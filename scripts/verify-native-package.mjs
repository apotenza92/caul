import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { createReleaseLaunchEnvironment } from './release-launch-env.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  options.set(process.argv[index], process.argv[index + 1]);
}
const platform = options.get('--platform');
const arch = options.get('--arch');
const channel = options.get('--channel') ?? 'stable';
const releaseDirectory = resolve(options.get('--release-dir') ?? 'release');
const explicitUnpackedDirectory = options.get('--unpacked-dir');
const publicOnly = options.get('--public-only') === 'true';
const packageVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;

function fail(message) {
  throw new Error(message);
}

function assertHost() {
  const expectedPlatform = platform === 'windows' ? 'win32' : platform;
  if (process.platform !== expectedPlatform || process.arch !== arch) {
    fail(`Package verification requires native ${expectedPlatform}/${arch}, received ${process.platform}/${process.arch}`);
  }
}

function executableArchitecture(filePath) {
  const file = readFileSync(filePath);
  if (file.subarray(0, 2).toString('ascii') === 'MZ') {
    const peOffset = file.readUInt32LE(0x3c);
    if (file.subarray(peOffset, peOffset + 4).toString('hex') !== '50450000') fail(`${filePath} has an invalid PE header`);
    const machine = file.readUInt16LE(peOffset + 4);
    return machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : `pe-${machine.toString(16)}`;
  }
  if (file.subarray(0, 4).toString('hex') === '7f454c46') {
    const littleEndian = file[5] === 1;
    const machine = littleEndian ? file.readUInt16LE(18) : file.readUInt16BE(18);
    return machine === 183 ? 'arm64' : machine === 62 ? 'x64' : `elf-${machine}`;
  }
  fail(`${filePath} is not a PE or ELF executable`);
}

function assertArchitecture(filePath) {
  if (!existsSync(filePath)) fail(`Required packaged executable is missing: ${filePath}`);
  const actual = executableArchitecture(filePath);
  if (actual !== arch) fail(`${filePath} architecture ${actual} does not match ${arch}`);
}

function findUnpackedDirectory() {
  if (explicitUnpackedDirectory) {
    const explicit = resolve(explicitUnpackedDirectory);
    if (!existsSync(explicit)) fail(`Explicit packaged application directory is missing: ${explicit}`);
    return explicit;
  }
  const preferred = platform === 'windows'
    ? `win-${arch}-unpacked`
    : arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`;
  const exact = join(releaseDirectory, preferred);
  if (existsSync(exact)) return exact;
  const matches = readdirSync(releaseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-unpacked'));
  fail(`Expected ${exact}; refusing fallback to ${matches.map((entry) => entry.name).join(', ') || 'no unpacked directory'}`);
}

function validatePackagedMetadata(root) {
  const archives = findNamedFiles(root, 'app.asar');
  if (archives.length !== 1) {
    fail(`Packaged application must contain one app.asar, found ${archives.length}`);
  }
  let metadata;
  try {
    metadata = JSON.parse(asar.extractFile(archives[0], 'package.json').toString('utf8'));
  } catch (error) {
    fail(`Could not read packaged package.json from ${archives[0]}: ${error.message}`);
  }
  const expectedName = channel === 'beta' ? 'caul-beta' : 'caul';
  if (metadata.name !== expectedName || metadata.version !== packageVersion) {
    fail(`Packaged metadata ${metadata.name}@${metadata.version} does not match ${expectedName}@${packageVersion}`);
  }
}

function runSmoke(executablePath) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'caul-native-package-'));
  try {
    const command = platform === 'linux' ? 'xvfb-run' : executablePath;
    const args = platform === 'linux' ? ['-a', executablePath, '--no-sandbox'] : [];
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      env: createReleaseLaunchEnvironment({
        ...(executablePath.endsWith('.AppImage') ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}),
        CAUL_DISABLE_MODEL_AUTO_DOWNLOAD: '1',
        CAUL_DISABLE_UPDATE_CHECKS: '1',
        CAUL_PACKAGED_LAUNCH_SMOKE_MS: '250',
        CAUL_USER_DATA_DIR: join(temporaryDirectory, 'user-data')
      }),
      timeout: 30_000
    });
    if (result.error || result.status !== 0) {
      fail(`Packaged app launch failed (${result.status}): ${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function inspectLinuxPackages() {
  const prefix = channel === 'beta' ? 'caul-beta' : 'caul';
  const appImage = join(releaseDirectory, `${prefix}-${arch}.AppImage`);
  const deb = join(releaseDirectory, `${prefix}-${arch}.deb`);
  for (const packagePath of [appImage, deb]) {
    if (!existsSync(packagePath)) fail(`Published Linux package is missing: ${packagePath}`);
  }
  chmodSync(appImage, 0o755);
  runSmoke(appImage);
  inspectExtractedLinuxPackage(deb, 'deb');
  if (arch === 'x64') {
    const rpm = join(releaseDirectory, `${prefix}-${arch}.rpm`);
    if (!existsSync(rpm)) fail(`Published RPM package is missing: ${rpm}`);
    inspectExtractedLinuxPackage(rpm, 'rpm');
  }
}

function inspectWindowsPackages() {
  const prefix = channel === 'beta' ? 'Caul-Beta' : 'Caul';
  const installer = join(releaseDirectory, `${prefix}-windows-${arch}-setup.exe`);
  const blockmap = `${installer}.blockmap`;
  for (const packagePath of [installer, blockmap]) {
    if (!existsSync(packagePath)) fail(`Published Windows package is missing: ${packagePath}`);
  }
}

function findNamedFiles(root, name) {
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) matches.push(...findNamedFiles(entryPath, name));
    else if (entry.isFile() && entry.name === name) matches.push(entryPath);
  }
  return matches;
}

function inspectExtractedLinuxPackage(packagePath, format) {
  const extractionRoot = mkdtempSync(join(tmpdir(), `caul-${format}-package-`));
  try {
    const extraction = format === 'deb'
      ? spawnSync('dpkg-deb', ['--extract', packagePath, extractionRoot], { encoding: 'utf8' })
      : spawnSync('bash', [
        '-c', 'cd "$1" && rpm2cpio "$2" | cpio -idm --quiet',
        'bash', extractionRoot, packagePath
      ], { encoding: 'utf8' });
    if (extraction.error || extraction.status !== 0) {
      fail(`${format} extraction failed: ${extraction.error?.message ?? ''}\n${extraction.stderr ?? ''}`);
    }
    const executableName = channel === 'beta' ? 'caul-beta' : 'caul';
    const appExecutables = findNamedFiles(extractionRoot, executableName);
    const backends = findNamedFiles(extractionRoot, 'caul-desktop-backend');
    if (appExecutables.length !== 1 || backends.length !== 1) {
      fail(`${format} package must contain one app and backend, found ${appExecutables.length} and ${backends.length}`);
    }
    validatePackagedMetadata(extractionRoot);
    assertArchitecture(appExecutables[0]);
    assertArchitecture(backends[0]);
    chmodSync(appExecutables[0], 0o755);
    runSmoke(appExecutables[0]);
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

assertHost();
if (!['windows', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch) || !['stable', 'beta'].includes(channel)) {
  fail('Usage: node scripts/verify-native-package.mjs --platform <windows|linux> --arch <arm64|x64> --channel <stable|beta>');
}
if (!publicOnly) {
  const unpackedDirectory = findUnpackedDirectory();
  const productName = channel === 'beta' ? 'Caul Beta' : 'Caul';
  const appExecutable = platform === 'windows'
    ? join(unpackedDirectory, `${productName}.exe`)
    : join(unpackedDirectory, channel === 'beta' ? 'caul-beta' : 'caul');
  const backendExecutable = join(
    unpackedDirectory,
    'resources',
    'bin',
    platform === 'windows' ? 'caul-desktop-backend.exe' : 'caul-desktop-backend'
  );
  assertArchitecture(appExecutable);
  assertArchitecture(backendExecutable);
  if (!existsSync(join(unpackedDirectory, 'resources', 'scripts', 'run-pi-json.py'))) {
    fail('Packaged app is missing resources/scripts/run-pi-json.py');
  }
  validatePackagedMetadata(unpackedDirectory);
  runSmoke(appExecutable);
}
if (platform === 'linux') {
  inspectLinuxPackages();
} else {
  inspectWindowsPackages();
}
console.log(`${platform}/${arch} ${channel} package architecture, resources and launch verification passed.`);

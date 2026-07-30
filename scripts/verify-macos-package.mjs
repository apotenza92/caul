import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  CAUL_MAC_ARCH,
  CAUL_MAC_MINIMUM_KERNEL_VERSION,
  CAUL_MAC_MINIMUM_SYSTEM_VERSION,
  normaliseFingerprint,
  parseCodesignMetadata,
  resolveMacReleaseContract,
  validateNotarisationRecord,
  validateSignatureMetadata
} from './macos-release-contract.mjs';
import { createReleaseLaunchEnvironment } from './release-launch-env.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { extractFile: extractAsarFile } = require('@electron/asar');
const YAML = require('js-yaml');
const machOMagic = new Set([
  'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe',
  'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'
]);
const signedBundleExtensions = ['.app', '.framework', '.xpc', '.appex', '.bundle'];
const allowedEntitlements = new Set([
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.device.audio-input',
  'com.apple.security.system-audio-capture'
]);

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    timeout: options.timeout,
    maxBuffer: 64 * 1024 * 1024
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    fail(`${command} ${args.join(' ')} failed (${result.status}):\n${output.trim()}`);
  }
  return { ...result, output };
}

function readOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hashFile(filePath, algorithm, encoding) {
  return createHash(algorithm).update(readFileSync(filePath)).digest(encoding);
}

function validateZipEntries(output, contract) {
  const entries = String(output).split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) {
    fail('Release ZIP contains no entries');
  }
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry)) {
      fail(`Release ZIP contains duplicate entry ${entry}`);
    }
    seen.add(entry);
    if (entry.includes('\\') || entry.includes('\0') || entry.startsWith('/')) {
      fail(`Release ZIP contains unsafe entry ${entry}`);
    }
    const segments = entry.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      fail(`Release ZIP contains traversal entry ${entry}`);
    }
    if (segments[0] !== contract.appName) {
      fail(`Release ZIP contains unexpected top-level entry ${entry}`);
    }
  }
  const executable = `${contract.appName}/Contents/MacOS/${contract.executableName}`;
  if (!seen.has(executable)) {
    fail(`Release ZIP is missing ${executable}`);
  }
}

function validateChecksum(artifactPath, required) {
  const checksumPath = `${artifactPath}.sha256`;
  if (!existsSync(checksumPath)) {
    if (required) {
      fail(`Required checksum is missing: ${checksumPath}`);
    }
    return;
  }
  const expected = `${hashFile(artifactPath, 'sha256', 'hex')}  ${basename(artifactPath)}`;
  if (readFileSync(checksumPath, 'utf8').trim() !== expected) {
    fail(`Checksum does not match ${basename(artifactPath)}`);
  }
}

function validateBlockmap(blockmapPath, artifactPath) {
  let blockmap;
  try {
    blockmap = JSON.parse(gunzipSync(readFileSync(blockmapPath)).toString('utf8'));
  } catch (error) {
    fail(`${blockmapPath} is not valid gzip-compressed JSON: ${error.message}`);
  }
  if (blockmap?.version !== '2' || !Array.isArray(blockmap.files) || blockmap.files.length === 0) {
    fail(`${blockmapPath} is not a non-empty blockmap v2 document`);
  }
  let representedBytes = 0;
  for (const file of blockmap.files) {
    if (!Array.isArray(file?.sizes) || !Array.isArray(file?.checksums) || file.sizes.length !== file.checksums.length) {
      fail(`${blockmapPath} contains an invalid file record`);
    }
    for (let index = 0; index < file.sizes.length; index += 1) {
      if (!Number.isInteger(file.sizes[index]) || file.sizes[index] <= 0 || typeof file.checksums[index] !== 'string') {
        fail(`${blockmapPath} contains an invalid block`);
      }
      representedBytes += file.sizes[index];
    }
  }
  if (representedBytes !== statSync(artifactPath).size) {
    fail(`${blockmapPath} represents ${representedBytes} bytes, expected ${statSync(artifactPath).size}`);
  }
}

export function validateUpdateMetadata(metadataPath, artifactPath) {
  let metadata;
  try {
    metadata = YAML.load(readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    fail(`${metadataPath} is invalid YAML: ${error.message}`);
  }
  if (!metadata || !Array.isArray(metadata.files) || typeof metadata.version !== 'string') {
    fail(`${metadataPath} does not contain updater files and a version`);
  }
  if (metadata.minimumSystemVersion !== CAUL_MAC_MINIMUM_KERNEL_VERSION) {
    fail(`${metadataPath} minimumSystemVersion must be ${CAUL_MAC_MINIMUM_KERNEL_VERSION}`);
  }
  const file = metadata.files.find((entry) => entry?.url === basename(artifactPath));
  if (!file) {
    fail(`${metadataPath} does not reference ${basename(artifactPath)}`);
  }
  if (file.size !== statSync(artifactPath).size) {
    fail(`${metadataPath} size does not match ${basename(artifactPath)}`);
  }
  const actualSha512 = hashFile(artifactPath, 'sha512', 'base64');
  if (file.sha512 !== actualSha512) {
    fail(`${metadataPath} SHA-512 does not match ${basename(artifactPath)}`);
  }
  if (metadata.path !== basename(artifactPath) || metadata.sha512 !== actualSha512) {
    fail(`${metadataPath} legacy path and SHA-512 do not match ${basename(artifactPath)}`);
  }
  const packageVersion = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')).version;
  if (metadata.version !== packageVersion) {
    fail(`${metadataPath} version ${metadata.version} does not match package ${packageVersion}`);
  }
}

function isMachO(filePath) {
  if (!lstatSync(filePath).isFile()) {
    return false;
  }
  const descriptor = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    return readSync(descriptor, header, 0, 4, 0) === 4 && machOMagic.has(header.toString('hex'));
  } finally {
    closeSync(descriptor);
  }
}

function collectCodeObjects(appPath) {
  const bundles = [appPath];
  const machOFiles = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(filePath);
        if (isAbsolute(target)) {
          fail(`App contains absolute symlink ${relative(appPath, filePath)} -> ${target}`);
        }
        const resolvedTarget = resolve(dirname(filePath), target);
        const relativeTarget = relative(appPath, resolvedTarget);
        if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)) {
          fail(`App contains escaping symlink ${relative(appPath, filePath)} -> ${target}`);
        }
      } else if (entry.isDirectory()) {
        if (signedBundleExtensions.some((extension) => entry.name.endsWith(extension))) {
          bundles.push(filePath);
        }
        visit(filePath);
      } else if (entry.isFile() && isMachO(filePath)) {
        machOFiles.push(filePath);
      }
    }
  }
  visit(appPath);
  return {
    bundles: [...new Set(bundles.map((bundlePath) => realpathSync(bundlePath)))].sort(),
    machOFiles: [...new Set(machOFiles.map((filePath) => realpathSync(filePath)))].sort()
  };
}

function parseEntitlements(targetPath) {
  const result = run('codesign', ['-d', '--xml', '--entitlements', '-', targetPath]);
  const xmlStart = result.stdout.indexOf('<?xml');
  if (xmlStart < 0) {
    return {};
  }
  const converted = run('plutil', ['-convert', 'json', '-o', '-', '--', '-'], {
    input: result.stdout.slice(xmlStart)
  });
  return JSON.parse(converted.stdout);
}

function validateEntitlements(entitlements, label) {
  for (const [key, value] of Object.entries(entitlements)) {
    if (key === 'com.apple.security.get-task-allow') {
      fail(`${label} includes forbidden get-task-allow entitlement`);
    }
    if (!allowedEntitlements.has(key) || value !== true) {
      fail(`${label} includes unexpected entitlement ${key}`);
    }
  }
}

function validateCertificate(targetPath, certificateDirectory, index, expectations, validateChain) {
  const prefix = join(certificateDirectory, `certificate-${index}-`);
  run('codesign', ['-d', `--extract-certificates=${prefix}`, targetPath]);
  const leafPath = `${prefix}0`;
  if (!existsSync(leafPath)) {
    fail(`codesign did not extract a leaf certificate for ${targetPath}`);
  }
  const fingerprint = normaliseFingerprint(hashFile(leafPath, 'sha256', 'hex'));
  if (fingerprint !== expectations.fingerprint) {
    fail(`${targetPath} leaf certificate ${fingerprint} does not match ${expectations.fingerprint}`);
  }
  if (validateChain) {
    const intermediatePath = `${prefix}1`;
    const rootPath = `${prefix}2`;
    if (!existsSync(intermediatePath) || !existsSync(rootPath)) {
      fail(`${targetPath} does not embed the complete signing certificate chain`);
    }
    run('security', [
      'verify-cert', '-N', '-L', '-p', 'codeSign',
      '-c', leafPath,
      '-c', intermediatePath,
      '-r', rootPath
    ]);
  }
}

function validateCodeObject(targetPath, context, options = {}) {
  const label = relative(context.appPath, targetPath) || context.contract.appName;
  run('codesign', ['--verify', '--strict', '--verbose=2', targetPath]);
  const metadata = parseCodesignMetadata(run('codesign', ['-dvvv', targetPath]).output);
  validateSignatureMetadata(metadata, context.expectations, label);
  validateEntitlements(parseEntitlements(targetPath), label);
  validateCertificate(
    targetPath,
    context.certificateDirectory,
    context.certificateIndex,
    context.expectations,
    options.validateChain === true
  );
  context.certificateIndex += 1;
  if (options.machO) {
    const architectures = run('lipo', ['-archs', targetPath]).stdout.trim().split(/\s+/).filter(Boolean);
    validateMachOArchitectures(architectures, label);
  }
  return metadata;
}

export function validateMachOArchitectures(architectures, label) {
  const allowedArchitectures = new Set([CAUL_MAC_ARCH, 'x86_64']);
  if (!architectures.includes(CAUL_MAC_ARCH)
    || architectures.some((architecture) => !allowedArchitectures.has(architecture))) {
    fail(
      `${label} architectures ${architectures.join(', ') || 'missing'} `
      + `must include ${CAUL_MAC_ARCH} and contain only supported Darwin slices`
    );
  }
}

function readPlistValue(plistPath, key) {
  return run('plutil', ['-extract', key, 'raw', '-o', '-', plistPath]).stdout.trim();
}

function validateEmbeddedUpdater(appPath, contract, version) {
  const resourcesPath = join(appPath, 'Contents', 'Resources');
  const asarPath = join(resourcesPath, 'app.asar');
  const updateConfigPath = join(resourcesPath, 'app-update.yml');
  if (!existsSync(asarPath) || !existsSync(updateConfigPath)) {
    fail('Packaged app is missing its updater configuration');
  }
  const packageMetadata = JSON.parse(extractAsarFile(asarPath, 'package.json').toString('utf8'));
  if (packageMetadata.name !== contract.packageName || packageMetadata.version !== version) {
    fail(`Packaged identity ${packageMetadata.name}@${packageMetadata.version} does not match ${contract.packageName}@${version}`);
  }
  const updateConfig = YAML.load(readFileSync(updateConfigPath, 'utf8'));
  if (updateConfig?.provider !== 'github'
    || updateConfig?.owner !== 'apotenza92'
    || updateConfig?.repo !== 'caul') {
    fail('Packaged updater does not use the maintained Caul GitHub release provider');
  }
  const actualChannel = updateConfig.channel ?? 'latest';
  if (actualChannel !== contract.updaterChannel) {
    fail(`Packaged updater channel ${actualChannel} does not match ${contract.updaterChannel}`);
  }
}

function verifyApplication(appPath, context) {
  const resolvedAppPath = realpathSync(appPath);
  const plistPath = join(resolvedAppPath, 'Contents', 'Info.plist');
  const executablePath = join(resolvedAppPath, 'Contents', 'MacOS', context.contract.executableName);
  if (!existsSync(plistPath) || !existsSync(executablePath)) {
    fail(`Package does not contain a complete ${context.contract.appName}`);
  }
  const plistExpectations = {
    CFBundleIdentifier: context.contract.bundleId,
    CFBundleShortVersionString: context.version,
    CFBundleVersion: context.version,
    CFBundleExecutable: context.contract.executableName,
    CFBundleIconFile: context.contract.iconFileName,
    LSMinimumSystemVersion: CAUL_MAC_MINIMUM_SYSTEM_VERSION
  };
  for (const [key, expected] of Object.entries(plistExpectations)) {
    const actual = readPlistValue(plistPath, key);
    if (actual !== expected) {
      fail(`${key} is ${actual}, expected ${expected}`);
    }
  }
  const packagedIcon = join(resolvedAppPath, 'Contents', 'Resources', context.contract.iconFileName);
  const sourceIcon = join(repositoryRoot, context.contract.sourceIconPath);
  if (!existsSync(packagedIcon) || !existsSync(sourceIcon)) {
    fail(`Package or source icon is missing for ${context.contract.appName}`);
  }
  if (hashFile(packagedIcon, 'sha256', 'hex') !== hashFile(sourceIcon, 'sha256', 'hex')) {
    fail(`Packaged icon does not match ${context.contract.sourceIconPath}`);
  }
  const backendPath = join(resolvedAppPath, 'Contents', 'Resources', 'bin', 'caul-desktop-backend');
  const audioHelperPath = join(resolvedAppPath, 'Contents', 'Resources', 'bin', 'CaulAudioHelper');
  for (const helperPath of [backendPath, audioHelperPath]) {
    if (!existsSync(helperPath) || !isMachO(helperPath)) {
      fail(`Package is missing required native helper ${relative(resolvedAppPath, helperPath)}`);
    }
  }
  validateEmbeddedUpdater(resolvedAppPath, context.contract, context.version);

  run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', resolvedAppPath]);
  const codeObjects = collectCodeObjects(resolvedAppPath);
  if (codeObjects.machOFiles.length === 0) {
    fail('Packaged app contains no Mach-O files');
  }
  for (const helperPath of [backendPath, audioHelperPath]) {
    if (!codeObjects.machOFiles.includes(realpathSync(helperPath))) {
      fail(`Required native helper is outside the verified code-object set: ${helperPath}`);
    }
  }
  const codeContext = { ...context, appPath: resolvedAppPath, certificateIndex: 0 };
  let appMetadata;
  for (const bundlePath of codeObjects.bundles) {
    const metadata = validateCodeObject(bundlePath, codeContext, {
      validateChain: bundlePath === resolvedAppPath
    });
    if (bundlePath === resolvedAppPath) {
      appMetadata = metadata;
    }
  }
  for (const machOPath of codeObjects.machOFiles) {
    validateCodeObject(machOPath, codeContext, { machO: true });
  }
  if (appMetadata?.ticket !== 'stapled') {
    fail('Packaged app does not report a stapled notarisation ticket');
  }
  run('xcrun', ['stapler', 'validate', resolvedAppPath]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', resolvedAppPath]);
  return { audioHelperPath, backendPath, executablePath, ...codeObjects };
}

export function main() {
  if (process.platform !== 'darwin' || process.arch !== CAUL_MAC_ARCH) {
    fail('macOS package verification requires a native Apple Silicon runner');
  }
  const channel = readOption('--channel', process.env.CAUL_RELEASE_CHANNEL ?? 'stable');
  const releaseDirectory = resolve(readOption('--release-dir', join(repositoryRoot, 'release')));
  const requireChecksum = process.argv.includes('--require-checksum');
  const skipLaunch = process.argv.includes('--skip-launch');
  const contract = resolveMacReleaseContract(channel);
  const requiredEnvironment = ['APPLE_SIGNING_CERTIFICATE_SHA256', 'APPLE_SIGNING_IDENTITY', 'APPLE_TEAM_ID'];
  for (const name of requiredEnvironment) {
    if (!process.env[name]?.trim()) {
      fail(`Required verification environment variable is missing: ${name}`);
    }
  }
  const expectations = {
    fingerprint: normaliseFingerprint(process.env.APPLE_SIGNING_CERTIFICATE_SHA256),
    identity: process.env.APPLE_SIGNING_IDENTITY,
    teamId: process.env.APPLE_TEAM_ID
  };
  const version = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')).version;
  const artifactPath = join(releaseDirectory, contract.artifactName);
  const blockmapPath = join(releaseDirectory, contract.blockmapName);
  const metadataPath = join(releaseDirectory, contract.metadataName);
  const appNotarisationPath = join(
    releaseDirectory,
    `notarization-${channel}-macos-arm64.json`
  );
  const distributableNotarisationPath = join(
    releaseDirectory,
    `notarization-${channel}-macos-arm64-distributable.json`
  );
  for (const requiredPath of [
    artifactPath,
    blockmapPath,
    metadataPath,
    appNotarisationPath,
    distributableNotarisationPath
  ]) {
    if (!existsSync(requiredPath)) {
      fail(`Required macOS release output is missing: ${requiredPath}`);
    }
  }

  run('unzip', ['-tq', artifactPath]);
  validateZipEntries(run('unzip', ['-Z1', artifactPath]).stdout, contract);
  validateChecksum(artifactPath, requireChecksum);
  validateBlockmap(blockmapPath, artifactPath);
  validateUpdateMetadata(metadataPath, artifactPath);
  validateNotarisationRecord(JSON.parse(readFileSync(appNotarisationPath, 'utf8')));
  validateNotarisationRecord(JSON.parse(readFileSync(distributableNotarisationPath, 'utf8')));

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'caul-verify-'));
  const extractionDirectory = join(temporaryDirectory, 'zip');
  const certificateDirectory = join(temporaryDirectory, 'certificates');
  const userDataDirectory = join(temporaryDirectory, 'user-data');
  mkdirSync(extractionDirectory, { mode: 0o700 });
  mkdirSync(certificateDirectory, { mode: 0o700 });
  mkdirSync(userDataDirectory, { mode: 0o700 });
  try {
    run('ditto', ['-x', '-k', artifactPath, extractionDirectory]);
    const topLevel = readdirSync(extractionDirectory);
    if (topLevel.length !== 1 || topLevel[0] !== contract.appName) {
      fail(`ZIP extracted unexpected top-level entries: ${topLevel.join(', ')}`);
    }
    const verified = verifyApplication(join(extractionDirectory, contract.appName), {
      certificateDirectory,
      contract,
      expectations,
      version
    });
    const helperEnvironment = createReleaseLaunchEnvironment({
      HOME: temporaryDirectory,
      TMPDIR: temporaryDirectory
    });
    run(verified.backendPath, ['--fixture-live-pipeline'], {
      env: helperEnvironment,
      timeout: 30_000
    });
    run(verified.audioHelperPath, ['--capabilities'], {
      env: helperEnvironment,
      timeout: 30_000
    });
    if (!skipLaunch) {
      run(verified.executablePath, [], {
        env: createReleaseLaunchEnvironment({
          CAUL_DISABLE_UPDATE_CHECKS: '1',
          CAUL_SMOKE_EXIT_MS: '1000',
          CAUL_USER_DATA_DIR: userDataDirectory
        }),
        timeout: 30_000
      });
    }
    console.log(
      `macOS ${channel}/arm64 package verification passed `
      + `(${verified.machOFiles.length} Mach-O files, ${verified.bundles.length} signed bundles).`
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}

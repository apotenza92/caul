import asar from '@electron/asar';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const privateBuild = process.argv.includes('--private');
const { extractFile, listPackage } = asar;
const appName = privateBuild ? 'Caul Dev-Private' : 'Caul Dev';
const expectedBundleId = privateBuild ? 'dev.caul.app.dev-private' : 'dev.caul.app.dev';
const outputDirectory = privateBuild ? 'release-dev-private' : 'release-dev';
const appPath = join(process.cwd(), outputDirectory, 'mac-arm64', `${appName}.app`);
const resourcesPath = join(appPath, 'Contents', 'Resources');
const asarPath = join(resourcesPath, 'app.asar');

if (!existsSync(asarPath)) {
  throw new Error(`Missing packaged application archive: ${asarPath}`);
}

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

const signature = run('codesign', ['-dv', '--verbose=4', appPath], { captureStderr: true });
if (!signature.includes('Authority=Apple Development:')) {
  throw new Error('The packaged development app is not signed with an Apple Development identity.');
}

const bundleId = run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(appPath, 'Contents', 'Info.plist')]).trim();
if (bundleId !== expectedBundleId) {
  throw new Error(`Expected bundle ID ${expectedBundleId}; received ${bundleId || 'none'}.`);
}

const packagedFiles = listPackage(asarPath);
const requiredFiles = [
  '/electron/piChatGptAuth.cjs',
  '/electron/piEnvironment.cjs',
  '/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
  '/node_modules/@earendil-works/pi-coding-agent/package.json',
  '/node_modules/brace-expansion/package.json'
];

for (const requiredFile of requiredFiles) {
  if (!packagedFiles.includes(requiredFile)) {
    throw new Error(`Packaged app is missing ${requiredFile}.`);
  }
}

const prohibitedName = /(?:^|\/)(?:auth\.json|provider-credentials\.json|\.env(?:\..*)?)$/iu;
const prohibitedFiles = [
  ...packagedFiles.filter((file) => prohibitedName.test(file)),
  ...listFiles(resourcesPath).filter((file) => prohibitedName.test(file))
];

if (prohibitedFiles.length > 0) {
  throw new Error(`Packaged app contains credential material: ${prohibitedFiles.join(', ')}`);
}

const piPackage = JSON.parse(
  extractFile(asarPath, 'node_modules/@earendil-works/pi-coding-agent/package.json').toString('utf8')
);
if (piPackage.version !== '0.83.0') {
  throw new Error(`Expected bundled Pi 0.83.0; received ${piPackage.version ?? 'none'}.`);
}

const nestedBraceExpansionPrefix = '/node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion/';
if (packagedFiles.some((file) => file.startsWith(nestedBraceExpansionPrefix))) {
  throw new Error('Packaged Pi contains its superseded nested brace-expansion runtime.');
}

const nestedUndiciPrefix = '/node_modules/@earendil-works/pi-coding-agent/node_modules/undici/';
if (packagedFiles.some((file) => file.startsWith(nestedUndiciPrefix))) {
  throw new Error('Packaged Pi contains its superseded nested Undici runtime.');
}

const braceExpansionPackage = JSON.parse(
  extractFile(asarPath, 'node_modules/brace-expansion/package.json').toString('utf8')
);
if (braceExpansionPackage.version !== '5.0.9') {
  throw new Error(
    `Expected bundled brace-expansion 5.0.9; received ${braceExpansionPackage.version ?? 'none'}.`
  );
}

const undiciPackage = JSON.parse(
  extractFile(asarPath, 'node_modules/undici/package.json').toString('utf8')
);
if (undiciPackage.version !== '8.10.0') {
  throw new Error(`Expected bundled undici 8.10.0; received ${undiciPackage.version ?? 'none'}.`);
}

console.log(`caul-macos-dev-package ${JSON.stringify({
  appPath,
  braceExpansionVersion: braceExpansionPackage.version,
  bundleId,
  piVersion: piPackage.version,
  signed: true,
  undiciVersion: undiciPackage.version
})}`);

function listFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(prefix, entry.name);

    return entry.isDirectory()
      ? listFiles(root, relativePath)
      : [relativePath];
  });
}

function run(command, args, { captureStderr = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8'
  });
  const output = captureStderr
    ? `${result.stdout ?? ''}${result.stderr ?? ''}`
    : result.stdout ?? '';

  if (result.status !== 0) {
    throw new Error(output.trim() || `${command} exited with status ${result.status}.`);
  }

  return output;
}

#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const appPackageJson = path.join(rootDir, 'package.json');
const piPackageJson = path.join(rootDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json');

if (!fs.existsSync(piPackageJson)) {
  console.error('Bundled Pi package is missing. Run npm install first.');
  process.exit(1);
}

const piPackage = JSON.parse(fs.readFileSync(piPackageJson, 'utf8'));
const appPackage = JSON.parse(fs.readFileSync(appPackageJson, 'utf8'));
const licence = String(piPackage.license ?? '').trim();
const pinnedVersion = appPackage.dependencies?.[piPackage.name];
const braceExpansionPackageJson = require.resolve('brace-expansion/package.json', {
  paths: [path.dirname(piPackageJson)]
});
const braceExpansionPackage = JSON.parse(
  fs.readFileSync(braceExpansionPackageJson, 'utf8')
);
const undiciPackageJson = require.resolve('undici/package.json', {
  paths: [path.dirname(piPackageJson)]
});
const undiciPackage = JSON.parse(fs.readFileSync(undiciPackageJson, 'utf8'));

function resolvePackageJson(name, searchPaths) {
  try {
    return require.resolve(`${name}/package.json`, { paths: searchPaths });
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    let directory = path.dirname(require.resolve(name, { paths: searchPaths }));
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'package.json');
      if (fs.existsSync(candidate)) {
        const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (metadata.name === name) return candidate;
      }
      directory = path.dirname(directory);
    }
    throw error;
  }
}

const tufPackageJson = require.resolve('tuf-js/package.json', { paths: [rootDir] });
const tufPackage = JSON.parse(fs.readFileSync(tufPackageJson, 'utf8'));
const tufModelsPackageJson = require.resolve('@tufjs/models/package.json', {
  paths: [path.dirname(tufPackageJson)]
});
const tufRuntimePackages = [
  ['tuf-js', tufPackageJson, '5.0.1', 'MIT'],
  [
    '@tufjs/models',
    tufModelsPackageJson,
    '4.1.1',
    'MIT'
  ],
  [
    '@tufjs/canonical-json',
    require.resolve('@tufjs/canonical-json/package.json', { paths: [path.dirname(tufPackageJson)] }),
    '2.0.0',
    'MIT'
  ],
  [
    '@gar/promise-retry',
    resolvePackageJson('@gar/promise-retry', [path.dirname(tufPackageJson)]),
    '1.0.3',
    'MIT'
  ],
  [
    'minimatch',
    require.resolve('minimatch/package.json', { paths: [path.dirname(tufModelsPackageJson)] }),
    '10.2.5',
    'BlueOak-1.0.0'
  ]
].map(([name, packagePath, version, expectedLicence]) => ({
  expectedLicence,
  name,
  package: JSON.parse(fs.readFileSync(packagePath, 'utf8')),
  version
}));

if (pinnedVersion !== piPackage.version) {
  console.error(`Pi must be pinned to the installed exact version. Expected ${piPackage.version}, found ${pinnedVersion || 'missing'}.`);
  process.exit(1);
}

if (piPackage.dependencies?.undici !== '8.10.0') {
  console.error(`Prepared Pi must require undici 8.10.0. Found ${piPackage.dependencies?.undici || 'missing'}.`);
  process.exit(1);
}

if (licence !== 'MIT') {
  console.error(`Pi package licence must be MIT before bundling. Found: ${licence || 'unknown'}`);
  process.exit(1);
}

if (
  appPackage.dependencies?.['brace-expansion'] !== '5.0.9'
  || braceExpansionPackage.version !== '5.0.9'
  || braceExpansionPackage.license !== 'MIT'
) {
  console.error('Pi must resolve the maintained brace-expansion 5.0.9 MIT runtime.');
  process.exit(1);
}

if (
  appPackage.dependencies?.undici !== '8.10.0'
  || undiciPackage.version !== '8.10.0'
  || undiciPackage.license !== 'MIT'
) {
  console.error('Pi must resolve the maintained undici 8.10.0 MIT runtime.');
  process.exit(1);
}

if (appPackage.dependencies?.['tuf-js'] !== tufPackage.version) {
  console.error(
    `tuf-js must be pinned to the installed exact version. `
    + `Expected ${tufPackage.version}, found ${appPackage.dependencies?.['tuf-js'] || 'missing'}.`
  );
  process.exit(1);
}

if (appPackage.devDependencies?.['@tufjs/canonical-json'] !== '2.0.0') {
  console.error('The TUF signing canonical JSON implementation must be pinned to 2.0.0.');
  process.exit(1);
}

for (const reviewed of tufRuntimePackages) {
  if (
    reviewed.package.name !== reviewed.name
    || reviewed.package.version !== reviewed.version
    || reviewed.package.license !== reviewed.expectedLicence
  ) {
    console.error(
      `Reviewed updater dependency mismatch for ${reviewed.name}. `
      + `Expected ${reviewed.version} (${reviewed.expectedLicence}), found `
      + `${reviewed.package.version || 'unknown'} (${reviewed.package.license || 'unknown'}).`
    );
    process.exit(1);
  }
}

console.log(
  `Bundled dependency licences verified: ${piPackage.name}@${piPackage.version} (${licence}), `
  + `brace-expansion@${braceExpansionPackage.version} (${braceExpansionPackage.license}), `
  + `undici@${undiciPackage.version} (${undiciPackage.license}), `
  + `${tufRuntimePackages.map((entry) => (
    `${entry.name}@${entry.version} (${entry.expectedLicence})`
  )).join(', ')}`
);

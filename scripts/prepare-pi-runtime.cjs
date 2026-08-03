#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const requiredBraceExpansionVersion = '5.0.9';
const requiredUndiciVersion = '8.10.0';
const piDir = path.join(
  rootDir,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent'
);
const piPackagePath = path.join(piDir, 'package.json');
const nestedBraceExpansionDir = path.join(
  piDir,
  'node_modules',
  'brace-expansion'
);
const nestedUndiciDir = path.join(piDir, 'node_modules', 'undici');
const rootBraceExpansionPackage = path.join(
  rootDir,
  'node_modules',
  'brace-expansion',
  'package.json'
);
const rootUndiciPackage = path.join(rootDir, 'node_modules', 'undici', 'package.json');

function readPackage(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (
  !fs.existsSync(piDir)
  || !fs.existsSync(rootBraceExpansionPackage)
  || !fs.existsSync(rootUndiciPackage)
) {
  console.error('Pi and its maintained brace-expansion and Undici runtimes must be installed.');
  process.exit(1);
}

const rootBraceExpansion = readPackage(rootBraceExpansionPackage);
const rootUndici = readPackage(rootUndiciPackage);
const piPackage = readPackage(piPackagePath);

if (
  piPackage.version !== '0.83.0'
  || !['8.5.0', requiredUndiciVersion].includes(piPackage.dependencies?.undici)
) {
  console.error(
    `Refusing to prepare unexpected Pi ${piPackage.version ?? 'unknown'} `
    + `with undici ${piPackage.dependencies?.undici ?? 'unknown'}.`
  );
  process.exit(1);
}

if (
  rootBraceExpansion.version !== requiredBraceExpansionVersion
  || rootBraceExpansion.license !== 'MIT'
) {
  console.error(
    `Expected brace-expansion ${requiredBraceExpansionVersion} (MIT), found `
    + `${rootBraceExpansion.version ?? 'unknown'} (${rootBraceExpansion.license ?? 'unknown'}).`
  );
  process.exit(1);
}

if (rootUndici.version !== requiredUndiciVersion || rootUndici.license !== 'MIT') {
  console.error(
    `Expected undici ${requiredUndiciVersion} (MIT), found `
    + `${rootUndici.version ?? 'unknown'} (${rootUndici.license ?? 'unknown'}).`
  );
  process.exit(1);
}

if (fs.existsSync(nestedBraceExpansionDir)) {
  const nestedPackage = readPackage(path.join(nestedBraceExpansionDir, 'package.json'));

  if (
    nestedPackage.version !== '5.0.7'
    && nestedPackage.version !== '5.0.8'
    && nestedPackage.version !== requiredBraceExpansionVersion
  ) {
    console.error(
      `Refusing to replace unexpected Pi brace-expansion ${nestedPackage.version ?? 'unknown'}.`
    );
    process.exit(1);
  }

  fs.rmSync(nestedBraceExpansionDir, { force: true, recursive: true });
}

if (fs.existsSync(nestedUndiciDir)) {
  const nestedPackage = readPackage(path.join(nestedUndiciDir, 'package.json'));

  if (nestedPackage.version !== '8.5.0' && nestedPackage.version !== requiredUndiciVersion) {
    console.error(`Refusing to replace unexpected Pi undici ${nestedPackage.version ?? 'unknown'}.`);
    process.exit(1);
  }

  fs.rmSync(nestedUndiciDir, { force: true, recursive: true });
}

piPackage.dependencies.undici = requiredUndiciVersion;
fs.writeFileSync(piPackagePath, `${JSON.stringify(piPackage, null, 2)}\n`);

const resolvedPackage = require.resolve('brace-expansion/package.json', {
  paths: [piDir]
});
const resolvedBraceExpansion = readPackage(resolvedPackage);

if (resolvedBraceExpansion.version !== requiredBraceExpansionVersion) {
  console.error(
    `Pi resolves brace-expansion ${resolvedBraceExpansion.version ?? 'unknown'}, `
    + `not ${requiredBraceExpansionVersion}.`
  );
  process.exit(1);
}

const resolvedUndiciPackage = require.resolve('undici/package.json', { paths: [piDir] });
const resolvedUndici = readPackage(resolvedUndiciPackage);

if (resolvedUndici.version !== requiredUndiciVersion) {
  console.error(
    `Pi resolves undici ${resolvedUndici.version ?? 'unknown'}, not ${requiredUndiciVersion}.`
  );
  process.exit(1);
}

console.log(
  `Pi runtime prepared with brace-expansion ${requiredBraceExpansionVersion} `
  + `and undici ${requiredUndiciVersion}.`
);

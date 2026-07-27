#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const requiredBraceExpansionVersion = '5.0.8';
const piDir = path.join(
  rootDir,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent'
);
const nestedBraceExpansionDir = path.join(
  piDir,
  'node_modules',
  'brace-expansion'
);
const rootBraceExpansionPackage = path.join(
  rootDir,
  'node_modules',
  'brace-expansion',
  'package.json'
);

function readPackage(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

if (!fs.existsSync(piDir) || !fs.existsSync(rootBraceExpansionPackage)) {
  console.error('Pi and the maintained brace-expansion runtime must both be installed.');
  process.exit(1);
}

const rootBraceExpansion = readPackage(rootBraceExpansionPackage);

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

if (fs.existsSync(nestedBraceExpansionDir)) {
  const nestedPackage = readPackage(path.join(nestedBraceExpansionDir, 'package.json'));

  if (
    nestedPackage.version !== '5.0.7'
    && nestedPackage.version !== requiredBraceExpansionVersion
  ) {
    console.error(
      `Refusing to replace unexpected Pi brace-expansion ${nestedPackage.version ?? 'unknown'}.`
    );
    process.exit(1);
  }

  fs.rmSync(nestedBraceExpansionDir, { force: true, recursive: true });
}

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

console.log(
  `Pi runtime prepared with brace-expansion ${requiredBraceExpansionVersion}.`
);

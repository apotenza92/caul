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

if (pinnedVersion !== piPackage.version) {
  console.error(`Pi must be pinned to the installed exact version. Expected ${piPackage.version}, found ${pinnedVersion || 'missing'}.`);
  process.exit(1);
}

if (licence !== 'MIT') {
  console.error(`Pi package licence must be MIT before bundling. Found: ${licence || 'unknown'}`);
  process.exit(1);
}

if (
  appPackage.dependencies?.['brace-expansion'] !== '5.0.8'
  || braceExpansionPackage.version !== '5.0.8'
  || braceExpansionPackage.license !== 'MIT'
) {
  console.error('Pi must resolve the maintained brace-expansion 5.0.8 MIT runtime.');
  process.exit(1);
}

console.log(
  `Pi licences verified: ${piPackage.name}@${piPackage.version} (${licence}), `
  + `brace-expansion@${braceExpansionPackage.version} (${braceExpansionPackage.license})`
);

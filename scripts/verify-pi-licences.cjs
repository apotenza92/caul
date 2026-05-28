#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const piPackageJson = path.join(rootDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json');

if (!fs.existsSync(piPackageJson)) {
  console.error('Bundled Pi package is missing. Run npm install first.');
  process.exit(1);
}

const piPackage = JSON.parse(fs.readFileSync(piPackageJson, 'utf8'));
const licence = String(piPackage.license ?? '').trim();

if (licence !== 'MIT') {
  console.error(`Pi package licence must be MIT before bundling. Found: ${licence || 'unknown'}`);
  process.exit(1);
}

console.log(`Pi licence verified: ${piPackage.name}@${piPackage.version} (${licence})`);

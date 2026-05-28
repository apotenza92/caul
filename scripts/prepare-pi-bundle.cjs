#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const bundleDir = path.join(rootDir, '.susura', 'pi-bundle');
const packageJsonPath = path.join(bundleDir, 'package.json');

fs.rmSync(bundleDir, { force: true, recursive: true });
fs.mkdirSync(bundleDir, { recursive: true });
fs.writeFileSync(packageJsonPath, `${JSON.stringify({
  private: true,
  dependencies: {
    '@earendil-works/pi-coding-agent': '0.75.5'
  }
}, null, 2)}\n`);

const result = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts'], {
  cwd: bundleDir,
  stdio: 'inherit'
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const piPackageJson = path.join(bundleDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json');
const piPackage = JSON.parse(fs.readFileSync(piPackageJson, 'utf8'));

if (piPackage.license !== 'MIT') {
  console.error(`Pi package licence must be MIT before bundling. Found: ${piPackage.license ?? 'unknown'}`);
  process.exit(1);
}

console.log(`Prepared bundled Pi: ${piPackage.name}@${piPackage.version}`);

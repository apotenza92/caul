#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const affinityPath = path.join(rootDir, 'assets', 'susura.af');
const iconsDir = path.join(rootDir, 'assets', 'icons');
const markPngPath = path.join(iconsDir, 'susura-mark.png');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngEnd = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(affinityPath)) {
  fail(`Missing Affinity source: ${path.relative(rootDir, affinityPath)}`);
}

const affinityData = fs.readFileSync(affinityPath);
const pngStart = affinityData.indexOf(pngSignature);

if (pngStart < 0) {
  fail([
    'Could not find an embedded PNG preview in assets/susura.af.',
    'Open the Affinity file, export the mark as assets/icons/susura-mark.png, then run npm run generate-icons.'
  ].join('\n'));
}

const pngEndIndex = affinityData.indexOf(pngEnd, pngStart);

if (pngEndIndex < 0) {
  fail('Found a PNG signature in assets/susura.af, but could not find its end marker.');
}

fs.mkdirSync(iconsDir, { recursive: true });
fs.writeFileSync(markPngPath, affinityData.subarray(pngStart, pngEndIndex + pngEnd.length));
console.log(`Extracted ${path.relative(rootDir, markPngPath)}`);

const result = spawnSync(process.execPath, [path.join(__dirname, 'generate-icons.cjs')], {
  cwd: rootDir,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);

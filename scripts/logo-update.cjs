#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');

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

async function main() {
  fs.mkdirSync(iconsDir, { recursive: true });

  const trimmedMark = await sharp(affinityData.subarray(pngStart, pngEndIndex + pngEnd.length))
    .ensureAlpha()
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      threshold: 10
    })
    .png()
    .toBuffer();

  const paddedMark = await sharp(trimmedMark)
    .resize(360, 360, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fit: 'contain'
    })
    .png()
    .toBuffer();
  const paddedMarkMetadata = await sharp(paddedMark).metadata();

  await sharp({
    create: {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      channels: 4,
      height: 512,
      width: 512
    }
  })
    .composite([{
      input: paddedMark,
      left: Math.round((512 - (paddedMarkMetadata.width ?? 360)) / 2),
      top: Math.round((512 - (paddedMarkMetadata.height ?? 360)) / 2)
    }])
    .png()
    .toFile(markPngPath);
  console.log(`Extracted ${path.relative(rootDir, markPngPath)}`);

  const result = spawnSync(process.execPath, [path.join(__dirname, 'generate-icons.cjs')], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

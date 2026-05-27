#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pngToIco = require('png-to-ico');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..');
const iconsDir = path.join(rootDir, 'assets', 'icons');
const lightBackground = '#ffffff';
const darkBackground = '#161616';

const variants = [
  {
    background: lightBackground,
    dir: iconsDir,
    source: path.join(iconsDir, 'susura-ear.svg')
  },
  {
    background: lightBackground,
    dir: path.join(iconsDir, 'beta'),
    source: path.join(iconsDir, 'susura-ear-beta.svg')
  },
  {
    background: darkBackground,
    dir: path.join(iconsDir, 'dark'),
    source: path.join(iconsDir, 'susura-ear.svg')
  },
  {
    background: darkBackground,
    dir: path.join(iconsDir, 'beta', 'dark'),
    source: path.join(iconsDir, 'susura-ear-beta.svg')
  }
];

const iconsetSizes = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 }
];

const pngSizes = [512, 256, 128, 96, 72, 64, 48, 32, 24, 22, 16];
const icoSizes = [256, 128, 64, 48, 32, 24, 16];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function renderIcon(svgBuffer, size, outputPath, background, backgroundScale = 0.83, glyphScale = 0.68) {
  const bgSize = Math.floor(size * backgroundScale);
  const bgPadding = Math.floor((size - bgSize) / 2);
  const glyphSize = Math.floor(size * glyphScale);
  const glyphPadding = Math.floor((size - glyphSize) / 2);
  const radius = Math.floor(bgSize * 0.2237);
  const backgroundSvg = `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${bgPadding}" y="${bgPadding}" width="${bgSize}" height="${bgSize}" rx="${radius}" fill="${background}"/>
</svg>`;
  const glyph = await sharp(svgBuffer)
    .resize(glyphSize, glyphSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(Buffer.from(backgroundSvg))
    .composite([{ input: glyph, left: glyphPadding, top: glyphPadding }])
    .png()
    .toFile(outputPath);
}

async function renderPlainPng(svgBuffer, size, outputPath, background) {
  await renderIcon(svgBuffer, size, outputPath, background, 0.85, 0.68);
}

async function generateVariant(variant) {
  const svgBuffer = fs.readFileSync(variant.source);
  const iconsetDir = path.join(variant.dir, 'icon.iconset');
  const linuxDir = path.join(variant.dir, 'linux');
  const icoDir = path.join(variant.dir, 'ico-rounded');

  ensureDir(variant.dir);
  ensureDir(iconsetDir);
  ensureDir(linuxDir);
  ensureDir(icoDir);

  for (const size of pngSizes) {
    await renderPlainPng(svgBuffer, size, path.join(variant.dir, `icon-${size}.png`), variant.background);
    await renderPlainPng(svgBuffer, size, path.join(linuxDir, `${size}x${size}.png`), variant.background);
  }

  await renderPlainPng(svgBuffer, 512, path.join(variant.dir, 'icon.png'), variant.background);
  await renderPlainPng(svgBuffer, 512, path.join(variant.dir, 'icon-rounded.png'), variant.background);

  for (const { name, size } of iconsetSizes) {
    await renderIcon(svgBuffer, size, path.join(iconsetDir, name), variant.background);
  }

  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(variant.dir, 'icon.icns')], { stdio: 'inherit' });
  }

  for (const size of icoSizes) {
    await renderPlainPng(svgBuffer, size, path.join(icoDir, `icon-${size}.png`), variant.background);
  }

  const icoBuffer = await pngToIco(icoSizes.map((size) => path.join(icoDir, `icon-${size}.png`)));
  fs.writeFileSync(path.join(variant.dir, 'icon.ico'), icoBuffer);
}

async function main() {
  ensureDir(iconsDir);

  for (const variant of variants) {
    console.log(`Generating icons in ${path.relative(rootDir, variant.dir)}`);
    await generateVariant(variant);
  }

  fs.copyFileSync(path.join(iconsDir, 'icon-rounded.png'), path.join(iconsDir, 'icon-rounded-readme.png'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pngToIco = require('png-to-ico');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..');
const iconsDir = path.join(rootDir, 'assets', 'icons');

const palettes = {
  stable: {
    base: '#0f766e',
    baseDark: '#0b4f4a',
    baseLight: '#2dd4bf',
    accent: '#a7f3d0',
    shadow: '#083f3b'
  },
  beta: {
    base: '#c2410c',
    baseDark: '#7c2d12',
    baseLight: '#fb923c',
    accent: '#fed7aa',
    shadow: '#5f220d'
  },
  stableDark: {
    base: '#0f766e',
    baseDark: '#071f1d',
    baseLight: '#14b8a6',
    accent: '#ccfbf1',
    shadow: '#031412'
  },
  betaDark: {
    base: '#c2410c',
    baseDark: '#241008',
    baseLight: '#ea580c',
    accent: '#ffedd5',
    shadow: '#170904'
  }
};

const variants = [
  {
    dir: iconsDir,
    palette: palettes.stable,
    source: path.join(iconsDir, 'susura-ear.svg')
  },
  {
    dir: path.join(iconsDir, 'beta'),
    palette: palettes.beta,
    source: path.join(iconsDir, 'susura-ear-beta.svg')
  },
  {
    dir: path.join(iconsDir, 'dark'),
    palette: palettes.stableDark,
    source: path.join(iconsDir, 'susura-ear.svg')
  },
  {
    dir: path.join(iconsDir, 'beta', 'dark'),
    palette: palettes.betaDark,
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

function renderBackgroundSvg(size, palette, backgroundScale) {
  const bgSize = Math.floor(size * backgroundScale);
  const bgPadding = Math.floor((size - bgSize) / 2);
  const radius = Math.floor(bgSize * 0.2237);
  const highlightRadius = Math.floor(bgSize * 0.44);
  const glowRadius = Math.floor(bgSize * 0.54);

  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tile" x1="${bgPadding}" y1="${bgPadding}" x2="${bgPadding + bgSize}" y2="${bgPadding + bgSize}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${palette.baseLight}"/>
      <stop offset="0.5" stop-color="${palette.base}"/>
      <stop offset="1" stop-color="${palette.baseDark}"/>
    </linearGradient>
    <radialGradient id="highlight" cx="${bgPadding + bgSize * 0.3}" cy="${bgPadding + bgSize * 0.24}" r="${highlightRadius}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.82"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow" cx="${bgPadding + bgSize * 0.8}" cy="${bgPadding + bgSize * 0.84}" r="${glowRadius}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${palette.shadow}" stop-opacity="0.58"/>
      <stop offset="1" stop-color="${palette.shadow}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft-shadow" x="-18%" y="-18%" width="136%" height="136%">
      <feDropShadow dx="0" dy="${Math.max(1, size * 0.018)}" stdDeviation="${Math.max(1, size * 0.028)}" flood-color="${palette.shadow}" flood-opacity="0.32"/>
    </filter>
  </defs>
  <rect x="${bgPadding}" y="${bgPadding}" width="${bgSize}" height="${bgSize}" rx="${radius}" fill="url(#tile)" filter="url(#soft-shadow)"/>
  <rect x="${bgPadding}" y="${bgPadding}" width="${bgSize}" height="${bgSize}" rx="${radius}" fill="url(#highlight)"/>
  <rect x="${bgPadding}" y="${bgPadding}" width="${bgSize}" height="${bgSize}" rx="${radius}" fill="url(#glow)"/>
</svg>`;
}

async function renderIcon(svgBuffer, size, outputPath, palette, backgroundScale = 0.83, glyphScale = 0.62) {
  const backgroundSvg = renderBackgroundSvg(size, palette, backgroundScale);
  const glyphSize = Math.floor(size * glyphScale);
  const glyphPaddingX = Math.floor((size - glyphSize) / 2);
  const glyphPaddingY = Math.floor((size - glyphSize) / 2) + Math.floor(size * 0.018);
  const glyph = await sharp(svgBuffer)
    .resize(glyphSize, glyphSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(Buffer.from(backgroundSvg))
    .composite([{ input: glyph, left: glyphPaddingX, top: glyphPaddingY }])
    .png()
    .toFile(outputPath);
}

async function renderPlainPng(svgBuffer, size, outputPath, palette) {
  await renderIcon(svgBuffer, size, outputPath, palette, 0.85, 0.62);
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
    await renderPlainPng(svgBuffer, size, path.join(variant.dir, `icon-${size}.png`), variant.palette);
    await renderPlainPng(svgBuffer, size, path.join(linuxDir, `${size}x${size}.png`), variant.palette);
  }

  await renderPlainPng(svgBuffer, 512, path.join(variant.dir, 'icon.png'), variant.palette);
  await renderPlainPng(svgBuffer, 512, path.join(variant.dir, 'icon-rounded.png'), variant.palette);

  for (const { name, size } of iconsetSizes) {
    await renderIcon(svgBuffer, size, path.join(iconsetDir, name), variant.palette);
  }

  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(variant.dir, 'icon.icns')], { stdio: 'inherit' });
  }

  for (const size of icoSizes) {
    await renderPlainPng(svgBuffer, size, path.join(icoDir, `icon-${size}.png`), variant.palette);
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

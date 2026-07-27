#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pngToIco = require('png-to-ico');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..');
const iconsDir = path.join(rootDir, 'assets', 'icons');
const markSource = path.join(rootDir, 'assets', 'caul-icon.svg');

const palettes = {
  stable: {
    base: '#34424A',
    baseDark: '#263238',
    baseLight: '#8EA6AD',
    accent: '#B8A46A',
    shadow: '#101619'
  },
  beta: {
    base: '#B8A46A',
    baseDark: '#34424A',
    baseLight: '#D8C98C',
    accent: '#8EA6AD',
    shadow: '#101619'
  },
  stableDark: {
    base: '#34424A',
    baseDark: '#101619',
    baseLight: '#8EA6AD',
    accent: '#B8A46A',
    shadow: '#05080A'
  },
  betaDark: {
    base: '#B8A46A',
    baseDark: '#101619',
    baseLight: '#D8C98C',
    accent: '#8EA6AD',
    shadow: '#05080A'
  }
};

const variants = [
  {
    dir: iconsDir,
    packaged: true,
    palette: palettes.stable,
    pageSizes: [32, 256],
    readmeIcon: true
  },
  {
    dir: path.join(iconsDir, 'beta'),
    packaged: true,
    palette: palettes.beta,
    pageSizes: []
  },
  {
    dir: path.join(iconsDir, 'dark'),
    packaged: false,
    palette: palettes.stableDark,
    pageSizes: [32]
  },
  {
    dir: path.join(iconsDir, 'beta', 'dark'),
    packaged: false,
    palette: palettes.betaDark,
    pageSizes: []
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

const linuxSizes = [512, 256, 128, 96, 72, 64, 48, 32, 24, 22, 16];
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

function hexToRgb(hex) {
  const normalised = hex.replace('#', '');
  return {
    r: Number.parseInt(normalised.slice(0, 2), 16),
    g: Number.parseInt(normalised.slice(2, 4), 16),
    b: Number.parseInt(normalised.slice(4, 6), 16)
  };
}

async function renderGlyph(svgBuffer, size, colour) {
  const { r, g, b } = hexToRgb(colour);
  const { data, info } = await sharp(svgBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  }).png().toBuffer();
}

async function renderIcon(svgBuffer, size, outputPath, palette, backgroundScale = 0.83, glyphScale = 0.9) {
  const backgroundSvg = renderBackgroundSvg(size, palette, backgroundScale);
  const glyphSize = Math.floor(size * glyphScale);
  const glyphPadding = Math.floor((size - glyphSize) / 2);
  const glyph = await renderGlyph(svgBuffer, glyphSize, '#ffffff');

  await sharp(Buffer.from(backgroundSvg))
    .composite([{ input: glyph, left: glyphPadding, top: glyphPadding }])
    .withMetadata({ icc: 'srgb' })
    .png()
    .toFile(outputPath);
}

async function pngPixelsEqual(firstPath, secondPath) {
  if (!fs.existsSync(firstPath) || !fs.existsSync(secondPath)) {
    return false;
  }

  const [first, second] = await Promise.all([
    sharp(firstPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(secondPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);

  return first.info.width === second.info.width
    && first.info.height === second.info.height
    && first.info.channels === second.info.channels
    && first.data.equals(second.data);
}

async function icnsFilesMatch(firstIcnsPath, secondIcnsPath, temporaryDir) {
  if (!fs.existsSync(firstIcnsPath) || !fs.existsSync(secondIcnsPath)) {
    return false;
  }

  const firstIconsetDir = path.join(temporaryDir, 'existing.iconset');
  const secondIconsetDir = path.join(temporaryDir, 'candidate.iconset');

  try {
    execFileSync(
      'iconutil',
      ['-c', 'iconset', firstIcnsPath, '-o', firstIconsetDir],
      { stdio: 'ignore' }
    );
    execFileSync(
      'iconutil',
      ['-c', 'iconset', secondIcnsPath, '-o', secondIconsetDir],
      { stdio: 'ignore' }
    );

    for (const { name } of iconsetSizes) {
      if (!await pngPixelsEqual(
        path.join(firstIconsetDir, name),
        path.join(secondIconsetDir, name)
      )) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function generatePackagedIcons(svgBuffer, variant, temporaryDir) {
  const iconsetDir = path.join(temporaryDir, 'icon.iconset');
  const icoDir = path.join(temporaryDir, 'ico');
  const linuxDir = path.join(variant.dir, 'linux');

  ensureDir(iconsetDir);
  ensureDir(icoDir);
  ensureDir(linuxDir);

  for (const size of linuxSizes) {
    await renderIcon(svgBuffer, size, path.join(linuxDir, `${size}x${size}.png`), variant.palette, 0.85);
  }

  for (const { name, size } of iconsetSizes) {
    await renderIcon(svgBuffer, size, path.join(iconsetDir, name), variant.palette);
  }

  if (process.platform === 'darwin') {
    const icnsPath = path.join(variant.dir, 'icon.icns');
    const candidateIcnsPath = path.join(temporaryDir, 'icon.icns');

    try {
      execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', candidateIcnsPath], { stdio: 'inherit' });

      if (!await icnsFilesMatch(icnsPath, candidateIcnsPath, temporaryDir)) {
        fs.copyFileSync(candidateIcnsPath, icnsPath);
      }
    } catch (error) {
      if (!fs.existsSync(icnsPath)) {
        throw error;
      }

      console.warn(`iconutil rejected generated input; keeping existing ${path.relative(rootDir, icnsPath)}.`);
    }
  }

  for (const size of icoSizes) {
    await renderIcon(svgBuffer, size, path.join(icoDir, `icon-${size}.png`), variant.palette, 0.85);
  }

  const icoBuffer = await pngToIco(icoSizes.map((size) => path.join(icoDir, `icon-${size}.png`)));
  fs.writeFileSync(path.join(variant.dir, 'icon.ico'), icoBuffer);
}

async function generateVariant(svgBuffer, variant, temporaryRoot) {
  ensureDir(variant.dir);
  await renderIcon(svgBuffer, 512, path.join(variant.dir, 'icon-rounded.png'), variant.palette, 0.85);

  for (const size of variant.pageSizes) {
    await renderIcon(svgBuffer, size, path.join(variant.dir, `icon-${size}.png`), variant.palette, 0.85);
  }

  if (variant.packaged) {
    const temporaryDir = path.join(temporaryRoot, path.relative(iconsDir, variant.dir) || 'stable');
    await generatePackagedIcons(svgBuffer, variant, temporaryDir);
  }

  if (variant.readmeIcon) {
    fs.copyFileSync(path.join(variant.dir, 'icon-rounded.png'), path.join(variant.dir, 'icon-rounded-readme.png'));
  }
}

async function main() {
  const svgBuffer = fs.readFileSync(markSource);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caul-icons-'));

  try {
    for (const variant of variants) {
      console.log(`Generating icons in ${path.relative(rootDir, variant.dir)}`);
      await generateVariant(svgBuffer, variant, temporaryRoot);
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const iconSizes = [16, 22, 24, 32, 48, 64, 72, 96, 128, 256, 512];

describe('Linux icon package contract', () => {
  it.each([
    ['stable', ''],
    ['beta', 'beta']
  ])('provides every %s hicolor icon at its declared size', async (_variant, variantDirectory) => {
    for (const size of iconSizes) {
      const iconPath = path.join(
        root,
        'assets',
        'icons',
        variantDirectory,
        'linux',
        `${size}x${size}.png`
      );
      const metadata = await sharp(iconPath).metadata();

      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
      expect(metadata.hasAlpha).toBe(true);
    }
  });

  it('installs the icon theme and desktop launcher under the same package name', () => {
    const source = readFileSync(path.join(root, 'scripts', 'build-linux-deb.mjs'), 'utf8');

    for (const size of iconSizes) {
      expect(source).toContain(`'${size}x${size}'`);
    }

    expect(source).toContain("path.join(iconBase, size, 'apps')");
    expect(source).toContain('`${packageName}.png`');
    expect(source).toContain('`${packageName}.desktop`');
    expect(source).toContain('Icon=${packageName}');
    expect(source).toContain('StartupWMClass=Caul');
  });

  it('uses the Linux icon family for Electron Builder packages', () => {
    const source = readFileSync(path.join(root, 'electron-builder.config.cjs'), 'utf8');

    expect(source).toContain("linux: 'assets/icons/linux'");
    expect(source).toContain("linux: 'assets/icons/beta/linux'");
    expect(source).toContain('icon: icons.linux');
  });
});

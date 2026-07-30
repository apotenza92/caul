import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../electron-builder.config.cjs');
const originalPlatform = process.env.CAUL_PACKAGE_PLATFORM;
const originalArch = process.env.CAUL_PACKAGE_ARCH;
const originalFilter = process.env.ELECTRON_BUILDER_7Z_FILTER;

function loadConfig(platform, arch) {
  process.env.CAUL_PACKAGE_PLATFORM = platform;
  process.env.CAUL_PACKAGE_ARCH = arch;
  delete process.env.ELECTRON_BUILDER_7Z_FILTER;
  delete require.cache[configPath];
  return require(configPath);
}

afterEach(() => {
  for (const [name, value] of [
    ['CAUL_PACKAGE_PLATFORM', originalPlatform],
    ['CAUL_PACKAGE_ARCH', originalArch],
    ['ELECTRON_BUILDER_7Z_FILTER', originalFilter]
  ]) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  delete require.cache[configPath];
});

describe('electron-builder Windows archive compatibility', () => {
  it('forces the NSIS-compatible BCJ filter for Windows ARM64 payloads', () => {
    loadConfig('win', 'arm64');
    expect(process.env.ELECTRON_BUILDER_7Z_FILTER).toBe('BCJ');
  });

  it.each([
    ['win', 'x64'],
    ['linux', 'arm64'],
    ['mac', 'arm64']
  ])('does not override the archive filter for %s/%s', (platform, arch) => {
    loadConfig(platform, arch);
    expect(process.env.ELECTRON_BUILDER_7Z_FILTER).toBeUndefined();
  });
});

describe('electron-builder RPM coexistence', () => {
  it('suppresses global build-ID links that collide between stable and beta', () => {
    const config = loadConfig('linux', 'x64');
    expect(config.rpm.fpm).toEqual(['--rpm-rpmbuild-define=_build_id_links none']);
  });
});

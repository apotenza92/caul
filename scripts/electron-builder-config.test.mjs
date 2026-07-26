import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../electron-builder.config.cjs');
const originalPlatform = process.env.CAUL_PACKAGE_PLATFORM;
const originalArch = process.env.CAUL_PACKAGE_ARCH;

function loadConfig(platform, arch) {
  process.env.CAUL_PACKAGE_PLATFORM = platform;
  process.env.CAUL_PACKAGE_ARCH = arch;
  delete require.cache[configPath];
  return require(configPath);
}

afterEach(() => {
  if (originalPlatform === undefined) {
    delete process.env.CAUL_PACKAGE_PLATFORM;
  } else {
    process.env.CAUL_PACKAGE_PLATFORM = originalPlatform;
  }
  if (originalArch === undefined) {
    delete process.env.CAUL_PACKAGE_ARCH;
  } else {
    process.env.CAUL_PACKAGE_ARCH = originalArch;
  }
  delete require.cache[configPath];
});

describe('electron-builder compression', () => {
  it('stores the Windows ARM64 NSIS payload without executable filters', () => {
    expect(loadConfig('win', 'arm64').compression).toBe('store');
  });

  it.each([
    ['win', 'x64'],
    ['linux', 'arm64'],
    ['mac', 'arm64']
  ])('keeps normal compression for %s/%s', (platform, arch) => {
    expect(loadConfig(platform, arch).compression).toBe('normal');
  });
});

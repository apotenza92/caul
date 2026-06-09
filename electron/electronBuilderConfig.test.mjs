import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../electron-builder.config.cjs');

function loadConfig(env = {}) {
  const originalEnv = {
    CAUL_PACKAGE_ARCH: process.env.CAUL_PACKAGE_ARCH,
    CAUL_PACKAGE_PLATFORM: process.env.CAUL_PACKAGE_PLATFORM,
    FORCE_BETA_BUILD: process.env.FORCE_BETA_BUILD,
    FORCE_DEV_BUILD: process.env.FORCE_DEV_BUILD,
    FORCE_DEV_PRIVATE_BUILD: process.env.FORCE_DEV_PRIVATE_BUILD
  };

  delete process.env.CAUL_PACKAGE_ARCH;
  delete process.env.CAUL_PACKAGE_PLATFORM;
  delete process.env.FORCE_BETA_BUILD;
  delete process.env.FORCE_DEV_BUILD;
  delete process.env.FORCE_DEV_PRIVATE_BUILD;
  Object.assign(process.env, env);
  delete require.cache[configPath];

  try {
    return require(configPath);
  } finally {
    delete require.cache[configPath];
    restoreEnv(originalEnv);
  }
}

function restoreEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('electron-builder macOS config', () => {
  it('marks packaged stable and beta macOS apps as Dockless agents', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(loadConfig().mac.extendInfo.LSUIElement).toBe(true);
    expect(loadConfig({ FORCE_BETA_BUILD: 'true' }).mac.extendInfo.LSUIElement).toBe(true);
  });

  it('keeps the packaged dev macOS app Dock-visible for UI inspection', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(loadConfig({ FORCE_DEV_BUILD: 'true' }).mac.extendInfo.LSUIElement).toBeUndefined();
    expect(loadConfig({ FORCE_DEV_BUILD: 'true' }).directories.output).toBe('release-dev');
  });

  it('can build a Dockless private packaged dev macOS app separately', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const config = loadConfig({
      FORCE_DEV_BUILD: 'true',
      FORCE_DEV_PRIVATE_BUILD: 'true'
    });

    expect(config.mac.extendInfo.LSUIElement).toBe(true);
    expect(config.directories.output).toBe('release-dev-private');
    expect(config.appId).toBe('dev.caul.app.dev-private');
    expect(config.productName).toBe('Caul Dev-Private');
  });
});

describe('electron-builder Windows config', () => {
  it('uses the product name without the version in Windows Apps uninstall entries', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(loadConfig().nsis.uninstallDisplayName).toBe('${productName}');
  });

  it('bundles the Windows-targeted backend for Windows arm64 packages', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const config = loadConfig({
      CAUL_PACKAGE_ARCH: 'arm64',
      CAUL_PACKAGE_PLATFORM: 'win'
    });

    expect(config.extraResources[0]).toMatchObject({
      from: 'target/aarch64-pc-windows-msvc/release/caul-desktop-backend.exe',
      to: 'bin/caul-desktop-backend.exe'
    });
  });
});

describe('electron-builder Linux config', () => {
  it('bundles the Linux-targeted backend for Linux arm64 packages', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const config = loadConfig({
      CAUL_PACKAGE_ARCH: 'arm64',
      CAUL_PACKAGE_PLATFORM: 'linux'
    });

    expect(config.extraResources[0]).toMatchObject({
      from: 'target/aarch64-unknown-linux-gnu/release/caul-desktop-backend',
      to: 'bin/caul-desktop-backend'
    });
  });

  it('bundles the Linux-targeted backend for Linux x64 packages', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const config = loadConfig({
      CAUL_PACKAGE_ARCH: 'x64',
      CAUL_PACKAGE_PLATFORM: 'linux'
    });

    expect(config.extraResources[0]).toMatchObject({
      from: 'target/x86_64-unknown-linux-gnu/release/caul-desktop-backend',
      to: 'bin/caul-desktop-backend'
    });
  });
});

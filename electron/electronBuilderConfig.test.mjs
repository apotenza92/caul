import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../electron-builder.config.cjs');

function loadConfig(env = {}) {
  const originalEnv = {
    FORCE_BETA_BUILD: process.env.FORCE_BETA_BUILD,
    FORCE_DEV_BUILD: process.env.FORCE_DEV_BUILD,
    FORCE_DEV_PRIVATE_BUILD: process.env.FORCE_DEV_PRIVATE_BUILD
  };

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

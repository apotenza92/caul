import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../electron-builder.config.cjs');

function loadConfig(env = {}) {
  const originalEnv = {
    FORCE_BETA_BUILD: process.env.FORCE_BETA_BUILD,
    FORCE_DEV_BUILD: process.env.FORCE_DEV_BUILD
  };

  delete process.env.FORCE_BETA_BUILD;
  delete process.env.FORCE_DEV_BUILD;
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
  });
});

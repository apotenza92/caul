import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createProviderCredentialStore,
  normaliseApiKey,
  providerIds
} = require('./providerCredentials.cjs');

const testRoots = [];

function createTestStore({
  available = true,
  backend = 'keychain',
  platform = 'darwin'
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'caul-provider-credentials-'));
  const filePath = join(root, 'provider-credentials.json');
  testRoots.push(root);

  const safeStorage = {
    decryptString: (buffer) => Buffer.from(buffer).toString('utf8').replace(/^encrypted:/u, ''),
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    getSelectedStorageBackend: () => backend,
    isEncryptionAvailable: () => available
  };

  let encryptionChecks = 0;

  safeStorage.isEncryptionAvailable = () => {
    encryptionChecks += 1;
    return available;
  };

  return {
    encryptionChecks: () => encryptionChecks,
    filePath,
    store: createProviderCredentialStore({ filePath, platform, safeStorage })
  };
}

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('provider credential store', () => {
  it('supports only the four first-party API-key providers', () => {
    expect(providerIds).toEqual(['openai', 'anthropic', 'google', 'xai']);
  });

  it('encrypts keys at rest and only decrypts the selected provider into its environment variable', () => {
    const { filePath, store } = createTestStore();

    store.save('openai', '  sk-test-secret  ');

    expect(readFileSync(filePath, 'utf8')).not.toContain('sk-test-secret');
    expect(store.getEnvironment('openai')).toEqual({
      OPENAI_API_KEY: 'sk-test-secret'
    });
    expect(store.getEnvironment('anthropic')).toEqual({});
    expect(store.status().providers.find((provider) => provider.id === 'openai')).toMatchObject({
      configured: true,
      defaultModel: 'openai/gpt-5.4-mini'
    });
  });

  it('does not open secure storage merely to report provider status on macOS', () => {
    const { encryptionChecks, store } = createTestStore();

    expect(store.status()).toMatchObject({ available: true });
    expect(encryptionChecks()).toBe(0);
    expect(store.getEnvironment('openai')).toEqual({});
    expect(encryptionChecks()).toBe(0);
  });

  it('removes one provider without affecting another', () => {
    const { store } = createTestStore();

    store.save('openai', 'sk-openai');
    store.save('anthropic', 'sk-anthropic');
    store.remove('openai');

    expect(store.getEnvironment('openai')).toEqual({});
    expect(store.getEnvironment('anthropic')).toEqual({
      ANTHROPIC_API_KEY: 'sk-anthropic'
    });
  });

  it('refuses plaintext fallback storage', () => {
    const { store } = createTestStore({
      backend: 'basic_text',
      platform: 'linux'
    });

    expect(store.status()).toMatchObject({
      available: false,
      message: 'Secure credential storage requires an operating-system keyring.'
    });
    expect(() => store.save('openai', 'sk-test')).toThrow(
      'Secure credential storage requires an operating-system keyring.'
    );
  });

  it('validates keys without provider-specific prefixes', () => {
    expect(normaliseApiKey('  arbitrary-provider-key  ')).toBe('arbitrary-provider-key');
    expect(() => normaliseApiKey('')).toThrow('Enter an API key.');
    expect(() => normaliseApiKey('line\nbreak')).toThrow('unsupported control characters');
  });
});

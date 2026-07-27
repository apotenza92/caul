const fs = require('node:fs');
const path = require('node:path');

const providerDefinitions = Object.freeze({
  openai: Object.freeze({
    defaultModel: 'openai/gpt-5.4-mini',
    environmentVariable: 'OPENAI_API_KEY',
    label: 'OpenAI'
  }),
  anthropic: Object.freeze({
    defaultModel: 'anthropic/claude-sonnet-4-6',
    environmentVariable: 'ANTHROPIC_API_KEY',
    label: 'Anthropic'
  }),
  google: Object.freeze({
    defaultModel: 'google/gemini-3.5-flash',
    environmentVariable: 'GEMINI_API_KEY',
    label: 'Google'
  }),
  xai: Object.freeze({
    defaultModel: 'xai/grok-4.3',
    environmentVariable: 'XAI_API_KEY',
    label: 'xAI'
  })
});

const providerIds = Object.freeze(Object.keys(providerDefinitions));

function isSupportedProvider(providerId) {
  return providerIds.includes(providerId);
}

function normaliseApiKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';

  if (!key) {
    throw new Error('Enter an API key.');
  }

  if (key.length > 16_384) {
    throw new Error('The API key is too long.');
  }

  if (/[\u0000-\u001f\u007f]/u.test(key)) {
    throw new Error('The API key contains unsupported control characters.');
  }

  return key;
}

function createProviderCredentialStore({
  filePath,
  safeStorage,
  fsModule = fs,
  platform = process.platform
}) {
  function getEncryptionStatus() {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      return {
        available: false,
        message: 'Secure credential storage is unavailable on this computer.'
      };
    }

    const backend = typeof safeStorage.getSelectedStorageBackend === 'function'
      ? safeStorage.getSelectedStorageBackend()
      : null;

    if (backend === 'basic_text') {
      return {
        available: false,
        message: 'Secure credential storage requires an operating-system keyring.'
      };
    }

    return { available: true, message: null };
  }

  function readState() {
    try {
      const parsed = JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
      const credentials = parsed?.credentials && typeof parsed.credentials === 'object'
        ? parsed.credentials
        : {};

      return {
        credentials: Object.fromEntries(
          Object.entries(credentials)
            .filter(([providerId, credential]) => (
              isSupportedProvider(providerId)
              && typeof credential?.encryptedKey === 'string'
            ))
        ),
        version: 1
      };
    } catch {
      return { credentials: {}, version: 1 };
    }
  }

  function writeState(state) {
    fsModule.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fsModule.writeFileSync(
      filePath,
      `${JSON.stringify(state, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    fsModule.chmodSync?.(filePath, 0o600);
  }

  function status() {
    const encryption = platform === 'darwin' || platform === 'win32'
      ? { available: true, message: null }
      : getEncryptionStatus();
    const state = readState();

    return {
      available: encryption.available,
      message: encryption.message,
      providers: providerIds.map((providerId) => ({
        configured: Boolean(state.credentials[providerId]),
        defaultModel: providerDefinitions[providerId].defaultModel,
        id: providerId,
        label: providerDefinitions[providerId].label
      }))
    };
  }

  function save(providerId, value) {
    if (!isSupportedProvider(providerId)) {
      throw new Error('This provider does not support API-key setup in Caul.');
    }

    const encryption = getEncryptionStatus();

    if (!encryption.available) {
      throw new Error(encryption.message);
    }

    const key = normaliseApiKey(value);
    const state = readState();
    const encryptedKey = safeStorage.encryptString(key).toString('base64');

    state.credentials[providerId] = { encryptedKey };
    writeState(state);

    return status();
  }

  function remove(providerId) {
    if (!isSupportedProvider(providerId)) {
      throw new Error('This provider does not support API-key setup in Caul.');
    }

    const state = readState();
    delete state.credentials[providerId];

    if (Object.keys(state.credentials).length === 0) {
      fsModule.rmSync(filePath, { force: true });
    } else {
      writeState(state);
    }

    return status();
  }

  function clear() {
    fsModule.rmSync(filePath, { force: true });
    return status();
  }

  function getEnvironment(providerId) {
    if (!isSupportedProvider(providerId)) {
      return {};
    }

    const encryptedKey = readState().credentials[providerId]?.encryptedKey;

    if (!encryptedKey) {
      return {};
    }

    const encryption = getEncryptionStatus();

    if (!encryption.available) {
      throw new Error(encryption.message);
    }

    const key = safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'));

    return {
      [providerDefinitions[providerId].environmentVariable]: key
    };
  }

  return {
    clear,
    getEnvironment,
    remove,
    save,
    status
  };
}

module.exports = {
  createProviderCredentialStore,
  isSupportedProvider,
  normaliseApiKey,
  providerDefinitions,
  providerIds
};

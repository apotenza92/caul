import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createBrowserLoginInteraction,
  isAllowedAuthenticationUrl,
  loginWithPiModelRuntime
} = require('./piChatGptAuth.cjs');

describe('Pi ChatGPT authentication', () => {
  it('uses Pi ModelRuntime with the exact auth file and OAuth provider', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ login });
    const openExternal = vi.fn();

    await loginWithPiModelRuntime({
      ModelRuntime: { create },
      authPath: '/tmp/caul-test/auth.json',
      openExternal,
      providerId: 'openai-codex'
    });

    expect(create).toHaveBeenCalledWith({
      allowModelNetwork: false,
      authPath: '/tmp/caul-test/auth.json',
      modelsPath: null
    });
    expect(login).toHaveBeenCalledWith(
      'openai-codex',
      'oauth',
      expect.objectContaining({
        notify: expect.any(Function),
        prompt: expect.any(Function)
      })
    );
  });

  it('selects browser login and opens only Pi authentication URLs', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const interaction = createBrowserLoginInteraction({ openExternal });

    await expect(interaction.prompt({
      type: 'select',
      options: [
        { id: 'browser', label: 'Browser login' },
        { id: 'device_code', label: 'Device code login' }
      ]
    })).resolves.toBe('browser');

    interaction.notify({
      type: 'auth_url',
      url: 'https://auth.openai.com/oauth/authorize'
    });
    interaction.notify({
      type: 'progress',
      message: 'Waiting'
    });

    const controller = new AbortController();
    const manualCode = interaction.prompt({
      type: 'manual_code',
      message: 'Paste redirect URL',
      signal: controller.signal
    });
    controller.abort();

    await expect(manualCode).rejects.toThrow('cancelled');
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize');
  });

  it('allows only the expected HTTPS authentication host', async () => {
    expect(isAllowedAuthenticationUrl('https://auth.openai.com/oauth/authorize')).toBe(true);
    expect(isAllowedAuthenticationUrl('http://auth.openai.com/oauth/authorize')).toBe(false);
    expect(isAllowedAuthenticationUrl('https://auth.openai.com.example.com/oauth/authorize')).toBe(false);
    expect(isAllowedAuthenticationUrl('https://example.com/oauth/authorize')).toBe(false);
    expect(isAllowedAuthenticationUrl('not a URL')).toBe(false);

    const openExternal = vi.fn();
    const interaction = createBrowserLoginInteraction({ openExternal });

    interaction.notify({
      type: 'auth_url',
      url: 'https://example.com/oauth/authorize'
    });

    await expect(interaction.prompt({
      type: 'manual_code',
      signal: new AbortController().signal
    })).rejects.toThrow('unexpected ChatGPT authentication address');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('fails clearly when Pi no longer offers browser login', async () => {
    const interaction = createBrowserLoginInteraction({
      openExternal: vi.fn()
    });

    await expect(interaction.prompt({
      type: 'select',
      options: [{ id: 'device_code', label: 'Device code login' }]
    })).rejects.toThrow('does not offer browser sign in');
  });

  it('reports a default-browser launch failure to Pi', async () => {
    const interaction = createBrowserLoginInteraction({
      openExternal: vi.fn().mockRejectedValue(new Error('launch failed'))
    });

    interaction.notify({
      type: 'auth_url',
      url: 'https://auth.openai.com/oauth/authorize'
    });

    await expect(interaction.prompt({
      type: 'manual_code',
      message: 'Paste redirect URL',
      signal: new AbortController().signal
    })).rejects.toThrow('Could not open ChatGPT sign in: launch failed');
  });
});

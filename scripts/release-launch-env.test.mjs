import { describe, expect, it } from 'vitest';
import { createReleaseLaunchEnvironment } from './release-launch-env.mjs';

describe('release package launch environment', () => {
  it('inherits only operating-system runtime variables and explicit smoke controls', () => {
    const environment = createReleaseLaunchEnvironment({
      CAUL_SMOKE_EXIT_MS: '1000'
    }, {
      APPLE_NOTARYTOOL_KEY_P8_BASE64: 'secret-key',
      GH_TOKEN: 'secret-token',
      HOME: '/tmp/home',
      PATH: '/usr/bin',
      SOME_PROVIDER_API_KEY: 'secret-provider-key'
    });

    expect(environment).toEqual({
      HOME: '/tmp/home',
      PATH: '/usr/bin',
      CAUL_SMOKE_EXIT_MS: '1000'
    });
  });
});

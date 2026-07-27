import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createPiEnvironment,
  isCredentialEnvironmentName
} = require('./piEnvironment.cjs');

describe('Pi subprocess environment', () => {
  it('recognises unrelated credentials and Node injection settings', () => {
    for (const name of [
      'ANTHROPIC_API_KEY',
      'APPLE_SIGNING_CERTIFICATE_PASSWORD',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'GH_TOKEN',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'NODE_OPTIONS',
      'NODE_PATH',
      'SSH_AUTH_SOCK'
    ]) {
      expect(isCredentialEnvironmentName(name)).toBe(true);
    }

    expect(isCredentialEnvironmentName('LANG')).toBe(false);
    expect(isCredentialEnvironmentName('PATH')).toBe(false);
  });

  it('passes ordinary settings and only the explicitly selected provider credential', () => {
    const environment = createPiEnvironment({
      agentDir: '/tmp/caul/pi-agent',
      baseEnvironment: {
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        CAUL_LLM_REQUEST_STRATEGY: 'persistent',
        GH_TOKEN: 'github-secret',
        LANG: 'en_AU.UTF-8',
        NODE_OPTIONS: '--require=/tmp/injected.cjs',
        OPENAI_API_KEY: 'unselected-openai-key',
        PATH: '/usr/bin'
      },
      providerEnvironment: {
        ANTHROPIC_API_KEY: 'selected-anthropic-key'
      }
    });

    expect(environment).toMatchObject({
      ANTHROPIC_API_KEY: 'selected-anthropic-key',
      CAUL_LLM_REQUEST_STRATEGY: 'persistent',
      ELECTRON_RUN_AS_NODE: '1',
      LANG: 'en_AU.UTF-8',
      PATH: '/usr/bin',
      PI_CODING_AGENT_DIR: '/tmp/caul/pi-agent',
      PI_CODING_AGENT_SESSION_DIR: '/tmp/caul/pi-agent/sessions',
      PI_SKIP_VERSION_CHECK: '1',
      PI_TELEMETRY: '0'
    });
    expect(environment).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(environment).not.toHaveProperty('GH_TOKEN');
    expect(environment).not.toHaveProperty('NODE_OPTIONS');
    expect(environment).not.toHaveProperty('OPENAI_API_KEY');
  });
});

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const llmConfig = require('./llmConfig.json');
const { providerDefinitions } = require('./providerCredentials.cjs');

describe('bundled Pi model compatibility', () => {
  it('pins the Pi release used to validate the configured providers', () => {
    const packageJson = require('../package.json');

    expect(packageJson.dependencies['@earendil-works/pi-coding-agent']).toBe('0.82.1');
  });

  it('resolves every advertised cloud model through the bundled Pi runtime', async () => {
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
    const runtime = await ModelRuntime.create({
      allowModelNetwork: false,
      authPath: '/tmp/caul-model-compatibility-auth.json',
      modelsPath: null
    });
    const expectedModels = new Set([
      ...llmConfig.models.map((model) => model.value),
      ...Object.values(providerDefinitions).map((provider) => provider.defaultModel)
    ]);

    for (const configuredModel of expectedModels) {
      const separator = configuredModel.indexOf('/');
      const providerId = configuredModel.slice(0, separator);
      const modelId = configuredModel.slice(separator + 1);

      expect(
        runtime.getModel(providerId, modelId),
        `${configuredModel} is missing from Pi 0.82.1`
      ).toMatchObject({
        id: modelId,
        provider: providerId
      });
    }
  });
});

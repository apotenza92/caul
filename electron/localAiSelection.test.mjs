import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getUsableSelectedLocalAiModelId } = require('./localAiSelection.cjs');

function createService({ installed = false, recommendedId = 'current-model', selectedExists = true } = {}) {
  return {
    getModelById: (modelId) => {
      if (!selectedExists || modelId !== 'old-model') {
        return null;
      }

      return { id: 'old-model' };
    },
    getRecommendedModel: () => ({ id: recommendedId }),
    status: () => ({
      model: { installed },
      runtime: { installed }
    })
  };
}

describe('getUsableSelectedLocalAiModelId', () => {
  it('keeps a saved local AI model when it is still the current recommendation', () => {
    const service = createService({ recommendedId: 'old-model' });

    expect(getUsableSelectedLocalAiModelId({ selectedModelId: 'old-model', service })).toBe('old-model');
  });

  it('keeps an installed saved local AI model even when recommendations change', () => {
    const service = createService({ installed: true });

    expect(getUsableSelectedLocalAiModelId({ selectedModelId: 'old-model', service })).toBe('old-model');
  });

  it('drops an uninstalled stale saved local AI model after recommendations change', () => {
    const service = createService({ installed: false });

    expect(getUsableSelectedLocalAiModelId({ selectedModelId: 'old-model', service })).toBeNull();
  });

  it('drops saved local AI model ids that no longer exist in the catalogue', () => {
    const service = createService({ selectedExists: false });

    expect(getUsableSelectedLocalAiModelId({ selectedModelId: 'old-model', service })).toBeNull();
  });
});

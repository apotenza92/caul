import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  parseArtificialAnalysisModelPage,
  refreshModelCatalogue
} = require('./modelCatalogueRefresh.cjs');

const {
  buildSystemProfile,
  estimateStableModelMemoryGb,
  getLiveModelCataloguePath,
  getStaleCatalogueEntries,
  loadBestModelCatalogue,
  loadModelCatalogue,
  parseMacAvailableMemoryGb,
  parseWindowsGpuProfile,
  recommendFromCatalogue
} = require('./modelRecommendation.cjs');

const root = resolve(import.meta.dirname, '..');

function fakeOs({ cores = 8, freeGb = 12, totalGb = 16 } = {}) {
  return {
    cpus: () => Array.from({ length: cores }, () => ({})),
    freemem: () => freeGb * 1024 * 1024 * 1024,
    totalmem: () => totalGb * 1024 * 1024 * 1024
  };
}

function fakeProcess({ arch = 'arm64', platform = 'darwin' } = {}) {
  return { arch, platform };
}

function fakeSpawn() {
  return () => ({ status: 1, stdout: '' });
}

function fakeMacMemorySpawn() {
  return (command) => {
    if (command === '/usr/bin/vm_stat') {
      return {
        status: 0,
        stdout: `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   144569.
Pages active:                                 779354.
Pages inactive:                               760869.
Pages speculative:                             17817.
Pages purgeable:                               14930.`
      };
    }

    return { status: 1, stdout: '' };
  };
}

function fakeNvidiaSpawn() {
  return (command) => {
    if (command === 'nvidia-smi') {
      return {
        status: 0,
        stdout: 'NVIDIA GeForce RTX 4070, 12282\n'
      };
    }

    return { status: 1, stdout: '' };
  };
}

function fakeCatalogueFs(files) {
  return {
    existsSync: (filePath) => files.has(filePath) || existsSync(filePath),
    readFileSync: (filePath) => {
      if (files.has(filePath)) {
        return files.get(filePath);
      }

      return readFileSync(filePath, 'utf8');
    }
  };
}

function fakeFetch(routes) {
  return async (url, options = {}) => {
    const key = `${options.method ?? 'GET'} ${url}`;
    const route = routes.get(key) ?? routes.get(`GET ${url}`);

    if (!route) {
      return fakeResponse({ ok: false, status: 404, text: 'not found' });
    }

    return fakeResponse(route);
  };
}

function delayedFakeFetch(routes, delayMs) {
  return async (url, options = {}) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fakeFetch(routes)(url, options);
  };
}

function fakeResponse({ body = '', headers = {}, ok = true, status = 200, text = null, url = '' }) {
  const bodyText = text ?? (typeof body === 'string' ? body : JSON.stringify(body));

  return {
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? headers[name] ?? null
    },
    json: async () => JSON.parse(bodyText),
    ok,
    status,
    text: async () => bodyText,
    url
  };
}

function hfModelFixture(id, siblings) {
  return {
    downloads: 123,
    gated: false,
    id,
    lastModified: '2026-06-07T00:00:00.000Z',
    modelId: id,
    private: false,
    siblings: siblings.map((rfilename) => ({ rfilename })),
    tags: ['license:apache-2.0']
  };
}

function liveCatalogueRoutes() {
  return new Map([
    ['GET https://huggingface.co/api/datasets/hf-audio/open-asr-leaderboard', {
      body: { id: 'hf-audio/open-asr-leaderboard', sha: 'abcdef123456' }
    }],
    ['GET https://deepmind.google/models/gemma/gemma-4/', {
      text: 'Gemma 4 12B Frontier intelligence on personal computers'
    }],
    ['GET https://lmarena.ai/leaderboard', {
      text: 'LMArena leaderboard human preference votes'
    }],
    ['GET https://ai.google.dev/edge/litert-lm', {
      text: 'LiteRT-LM serves local Gemma models on device.'
    }],
    ['GET https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', {
      body: { tag_name: 'b9999' }
    }],
    ['GET https://api.github.com/repos/ml-explore/mlx-lm/releases/latest', {
      ok: false,
      status: 403,
      text: 'rate limited'
    }],
    ['GET https://github.com/ml-explore/mlx-lm/releases/latest', {
      text: '<html>MLX LM release</html>',
      url: 'https://github.com/ml-explore/mlx-lm/releases/tag/v0.25.0'
    }],
    ['GET https://artificialanalysis.ai/models/gemma-4-e4b', {
      text: '<p>Gemma 4 E4B scores 19 on the Artificial Analysis Intelligence Index.</p><span>Total parameters</span><td>8B</td><span>Active parameters</span><td>4.5B</td><span>Context window</span><td>128k</td>'
    }],
    ['GET https://artificialanalysis.ai/models/qwen3-8b-instruct', {
      text: '<p>Qwen3 8B scores 11 on the Artificial Analysis Intelligence Index.</p><span>Total parameters</span><td>8B</td><span>Context window</span><td>131k</td>'
    }],
    ['GET https://huggingface.co/api/models/litert-community/gemma-4-E4B-it-litert-lm', {
      body: hfModelFixture('litert-community/gemma-4-E4B-it-litert-lm', [])
    }],
    ['GET https://huggingface.co/api/models/bartowski/gemma-4-12B-it-GGUF', {
      body: hfModelFixture('bartowski/gemma-4-12B-it-GGUF', ['gemma-4-12B-it-Q4_K_M.gguf'])
    }],
    ['HEAD https://huggingface.co/bartowski/gemma-4-12B-it-GGUF/resolve/main/gemma-4-12B-it-Q4_K_M.gguf', {
      body: '',
      headers: { 'content-length': String(6.5 * 1024 * 1024 * 1024) }
    }],
    ['GET https://huggingface.co/api/models/Qwen/Qwen3-8B-GGUF', {
      body: hfModelFixture('Qwen/Qwen3-8B-GGUF', ['qwen3-8b-q4_k_m.gguf'])
    }],
    ['HEAD https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q4_k_m.gguf', {
      body: '',
      headers: { 'content-length': String(5.1 * 1024 * 1024 * 1024) }
    }]
  ]);
}

describe('model recommendation catalogue', () => {
  it('loads the checked-in catalogue with source attribution', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));

    expect(catalogue.sources.asrLeaderboard.url).toContain('huggingface.co');
    expect(catalogue.sources.llmLeaderboard.url).toContain('artificialanalysis.ai');
    expect(catalogue.transcription.some((model) => model.id === 'parakeet')).toBe(true);
    expect(catalogue.aiResponse.some((model) => model.id === 'qwen2.5-3b-instruct-q4_k_m')).toBe(true);
  });

  it('prefers a valid live catalogue cache over the bundled fallback', () => {
    const bundled = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const live = {
      ...bundled,
      lastReviewed: '2026-06-07'
    };
    const userDataPath = '/tmp/caul-user-data';
    const livePath = getLiveModelCataloguePath(userDataPath);
    const files = new Map([
      [livePath, JSON.stringify(live)]
    ]);
    const catalogue = loadBestModelCatalogue({
      bundledPath: resolve(root, 'model-catalog.json'),
      fs: fakeCatalogueFs(files),
      userDataPath
    });

    expect(catalogue.source).toBe('live-cache');
    expect(catalogue.lastReviewed).toBe('2026-06-07');
  });

  it('falls back to the bundled catalogue when the live cache is invalid', () => {
    const userDataPath = '/tmp/caul-user-data';
    const livePath = getLiveModelCataloguePath(userDataPath);
    const files = new Map([
      [livePath, '{"version":999}']
    ]);
    const catalogue = loadBestModelCatalogue({
      bundledPath: resolve(root, 'model-catalog.json'),
      fs: fakeCatalogueFs(files),
      userDataPath
    });

    expect(catalogue.source).toBe('bundled');
    expect(catalogue.sources.llmLeaderboard.url).toContain('artificialanalysis.ai');
  });

  it('reports stale catalogue entries without fetching online sources', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const stale = getStaleCatalogueEntries(catalogue, new Date('2026-12-01T00:00:00.000Z'));

    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0]).toHaveProperty('reviewedAt');
  });

  it('parses Artificial Analysis model pages into usable benchmark facts', () => {
    const parsed = parseArtificialAnalysisModelPage(`
      <div>19</div><div>Artificial Analysis Intelligence Index</div>
      <p>Gemma 4 E4B scores 19 on the Artificial Analysis Intelligence Index.</p>
      <span>Total parameters</span><td>8B</td>
      <span>Active parameters</span><td>4.5B</td>
      <span>Context window</span><td>128k</td>
    `);

    expect(parsed.intelligenceIndex).toBe(19);
    expect(parsed.totalParametersB).toBe(8);
    expect(parsed.activeParametersB).toBe(4.5);
    expect(parsed.contextWindowTokens).toBe(128000);
  });

  it('refreshes a live catalogue from trusted online source fixtures', async () => {
    const bundled = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const routes = liveCatalogueRoutes();
    const result = await refreshModelCatalogue(bundled, {
      fetchFn: fakeFetch(routes),
      now: new Date('2026-06-08T00:00:00.000Z')
    });

    expect(result.catalogue.lastReviewed).toBe('2026-06-08');
    expect(result.catalogue.sources.liveArtificialAnalysis.url).toContain('artificialanalysis.ai');
    expect(result.catalogue.sources.liveLmArena.url).toContain('lmarena.ai');
    expect(result.catalogue.sources.liveMlxLm.url).toContain('mlx-lm');
    expect(result.sourceReports.find((report) => report.source === 'MLX LM').detail).toContain('v0.25.0');
    expect(result.catalogue.transcription.find((model) => model.id === 'parakeet').benchmark.rankSource).toContain('abcdef1');
    expect(result.catalogue.aiResponse.some((model) => model.id === 'gemma-4-e4b-it-litert-lm')).toBe(true);
    expect(result.catalogue.aiResponse.find((model) => model.id === 'gemma-4-12b-it-q4_k_m').downloadSizeGb).toBe(6.5);
    expect(result.sourceReports.every((report) => report.ok)).toBe(true);
  });

  it('refreshes independent live catalogue sources concurrently', async () => {
    const bundled = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const routes = liveCatalogueRoutes();
    const start = Date.now();
    await refreshModelCatalogue(bundled, {
      fetchFn: delayedFakeFetch(routes, 30),
      now: new Date('2026-06-08T00:00:00.000Z')
    });
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(180);
  });

  it('uses macOS reclaimable memory instead of raw free memory', () => {
    const availableGb = parseMacAvailableMemoryGb(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   144569.
Pages inactive:                               760869.
Pages speculative:                             17817.
Pages purgeable:                               14930.`);
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 1.3, totalGb: 32 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeMacMemorySpawn()
    });

    expect(availableGb).toBe(14.3);
    expect(profile.freeMemoryGb).toBe(14.3);
    expect(profile.currentAvailableMemoryGb).toBe(14.3);
  });

  it('estimates stable model capacity from total memory for onboarding recommendations', () => {
    expect(estimateStableModelMemoryGb(8)).toBe(2.6);
    expect(estimateStableModelMemoryGb(16)).toBe(7.2);
    expect(estimateStableModelMemoryGb(32)).toBe(16.8);
  });

  it('detects NVIDIA VRAM on Windows and Linux when nvidia-smi is available', () => {
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 8, freeGb: 2, totalGb: 16 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeNvidiaSpawn()
    });

    expect(profile.gpu.vendor).toBe('nvidia');
    expect(profile.gpu.vramGb).toBe(12);
  });

  it('parses Windows video controller VRAM', () => {
    const gpu = parseWindowsGpuProfile(JSON.stringify({
      AdapterRAM: 8589934592,
      Name: 'NVIDIA GeForce RTX 4060 Laptop GPU'
    }));

    expect(gpu.vendor).toBe('nvidia');
    expect(gpu.vramGb).toBe(8);
  });

  it('recommends Parakeet for a strong Apple Silicon machine', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(profile.localRuntimes.caulLlamaCpp.provider).toBe('caul-llama.cpp');
    expect(profile.localRuntimes.caulLlamaCpp.runtime.supported).toBe(false);
    expect(recommendation.transcription.recommendation).toBe('local-parakeet');
    expect(recommendation.transcription.source).toContain('Open ASR');
  });

  it('falls back to Moonshine for a lighter machine', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 2, freeGb: 1.5, totalGb: 4 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(recommendation.transcription.recommendation).toBe('local-moonshine-tiny');
  });

  it('does not claim cloud transcription exists when no local transcription model fits', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 1, freeGb: 0.5, totalGb: 2 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(recommendation.transcription.recommendation).toBe('none');
    expect(recommendation.transcription.reason).toContain('does not implement cloud transcription');
  });

  it('recommends Caul-managed local AI when hardware fits', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(recommendation.ai.recommendation).toBe('local');
    expect(recommendation.ai.model.id).toBe('qwen3-1.7b-mlx-4bit');
  });

  it('recommends llama.cpp local AI on Windows and Linux', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(recommendation.ai.recommendation).toBe('local');
    expect(recommendation.ai.model.id).toBe('qwen2.5-3b-instruct-q4_k_m');
  });

  it('prefers a stronger local AI model when it fits the stable machine budget', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const qwen3b = catalogue.aiResponse.find((model) => model.id === 'qwen2.5-3b-instruct-q4_k_m');
    const expandedCatalogue = {
      ...catalogue,
      aiResponse: [
        ...catalogue.aiResponse,
        {
          ...qwen3b,
          id: 'larger-local-test-model',
          name: 'Larger local test model',
          benchmark: {
            ...qwen3b.benchmark,
            qualityBand: 'strong-local'
          },
          downloadSizeGb: 6,
          estimatedMemoryGb: 10,
          modelSizeB: 9,
          minimumFreeMemoryGb: 8,
          minimumTotalMemoryGb: 16
        }
      ]
    };
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 12, freeGb: 48, totalGb: 64 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(expandedCatalogue, profile);

    expect(recommendation.ai.model.id).toBe('larger-local-test-model');
  });

  it('would recommend Gemma 4 12B on a 32 GB Apple Silicon machine after Caul smoke passes', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const expandedCatalogue = {
      ...catalogue,
      aiResponse: catalogue.aiResponse.map((model) => (
        model.id === 'gemma-4-12b-it-q4_k_m'
          ? {
            ...model,
            caulSmokeStatus: 'passed-basic-instruction',
            implemented: true
          }
          : model
      ))
    };
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(expandedCatalogue, profile);

    expect(recommendation.ai.model.id).toBe('gemma-4-12b-it-q4_k_m');
  });

  it('does not recommend a local AI model that failed Caul smoke validation', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const expandedCatalogue = {
      ...catalogue,
      aiResponse: catalogue.aiResponse.map((model) => (
        model.id === 'qwen2.5-1.5b-instruct-q4_k_m'
          ? {
            ...model,
            defaultPriority: 100,
            implemented: true
          }
          : model
      ))
    };
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(expandedCatalogue, profile);

    expect(recommendation.ai.model.id).toBe('qwen3-1.7b-mlx-4bit');
  });

  it('recommends cloud AI when local AI is not viable', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 2, freeGb: 20, totalGb: 4 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'win32' }),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(recommendation.ai.recommendation).toBe('cloud');
    expect(recommendation.ai.model.id).toBe('openai-codex/gpt-5.5');
  });
});

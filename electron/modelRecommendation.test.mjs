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
  buildModelOptimisationProfile,
  buildSystemProfile,
  estimateStableModelMemoryGb,
  getBenchmarkCacheKey,
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
    ['GET https://huggingface.co/api/models/google/gemma-4-12B-it-qat-q4_0-gguf', {
      body: hfModelFixture('google/gemma-4-12B-it-qat-q4_0-gguf', ['gemma-4-12b-it-qat-q4_0.gguf'])
    }],
    ['HEAD https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/main/gemma-4-12b-it-qat-q4_0.gguf', {
      body: '',
      headers: { 'content-length': String(6.5 * 1024 * 1024 * 1024) }
    }],
    ['GET https://huggingface.co/api/models/Qwen/Qwen3-8B-GGUF', {
      body: hfModelFixture('Qwen/Qwen3-8B-GGUF', ['qwen3-8b-q4_k_m.gguf'])
    }],
    ['HEAD https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q4_k_m.gguf', {
      body: '',
      headers: { 'content-length': String(5.1 * 1024 * 1024 * 1024) }
    }],
    ['GET https://huggingface.co/api/models?search=GGUF%20Instruct&sort=downloads&direction=-1&limit=12', {
      body: [
        hfModelFixture('future-ai/Future-12B-Instruct-GGUF', [
          'future-12b-instruct-q3_k_m.gguf',
          'future-12b-instruct-q4_k_m.gguf',
          'future-12b-instruct-q5_k_m.gguf'
        ])
      ]
    }],
    ['GET https://huggingface.co/api/models/future-ai/Future-12B-Instruct-GGUF', {
      body: hfModelFixture('future-ai/Future-12B-Instruct-GGUF', [
        'future-12b-instruct-q3_k_m.gguf',
        'future-12b-instruct-q4_k_m.gguf',
        'future-12b-instruct-q5_k_m.gguf'
      ])
    }],
    ['HEAD https://huggingface.co/future-ai/Future-12B-Instruct-GGUF/resolve/main/future-12b-instruct-q3_k_m.gguf', {
      body: '',
      headers: { 'content-length': String(5.1 * 1024 * 1024 * 1024) }
    }],
    ['HEAD https://huggingface.co/future-ai/Future-12B-Instruct-GGUF/resolve/main/future-12b-instruct-q4_k_m.gguf', {
      body: '',
      headers: { 'content-length': String(6.2 * 1024 * 1024 * 1024) }
    }],
    ['HEAD https://huggingface.co/future-ai/Future-12B-Instruct-GGUF/resolve/main/future-12b-instruct-q5_k_m.gguf', {
      body: '',
      headers: { 'content-length': String(7.1 * 1024 * 1024 * 1024) }
    }],
    ['GET https://huggingface.co/api/models?search=GGUF%20Chat&sort=downloads&direction=-1&limit=12', {
      body: []
    }],
    ['GET https://huggingface.co/api/models?search=MLX%204bit%20Instruct&sort=downloads&direction=-1&limit=12', {
      body: [
        {
          ...hfModelFixture('future-ai/Future-12B-Instruct-MLX-4bit', []),
          tags: ['license:apache-2.0', 'mlx', '4bit']
        }
      ]
    }],
    ['GET https://huggingface.co/api/models/future-ai/Future-12B-Instruct-MLX-4bit', {
      body: {
        ...hfModelFixture('future-ai/Future-12B-Instruct-MLX-4bit', []),
        tags: ['license:apache-2.0', 'mlx', '4bit']
      }
    }],
    ['GET https://huggingface.co/api/models?search=MLX%20LM%204bit&sort=downloads&direction=-1&limit=12', {
      body: []
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
    expect(result.catalogue.sources.liveHuggingFaceGgufDiscovery.url).toContain('GGUF');
    expect(result.catalogue.sources.liveHuggingFaceMlxDiscovery.url).toContain('MLX');
    expect(result.catalogue.sources.liveLmArena.url).toContain('lmarena.ai');
    expect(result.catalogue.sources.liveMlxLm.url).toContain('mlx-lm');
    expect(result.sourceReports.find((report) => report.source === 'MLX LM').detail).toContain('v0.25.0');
    expect(result.catalogue.transcription.find((model) => model.id === 'parakeet').benchmark.rankSource).toContain('abcdef1');
    expect(result.catalogue.aiResponse.some((model) => model.id === 'gemma-4-e4b-it-litert-lm')).toBe(true);
    expect(result.catalogue.aiResponse.find((model) => model.id === 'gemma-4-12b-it-q4_0')).toMatchObject({
      downloadSizeGb: 6.5,
      fileName: 'gemma-4-12b-it-qat-q4_0.gguf',
      implemented: true,
      providerModelId: 'google/gemma-4-12B-it-qat-q4_0-gguf',
      quantisation: ['Q4_0']
    });
    expect(result.catalogue.aiResponse.find((model) => model.providerModelId === 'future-ai/Future-12B-Instruct-GGUF' && model.quantisation.includes('Q3_K_M'))).toMatchObject({
      downloadSizeGb: 5.1,
      implemented: true,
      runtime: 'llama.cpp'
    });
    expect(result.catalogue.aiResponse.find((model) => model.providerModelId === 'future-ai/Future-12B-Instruct-GGUF' && model.quantisation.includes('Q5_K_M'))).toMatchObject({
      downloadSizeGb: 7.1,
      implemented: true,
      minimumTotalMemoryGb: 32,
      runtime: 'llama.cpp'
    });
    expect(result.catalogue.aiResponse.find((model) => model.providerModelId === 'future-ai/Future-12B-Instruct-MLX-4bit')).toMatchObject({
      implemented: true,
      platforms: ['darwin'],
      runtime: 'mlx-lm'
    });
    expect(result.sourceReports.find((report) => report.source === 'Hugging Face GGUF discovery' && report.detail.includes('discovered 1'))).toBeTruthy();
    expect(result.sourceReports.find((report) => report.source === 'Hugging Face MLX discovery' && report.detail.includes('discovered 1'))).toBeTruthy();
    expect(result.sourceReports.every((report) => report.ok)).toBe(true);
  });

  it('can recommend a newly discovered live GGUF model when the machine fits it', async () => {
    const bundled = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const routes = liveCatalogueRoutes();
    const result = await refreshModelCatalogue(bundled, {
      fetchFn: fakeFetch(routes),
      now: new Date('2026-06-08T00:00:00.000Z')
    });
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 12, freeGb: 48, totalGb: 64 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue({ ...result.catalogue, source: 'live-cache' }, profile);

    expect(recommendation.ai.recommendation).toBe('local');
    expect(recommendation.ai.model.providerModelId).toBe('future-ai/Future-12B-Instruct-GGUF');
    expect(recommendation.ai.reason).toContain('live benchmark catalogue');
  });

  it('can recommend a newly discovered live MLX model on Apple Silicon', async () => {
    const bundled = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const routes = liveCatalogueRoutes();
    const result = await refreshModelCatalogue(bundled, {
      fetchFn: fakeFetch(routes),
      now: new Date('2026-06-08T00:00:00.000Z')
    });
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 12, freeGb: 36, totalGb: 48 }),
      processObject: fakeProcess({ arch: 'arm64', platform: 'darwin' }),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue({ ...result.catalogue, source: 'live-cache' }, profile);

    expect(recommendation.ai.recommendation).toBe('local');
    expect(recommendation.ai.model.providerModelId).toBe('future-ai/Future-12B-Instruct-MLX-4bit');
    expect(recommendation.ai.model.runtime).toBe('mlx-lm');
  });

  it('adds the official Gemma 4 12B candidate when refreshing an older live cache', async () => {
    const bundled = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const olderLiveCache = {
      ...bundled,
      aiResponse: bundled.aiResponse.filter((model) => model.id !== 'gemma-4-12b-it-q4_0')
    };
    const result = await refreshModelCatalogue(olderLiveCache, {
      fetchFn: fakeFetch(liveCatalogueRoutes()),
      now: new Date('2026-06-08T00:00:00.000Z')
    });

    expect(result.catalogue.aiResponse.find((model) => model.id === 'gemma-4-12b-it-q4_0')).toMatchObject({
      implemented: true,
      providerModelId: 'google/gemma-4-12B-it-qat-q4_0-gguf',
      quantisation: ['Q4_0'],
      runtime: 'llama.cpp'
    });
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

    expect(elapsedMs).toBeLessThan(260);
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
    expect(recommendation.ai.model.id).toBe('gemma-4-12b-it-q4_0');
  });

  it('does not down-rank a stronger model just because current free memory is temporarily low', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 6.8, totalGb: 32 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(recommendation.ai.recommendation).toBe('local');
    expect(profile.modelMemoryGb).toBeGreaterThanOrEqual(16);
    expect(recommendation.ai.model.id).toBe('gemma-4-12b-it-q4_0');
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
    expect(recommendation.ai.model.id).toBe('gemma-4-12b-it-q4_0');
  });

  it('describes live-cache recommendations as live rather than offline', () => {
    const catalogue = {
      ...loadModelCatalogue(resolve(root, 'model-catalog.json')),
      source: 'live-cache'
    };
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const recommendation = recommendFromCatalogue(catalogue, profile);

    expect(recommendation.ai.reason).toContain('live benchmark catalogue');
    expect(recommendation.transcription.reason).toContain('live benchmark catalogue');
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
        model.id === 'gemma-4-12b-it-q4_0'
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

    expect(recommendation.ai.model.id).toBe('gemma-4-12b-it-q4_0');
  });

  it('lets benchmark evidence choose GGUF over MLX when GGUF is faster on the machine', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess(),
      spawnSyncFn: fakeSpawn()
    });
    const optimisationProfile = buildModelOptimisationProfile(profile);
    const gemma = catalogue.aiResponse.find((entry) => entry.id === 'gemma-4-12b-it-q4_0');
    const mlx = catalogue.aiResponse.find((entry) => entry.id === 'qwen3-1.7b-mlx-4bit');
    const recommendation = recommendFromCatalogue(catalogue, profile, {
      benchmarkCache: {
        [getBenchmarkCacheKey(gemma, optimisationProfile)]: {
          createdAtMs: Date.now(),
          firstTokenMs: 420,
          machineFingerprint: optimisationProfile.machineFingerprint,
          modelId: gemma.id,
          ok: true,
          status: 'passed',
          tokensPerSecond: 34,
          totalMs: 1600
        },
        [getBenchmarkCacheKey(mlx, optimisationProfile)]: {
          createdAtMs: Date.now(),
          firstTokenMs: 2300,
          machineFingerprint: optimisationProfile.machineFingerprint,
          modelId: mlx.id,
          ok: true,
          status: 'passed',
          tokensPerSecond: 5,
          totalMs: 8200
        }
      }
    });

    expect(recommendation.ai.model.id).toBe('gemma-4-12b-it-q4_0');
    expect(recommendation.ai.performanceStatus.status).toBe('passed');
  });

  it('uses a passed benchmark cache entry to avoid reprobe requirements', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const initial = recommendFromCatalogue(catalogue, profile);
    const optimisationProfile = buildModelOptimisationProfile(profile);
    const key = getBenchmarkCacheKey(initial.ai.model, optimisationProfile);
    const recommendation = recommendFromCatalogue(catalogue, profile, {
      benchmarkCache: {
        [key]: {
          createdAtMs: Date.now(),
          firstTokenMs: 500,
          machineFingerprint: optimisationProfile.machineFingerprint,
          modelId: initial.ai.model.id,
          ok: true,
          status: 'passed',
          tokensPerSecond: 18,
          totalMs: 1200
        }
      }
    });

    expect(recommendation.ai.model.id).toBe(initial.ai.model.id);
    expect(recommendation.ai.benchmarkRequired).toBe(false);
    expect(recommendation.ai.performanceStatus.status).toBe('passed');
  });

  it('invalidates benchmark cache keys when the local runtime version changes', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const model = catalogue.aiResponse.find((entry) => entry.id === 'qwen2.5-3b-instruct-q4_k_m');
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const firstProfile = {
      ...profile,
      localRuntimes: {
        caulLlamaCpp: {
          ...profile.localRuntimes.caulLlamaCpp,
          provider: 'caul-llama.cpp',
          runtime: {
            ...profile.localRuntimes.caulLlamaCpp.runtime,
            supported: true,
            version: 'b1'
          }
        }
      }
    };
    const secondProfile = {
      ...firstProfile,
      localRuntimes: {
        caulLlamaCpp: {
          ...firstProfile.localRuntimes.caulLlamaCpp,
          runtime: {
            ...firstProfile.localRuntimes.caulLlamaCpp.runtime,
            version: 'b2'
          }
        }
      }
    };

    expect(getBenchmarkCacheKey(model, buildModelOptimisationProfile(firstProfile)))
      .not.toBe(getBenchmarkCacheKey(model, buildModelOptimisationProfile(secondProfile)));
  });

  it('avoids a local AI model that failed benchmark on this machine', () => {
    const catalogue = loadModelCatalogue(resolve(root, 'model-catalog.json'));
    const profile = buildSystemProfile({
      osModule: fakeOs({ cores: 10, freeGb: 18, totalGb: 32 }),
      processObject: fakeProcess({ arch: 'x64', platform: 'linux' }),
      spawnSyncFn: fakeSpawn()
    });
    const initial = recommendFromCatalogue(catalogue, profile);
    const optimisationProfile = buildModelOptimisationProfile(profile);
    const key = getBenchmarkCacheKey(initial.ai.model, optimisationProfile);
    const recommendation = recommendFromCatalogue(catalogue, profile, {
      benchmarkCache: {
        [key]: {
          createdAtMs: Date.now(),
          failureReason: 'benchmark timeout',
          machineFingerprint: optimisationProfile.machineFingerprint,
          modelId: initial.ai.model.id,
          ok: false,
          status: 'failed'
        }
      }
    });

    expect(recommendation.ai.model?.id).not.toBe(initial.ai.model.id);
    expect(recommendation.ai.fitFailures.some((failure) => failure.includes('benchmark timeout'))).toBe(true);
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

    expect(recommendation.ai.model.id).not.toBe('qwen2.5-1.5b-instruct-q4_k_m');
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

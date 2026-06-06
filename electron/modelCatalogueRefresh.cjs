const defaultUserAgent = 'CaulModelCatalogueRefresh/0.1 (+https://github.com/apotenza92/caul)';

const liveSourceDefinitions = {
  artificialAnalysis: {
    name: 'Artificial Analysis',
    url: 'https://artificialanalysis.ai/leaderboards/models'
  },
  lmArena: {
    name: 'LMArena',
    url: 'https://lmarena.ai/leaderboard'
  },
  huggingFace: {
    name: 'Hugging Face Hub API',
    url: 'https://huggingface.co/docs/hub/api'
  },
  googleGemma: {
    name: 'Google DeepMind Gemma',
    url: 'https://deepmind.google/models/gemma/gemma-4/'
  },
  liteRtLm: {
    name: 'LiteRT-LM',
    url: 'https://ai.google.dev/edge/litert-lm'
  },
  llamaCpp: {
    name: 'llama.cpp',
    fallbackUrl: 'https://github.com/ggml-org/llama.cpp/releases/latest',
    url: 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'
  },
  mlxLm: {
    name: 'MLX LM',
    fallbackUrl: 'https://github.com/ml-explore/mlx-lm/releases/latest',
    url: 'https://api.github.com/repos/ml-explore/mlx-lm/releases/latest'
  }
};

const liveModelSources = [
  {
    artificialAnalysisUrl: 'https://artificialanalysis.ai/models/gemma-4-e4b',
    hfRepo: 'litert-community/gemma-4-E4B-it-litert-lm',
    id: 'gemma-4-e4b-it-litert-lm',
    localCandidate: {
      benchmark: {
        latencyBand: 'balanced-local',
        preferenceSource: 'Artificial Analysis and LMArena Gemma 4 family comparisons',
        qualityBand: 'balanced-local',
        qualitySource: 'Artificial Analysis Gemma 4 E4B Intelligence Index',
        speedSource: 'LiteRT-LM and Google DeepMind Gemma runtime guidance'
      },
      cloud: false,
      contextWindowTokens: 128000,
      defaultPriority: 0,
      downloadSizeGb: 6,
      estimatedMemoryGb: 9,
      implemented: false,
      licence: 'Apache-2.0',
      local: true,
      minimumCpuCores: 6,
      minimumFreeMemoryGb: 7,
      minimumTotalMemoryGb: 16,
      minimumVramGb: 0,
      modelSizeB: 8,
      name: 'Gemma 4 E4B IT LiteRT-LM',
      openWeights: true,
      platforms: ['darwin'],
      quantisation: ['LiteRT-LM'],
      reasoningSupport: true,
      runtime: 'litert-lm',
      toolSupport: true
    }
  },
  {
    artificialAnalysisUrl: null,
    hfRepo: 'bartowski/gemma-4-12B-it-GGUF',
    id: 'gemma-4-12b-it-q4_k_m',
    preferredFileName: 'gemma-4-12B-it-Q4_K_M.gguf'
  },
  {
    artificialAnalysisUrl: 'https://artificialanalysis.ai/models/qwen3-8b-instruct',
    hfRepo: 'Qwen/Qwen3-8B-GGUF',
    id: 'qwen3-8b-instruct-q4_k_m',
    localCandidate: {
      benchmark: {
        latencyBand: 'balanced-local',
        preferenceSource: 'Artificial Analysis and LMArena Qwen3 family comparisons',
        qualityBand: 'balanced-local',
        qualitySource: 'Artificial Analysis Qwen3 8B Intelligence Index',
        speedSource: 'Hugging Face GGUF availability and llama.cpp runtime guidance'
      },
      cloud: false,
      contextWindowTokens: 131000,
      defaultPriority: 0,
      downloadSizeGb: 5,
      estimatedMemoryGb: 9,
      implemented: false,
      licence: 'Apache-2.0',
      local: true,
      minimumCpuCores: 8,
      minimumFreeMemoryGb: 7,
      minimumTotalMemoryGb: 16,
      minimumVramGb: 0,
      modelSizeB: 8,
      name: 'Qwen3 8B Instruct Q4',
      openWeights: true,
      platforms: ['darwin', 'win32', 'linux'],
      quantisation: ['Q4_K_M'],
      reasoningSupport: true,
      runtime: 'llama.cpp',
      toolSupport: false
    },
    preferredFileName: 'qwen3-8b-q4_k_m.gguf'
  }
];

async function refreshModelCatalogue(catalogue, {
  fetchFn = fetchUrl,
  now = new Date()
} = {}) {
  const next = structuredClone(catalogue);
  const reviewedAt = toDateString(now);
  const sourceReports = [];

  next.lastReviewed = reviewedAt;
  next.sources = {
    ...next.sources,
    liveArtificialAnalysis: liveSourceDefinitions.artificialAnalysis,
    liveLmArena: liveSourceDefinitions.lmArena,
    liveHuggingFace: liveSourceDefinitions.huggingFace,
    liveGoogleGemma: liveSourceDefinitions.googleGemma,
    liveLiteRtLm: liveSourceDefinitions.liteRtLm,
    liveLlamaCpp: liveSourceDefinitions.llamaCpp,
    liveMlxLm: liveSourceDefinitions.mlxLm
  };

  const modelTasks = liveModelSources.map((source) => refreshLiveModel(next, source, { fetchFn, reviewedAt }));
  const sourceTasks = [
    refreshAsrSource(next, { fetchFn, reviewedAt }),
    refreshGemmaOfficialSource(next, { fetchFn }),
    refreshLmArenaSource({ fetchFn }),
    refreshLiteRtLmRuntimeSource({ fetchFn }),
    refreshGitHubRuntimeSource(liveSourceDefinitions.llamaCpp, { fetchFn }),
    refreshGitHubRuntimeSource(liveSourceDefinitions.mlxLm, { fetchFn }),
    ...modelTasks
  ];
  const reportGroups = await Promise.all(sourceTasks);
  for (const reports of reportGroups) {
    sourceReports.push(...reports);
  }

  return {
    catalogue: next,
    reviewedAt,
    sourceReports
  };
}

async function refreshLmArenaSource({ fetchFn }) {
  const url = liveSourceDefinitions.lmArena.url;

  try {
    const html = await fetchText(fetchFn, url);
    const text = stripHtml(html);
    const hasLeaderboardSignal = /LMArena|leaderboard|Arena/i.test(text);
    return [{
      ok: hasLeaderboardSignal,
      source: liveSourceDefinitions.lmArena.name,
      url,
      detail: hasLeaderboardSignal ? 'human-preference leaderboard reachable' : 'leaderboard signal not found'
    }];
  } catch (error) {
    return [{
      ok: false,
      source: liveSourceDefinitions.lmArena.name,
      url,
      detail: error.message
    }];
  }
}

async function refreshLiteRtLmRuntimeSource({ fetchFn }) {
  const url = liveSourceDefinitions.liteRtLm.url;

  try {
    const html = await fetchText(fetchFn, url);
    const text = stripHtml(html);
    const hasLiteRtLm = /LiteRT[-\s]?LM/i.test(text);
    return [{
      ok: hasLiteRtLm,
      source: liveSourceDefinitions.liteRtLm.name,
      url,
      detail: hasLiteRtLm ? 'runtime guidance available' : 'runtime signal not found'
    }];
  } catch (error) {
    return [{
      ok: false,
      source: liveSourceDefinitions.liteRtLm.name,
      url,
      detail: error.message
    }];
  }
}

async function refreshGitHubRuntimeSource(source, { fetchFn }) {
  try {
    const release = await fetchJson(fetchFn, source.url);
    return [{
      ok: true,
      source: source.name,
      url: source.url,
      detail: `latest release ${release.tag_name ?? release.name ?? 'unknown'}`
    }];
  } catch (error) {
    return refreshGitHubRuntimeSourceFromPage(source, { fetchFn, previousError: error });
  }
}

async function refreshGitHubRuntimeSourceFromPage(source, { fetchFn, previousError }) {
  if (!source.fallbackUrl) {
    return [{
      ok: false,
      source: source.name,
      url: source.url,
      detail: previousError.message
    }];
  }

  try {
    const response = await fetchFn(source.fallbackUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const releaseUrl = response.url || source.fallbackUrl;
    const tag = releaseUrl.match(/\/releases\/tag\/([^/?#]+)/)?.[1] ?? 'unknown';
    return [{
      ok: true,
      source: source.name,
      url: source.fallbackUrl,
      detail: `latest release ${decodeURIComponent(tag)}`
    }];
  } catch (fallbackError) {
    return [{
      ok: false,
      source: source.name,
      url: source.url,
      detail: `${previousError.message}; fallback ${fallbackError.message}`
    }];
  }
}

async function refreshAsrSource(catalogue, { fetchFn, reviewedAt }) {
  const url = 'https://huggingface.co/api/datasets/hf-audio/open-asr-leaderboard';

  try {
    const metadata = await fetchJson(fetchFn, url);
    for (const model of catalogue.transcription) {
      if (model.benchmark?.rankSource?.includes('Open ASR')) {
        model.reviewedAt = reviewedAt;
        model.benchmark.rankSource = `Hugging Face Open ASR Leaderboard (${metadata.sha?.slice(0, 7) ?? 'live'})`;
      }
    }
    return [{
      ok: true,
      source: 'Hugging Face Open ASR Leaderboard',
      url,
      detail: `dataset revision ${metadata.sha ?? 'unknown'}`
    }];
  } catch (error) {
    return [{
      ok: false,
      source: 'Hugging Face Open ASR Leaderboard',
      url,
      detail: error.message
    }];
  }
}

async function refreshGemmaOfficialSource(catalogue, { fetchFn }) {
  const url = 'https://deepmind.google/models/gemma/gemma-4/';

  try {
    const html = await fetchText(fetchFn, url);
    const hasGemma12B = /12B/.test(stripHtml(html)) && /Frontier intelligence on personal computers/i.test(stripHtml(html));
    const report = {
      ok: hasGemma12B,
      source: 'Google DeepMind Gemma',
      url,
      detail: hasGemma12B ? 'Gemma 4 personal-computer class confirmed' : 'Gemma 4 12B signal not found'
    };

    const gemma12B = catalogue.aiResponse.find((model) => model.id === 'gemma-4-12b-it-q4_k_m');
    if (gemma12B && hasGemma12B) {
      gemma12B.benchmark.qualitySource = 'Google DeepMind Gemma 4 12B launch benchmarks and Artificial Analysis Gemma 4 family benchmarks';
      gemma12B.benchmark.speedSource = 'Google DeepMind Gemma 4 12B local hardware guidance; Caul smoke pending';
      gemma12B.minimumTotalMemoryGb = Math.max(16, Number(gemma12B.minimumTotalMemoryGb ?? 0));
      gemma12B.minimumFreeMemoryGb = Math.max(10, Number(gemma12B.minimumFreeMemoryGb ?? 0));
    }
    return [report];
  } catch (error) {
    return [{
      ok: false,
      source: 'Google DeepMind Gemma',
      url,
      detail: error.message
    }];
  }
}

async function refreshLiveModel(catalogue, source, { fetchFn, reviewedAt }) {
  const model = ensureLiveModelCandidate(catalogue, source, reviewedAt);
  const reportGroups = [];

  if (source.artificialAnalysisUrl) {
    reportGroups.push(refreshArtificialAnalysisModel(model, source.artificialAnalysisUrl, { fetchFn }));
  }

  if (source.hfRepo) {
    reportGroups.push(refreshHuggingFaceModel(model, source, { fetchFn, reviewedAt }));
  }

  const reports = reportGroups.length > 0 ? (await Promise.all(reportGroups)).flat() : [];
  model.reviewedAt = reviewedAt;

  return reports;
}

function ensureLiveModelCandidate(catalogue, source, reviewedAt) {
  const existing = catalogue.aiResponse.find((model) => model.id === source.id);
  if (existing) {
    return existing;
  }

  if (!source.localCandidate) {
    throw new Error(`Live source ${source.id} has no bundled or candidate model template.`);
  }

  const candidate = {
    ...structuredClone(source.localCandidate),
    id: source.id,
    provenanceUrl: source.hfRepo ? `https://huggingface.co/${source.hfRepo}` : source.artificialAnalysisUrl,
    providerModelId: source.hfRepo,
    reviewedAt
  };

  catalogue.aiResponse.push(candidate);
  return candidate;
}

async function refreshArtificialAnalysisModel(model, url, { fetchFn }) {
  try {
    const html = await fetchText(fetchFn, url);
    const parsed = parseArtificialAnalysisModelPage(html);
    if (parsed.intelligenceIndex !== null) {
      model.benchmark.qualitySource = `Artificial Analysis Intelligence Index ${parsed.intelligenceIndex}`;
      model.benchmark.qualityBand = qualityBandFromIntelligenceIndex(parsed.intelligenceIndex, model.modelSizeB);
    }
    if (parsed.outputTokensPerSecond !== null) {
      model.benchmark.speedSource = `Artificial Analysis speed ${parsed.outputTokensPerSecond} output tokens/s`;
      model.benchmark.latencyBand = parsed.outputTokensPerSecond >= 35 ? 'fast-local' : 'balanced-local';
    }
    if (parsed.contextWindowTokens !== null) {
      model.contextWindowTokens = parsed.contextWindowTokens;
    }
    if (parsed.totalParametersB !== null) {
      model.modelSizeB = parsed.totalParametersB;
    }
    if (parsed.activeParametersB !== null && parsed.activeParametersB < model.modelSizeB) {
      model.estimatedMemoryGb = Math.min(model.estimatedMemoryGb, Math.max(4, parsed.activeParametersB * 2));
    }

    return [{
      ok: true,
      source: 'Artificial Analysis',
      url,
      detail: parsed.intelligenceIndex === null ? 'page fetched; score not found' : `Intelligence Index ${parsed.intelligenceIndex}`
    }];
  } catch (error) {
    return [{
      ok: false,
      source: 'Artificial Analysis',
      url,
      detail: error.message
    }];
  }
}

async function refreshHuggingFaceModel(model, source, { fetchFn, reviewedAt }) {
  const url = `https://huggingface.co/api/models/${source.hfRepo}`;

  try {
    const metadata = await fetchJson(fetchFn, url);
    const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
    const licenceTag = tags.find((tag) => tag.startsWith('license:'));
    const preferredFile = source.preferredFileName
      ? findHuggingFaceSibling(metadata, source.preferredFileName)
      : null;

    model.providerModelId = source.hfRepo;
    model.provenanceUrl = `https://huggingface.co/${source.hfRepo}`;
    model.openWeights = metadata.gated === false && metadata.private === false;
    model.licence = licenceTag ? normaliseLicenceTag(licenceTag) : model.licence;
    model.reviewedAt = reviewedAt;

    if (preferredFile) {
      model.fileName = preferredFile.rfilename;
      model.downloadUrl = `https://huggingface.co/${source.hfRepo}/resolve/main/${encodeURIComponent(preferredFile.rfilename)}`;
      model.downloadSizeGb = await fetchContentLengthGb(fetchFn, model.downloadUrl).catch(() => model.downloadSizeGb);
    }

    return [{
      ok: true,
      source: 'Hugging Face Hub',
      url,
      detail: `${metadata.modelId ?? source.hfRepo}; ${metadata.downloads ?? 0} downloads; ${metadata.lastModified ?? 'unknown modified date'}`
    }];
  } catch (error) {
    return [{
      ok: false,
      source: 'Hugging Face Hub',
      url,
      detail: error.message
    }];
  }
}

function parseArtificialAnalysisModelPage(html) {
  const text = stripHtml(html);
  const intelligenceIndex = firstNumber([
    /scores\s+(\d+(?:\.\d+)?)\s+on the Artificial Analysis Intelligence Index/i,
    /Intelligence\s+#\d+\s*\/\s*\d+\s+(\d+(?:\.\d+)?)\s+Artificial Analysis Intelligence Index/i,
    /Artificial Analysis Intelligence Index\s+(\d+(?:\.\d+)?)\s+out of 100/i
  ], text);
  const outputTokensPerSecond = firstNumber([
    /Speed\s+(\d+(?:\.\d+)?)\s+Output tokens per second/i,
    /(\d+(?:\.\d+)?)\s+Output tokens per second/i
  ], text);
  const contextWindowTokens = parseContextWindow(text);
  const totalParametersB = firstNumber([/Total parameters\s+(\d+(?:\.\d+)?)B/i], text);
  const activeParametersB = firstNumber([/Active parameters\s+(\d+(?:\.\d+)?)B/i], text);

  return {
    activeParametersB,
    contextWindowTokens,
    intelligenceIndex,
    outputTokensPerSecond,
    totalParametersB
  };
}

function stripHtml(html) {
  return String(html ?? '')
    .replace(/<!--.*?-->/gs, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNumber(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      return Number.isFinite(value) ? value : null;
    }
  }

  return null;
}

function parseContextWindow(text) {
  const match = text.match(/Context window\s+(\d+(?:\.\d+)?)\s*k/i);
  if (!match) {
    return null;
  }

  return Math.round(Number(match[1]) * 1000);
}

function qualityBandFromIntelligenceIndex(index, modelSizeB) {
  if (index >= 22 || (index >= 18 && modelSizeB <= 12)) {
    return 'strong-local';
  }

  if (index >= 12) {
    return 'balanced-local';
  }

  return 'small-local';
}

function findHuggingFaceSibling(metadata, preferredFileName) {
  const siblings = Array.isArray(metadata.siblings) ? metadata.siblings : [];
  const exact = siblings.find((sibling) => sibling.rfilename === preferredFileName);
  if (exact) {
    return exact;
  }

  const preferredLower = preferredFileName.toLowerCase();
  return siblings.find((sibling) => sibling.rfilename?.toLowerCase().endsWith(preferredLower)) ?? null;
}

function normaliseLicenceTag(tag) {
  return tag.replace(/^license:/, '').replace(/^apache-2\.0$/i, 'Apache-2.0');
}

async function fetchContentLengthGb(fetchFn, url) {
  const response = await fetchFn(url, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const length = Number(response.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('Missing content-length');
  }

  return Math.round((length / 1024 / 1024 / 1024) * 10) / 10;
}

async function fetchJson(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchText(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function fetchUrl(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': defaultUserAgent,
      ...options.headers
    }
  });
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = {
  liveModelSources,
  parseArtificialAnalysisModelPage,
  refreshModelCatalogue,
  stripHtml
};

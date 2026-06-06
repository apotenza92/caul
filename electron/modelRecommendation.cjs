const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const catalogueStaleAfterMs = 90 * 24 * 60 * 60 * 1000;

function getDefaultModelCataloguePath(rootDir = path.resolve(__dirname, '..')) {
  return path.join(rootDir, 'model-catalog.json');
}

function getLiveModelCataloguePath(userDataPath) {
  return path.join(userDataPath, 'model-catalogue', 'live-model-catalog.json');
}

function loadModelCatalogue(cataloguePath = getDefaultModelCataloguePath()) {
  const raw = fsSync.readFileSync(cataloguePath, 'utf8');
  const catalogue = JSON.parse(raw);
  validateModelCatalogue(catalogue);

  return catalogue;
}

function loadBestModelCatalogue({
  allowLive = true,
  bundledPath = getDefaultModelCataloguePath(),
  fs = fsSync,
  userDataPath = null
} = {}) {
  if (allowLive && userDataPath) {
    const livePath = getLiveModelCataloguePath(userDataPath);
    try {
      if (fs.existsSync(livePath)) {
        const liveCatalogue = JSON.parse(fs.readFileSync(livePath, 'utf8'));
        validateModelCatalogue(liveCatalogue);

        return {
          ...liveCatalogue,
          source: 'live-cache'
        };
      }
    } catch (error) {
      console.error('Failed to load live model catalogue cache:', error);
    }
  }

  return {
    ...loadModelCatalogue(bundledPath),
    source: 'bundled'
  };
}

function writeLiveModelCatalogue(userDataPath, catalogue, { fs = fsSync } = {}) {
  validateModelCatalogue(catalogue);
  const livePath = getLiveModelCataloguePath(userDataPath);
  fs.mkdirSync(path.dirname(livePath), { recursive: true });
  fs.writeFileSync(livePath, `${JSON.stringify(catalogue, null, 2)}\n`, 'utf8');

  return livePath;
}

function validateModelCatalogue(catalogue) {
  if (!catalogue || typeof catalogue !== 'object') {
    throw new Error('Model catalogue must be an object.');
  }

  if (catalogue.version !== 1) {
    throw new Error('Model catalogue version must be 1.');
  }

  for (const key of ['lastReviewed', 'sources']) {
    if (!catalogue[key]) {
      throw new Error(`Model catalogue is missing ${key}.`);
    }
  }

  if (!Array.isArray(catalogue.transcription) || catalogue.transcription.length === 0) {
    throw new Error('Model catalogue must include transcription models.');
  }

  if (!Array.isArray(catalogue.aiResponse) || catalogue.aiResponse.length === 0) {
    throw new Error('Model catalogue must include AI response models.');
  }

  for (const model of [...catalogue.transcription, ...catalogue.aiResponse]) {
    for (const key of ['id', 'name', 'runtime', 'reviewedAt', 'provenanceUrl']) {
      if (!model[key]) {
        throw new Error(`Model catalogue entry is missing ${key}.`);
      }
    }
  }
}

function getStaleCatalogueEntries(catalogue, now = new Date()) {
  return [...catalogue.transcription, ...catalogue.aiResponse]
    .filter((model) => isStaleReviewedAt(model.reviewedAt, now))
    .map((model) => ({
      id: model.id,
      name: model.name,
      reviewedAt: model.reviewedAt
    }));
}

function isStaleReviewedAt(reviewedAt, now) {
  const reviewedDate = new Date(reviewedAt);

  if (Number.isNaN(reviewedDate.getTime())) {
    return true;
  }

  return now.getTime() - reviewedDate.getTime() > catalogueStaleAfterMs;
}

function buildSystemProfile({
  osModule = os,
  processObject = process,
  spawnSyncFn = spawnSync
} = {}) {
  const totalMemoryGb = roundGb(osModule.totalmem());
  const platform = processObject.platform;
  const arch = processObject.arch;
  const currentAvailableMemoryGb = detectAvailableMemoryGb({ osModule, platform, spawnSyncFn });
  const modelMemoryGb = estimateStableModelMemoryGb(totalMemoryGb);
  const cpuCores = Math.max(1, osModule.cpus().length);
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
  const gpu = detectGpuProfile({ platform, isAppleSilicon, spawnSyncFn, totalMemoryGb });

  return {
    accelerator: isAppleSilicon ? 'apple-silicon' : gpu.vendor === 'unknown' ? 'cpu' : 'gpu',
    arch,
    cpuCores,
    currentAvailableMemoryGb,
    freeMemoryGb: currentAvailableMemoryGb,
    gpu,
    localRuntimes: {
      caulLlamaCpp: createMissingLocalLlmStatus()
    },
    modelMemoryGb,
    platform,
    totalMemoryGb
  };
}

function detectAvailableMemoryGb({ osModule, platform, spawnSyncFn }) {
  if (platform === 'darwin') {
    const result = spawnSyncFn('/usr/bin/vm_stat', [], {
      encoding: 'utf8',
      timeout: 1500
    });
    const macAvailableGb = parseMacAvailableMemoryGb(result.stdout);
    if (macAvailableGb !== null) {
      return macAvailableGb;
    }
  }

  return roundGb(osModule.freemem());
}

function estimateStableModelMemoryGb(totalMemoryGb) {
  const osReserveGb = totalMemoryGb >= 32
    ? 8
    : totalMemoryGb >= 16
      ? 5
    : totalMemoryGb >= 8
      ? 4
      : 2;
  const usableAfterReserve = Math.max(0, totalMemoryGb - osReserveGb);
  const conservativeShare = totalMemoryGb >= 32 ? 0.7 : 0.65;

  return roundOneDecimal(usableAfterReserve * conservativeShare);
}

function parseMacAvailableMemoryGb(stdout) {
  const text = String(stdout ?? '');
  const pageSizeMatch = text.match(/page size of (\d+) bytes/i);

  if (!pageSizeMatch) {
    return null;
  }

  const pageSize = Number(pageSizeMatch[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return null;
  }

  const pageCounts = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^Pages ([^:]+):\s+([\d.]+)\.?$/);
    if (match) {
      pageCounts.set(match[1].trim().toLowerCase(), Number(match[2]));
    }
  }

  const reclaimablePages = [
    pageCounts.get('free') ?? 0,
    pageCounts.get('inactive') ?? 0,
    pageCounts.get('speculative') ?? 0,
    pageCounts.get('purgeable') ?? 0
  ].reduce((sum, pages) => sum + (Number.isFinite(pages) ? pages : 0), 0);

  return roundGb(reclaimablePages * pageSize);
}

function createMissingLocalLlmStatus() {
  return {
    ok: true,
    provider: 'caul-llama.cpp',
    status: 'missing',
    runtime: {
      assetName: null,
      installed: false,
      path: null,
      supported: false,
      version: null
    },
    model: null
  };
}

function roundGb(bytes) {
  return roundOneDecimal(bytes / 1024 / 1024 / 1024);
}

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function detectGpuProfile({ platform, isAppleSilicon, spawnSyncFn, totalMemoryGb }) {
  if (isAppleSilicon) {
    return {
      available: true,
      name: 'Apple Silicon unified GPU',
      unifiedMemory: true,
      vendor: 'apple',
      vramGb: totalMemoryGb
    };
  }

  if (platform === 'darwin') {
    const result = spawnSyncFn('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], {
      encoding: 'utf8',
      timeout: 1500
    });
    const parsed = parseMacGpuProfile(result.stdout);
    if (parsed) {
      return parsed;
    }
  }

  const nvidia = detectNvidiaGpuProfile(spawnSyncFn);
  if (nvidia) {
    return nvidia;
  }

  if (platform === 'win32') {
    const result = spawnSyncFn('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress'
    ], {
      encoding: 'utf8',
      timeout: 1500
    });
    const parsed = parseWindowsGpuProfile(result.stdout);
    if (parsed) {
      return parsed;
    }
  }

  return {
    available: false,
    name: null,
    unifiedMemory: false,
    vendor: 'unknown',
    vramGb: 0
  };
}

function detectNvidiaGpuProfile(spawnSyncFn) {
  const result = spawnSyncFn('nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits'
  ], {
    encoding: 'utf8',
    timeout: 1500
  });
  const firstLine = String(result.stdout ?? '').trim().split('\n')[0];
  const match = firstLine.match(/^(.+),\s*([\d.]+)$/);

  if (!match || result.status !== 0) {
    return null;
  }

  const vramMb = Number(match[2]);

  return {
    available: true,
    name: match[1].trim(),
    unifiedMemory: false,
    vendor: 'nvidia',
    vramGb: Number.isFinite(vramMb) ? roundGb(vramMb * 1024 * 1024) : 0
  };
}

function parseWindowsGpuProfile(stdout) {
  if (!stdout) {
    return null;
  }

  try {
    const payload = JSON.parse(stdout);
    const adapter = Array.isArray(payload) ? payload[0] : payload;
    if (!adapter?.Name) {
      return null;
    }

    return {
      available: true,
      name: adapter.Name,
      unifiedMemory: false,
      vendor: normaliseGpuVendor(adapter.Name),
      vramGb: roundGb(Number(adapter.AdapterRAM ?? 0))
    };
  } catch {
    return null;
  }
}

function parseMacGpuProfile(stdout) {
  if (!stdout) {
    return null;
  }

  try {
    const payload = JSON.parse(stdout);
    const display = payload?.SPDisplaysDataType?.[0];
    if (!display) {
      return null;
    }

    return {
      available: true,
      name: display.sppci_model ?? display._name ?? 'Detected GPU',
      unifiedMemory: false,
      vendor: normaliseGpuVendor(display.sppci_vendor),
      vramGb: parseVramGb(display.spdisplays_vram)
    };
  } catch {
    return null;
  }
}

function normaliseGpuVendor(vendor) {
  const value = String(vendor ?? '').toLowerCase();

  if (value.includes('nvidia')) {
    return 'nvidia';
  }

  if (value.includes('amd') || value.includes('ati')) {
    return 'amd';
  }

  if (value.includes('intel')) {
    return 'intel';
  }

  return value ? 'other' : 'unknown';
}

function parseVramGb(value) {
  const text = String(value ?? '').toLowerCase();
  const match = text.match(/([\d.]+)\s*(gb|mb)/);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return match[2] === 'gb'
    ? amount
    : Math.round((amount / 1024) * 10) / 10;
}

function recommendFromCatalogue(catalogue, profile, {
  cloudAiImplemented = true,
  cloudTranscriptionImplemented = false
} = {}) {
  return {
    ai: recommendAiResponseModel(catalogue, profile, { cloudAiImplemented }),
    staleCatalogueEntries: getStaleCatalogueEntries(catalogue),
    transcription: recommendTranscriptionModel(catalogue, profile, { cloudTranscriptionImplemented })
  };
}

function recommendTranscriptionModel(catalogue, profile, { cloudTranscriptionImplemented = false } = {}) {
  const candidates = catalogue.transcription
    .filter((model) => model.implemented)
    .filter((model) => model.platforms.includes(profile.platform))
    .map((model) => ({
      model,
      fit: getHardwareFit(model, profile),
      score: scoreTranscriptionModel(model, profile)
    }))
    .filter((candidate) => candidate.fit.ok)
    .sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    const best = candidates[0].model;
    return {
      candidateCount: candidates.length,
      model: best,
      recommendation: best.id === 'parakeet' ? 'local-parakeet' : 'local-moonshine-tiny',
      reason: `${best.name} is the best implemented live transcription fit for this machine from the bundled benchmark catalogue.`,
      source: best.benchmark.rankSource,
      viable: true
    };
  }

  return {
    candidateCount: 0,
    model: null,
    recommendation: cloudTranscriptionImplemented ? 'cloud' : 'none',
    reason: cloudTranscriptionImplemented
      ? 'No bundled local transcription model is a good fit for this machine, so cloud transcription is recommended.'
      : 'No bundled local transcription model is a good fit for this machine, and Caul does not implement cloud transcription yet.',
    source: catalogue.sources.asrLeaderboard.name,
    viable: false
  };
}

function scoreTranscriptionModel(model, profile) {
  const accuracyScore = model.benchmark.accuracyBand === 'strong' ? 50 : 30;
  const latencyScore = model.benchmark.latencyBand === 'live' ? 35 : 5;
  const maturityScore = model.implementationMaturity === 'production' ? 20 : 5;
  const acceleratorScore = model.accelerators.includes(profile.accelerator) ? 10 : 0;

  return accuracyScore + latencyScore + maturityScore + acceleratorScore - model.estimatedMemoryGb;
}

function recommendAiResponseModel(catalogue, profile, { cloudAiImplemented = true } = {}) {
  const localCandidates = catalogue.aiResponse
    .filter((model) => model.local && model.implemented)
    .filter((model) => model.caulSmokeStatus !== 'failed-basic-instruction')
    .filter((model) => !Array.isArray(model.platforms) || model.platforms.includes(profile.platform))
    .map((model) => ({
      model,
      fit: getHardwareFit(model, profile),
      score: scoreAiModel(model, profile)
    }))
    .filter((candidate) => candidate.fit.ok)
    .sort((a, b) => b.score - a.score);

  if (localCandidates.length > 0) {
    const best = localCandidates[0].model;
    return {
      localRuntime: profile.localRuntimes.caulLlamaCpp,
      model: best,
      recommendation: 'local',
      reason: `${best.name} is the best local AI response fit for this machine from the bundled benchmark catalogue.`,
      source: best.benchmark.qualitySource,
      viable: true
    };
  }

  const cloudModel = catalogue.aiResponse.find((model) => model.cloud && model.implemented) ?? null;

  return {
    localRuntime: profile.localRuntimes.caulLlamaCpp,
    model: cloudAiImplemented ? cloudModel : null,
    recommendation: cloudAiImplemented ? 'cloud' : 'none',
    reason: 'No benchmark-grounded local AI model is likely to run comfortably on this machine.',
    source: cloudModel?.benchmark.qualitySource ?? catalogue.sources.llmLeaderboard.name,
    viable: false
  };
}

function scoreAiModel(model, profile) {
  const qualityScore = model.benchmark.qualityBand === 'strong-local'
    ? 85
    : model.benchmark.qualityBand === 'balanced-local'
      ? 55
      : model.benchmark.qualityBand === 'small-local'
        ? 35
        : 30;
  const speedScore = model.benchmark.latencyBand === 'fast-local' ? 30 : 20;
  const memoryHeadroom = getRecommendationMemoryGb(profile) - model.minimumFreeMemoryGb;
  const acceleratorScore = profile.accelerator === 'apple-silicon' || profile.gpu.available ? 10 : 0;
  const defaultPriorityScore = Math.min(8, Number(model.defaultPriority ?? 0) / 4);
  const sizePenalty = (Number(model.modelSizeB ?? 0) * 1.2)
    + (Number(model.downloadSizeGb ?? 0) * 0.7)
    + (Number(model.estimatedMemoryGb ?? 0) * 0.5);

  return qualityScore + speedScore + acceleratorScore + memoryHeadroom + defaultPriorityScore - sizePenalty;
}

function getHardwareFit(model, profile) {
  const failures = [];
  const memoryGb = getRecommendationMemoryGb(profile);

  if (profile.totalMemoryGb < model.minimumTotalMemoryGb) {
    failures.push(`needs ${model.minimumTotalMemoryGb} GB RAM`);
  }

  if (memoryGb < model.minimumFreeMemoryGb) {
    failures.push(`needs ${model.minimumFreeMemoryGb} GB model memory capacity`);
  }

  if (profile.cpuCores < model.minimumCpuCores) {
    failures.push(`needs ${model.minimumCpuCores} CPU cores`);
  }

  if ((model.minimumVramGb ?? 0) > 0 && profile.gpu.vramGb < model.minimumVramGb) {
    failures.push(`needs ${model.minimumVramGb} GB VRAM`);
  }

  return {
    failures,
    ok: failures.length === 0
  };
}

function getCurrentMemoryFit(model, profile) {
  const currentAvailableGb = Number(profile.currentAvailableMemoryGb ?? profile.freeMemoryGb ?? 0);
  const minimumFreeMemoryGb = Number(model.minimumFreeMemoryGb ?? 0);

  return {
    ok: currentAvailableGb >= minimumFreeMemoryGb,
    currentAvailableGb,
    failures: currentAvailableGb >= minimumFreeMemoryGb
      ? []
      : [`currently has ${currentAvailableGb} GB available, model prefers ${minimumFreeMemoryGb} GB before starting`]
  };
}

function getRecommendationMemoryGb(profile) {
  return Number(profile.modelMemoryGb ?? profile.freeMemoryGb ?? 0);
}

module.exports = {
  buildSystemProfile,
  createMissingLocalLlmStatus,
  detectAvailableMemoryGb,
  estimateStableModelMemoryGb,
  getCurrentMemoryFit,
  getDefaultModelCataloguePath,
  getHardwareFit,
  getRecommendationMemoryGb,
  getLiveModelCataloguePath,
  getStaleCatalogueEntries,
  loadBestModelCatalogue,
  loadModelCatalogue,
  parseMacAvailableMemoryGb,
  parseWindowsGpuProfile,
  recommendAiResponseModel,
  recommendFromCatalogue,
  recommendTranscriptionModel,
  validateModelCatalogue,
  writeLiveModelCatalogue
};

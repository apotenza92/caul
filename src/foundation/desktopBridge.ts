import type { CaptureStatus } from './capture';
import type { CaptureSource } from './capture';

export type TranscriptionBridgeEvent =
  | { type: 'closed' }
  | { type: 'connected' }
  | { type: 'delta'; itemId?: string; text: string }
  | { type: 'partial'; source?: CaptureSource; utteranceId?: number; startMs?: number; endMs?: number; text: string }
  | { type: 'completed'; itemId?: string; source?: CaptureSource; utteranceId?: number; startMs?: number; endMs?: number; text: string }
  | { type: 'error'; message: string }
  | { type: 'llm-query'; requestId?: string; text: string }
  | { type: 'llm-response'; requestId?: string; text: string }
  | { type: 'llm-response-delta'; requestId?: string; text: string }
  | { type: 'metric'; name: string; utteranceId?: number; atMs: number }
  | { type: 'stage'; message: string }
  | { type: 'speech-started' }
  | { type: 'speech-stopped' };

export type TranscriptionStartOptions = {
  sources: CaptureSource[];
};

export type LlmModel =
  | 'openai-codex/gpt-5.2'
  | 'openai-codex/gpt-5.4'
  | 'openai-codex/gpt-5.4-mini'
  | 'openai-codex/gpt-5.5';

export type LlmReasoning = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type PromptTemplateAttachmentSupport = 'supported' | 'unsupported';

export type PromptTemplateAttachment = {
  id: string;
  kind: 'file' | 'image' | 'text';
  mimeType: string;
  name: string;
  path: string;
  sizeBytes: number;
  support: PromptTemplateAttachmentSupport;
};

export type LlmRequestOptions = {
  attachments?: PromptTemplateAttachment[];
  model: LlmModel;
  requestId?: string;
  reasoning: LlmReasoning;
  speculative?: boolean;
  trace?: Record<string, unknown>;
  transcript: string;
};

export type LlmStatus = {
  ok: boolean;
  ready: boolean;
  status: 'warming' | 'ready' | 'error' | 'disabled';
};

export type HistoryStatus = {
  enabled: boolean;
  folder: string;
  message?: string;
  ok: boolean;
};

export type HistorySessionUpdate = {
  aiResponses?: Array<{
    id: string;
    request: string;
    requestedAt: string | null;
    response: string;
  }>;
  sessionId: string;
  startedAt: string;
  transcript?: string;
};

export type LocalTranscriptionModelId = 'parakeet' | 'moonshine-tiny';

export type ParakeetStatus = {
  installed: boolean;
  modelDir?: string;
  modelId?: LocalTranscriptionModelId;
  modelName?: string;
  ok: boolean;
  progress?: {
    downloadedBytes: number;
    percent: number;
    totalBytes: number | null;
  };
  status: 'missing' | 'downloading' | 'installed';
};

export type PiStatus = {
  agentDir: string;
  bundled: boolean;
  connected: boolean;
  ok: boolean;
  selectedModel: string | null;
  status: 'disconnected' | 'ready';
};

export type AiProvider = 'cloud' | 'local';

export type ModelBenchmarkStatus = {
  catalogueLastReviewed: string;
  recommendationSource: string;
  staleEntries: Array<{
    id: string;
    name: string;
    reviewedAt: string;
  }>;
};

export type LocalLlmStatus = {
  ok: boolean;
  model: null | {
    id: string;
    installed: boolean;
    name: string;
    path: string | null;
    sizeGb: number;
  };
  progress?: {
    downloadedBytes: number;
    label: string;
    percent: number;
    phase: 'model' | 'runtime';
    totalBytes: number | null;
  };
  provider: 'caul-llama.cpp' | 'caul-mlx';
  runtime: {
    assetName: string | null;
    installed: boolean;
    path: string | null;
    supported: boolean;
    version: string | null;
  };
  status: 'downloading' | 'missing' | 'ready';
};

export type SystemGpuProfile = {
  available: boolean;
  name: string | null;
  unifiedMemory: boolean;
  vendor: string;
  vramGb: number;
};

export type SystemModelResources = {
  accelerator: string;
  arch: string;
  cpuCores: number;
  currentAvailableMemoryGb?: number;
  freeMemoryGb: number;
  gpu?: SystemGpuProfile;
  localRuntimes?: {
    caulLlamaCpp?: LocalLlmStatus;
  };
  modelMemoryGb?: number;
  platform: string;
  totalMemoryGb: number;
};

export type AiRecommendation = {
  benchmark: ModelBenchmarkStatus;
  localRuntime: LocalLlmStatus;
  provider: AiProvider;
  recommended: 'cloud' | 'local' | 'none';
  recommendedModel: null | {
    id: string;
    name: string;
    reason: string;
    runtime: string;
  };
  resources: SystemModelResources;
  status: 'ready';
  summary: string;
  viable: boolean;
};

export type TranscriptionRecommendation = {
  autoDownloadModel?: boolean;
  autoDownloadParakeet: boolean;
  benchmark?: ModelBenchmarkStatus;
  ok: boolean;
  recommended: 'cloud' | 'local-parakeet' | 'local-moonshine-tiny' | 'none';
  recommendedModel?: {
    id: LocalTranscriptionModelId;
    name: string;
    reason: string;
  };
  resources: SystemModelResources;
  score: {
    machineProbeIterationsPerMs: number;
    parakeet: number;
    moonshineTiny?: number;
  };
  status: 'ready';
  summary: string;
};

export type OnboardingStatus = {
  ai: AiRecommendation;
  autoUpdate: {
    ai: boolean;
    transcription: boolean;
  };
  complete: boolean;
  completedAt: string | null;
  ok: boolean;
  parakeet: ParakeetStatus;
  permissions: PermissionsStatus;
  pi: PiStatus;
  required: boolean;
  selectedLocalTranscriptionModel: LocalTranscriptionModelId | null;
  transcription: TranscriptionRecommendation;
};

export type ModelCatalogueRefreshResult = {
  livePath?: string;
  ok: boolean;
  reviewedAt: string;
  sourceReports: Array<{
    detail: string;
    ok: boolean;
    source: string;
    url: string;
  }>;
  status: OnboardingStatus;
};

export type UpdateFrequency = 'never' | 'startup' | 'hourly' | 'sixHours' | 'twelveHours' | 'daily' | 'weekly';

export type UpdateStatus = {
  appChannel: 'stable' | 'beta' | 'dev' | string;
  appName: string;
  appVersion: string;
  availableUpdate: null | {
    downloadUrl?: string;
    prerelease: boolean;
    releaseName?: string;
    version: string;
  };
  checking: boolean;
  downloading: boolean;
  enabled: boolean;
  frequency: UpdateFrequency;
  lastCheckedAt: string | null;
  lastResult: null | {
    ok: boolean;
    status: string;
    message: string;
    progress?: {
      percent: number;
      transferred: number;
      total: number | null;
    };
  };
};

export type PermissionStatusValue =
  | 'denied'
  | 'granted'
  | 'not-determined'
  | 'restricted'
  | 'unknown'
  | 'unsupported';

export type PermissionItem = {
  description: string;
  id: 'microphone' | 'screen-recording' | 'system-audio';
  label: string;
  status: PermissionStatusValue;
};

export type PermissionsStatus = {
  ok: boolean;
  permissions: PermissionItem[];
  platform: string;
};

export type PromptTemplate = {
  attachments: PromptTemplateAttachment[];
  createdAt: string;
  id: string;
  name: string;
  prompt: string;
  updatedAt: string;
};

export type PromptTemplateState = {
  ok: boolean;
  selectedTemplateIds: string[];
  templates: PromptTemplate[];
};

export type PortablePreferences = {
  autoCollapse?: boolean;
  autoUpdateAiModel?: boolean;
  autoUpdateTranscriptionModel?: boolean;
  generalInstructions?: string;
  historyEnabled?: boolean;
  llmModel?: LlmModel;
  llmReasoning?: LlmReasoning;
  selectedAiProvider?: AiProvider;
  selectedLocalTranscriptionModel?: LocalTranscriptionModelId;
};

export type PrivateOverlayHandleSize = 'small' | 'medium' | 'large';

export type PrivateOverlayState = {
  clickThrough: boolean;
  handle: {
    opacity: number;
    size: PrivateOverlayHandleSize;
    visible: boolean;
    x: number;
    y: number;
  };
  handleWindowVisible: boolean;
  overlay: {
    height: number;
    visible: boolean;
    width: number;
    x: number;
    y: number;
  };
  overlayWindowVisible: boolean;
  privateMode: boolean;
};

export type LlmBridge = {
  onStatus: (callback: (status: LlmStatus) => void) => () => void;
  status: () => Promise<LlmStatus>;
};

export type PermissionsBridge = {
  open: (permission: PermissionItem['id']) => Promise<{ ok: boolean; message?: string }>;
  request: (permission: PermissionItem['id']) => Promise<{ ok: boolean; message?: string }>;
  status: () => Promise<PermissionsStatus>;
};

export type CaptureBridge = {
  pause: () => Promise<CaptureStatus>;
  start: () => Promise<CaptureStatus>;
  status: () => Promise<CaptureStatus>;
  stop: () => Promise<CaptureStatus>;
};

export type TranscriptionBridge = {
  onEvent: (callback: (event: TranscriptionBridgeEvent) => void) => () => void;
  prepare?: (options: TranscriptionStartOptions) => Promise<{ ok: boolean }>;
  requestLlm: (options: LlmRequestOptions) => Promise<{ ok: boolean; text: string }>;
  start: (options: TranscriptionStartOptions) => Promise<{ ok: boolean }>;
  stop: () => Promise<{ ok: boolean }>;
};

export type SystemAudioBridge = {
  start: () => Promise<{ ok: boolean }>;
  stop: () => Promise<{ ok: boolean }>;
};

export type PrivateOverlayBridge = {
  dragHandleEnd: (point: { screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  dragHandleMove: (point: { screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  dragHandleStart: (point: { screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  dragWindowEnd: (point: { screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  dragWindowMove: (point: { screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  dragWindowStart: (point: { screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  hide: () => Promise<PrivateOverlayState>;
  onState: (callback: (state: PrivateOverlayState) => void) => () => void;
  panicHide: () => Promise<PrivateOverlayState>;
  resetHandlePosition: () => Promise<PrivateOverlayState>;
  resizeWindowEnd: (point: { direction: string; screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  resizeWindowMove: (point: { direction: string; screenX: number; screenY: number }) => Promise<void>;
  resizeWindowStart: (point: { direction: string; screenX: number; screenY: number }) => Promise<PrivateOverlayState>;
  setClickThrough: (enabled: boolean) => Promise<PrivateOverlayState>;
  setHandleSize: (size: PrivateOverlayHandleSize) => Promise<PrivateOverlayState>;
  showHandleMenu: () => Promise<PrivateOverlayState>;
  showMain: () => Promise<PrivateOverlayState>;
  status: () => Promise<PrivateOverlayState>;
  toggle: () => Promise<PrivateOverlayState>;
};

export type SettingsBridge = {
  ai?: {
    cancelLocalDownload: () => Promise<LocalLlmStatus>;
    disconnect: () => Promise<PiStatus>;
    downloadLocal: () => Promise<LocalLlmStatus>;
    localStatus: () => Promise<LocalLlmStatus>;
    onLocalStatus: (callback: (status: LocalLlmStatus) => void) => () => void;
    openChatGptLogin: () => Promise<{ ok: boolean; message?: string }>;
    openLogin: () => Promise<{ ok: boolean; message?: string }>;
    openModel: () => Promise<{ ok: boolean; message?: string }>;
    refreshCatalogue: () => Promise<ModelCatalogueRefreshResult>;
    saveModel: (model: string) => Promise<PiStatus>;
    setProvider: (provider: AiProvider) => Promise<OnboardingStatus>;
    status: () => Promise<PiStatus>;
  };
  onboarding?: {
    complete: () => Promise<OnboardingStatus>;
    fitContent?: (size: { height: number; width?: number }) => Promise<{ ok: boolean }>;
    open: () => Promise<OnboardingStatus>;
    status: () => Promise<OnboardingStatus>;
  };
  history?: {
    chooseFolder: () => Promise<HistoryStatus>;
    openFolder: () => Promise<{ ok: boolean; message?: string }>;
    saveSession: (update: HistorySessionUpdate) => Promise<{ ok: boolean; filePath?: string; message?: string }>;
    setEnabled: (enabled: boolean) => Promise<HistoryStatus>;
    status: () => Promise<HistoryStatus>;
  };
  parakeet?: {
    cancelDownload: () => Promise<ParakeetStatus>;
    download: (modelId?: LocalTranscriptionModelId) => Promise<ParakeetStatus>;
    onStatus: (callback: (status: ParakeetStatus) => void) => () => void;
    remove: (modelId: LocalTranscriptionModelId) => Promise<ParakeetStatus>;
    setModel: (modelId: LocalTranscriptionModelId) => Promise<ParakeetStatus>;
    status: () => Promise<ParakeetStatus>;
  };
  promptTemplates?: {
    delete: (id: string) => Promise<PromptTemplateState>;
    chooseAttachments: () => Promise<{ ok: boolean; attachments: PromptTemplateAttachment[] }>;
    list: () => Promise<PromptTemplateState>;
    reset?: () => Promise<PromptTemplateState>;
    save: (template: PromptTemplate) => Promise<PromptTemplateState>;
    setSelected: (ids: string[]) => Promise<PromptTemplateState>;
  };
  preferences?: {
    load: (legacy?: PortablePreferences) => Promise<{ ok: boolean; preferences: PortablePreferences }>;
    save: (update: PortablePreferences) => Promise<{ ok: boolean; preferences: PortablePreferences }>;
  };
  updates?: {
    checkNow: () => Promise<UpdateStatus>;
    downloadAndInstall: () => Promise<UpdateStatus>;
    installDownloaded: () => Promise<{ ok: boolean }>;
    onStatus: (callback: (status: UpdateStatus) => void) => () => void;
    openDownloadPage: () => Promise<{ ok: boolean }>;
    setFrequency: (frequency: UpdateFrequency) => Promise<UpdateStatus>;
    status: () => Promise<UpdateStatus>;
  };
  quit?: () => Promise<{ ok: boolean }>;
  relaunch?: () => Promise<{ ok: boolean }>;
  reset: () => Promise<{ ok: boolean }>;
};

export function getCaptureBridge(): CaptureBridge | null {
  return window.caul?.capture ?? null;
}

export function getSystemAudioBridge(): SystemAudioBridge | null {
  return window.caul?.systemAudio ?? null;
}

export function getTranscriptionBridge(): TranscriptionBridge | null {
  return window.caul?.transcription ?? null;
}

export function getLlmBridge(): LlmBridge | null {
  return window.caul?.llm ?? null;
}

export function getPermissionsBridge(): PermissionsBridge | null {
  return window.caul?.permissions ?? null;
}

export function getPrivateOverlayBridge(): PrivateOverlayBridge | null {
  return window.caul?.privateOverlay ?? null;
}

export function getSettingsBridge(): SettingsBridge | null {
  return window.caul?.settings ?? null;
}

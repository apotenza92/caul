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

export type TranscriptionRecommendation = {
  autoDownloadModel?: boolean;
  autoDownloadParakeet: boolean;
  ok: boolean;
  recommended: 'cloud' | 'local-parakeet' | 'local-moonshine-tiny';
  recommendedModel?: {
    id: LocalTranscriptionModelId;
    name: string;
    reason: string;
  };
  resources: {
    accelerator: string;
    arch: string;
    cpuCores: number;
    freeMemoryGb: number;
    platform: string;
    totalMemoryGb: number;
  };
  score: {
    machineProbeIterationsPerMs: number;
    parakeet: number;
    moonshineTiny?: number;
  };
  status: 'ready';
  summary: string;
};

export type OnboardingStatus = {
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
    disconnect: () => Promise<PiStatus>;
    openChatGptLogin: () => Promise<{ ok: boolean; message?: string }>;
    openLogin: () => Promise<{ ok: boolean; message?: string }>;
    openModel: () => Promise<{ ok: boolean; message?: string }>;
    saveModel: (model: string) => Promise<PiStatus>;
    status: () => Promise<PiStatus>;
  };
  onboarding?: {
    complete: () => Promise<OnboardingStatus>;
    fitContent?: (size: { height: number; width?: number }) => Promise<{ ok: boolean }>;
    open: () => Promise<OnboardingStatus>;
    status: () => Promise<OnboardingStatus>;
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
  reset: () => Promise<{ ok: boolean }>;
};

export function getCaptureBridge(): CaptureBridge | null {
  return window.susura?.capture ?? null;
}

export function getSystemAudioBridge(): SystemAudioBridge | null {
  return window.susura?.systemAudio ?? null;
}

export function getTranscriptionBridge(): TranscriptionBridge | null {
  return window.susura?.transcription ?? null;
}

export function getLlmBridge(): LlmBridge | null {
  return window.susura?.llm ?? null;
}

export function getPermissionsBridge(): PermissionsBridge | null {
  return window.susura?.permissions ?? null;
}

export function getPrivateOverlayBridge(): PrivateOverlayBridge | null {
  return window.susura?.privateOverlay ?? null;
}

export function getSettingsBridge(): SettingsBridge | null {
  return window.susura?.settings ?? null;
}

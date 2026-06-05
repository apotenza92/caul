/// <reference types="vite/client" />

import type { RuntimeContext } from './foundation/runtime';
import type { CaptureBridge, LlmBridge, PermissionsBridge, PrivateOverlayBridge, SettingsBridge, SystemAudioBridge, TranscriptionBridge } from './foundation/desktopBridge';

interface ImportMetaEnv {
  readonly VITE_CAUL_SPECULATIVE_LLM?: string;
  readonly VITE_CAUL_SPECULATIVE_LLM_DELAY_MS?: string;
  readonly VITE_CAUL_SPECULATIVE_LLM_MODEL?: string;
  readonly VITE_CAUL_SPECULATIVE_LLM_REASONING?: string;
  readonly VITE_CAUL_TRANSCRIPT_DEBUG_LOG?: string;
}

declare global {
  interface Window {
    caul?: {
      capture?: CaptureBridge;
      getRuntimeContext: () => Promise<RuntimeContext>;
      llm?: LlmBridge;
      permissions?: PermissionsBridge;
      privateOverlay?: PrivateOverlayBridge;
      settings?: SettingsBridge;
      smokeEmitTranscriptionEvent?: (event: unknown) => Promise<{ ok: boolean }>;
      systemAudio?: SystemAudioBridge;
      transcription?: TranscriptionBridge;
    };
  }
}

export {};

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('caul', {
  getRuntimeContext: () => ipcRenderer.invoke('caul:get-runtime-context'),
  capture: {
    status: () => ipcRenderer.invoke('caul:capture-status'),
    start: () => ipcRenderer.invoke('caul:capture-start'),
    pause: () => ipcRenderer.invoke('caul:capture-pause'),
    stop: () => ipcRenderer.invoke('caul:capture-stop')
  },
  systemAudio: {
    start: () => ipcRenderer.invoke('caul:system-audio-start'),
    stop: () => ipcRenderer.invoke('caul:system-audio-stop')
  },
  llm: {
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);

      ipcRenderer.on('caul:llm-status', listener);

      return () => {
        ipcRenderer.off('caul:llm-status', listener);
      };
    },
    status: () => ipcRenderer.invoke('caul:llm-status')
  },
  permissions: {
    open: (permission) => ipcRenderer.invoke('caul:permissions-open', { permission }),
    request: (permission) => ipcRenderer.invoke('caul:permissions-request', { permission }),
    status: () => ipcRenderer.invoke('caul:permissions-status')
  },
  privateOverlay: {
    hide: () => ipcRenderer.invoke('caul:private-overlay-hide'),
    onState: (callback) => {
      const listener = (_event, payload) => callback(payload);

      ipcRenderer.on('caul:private-overlay-state', listener);

      return () => {
        ipcRenderer.off('caul:private-overlay-state', listener);
      };
    },
    dragHandleEnd: (point) => ipcRenderer.invoke('caul:private-overlay-handle-drag-end', point),
    dragHandleMove: (point) => ipcRenderer.invoke('caul:private-overlay-handle-drag-move', point),
    dragHandleStart: (point) => ipcRenderer.invoke('caul:private-overlay-handle-drag-start', point),
    dragWindowEnd: (point) => ipcRenderer.invoke('caul:private-overlay-window-drag-end', point),
    dragWindowMove: (point) => ipcRenderer.invoke('caul:private-overlay-window-drag-move', point),
    dragWindowStart: (point) => ipcRenderer.invoke('caul:private-overlay-window-drag-start', point),
    resizeWindowEnd: (point) => ipcRenderer.invoke('caul:private-overlay-window-resize-end', point),
    resizeWindowMove: (point) => {
      ipcRenderer.send('caul:private-overlay-window-resize-move-live', point);
      return Promise.resolve();
    },
    resizeWindowStart: (point) => ipcRenderer.invoke('caul:private-overlay-window-resize-start', point),
    panicHide: () => ipcRenderer.invoke('caul:private-overlay-panic-hide'),
    resetHandlePosition: () => ipcRenderer.invoke('caul:private-overlay-reset-handle'),
    setClickThrough: (enabled) => ipcRenderer.invoke('caul:private-overlay-set-click-through', { enabled }),
    setHandleSize: (size) => ipcRenderer.invoke('caul:private-overlay-set-handle-size', { size }),
    showHandleMenu: () => ipcRenderer.invoke('caul:private-overlay-handle-menu'),
    showMain: () => ipcRenderer.invoke('caul:private-overlay-show-main'),
    status: () => ipcRenderer.invoke('caul:private-overlay-status'),
    toggle: () => ipcRenderer.invoke('caul:private-overlay-toggle')
  },
  settings: {
    ai: {
      disconnect: () => ipcRenderer.invoke('caul:pi-disconnect'),
      benchmarkLocal: (modelId) => ipcRenderer.invoke('caul:local-llm-benchmark', { modelId }),
      cancelLocalDownload: () => ipcRenderer.invoke('caul:local-llm-cancel-download'),
      downloadLocal: (modelId) => ipcRenderer.invoke('caul:local-llm-download', { modelId }),
      localStatus: () => ipcRenderer.invoke('caul:local-llm-status'),
      onLocalStatus: (callback) => {
        const listener = (_event, payload) => callback(payload);

        ipcRenderer.on('caul:local-llm-status', listener);

        return () => {
          ipcRenderer.off('caul:local-llm-status', listener);
        };
      },
      openChatGptLogin: () => ipcRenderer.invoke('caul:pi-chatgpt-login'),
      openLogin: () => ipcRenderer.invoke('caul:pi-login'),
      openModel: () => ipcRenderer.invoke('caul:pi-model'),
      refreshCatalogue: () => ipcRenderer.invoke('caul:model-catalogue-refresh'),
      saveModel: (model) => ipcRenderer.invoke('caul:pi-save-model', { model }),
      setProvider: (provider) => ipcRenderer.invoke('caul:ai-provider', { provider }),
      setLocalModel: (modelId) => ipcRenderer.invoke('caul:local-llm-set-model', { modelId }),
      status: () => ipcRenderer.invoke('caul:pi-status')
    },
    onboarding: {
      complete: () => ipcRenderer.invoke('caul:onboarding-complete'),
      fitContent: (size) => ipcRenderer.invoke('caul:onboarding-fit-content', size),
      open: () => ipcRenderer.invoke('caul:onboarding-open'),
      status: (options) => ipcRenderer.invoke('caul:onboarding-status', options)
    },
    history: {
      chooseFolder: () => ipcRenderer.invoke('caul:history-choose-folder'),
      openFolder: () => ipcRenderer.invoke('caul:history-open-folder'),
      saveSession: (update) => ipcRenderer.invoke('caul:history-save-session', update),
      setEnabled: (enabled) => ipcRenderer.invoke('caul:history-set-enabled', { enabled }),
      status: () => ipcRenderer.invoke('caul:history-status')
    },
    parakeet: {
      cancelDownload: () => ipcRenderer.invoke('caul:parakeet-cancel-download'),
      download: (modelId) => ipcRenderer.invoke('caul:parakeet-download', { modelId }),
      onStatus: (callback) => {
        const listener = (_event, payload) => callback(payload);

        ipcRenderer.on('caul:parakeet-status', listener);

        return () => {
          ipcRenderer.off('caul:parakeet-status', listener);
        };
      },
      remove: (modelId) => ipcRenderer.invoke('caul:parakeet-remove', { modelId }),
      setModel: (modelId) => ipcRenderer.invoke('caul:parakeet-set-model', { modelId }),
      status: () => ipcRenderer.invoke('caul:parakeet-status')
    },
    promptTemplates: {
      chooseAttachments: () => ipcRenderer.invoke('caul:prompt-templates-choose-attachments'),
      delete: (id) => ipcRenderer.invoke('caul:prompt-templates-delete', { id }),
      list: () => ipcRenderer.invoke('caul:prompt-templates-list'),
      reset: () => ipcRenderer.invoke('caul:prompt-templates-reset'),
      save: (template) => ipcRenderer.invoke('caul:prompt-templates-save', { template }),
      setSelected: (ids) => ipcRenderer.invoke('caul:prompt-templates-set-selected', { ids })
    },
    preferences: {
      load: (legacy) => ipcRenderer.invoke('caul:preferences-load', { legacy }),
      save: (update) => ipcRenderer.invoke('caul:preferences-save', update)
    },
    updates: {
      checkNow: () => ipcRenderer.invoke('caul:updates-check-now'),
      downloadAndInstall: () => ipcRenderer.invoke('caul:updates-download-and-install'),
      installDownloaded: () => ipcRenderer.invoke('caul:updates-install-downloaded'),
      onStatus: (callback) => {
        const listener = (_event, payload) => callback(payload);

        ipcRenderer.on('caul:updates-status', listener);

        return () => {
          ipcRenderer.off('caul:updates-status', listener);
        };
      },
      openDownloadPage: () => ipcRenderer.invoke('caul:updates-open-download-page'),
      setFrequency: (frequency) => ipcRenderer.invoke('caul:updates-set-frequency', { frequency }),
      status: () => ipcRenderer.invoke('caul:updates-status')
    },
    quit: () => ipcRenderer.invoke('caul:settings-quit'),
    relaunch: () => ipcRenderer.invoke('caul:settings-relaunch'),
    reset: () => ipcRenderer.invoke('caul:settings-reset')
  },
  transcription: {
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);

      ipcRenderer.on('caul:transcription-event', listener);

      return () => {
        ipcRenderer.off('caul:transcription-event', listener);
      };
    },
    prepare: (options) => ipcRenderer.invoke('caul:transcription-prepare', options),
    requestLlm: (options) => ipcRenderer.invoke('caul:llm-request', options),
    start: (options) => ipcRenderer.invoke('caul:transcription-start', options),
    stop: () => ipcRenderer.invoke('caul:transcription-stop')
  },
  smokeEmitTranscriptionEvent: (event) => ipcRenderer.invoke('caul:smoke-emit-transcription-event', event)
});

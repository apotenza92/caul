const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('susura', {
  getRuntimeContext: () => ipcRenderer.invoke('susura:get-runtime-context'),
  capture: {
    status: () => ipcRenderer.invoke('susura:capture-status'),
    start: () => ipcRenderer.invoke('susura:capture-start'),
    pause: () => ipcRenderer.invoke('susura:capture-pause'),
    stop: () => ipcRenderer.invoke('susura:capture-stop')
  },
  systemAudio: {
    start: () => ipcRenderer.invoke('susura:system-audio-start'),
    stop: () => ipcRenderer.invoke('susura:system-audio-stop')
  },
  llm: {
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);

      ipcRenderer.on('susura:llm-status', listener);

      return () => {
        ipcRenderer.off('susura:llm-status', listener);
      };
    },
    status: () => ipcRenderer.invoke('susura:llm-status')
  },
  permissions: {
    open: (permission) => ipcRenderer.invoke('susura:permissions-open', { permission }),
    request: (permission) => ipcRenderer.invoke('susura:permissions-request', { permission }),
    status: () => ipcRenderer.invoke('susura:permissions-status')
  },
  privateOverlay: {
    hide: () => ipcRenderer.invoke('susura:private-overlay-hide'),
    onState: (callback) => {
      const listener = (_event, payload) => callback(payload);

      ipcRenderer.on('susura:private-overlay-state', listener);

      return () => {
        ipcRenderer.off('susura:private-overlay-state', listener);
      };
    },
    dragHandleEnd: (point) => ipcRenderer.invoke('susura:private-overlay-handle-drag-end', point),
    dragHandleMove: (point) => ipcRenderer.invoke('susura:private-overlay-handle-drag-move', point),
    dragHandleStart: (point) => ipcRenderer.invoke('susura:private-overlay-handle-drag-start', point),
    dragWindowEnd: (point) => ipcRenderer.invoke('susura:private-overlay-window-drag-end', point),
    dragWindowMove: (point) => ipcRenderer.invoke('susura:private-overlay-window-drag-move', point),
    dragWindowStart: (point) => ipcRenderer.invoke('susura:private-overlay-window-drag-start', point),
    resizeWindowEnd: (point) => ipcRenderer.invoke('susura:private-overlay-window-resize-end', point),
    resizeWindowMove: (point) => {
      ipcRenderer.send('susura:private-overlay-window-resize-move-live', point);
      return Promise.resolve();
    },
    resizeWindowStart: (point) => ipcRenderer.invoke('susura:private-overlay-window-resize-start', point),
    panicHide: () => ipcRenderer.invoke('susura:private-overlay-panic-hide'),
    resetHandlePosition: () => ipcRenderer.invoke('susura:private-overlay-reset-handle'),
    setClickThrough: (enabled) => ipcRenderer.invoke('susura:private-overlay-set-click-through', { enabled }),
    setHandleSize: (size) => ipcRenderer.invoke('susura:private-overlay-set-handle-size', { size }),
    showHandleMenu: () => ipcRenderer.invoke('susura:private-overlay-handle-menu'),
    showMain: () => ipcRenderer.invoke('susura:private-overlay-show-main'),
    status: () => ipcRenderer.invoke('susura:private-overlay-status'),
    toggle: () => ipcRenderer.invoke('susura:private-overlay-toggle')
  },
  settings: {
    ai: {
      disconnect: () => ipcRenderer.invoke('susura:pi-disconnect'),
      openChatGptLogin: () => ipcRenderer.invoke('susura:pi-chatgpt-login'),
      openLogin: () => ipcRenderer.invoke('susura:pi-login'),
      openModel: () => ipcRenderer.invoke('susura:pi-model'),
      saveModel: (model) => ipcRenderer.invoke('susura:pi-save-model', { model }),
      status: () => ipcRenderer.invoke('susura:pi-status')
    },
    onboarding: {
      complete: () => ipcRenderer.invoke('susura:onboarding-complete'),
      fitContent: (size) => ipcRenderer.invoke('susura:onboarding-fit-content', size),
      open: () => ipcRenderer.invoke('susura:onboarding-open'),
      status: () => ipcRenderer.invoke('susura:onboarding-status')
    },
    parakeet: {
      cancelDownload: () => ipcRenderer.invoke('susura:parakeet-cancel-download'),
      download: (modelId) => ipcRenderer.invoke('susura:parakeet-download', { modelId }),
      onStatus: (callback) => {
        const listener = (_event, payload) => callback(payload);

        ipcRenderer.on('susura:parakeet-status', listener);

        return () => {
          ipcRenderer.off('susura:parakeet-status', listener);
        };
      },
      remove: (modelId) => ipcRenderer.invoke('susura:parakeet-remove', { modelId }),
      setModel: (modelId) => ipcRenderer.invoke('susura:parakeet-set-model', { modelId }),
      status: () => ipcRenderer.invoke('susura:parakeet-status')
    },
    promptTemplates: {
      chooseAttachments: () => ipcRenderer.invoke('susura:prompt-templates-choose-attachments'),
      delete: (id) => ipcRenderer.invoke('susura:prompt-templates-delete', { id }),
      list: () => ipcRenderer.invoke('susura:prompt-templates-list'),
      reset: () => ipcRenderer.invoke('susura:prompt-templates-reset'),
      save: (template) => ipcRenderer.invoke('susura:prompt-templates-save', { template }),
      setSelected: (ids) => ipcRenderer.invoke('susura:prompt-templates-set-selected', { ids })
    },
    updates: {
      checkNow: () => ipcRenderer.invoke('susura:updates-check-now'),
      downloadAndInstall: () => ipcRenderer.invoke('susura:updates-download-and-install'),
      installDownloaded: () => ipcRenderer.invoke('susura:updates-install-downloaded'),
      onStatus: (callback) => {
        const listener = (_event, payload) => callback(payload);

        ipcRenderer.on('susura:updates-status', listener);

        return () => {
          ipcRenderer.off('susura:updates-status', listener);
        };
      },
      openDownloadPage: () => ipcRenderer.invoke('susura:updates-open-download-page'),
      setFrequency: (frequency) => ipcRenderer.invoke('susura:updates-set-frequency', { frequency }),
      status: () => ipcRenderer.invoke('susura:updates-status')
    },
    quit: () => ipcRenderer.invoke('susura:settings-quit'),
    reset: () => ipcRenderer.invoke('susura:settings-reset')
  },
  transcription: {
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);

      ipcRenderer.on('susura:transcription-event', listener);

      return () => {
        ipcRenderer.off('susura:transcription-event', listener);
      };
    },
    prepare: (options) => ipcRenderer.invoke('susura:transcription-prepare', options),
    requestLlm: (options) => ipcRenderer.invoke('susura:llm-request', options),
    start: (options) => ipcRenderer.invoke('susura:transcription-start', options),
    stop: () => ipcRenderer.invoke('susura:transcription-stop')
  },
  smokeEmitTranscriptionEvent: (event) => ipcRenderer.invoke('susura:smoke-emit-transcription-event', event)
});

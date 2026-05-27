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
    panicHide: () => ipcRenderer.invoke('susura:private-overlay-panic-hide'),
    resetHandlePosition: () => ipcRenderer.invoke('susura:private-overlay-reset-handle'),
    setClickThrough: (enabled) => ipcRenderer.invoke('susura:private-overlay-set-click-through', { enabled }),
    showHandleMenu: () => ipcRenderer.invoke('susura:private-overlay-handle-menu'),
    showMain: () => ipcRenderer.invoke('susura:private-overlay-show-main'),
    status: () => ipcRenderer.invoke('susura:private-overlay-status'),
    toggle: () => ipcRenderer.invoke('susura:private-overlay-toggle')
  },
  settings: {
    promptTemplates: {
      chooseAttachments: () => ipcRenderer.invoke('susura:prompt-templates-choose-attachments'),
      delete: (id) => ipcRenderer.invoke('susura:prompt-templates-delete', { id }),
      list: () => ipcRenderer.invoke('susura:prompt-templates-list'),
      reset: () => ipcRenderer.invoke('susura:prompt-templates-reset'),
      save: (template) => ipcRenderer.invoke('susura:prompt-templates-save', { template }),
      setSelected: (id) => ipcRenderer.invoke('susura:prompt-templates-set-selected', { id })
    },
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

const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, nativeTheme, screen, shell, systemPreferences } = require('electron');
const { spawn } = require('node:child_process');
const fsSync = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { getPreferredOverlaySizeForEdge } = require('./privateOverlayGeometry.cjs');
const { createStopFlushController } = require('./transcriptionStopFlush.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const smokeExitMs = Number(process.env.SUSURA_SMOKE_EXIT_MS ?? 0);
const systemAudioSmokeMs = Number(process.env.SUSURA_SYSTEM_AUDIO_SMOKE_MS ?? 0);
const localParakeetSmokeMs = Number(process.env.SUSURA_LOCAL_PARAKEET_SMOKE_MS ?? 0);
const rendererTranscriptionSmokeMs = Number(process.env.SUSURA_RENDERER_TRANSCRIPTION_SMOKE_MS ?? 0);
const rendererLlmSmoke = process.env.SUSURA_RENDERER_LLM_SMOKE === '1';
const rendererRealLlmSmoke = process.env.SUSURA_RENDERER_REAL_LLM_SMOKE === '1';
const resourceSmokeMs = Number(process.env.SUSURA_RESOURCE_SMOKE_MS ?? 0);
const resourceSmokeMaxWorkingSetMb = Number(process.env.SUSURA_RESOURCE_SMOKE_MAX_WORKING_SET_MB ?? 450);
const piLlmBridgeMode = String(process.env.SUSURA_PI_LLM_BRIDGE ?? '').trim().toLowerCase();
const windowSize = {
  width: 800,
  height: 600
};
const overlayWindowSize = {
  width: 920,
  height: 640
};
const maximumOverlayWindowSize = {
  width: 1200,
  height: 900
};
const handleWindowSize = {
  width: 32,
  height: 32
};
const minimumWindowSize = {
  width: 600,
  height: 400
};
const minimumNonCompactOverlayWidth = 920;
const resetWindowSize = {
  width: minimumNonCompactOverlayWidth,
  height: windowSize.height
};
const overlayWindowGap = 4;
const windowScreenMargin = 8;
const handleMidpointMagnetPx = 72;
const handleSnapPreviewAnimationDurationMs = 140;
const handleSnapAnimationDurationMs = 260;
const windowStateFileName = 'window-state.json';
const privateOverlayStateFileName = 'private-overlay-state.json';
const promptTemplatesFileName = 'prompt-templates.json';
const transcriptDebugLogEnabled = process.env.SUSURA_TRANSCRIPT_DEBUG_LOG === '1';
let transcriptDebugLogPath = null;
let mainWindow = null;
let privateOverlayWindow = null;
let privateOverlayHandleWindow = null;
let privateOverlayHandleDrag = null;
let privateOverlayHandleSnapAnimation = null;
let privateOverlayWindowDrag = null;
let isQuitting = false;

const starterPromptTemplates = [
  {
    id: 'starter-summarise-phone-call',
    name: 'Summarise this phone call',
    prompt: 'Summarise this phone call clearly. Include the main points, decisions, open questions and follow-up actions.'
  },
  {
    id: 'starter-extract-action-items',
    name: 'Extract action items',
    prompt: 'Extract action items from this transcript. Include owner, task and due date when available.'
  },
  {
    id: 'starter-draft-follow-up-email',
    name: 'Draft follow-up email',
    prompt: 'Draft a concise follow-up email based on this transcript. Include decisions, action items and next steps.'
  }
];

function getProjectRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function getBundledExecutablePath(name) {
  return path.join(process.resourcesPath, 'bin', name);
}

function getBundledScriptPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', name)
    : path.join(__dirname, '..', 'scripts', name);
}

if (process.env.SUSURA_USER_DATA_DIR) {
  app.setPath('userData', process.env.SUSURA_USER_DATA_DIR);
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), windowStateFileName);
}

function getPrivateOverlayStatePath() {
  return path.join(app.getPath('userData'), privateOverlayStateFileName);
}

function getPromptTemplatesPath() {
  return path.join(app.getPath('userData'), promptTemplatesFileName);
}

function createStarterPromptTemplates() {
  const now = new Date().toISOString();

  return starterPromptTemplates.map((template) => ({
    attachments: [],
    createdAt: now,
    id: template.id,
    name: template.name,
    prompt: template.prompt,
    updatedAt: now
  }));
}

function normalisePromptTemplateAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }

  const filePath = typeof attachment.path === 'string' ? attachment.path : '';

  let stats;

  try {
    if (!filePath || !fsSync.existsSync(filePath)) {
      return null;
    }

    stats = fsSync.statSync(filePath);

    if (!stats.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const name = typeof attachment.name === 'string' && attachment.name.trim()
    ? attachment.name.trim()
    : path.basename(filePath);
  const mimeType = inferAttachmentMimeType(filePath);
  const kind = inferAttachmentKind(filePath, mimeType);

  return {
    id: typeof attachment.id === 'string' && attachment.id
      ? attachment.id
      : `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    mimeType,
    name,
    path: filePath,
    sizeBytes: stats.size,
    support: 'supported'
  };
}

function inferAttachmentMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.bmp': 'image/bmp',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.css': 'text/css',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.gif': 'image/gif',
    '.go': 'text/x-go',
    '.heic': 'image/heic',
    '.htm': 'text/html',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.jsx': 'text/jsx',
    '.log': 'text/plain',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.py': 'text/x-python',
    '.rs': 'text/x-rust',
    '.rtf': 'application/rtf',
    '.svg': 'image/svg+xml',
    '.ts': 'text/typescript',
    '.tsx': 'text/tsx',
    '.txt': 'text/plain',
    '.webp': 'image/webp',
    '.xml': 'application/xml',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml'
  };

  return mimeTypes[extension] ?? 'application/octet-stream';
}

function inferAttachmentKind(filePath, mimeType) {
  const extension = path.extname(filePath).toLowerCase();
  const textExtensions = new Set([
    '.c', '.cpp', '.css', '.csv', '.go', '.htm', '.html', '.js', '.json', '.jsx',
    '.log', '.md', '.py', '.rs', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml'
  ]);

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('text/') || textExtensions.has(extension)) {
    return 'text';
  }

  return 'file';
}

function normalisePromptTemplate(template) {
  if (!template || typeof template !== 'object') {
    return null;
  }

  const id = typeof template.id === 'string' && template.id.trim()
    ? template.id.trim()
    : `prompt-template-${Date.now()}`;
  const name = typeof template.name === 'string' ? template.name.trim() : '';
  const prompt = typeof template.prompt === 'string' ? template.prompt.trim() : '';

  if (!name || !prompt) {
    return null;
  }

  const now = new Date().toISOString();
  const createdAt = typeof template.createdAt === 'string' && template.createdAt
    ? template.createdAt
    : now;
  const updatedAt = typeof template.updatedAt === 'string' && template.updatedAt
    ? template.updatedAt
    : now;

  return {
    attachments: Array.isArray(template.attachments)
      ? template.attachments.map(normalisePromptTemplateAttachment).filter(Boolean)
      : [],
    createdAt,
    id,
    name,
    prompt,
    updatedAt
  };
}

function normalisePromptTemplateState(value) {
  const templates = Array.isArray(value?.templates)
    ? value.templates.map(normalisePromptTemplate).filter(Boolean)
    : [];
  const starterTemplates = templates.length > 0 ? templates : createStarterPromptTemplates();
  const selectedTemplateId = typeof value?.selectedTemplateId === 'string'
    && starterTemplates.some((template) => template.id === value.selectedTemplateId)
    ? value.selectedTemplateId
    : null;

  return {
    ok: true,
    selectedTemplateId,
    templates: starterTemplates
  };
}

function readPromptTemplateState() {
  try {
    return normalisePromptTemplateState(JSON.parse(fsSync.readFileSync(getPromptTemplatesPath(), 'utf8')));
  } catch {
    return normalisePromptTemplateState(null);
  }
}

function writePromptTemplateState(state) {
  const nextState = normalisePromptTemplateState(state);
  fsSync.mkdirSync(app.getPath('userData'), { recursive: true });
  fsSync.writeFileSync(getPromptTemplatesPath(), `${JSON.stringify({
    selectedTemplateId: nextState.selectedTemplateId,
    templates: nextState.templates
  }, null, 2)}\n`);

  return nextState;
}

function savePromptTemplate(template) {
  const existing = readPromptTemplateState();
  const normalised = normalisePromptTemplate({
    ...template,
    updatedAt: new Date().toISOString()
  });

  if (!normalised) {
    return existing;
  }

  const templates = existing.templates.some((item) => item.id === normalised.id)
    ? existing.templates.map((item) => (item.id === normalised.id ? normalised : item))
    : [...existing.templates, normalised];

  return writePromptTemplateState({
    selectedTemplateId: existing.selectedTemplateId,
    templates
  });
}

function deletePromptTemplate(id) {
  const existing = readPromptTemplateState();
  const templates = existing.templates.filter((template) => template.id !== id);

  return writePromptTemplateState({
    selectedTemplateId: existing.selectedTemplateId === id ? null : existing.selectedTemplateId,
    templates
  });
}

function resetPromptTemplates() {
  return writePromptTemplateState({
    selectedTemplateId: null,
    templates: createStarterPromptTemplates()
  });
}

async function choosePromptTemplateAttachments(window) {
  const result = await dialog.showOpenDialog(window, {
    buttonLabel: 'Add attachments',
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) {
    return { ok: true, attachments: [] };
  }

  return {
    ok: true,
    attachments: result.filePaths
      .map((filePath) => normalisePromptTemplateAttachment({ path: filePath }))
      .filter(Boolean)
  };
}

function setSelectedPromptTemplate(id) {
  const existing = readPromptTemplateState();
  const selectedTemplateId = typeof id === 'string'
    && existing.templates.some((template) => template.id === id)
    ? id
    : null;

  return writePromptTemplateState({
    selectedTemplateId,
    templates: existing.templates
  });
}

function normaliseWindowState(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const x = Number(state.x);
  const y = Number(state.y);
  const width = Number(state.width);
  const height = Number(state.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(minimumWindowSize.width, Math.round(width)),
    height: Math.max(minimumWindowSize.height, Math.round(height))
  };
}

function rectanglesIntersect(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function isWindowStateVisible(state) {
  return screen.getAllDisplays().some((display) => rectanglesIntersect(state, display.workArea));
}

function readWindowState() {
  try {
    const state = normaliseWindowState(JSON.parse(fsSync.readFileSync(getWindowStatePath(), 'utf8')));
    return state && isWindowStateVisible(state) ? state : null;
  } catch {
    return null;
  }
}

function writeWindowState(mainWindow) {
  if (mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isFullScreen()) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const [width, height] = mainWindow.getContentSize();
  const state = normaliseWindowState({
    x: bounds.x,
    y: bounds.y,
    width,
    height
  });

  if (!state) {
    return;
  }

  try {
    fsSync.mkdirSync(app.getPath('userData'), { recursive: true });
    fsSync.writeFileSync(getWindowStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // Window state persistence should never prevent the app from closing.
  }
}

function resetWindowState(mainWindow) {
  try {
    fsSync.rmSync(getWindowStatePath(), { force: true });
  } catch {
    // Reset should still restore the active window even if deleting state fails.
  }

  if (mainWindow?.isDestroyed()) {
    return;
  }

  mainWindow.setContentSize(resetWindowSize.width, resetWindowSize.height);
  mainWindow.center();
  writeWindowState(mainWindow);
}

function persistWindowState(mainWindow) {
  let saveTimer = null;

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeWindowState(mainWindow);
    }, 250);
  };

  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    clearTimeout(saveTimer);
    writeWindowState(mainWindow);
  });
}

function normalisePrivateOverlayState(state) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const defaultHandleX = workArea.x + workArea.width - handleWindowSize.width - windowScreenMargin;
  const defaultHandleY = workArea.y + Math.max(24, Math.round(workArea.height * 0.25));
  const defaultOverlayX = workArea.x + Math.round((workArea.width - overlayWindowSize.width) / 2);
  const defaultOverlayY = workArea.y + 48;
  const handle = state && typeof state === 'object' && state.handle && typeof state.handle === 'object'
    ? state.handle
    : {};
  const overlay = state && typeof state === 'object' && state.overlay && typeof state.overlay === 'object'
    ? state.overlay
    : {};
  const handleBounds = normaliseHandleBounds({
    height: handleWindowSize.height,
    width: handleWindowSize.width,
    x: normaliseCoordinate(handle.x, defaultHandleX),
    y: normaliseCoordinate(handle.y, defaultHandleY)
  });

  return {
    clickThrough: Boolean(state?.clickThrough),
    handle: {
      opacity: clampNumber(Number(handle.opacity), 0.35, 1, 0.82),
      visible: true,
      x: handleBounds.x,
      y: handleBounds.y
    },
    overlay: {
      height: clampNumber(Number(overlay.height), minimumWindowSize.height, maximumOverlayWindowSize.height, overlayWindowSize.height),
      visible: Boolean(overlay.visible),
      width: clampNumber(Number(overlay.width), minimumWindowSize.width, maximumOverlayWindowSize.width, overlayWindowSize.width),
      x: normaliseCoordinate(overlay.x, defaultOverlayX),
      y: normaliseCoordinate(overlay.y, defaultOverlayY)
    },
    privateMode: true
  };
}

function normaliseCoordinate(value, fallback) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function normaliseHandleBounds(bounds) {
  const handleBounds = {
    height: handleWindowSize.height,
    width: handleWindowSize.width,
    x: normaliseCoordinate(bounds?.x, 0),
    y: normaliseCoordinate(bounds?.y, 0)
  };
  const display = screen.getDisplayMatching(handleBounds);

  return clampHandleBoundsToDisplay(handleBounds, display);
}

function clampHandleBoundsToDisplay(bounds, display = screen.getDisplayMatching(bounds)) {
  const workArea = display.workArea;

  return {
    height: handleWindowSize.height,
    width: handleWindowSize.width,
    x: clampNumber(
      Math.round(Number(bounds.x)),
      workArea.x + windowScreenMargin,
      workArea.x + workArea.width - handleWindowSize.width - windowScreenMargin,
      workArea.x + workArea.width - handleWindowSize.width - windowScreenMargin
    ),
    y: clampNumber(
      Math.round(Number(bounds.y)),
      workArea.y + windowScreenMargin,
      workArea.y + workArea.height - handleWindowSize.height - windowScreenMargin,
      workArea.y + windowScreenMargin
    )
  };
}

function magnetiseHandleBoundsToNearestEdge(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const clamped = clampHandleBoundsToDisplay(bounds, display);
  const minX = workArea.x + windowScreenMargin;
  const maxX = workArea.x + workArea.width - clamped.width - windowScreenMargin;
  const minY = workArea.y + windowScreenMargin;
  const maxY = workArea.y + workArea.height - clamped.height - windowScreenMargin;
  const midpointX = getMidpointCoordinate({ max: maxX, min: minX });
  const midpointY = getMidpointCoordinate({ max: maxY, min: minY });
  const cornerSnap = getNearestHandleCornerSnapTarget(clamped, {
    maxX,
    maxY,
    minX,
    minY
  });

  if (cornerSnap) {
    return cornerSnap.bounds;
  }

  const midpointSnap = getNearestHandleMidpointSnapTarget(clamped, {
    maxX,
    maxY,
    midpointX,
    midpointY,
    minX,
    minY
  });

  if (midpointSnap) {
    return midpointSnap.bounds;
  }

  const nearest = getNearestHandleEdgeWithMidpointBias(clamped, {
    maxX,
    maxY,
    midpointX,
    midpointY,
    minX,
    minY
  }, display);
  const magnetisedX = magnetiseCoordinateToMidpoint({
    max: maxX,
    min: minX,
    value: clamped.x
  });
  const magnetisedY = magnetiseCoordinateToMidpoint({
    max: maxY,
    min: minY,
    value: clamped.y
  });

  if (nearest === 'left') {
    return { ...clamped, x: minX, y: magnetisedY };
  }

  if (nearest === 'right') {
    return { ...clamped, x: maxX, y: magnetisedY };
  }

  if (nearest === 'top') {
    return { ...clamped, x: magnetisedX, y: minY };
  }

  return { ...clamped, x: magnetisedX, y: maxY };
}

function getMidpointCoordinate({ max, min }) {
  const travel = max - min;

  if (travel <= 0) {
    return min;
  }

  return min + (travel * 0.5);
}

function magnetiseCoordinateToMidpoint({ max, min, threshold = handleMidpointMagnetPx, value }) {
  const midpoint = getMidpointCoordinate({ max, min });

  return Math.abs(midpoint - value) <= threshold
    ? Math.round(midpoint)
    : Math.round(value);
}

function getNearestHandleMidpointSnapTarget(bounds, midpointBounds, threshold = handleMidpointMagnetPx) {
  const targets = [
    { edge: 'left', x: midpointBounds.minX, y: midpointBounds.midpointY },
    { edge: 'right', x: midpointBounds.maxX, y: midpointBounds.midpointY },
    { edge: 'top', x: midpointBounds.midpointX, y: midpointBounds.minY },
    { edge: 'bottom', x: midpointBounds.midpointX, y: midpointBounds.maxY }
  ].map((target) => ({
    ...target,
    distance: Math.hypot(bounds.x - target.x, bounds.y - target.y)
  }));
  const nearest = targets.reduce((best, target) => (
    target.distance < best.distance ? target : best
  ), targets[0]);

  if (nearest.distance > threshold) {
    return null;
  }

  return {
    bounds: {
      ...bounds,
      x: Math.round(nearest.x),
      y: Math.round(nearest.y)
    },
    key: nearest.edge
  };
}

function getNearestHandleCornerSnapTarget(bounds, edgeBounds, threshold = handleMidpointMagnetPx) {
  const targets = [
    { edge: 'top', key: 'top-left', x: edgeBounds.minX, y: edgeBounds.minY },
    { edge: 'top', key: 'top-right', x: edgeBounds.maxX, y: edgeBounds.minY },
    { edge: 'bottom', key: 'bottom-left', x: edgeBounds.minX, y: edgeBounds.maxY },
    { edge: 'bottom', key: 'bottom-right', x: edgeBounds.maxX, y: edgeBounds.maxY }
  ].map((target) => ({
    ...target,
    distance: Math.hypot(bounds.x - target.x, bounds.y - target.y)
  }));
  const nearest = targets.reduce((best, target) => (
    target.distance < best.distance ? target : best
  ), targets[0]);

  if (nearest.distance > threshold) {
    return null;
  }

  return {
    bounds: {
      ...bounds,
      x: Math.round(nearest.x),
      y: Math.round(nearest.y)
    },
    edge: nearest.edge,
    key: nearest.key
  };
}

function getLiveHandleSnapBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const clamped = clampHandleBoundsToDisplay(bounds, display);
  const minX = workArea.x + windowScreenMargin;
  const maxX = workArea.x + workArea.width - clamped.width - windowScreenMargin;
  const minY = workArea.y + windowScreenMargin;
  const maxY = workArea.y + workArea.height - clamped.height - windowScreenMargin;
  const edgeBounds = {
    maxX,
    maxY,
    minX,
    minY
  };
  const cornerSnap = getNearestHandleCornerSnapTarget(clamped, edgeBounds);

  if (cornerSnap) {
    return cornerSnap;
  }

  return getNearestHandleMidpointSnapTarget(clamped, {
    maxX,
    maxY,
    midpointX: getMidpointCoordinate({ max: maxX, min: minX }),
    midpointY: getMidpointCoordinate({ max: maxY, min: minY }),
    minX,
    minY
  });
}

function getNearestHandleEdgeWithMidpointBias(bounds, midpointBounds, display = screen.getDisplayMatching(bounds)) {
  const cornerSnap = getNearestHandleCornerSnapTarget(bounds, midpointBounds);

  if (cornerSnap) {
    return cornerSnap.edge;
  }

  const midpointCandidates = [];

  if (Math.abs(bounds.x - midpointBounds.midpointX) <= handleMidpointMagnetPx) {
    midpointCandidates.push(
      { edge: 'top', value: Math.abs(bounds.y - midpointBounds.minY) },
      { edge: 'bottom', value: Math.abs(midpointBounds.maxY - bounds.y) }
    );
  }

  if (Math.abs(bounds.y - midpointBounds.midpointY) <= handleMidpointMagnetPx) {
    midpointCandidates.push(
      { edge: 'left', value: Math.abs(bounds.x - midpointBounds.minX) },
      { edge: 'right', value: Math.abs(midpointBounds.maxX - bounds.x) }
    );
  }

  if (midpointCandidates.length > 0) {
    return midpointCandidates.reduce((best, item) => (item.value < best.value ? item : best), midpointCandidates[0]).edge;
  }

  return getNearestHandleEdge(bounds, display);
}

function getNearestHandleEdge(bounds, display = screen.getDisplayMatching(bounds)) {
  const workArea = display.workArea;
  const minX = workArea.x + windowScreenMargin;
  const maxX = workArea.x + workArea.width - bounds.width - windowScreenMargin;
  const minY = workArea.y + windowScreenMargin;
  const maxY = workArea.y + workArea.height - bounds.height - windowScreenMargin;
  const cornerSnap = getNearestHandleCornerSnapTarget(bounds, {
    maxX,
    maxY,
    minX,
    minY
  });

  if (cornerSnap) {
    return cornerSnap.edge;
  }

  const distances = [
    { edge: 'left', value: Math.abs(bounds.x - minX) },
    { edge: 'right', value: Math.abs(maxX - bounds.x) },
    { edge: 'top', value: Math.abs(bounds.y - minY) },
    { edge: 'bottom', value: Math.abs(maxY - bounds.y) }
  ];

  return distances.reduce((best, item) => (item.value < best.value ? item : best), distances[0]).edge;
}

function getPrivateOverlayHandleBounds() {
  if (privateOverlayHandleWindow && !privateOverlayHandleWindow.isDestroyed()) {
    return privateOverlayHandleWindow.getBounds();
  }

  const state = readPrivateOverlayState();

  return {
    height: handleWindowSize.height,
    width: handleWindowSize.width,
    x: state.handle.x,
    y: state.handle.y
  };
}

function getAnchoredOverlayBounds(size = {}) {
  const state = readPrivateOverlayState();
  const handleBounds = getPrivateOverlayHandleBounds();
  const display = screen.getDisplayMatching(handleBounds);
  const workArea = display.workArea;
  const edge = getNearestHandleEdge(handleBounds, display);
  const horizontalSpace = workArea.width - (windowScreenMargin * 2);
  const verticalSpace = workArea.height - (windowScreenMargin * 2);
  const leftSpace = handleBounds.x - workArea.x - overlayWindowGap - windowScreenMargin;
  const rightSpace = workArea.x + workArea.width - (handleBounds.x + handleBounds.width) - overlayWindowGap - windowScreenMargin;
  const topSpace = handleBounds.y - workArea.y - overlayWindowGap - windowScreenMargin;
  const bottomSpace = workArea.y + workArea.height - (handleBounds.y + handleBounds.height) - overlayWindowGap - windowScreenMargin;
  const widthMax = Math.max(minimumWindowSize.width, Math.min(maximumOverlayWindowSize.width, horizontalSpace));
  const heightMax = Math.max(minimumWindowSize.height, Math.min(maximumOverlayWindowSize.height, verticalSpace));
  const requestedWidth = Number(size.width);
  const requestedHeight = Number(size.height);
  const preferredOverlaySize = getPreferredOverlaySizeForEdge({
    height: Number.isFinite(requestedHeight)
      ? requestedHeight
      : state.overlay.height,
    width: Number.isFinite(requestedWidth)
      ? requestedWidth
      : Math.max(Number(state.overlay.width), minimumNonCompactOverlayWidth)
  }, edge, { minimumNonCompactWidth: minimumNonCompactOverlayWidth });
  const preferredOverlayWidth = preferredOverlaySize.width;
  const preferredOverlayHeight = preferredOverlaySize.height;
  let width = clampNumber(preferredOverlayWidth, minimumWindowSize.width, widthMax, overlayWindowSize.width);
  let height = clampNumber(preferredOverlayHeight, minimumWindowSize.height, heightMax, overlayWindowSize.height);
  let x = workArea.x + windowScreenMargin;
  let y = workArea.y + windowScreenMargin;

  if (edge === 'top' || edge === 'bottom') {
    const availableHeight = Math.max(edge === 'top' ? bottomSpace : topSpace, minimumWindowSize.height);

    height = clampNumber(preferredOverlayHeight, minimumWindowSize.height, Math.min(heightMax, availableHeight), overlayWindowSize.height);
    x = clampNumber(
      handleBounds.x + Math.round((handleBounds.width - width) / 2),
      workArea.x + windowScreenMargin,
      workArea.x + workArea.width - width - windowScreenMargin,
      workArea.x + windowScreenMargin
    );
    y = edge === 'top'
      ? Math.min(workArea.y + workArea.height - height - windowScreenMargin, handleBounds.y + handleBounds.height + overlayWindowGap)
      : Math.max(workArea.y + windowScreenMargin, handleBounds.y - overlayWindowGap - height);
  } else {
    const availableWidth = Math.max(edge === 'right' ? leftSpace : rightSpace, minimumWindowSize.width);

    width = clampNumber(preferredOverlayWidth, minimumWindowSize.width, Math.min(widthMax, availableWidth), overlayWindowSize.width);
    x = edge === 'right'
      ? Math.max(workArea.x + windowScreenMargin, handleBounds.x - overlayWindowGap - width)
      : Math.min(workArea.x + workArea.width - width - windowScreenMargin, handleBounds.x + handleBounds.width + overlayWindowGap);
    y = clampNumber(
      handleBounds.y + Math.round((handleBounds.height - height) / 2),
      workArea.y + windowScreenMargin,
      workArea.y + workArea.height - height - windowScreenMargin,
      workArea.y + windowScreenMargin
    );
  }

  return {
    height,
    width,
    x,
    y
  };
}

function clampOverlayBoundsToDisplay(bounds, display = screen.getDisplayMatching(bounds)) {
  const workArea = display.workArea;
  const width = clampNumber(
    Math.round(Number(bounds.width)),
    minimumWindowSize.width,
    Math.min(maximumOverlayWindowSize.width, workArea.width - (windowScreenMargin * 2)),
    overlayWindowSize.width
  );
  const height = clampNumber(
    Math.round(Number(bounds.height)),
    minimumWindowSize.height,
    Math.min(maximumOverlayWindowSize.height, workArea.height - (windowScreenMargin * 2)),
    overlayWindowSize.height
  );

  return {
    height,
    width,
    x: clampNumber(
      Math.round(Number(bounds.x)),
      workArea.x + windowScreenMargin,
      workArea.x + workArea.width - width - windowScreenMargin,
      workArea.x + windowScreenMargin
    ),
    y: clampNumber(
      Math.round(Number(bounds.y)),
      workArea.y + windowScreenMargin,
      workArea.y + workArea.height - height - windowScreenMargin,
      workArea.y + windowScreenMargin
    )
  };
}

function getNearestOverlayEdge(bounds, display = screen.getDisplayMatching(bounds)) {
  const workArea = display.workArea;
  const distances = [
    { edge: 'left', value: Math.abs(bounds.x - (workArea.x + windowScreenMargin)) },
    { edge: 'right', value: Math.abs((workArea.x + workArea.width - windowScreenMargin) - (bounds.x + bounds.width)) },
    { edge: 'top', value: Math.abs(bounds.y - (workArea.y + windowScreenMargin)) },
    { edge: 'bottom', value: Math.abs((workArea.y + workArea.height - windowScreenMargin) - (bounds.y + bounds.height)) }
  ];

  return distances.reduce((best, item) => (item.value < best.value ? item : best), distances[0]).edge;
}

function getHandleBoundsForOverlayBounds(overlayBounds, { snap = false } = {}) {
  const display = screen.getDisplayMatching(overlayBounds);
  const workArea = display.workArea;
  const edge = getNearestOverlayEdge(overlayBounds, display);
  const overlayCentreX = overlayBounds.x + Math.round(overlayBounds.width / 2);
  const overlayCentreY = overlayBounds.y + Math.round(overlayBounds.height / 2);
  let handleBounds;

  if (edge === 'left') {
    handleBounds = {
      height: handleWindowSize.height,
      width: handleWindowSize.width,
      x: workArea.x + windowScreenMargin,
      y: overlayCentreY - Math.round(handleWindowSize.height / 2)
    };
  } else if (edge === 'right') {
    handleBounds = {
      height: handleWindowSize.height,
      width: handleWindowSize.width,
      x: workArea.x + workArea.width - handleWindowSize.width - windowScreenMargin,
      y: overlayCentreY - Math.round(handleWindowSize.height / 2)
    };
  } else if (edge === 'top') {
    handleBounds = {
      height: handleWindowSize.height,
      width: handleWindowSize.width,
      x: overlayCentreX - Math.round(handleWindowSize.width / 2),
      y: workArea.y + windowScreenMargin
    };
  } else {
    handleBounds = {
      height: handleWindowSize.height,
      width: handleWindowSize.width,
      x: overlayCentreX - Math.round(handleWindowSize.width / 2),
      y: workArea.y + workArea.height - handleWindowSize.height - windowScreenMargin
    };
  }

  return snap
    ? magnetiseHandleBoundsToNearestEdge(handleBounds)
    : clampHandleBoundsToDisplay(handleBounds, display);
}

function setPrivateOverlayHandleBounds(bounds, { persist = true } = {}) {
  const handle = createPrivateOverlayHandleWindow();
  const nextBounds = normaliseHandleBounds(bounds);

  cancelPrivateOverlayHandleSnapAnimation();
  handle.setBounds(nextBounds);

  if (persist) {
    updatePrivateOverlayState((state) => ({
      ...state,
      handle: {
        ...state.handle,
        visible: handle.isVisible(),
        x: nextBounds.x,
        y: nextBounds.y
      }
    }));
  }

  return nextBounds;
}

function positionVisibleOverlayFromHandle(size = {}, { persist = true } = {}) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed() || !privateOverlayWindow.isVisible()) {
    return null;
  }

  const bounds = getAnchoredOverlayBounds(size);

  privateOverlayWindow.setBounds(bounds);

  if (persist) {
    updatePrivateOverlayState((state) => ({
      ...state,
      overlay: {
        ...state.overlay,
        height: bounds.height,
        visible: true,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y
      }
    }));
  }

  return bounds;
}

function readPrivateOverlayState() {
  try {
    return normalisePrivateOverlayState(JSON.parse(fsSync.readFileSync(getPrivateOverlayStatePath(), 'utf8')));
  } catch {
    return normalisePrivateOverlayState(null);
  }
}

function writePrivateOverlayState(nextState) {
  const state = normalisePrivateOverlayState(nextState);

  try {
    fsSync.mkdirSync(app.getPath('userData'), { recursive: true });
    fsSync.writeFileSync(getPrivateOverlayStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // Overlay state should never block window management.
  }

  return state;
}

function updatePrivateOverlayState(update) {
  const state = readPrivateOverlayState();
  const nextState = typeof update === 'function' ? update(state) : { ...state, ...update };

  return writePrivateOverlayState(nextState);
}

function getPrivateOverlayStatus() {
  const state = readPrivateOverlayState();
  const hasHandleWindow = Boolean(privateOverlayHandleWindow && !privateOverlayHandleWindow.isDestroyed());
  const hasOverlayWindow = Boolean(privateOverlayWindow && !privateOverlayWindow.isDestroyed());
  const handleWindowVisible = Boolean(hasHandleWindow && privateOverlayHandleWindow.isVisible());
  const overlayWindowVisible = Boolean(hasOverlayWindow && privateOverlayWindow.isVisible());
  const handleBounds = hasHandleWindow ? privateOverlayHandleWindow.getBounds() : state.handle;
  const overlayBounds = hasOverlayWindow ? privateOverlayWindow.getBounds() : state.overlay;

  return {
    ...state,
    handle: {
      ...state.handle,
      visible: hasHandleWindow ? handleWindowVisible : state.handle.visible,
      x: handleBounds.x,
      y: handleBounds.y
    },
    handleWindowVisible,
    overlay: {
      ...state.overlay,
      height: overlayBounds.height,
      visible: hasOverlayWindow ? overlayWindowVisible : state.overlay.visible,
      width: overlayBounds.width,
      x: overlayBounds.x,
      y: overlayBounds.y
    },
    overlayWindowVisible
  };
}

const captureStatus = {
  state: 'idle',
  levels: {
    microphone: {
      source: 'microphone',
      level: 38,
      label: '-24 dB'
    },
    system: {
      source: 'system',
      level: 52,
      label: '-18 dB'
    }
  }
};
let localTranscriptionActive = false;
let systemAudioProcess = null;
let systemAudioStdout = '';
let systemAudioSmoke = null;
let localTranscriptionProcess = null;
let localTranscriptionStdout = '';
const localTranscriptionStopFlush = createStopFlushController();
let localParakeetDaemonProcess = null;
let localParakeetDaemonStdout = '';
let persistentPiRpcBridge = null;
let backupPersistentPiRpcBridge = null;
let llmWarmStatus = isPiLlmBridgeEnabled() ? 'warming' : 'disabled';

function isPiLlmBridgeEnabled() {
  if (rendererRealLlmSmoke) {
    return true;
  }

  if (piLlmBridgeMode) {
    return ['1', 'enabled', 'on', 'pi', 'true', 'yes'].includes(piLlmBridgeMode);
  }

  return !app.isPackaged;
}

function assertPiLlmBridgeEnabled() {
  if (!isPiLlmBridgeEnabled()) {
    throw new Error('AI is not configured yet. Susura does not use local Pi, Codex, browser or subscription logins automatically in packaged builds.');
  }
}

function writeTranscriptDebugLog(stage, payload = {}) {
  if (!transcriptDebugLogEnabled) {
    return;
  }

  const entry = {
    at: new Date().toISOString(),
    pid: process.pid,
    stage,
    ...payload
  };

  console.log(`susura-transcript-debug ${JSON.stringify(entry)}`);

  try {
    if (!transcriptDebugLogPath) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      fsSync.mkdirSync(logDir, { recursive: true });
      transcriptDebugLogPath = path.join(logDir, 'transcript-debug.jsonl');
    }

    fsSync.appendFileSync(transcriptDebugLogPath, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error(`susura-transcript-debug-write-failed ${error.message}`);
  }
}

function emitTranscriptionEvent(event) {
  if (process.env.SUSURA_BENCH_TRANSCRIPTION_EVENT_LOG === '1' && event.name !== 'frame_received_at') {
    console.log(`susura-transcription-event ${JSON.stringify(event)}`);
  }

  writeTranscriptDebugLog('electron.emit_transcription_event', { event });

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('susura:transcription-event', event);
  });
}

function emitLlmStatus() {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('susura:llm-status', {
      ok: true,
      ready: llmWarmStatus === 'ready',
      status: llmWarmStatus
    });
  });
}

function getPermissionsStatus() {
  const isMac = process.platform === 'darwin';

  return {
    ok: true,
    platform: process.platform,
    permissions: [
      {
        description: 'Required when listening to speaker audio output.',
        id: 'screen-recording',
        label: 'Screen & System Audio Recording',
        status: isMac
          ? mapMacMediaAccessStatus(systemPreferences.getMediaAccessStatus('screen'))
          : 'unsupported'
      },
      {
        description: 'Required when listening to your microphone.',
        id: 'microphone',
        label: 'Microphone',
        status: isMac
          ? mapMacMediaAccessStatus(systemPreferences.getMediaAccessStatus('microphone'))
          : 'unsupported'
      }
    ]
  };
}

function mapMacMediaAccessStatus(status) {
  if (status === 'granted' || status === 'denied' || status === 'restricted' || status === 'not-determined') {
    return status;
  }

  return 'unknown';
}

function openPermissionsSettings(permission) {
  if (process.platform !== 'darwin') {
    return { ok: false, message: 'Permission settings shortcuts are only available on macOS for now.' };
  }

  const pane = permission === 'microphone'
    ? 'Privacy_Microphone'
    : 'Privacy_ScreenCapture';

  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);

  return { ok: true };
}

async function requestPermission(permission) {
  if (process.platform !== 'darwin') {
    return { ok: false, message: 'Permission requests are only available on macOS for now.' };
  }

  if (permission === 'microphone') {
    const granted = await systemPreferences.askForMediaAccess('microphone');

    return { ok: granted };
  }

  if (permission === 'screen-recording') {
    return openPermissionsSettings(permission);
  }

  return { ok: false, message: 'Unknown permission.' };
}

function getAudioHelperCommand(args) {
  if (app.isPackaged) {
    const bundledPath = getBundledExecutablePath('SusuraAudioHelper');

    if (fsSync.existsSync(bundledPath)) {
      return {
        command: bundledPath,
        args
      };
    }
  }

  const packagePath = path.join(__dirname, '..', 'native', 'macos-audio-helper');
  const releaseBinaryPath = path.join(packagePath, '.build', 'release', 'SusuraAudioHelper');
  const debugBinaryPath = path.join(packagePath, '.build', 'debug', 'SusuraAudioHelper');
  const binaryPath = fsSync.existsSync(releaseBinaryPath) ? releaseBinaryPath : debugBinaryPath;

  if (fsSync.existsSync(binaryPath)) {
    return {
      command: binaryPath,
      args
    };
  }

  return {
    command: 'swift',
    args: ['run', '--package-path', packagePath, 'SusuraAudioHelper', ...args]
  };
}

function getSystemAudioHelperCommand() {
  const captureArg = '--stream-system-audio';

  return getDesktopBackendCommand([captureArg]);
}

function getDesktopBackendCommand(args) {
  if (app.isPackaged) {
    const bundledPath = getBundledExecutablePath('susura-desktop-backend');

    if (fsSync.existsSync(bundledPath)) {
      return {
        command: bundledPath,
        args
      };
    }
  }

  const releaseBinaryPath = path.join(__dirname, '..', 'target', 'release', 'susura-desktop-backend');
  const debugBinaryPath = path.join(__dirname, '..', 'target', 'debug', 'susura-desktop-backend');
  const binaryPath = fsSync.existsSync(releaseBinaryPath) ? releaseBinaryPath : debugBinaryPath;

  if (fsSync.existsSync(binaryPath)) {
    return {
      command: binaryPath,
      args
    };
  }

  return {
    command: 'cargo',
    args: ['run', '-p', 'susura-desktop-backend', '--', ...args]
  };
}

function startLocalParakeetDaemon() {
  if (process.platform !== 'darwin') {
    return;
  }

  if (localParakeetDaemonProcess) {
    return;
  }

  const helper = getAudioHelperCommand(['--parakeet-daemon']);
  const child = spawn(helper.command, helper.args, {
    cwd: getProjectRoot(),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  localParakeetDaemonProcess = child;
  localParakeetDaemonStdout = '';

  child.stdout.on('data', handleLocalParakeetDaemonStdout);

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();

    if (message && !isIgnorableHelperStderr(message)) {
      emitTranscriptionEvent({
        type: 'error',
        message
      });
    }
  });

  child.once('error', (error) => {
    if (localParakeetDaemonProcess === child) {
      localParakeetDaemonProcess = null;
      emitTranscriptionEvent({
        type: 'error',
        message: error.message
      });
    }
  });

  child.once('exit', (code, signal) => {
    if (localParakeetDaemonProcess === child) {
      localParakeetDaemonProcess = null;
      localParakeetDaemonStdout = '';

      if (code && code !== 0) {
        emitTranscriptionEvent({
          type: 'error',
          message: `Local Parakeet helper exited with code ${code}${signal ? ` (${signal})` : ''}.`
        });
      }
    }
  });
}

function sendLocalParakeetDaemonCommand(type) {
  startLocalParakeetDaemon();

  if (!localParakeetDaemonProcess?.stdin?.writable) {
    throw new Error('Local Parakeet helper is unavailable.');
  }

  localParakeetDaemonProcess.stdin.write(`${JSON.stringify({ type })}\n`);
}

function stopLocalParakeetCapture() {
  if (!localParakeetDaemonProcess) {
    return;
  }

  if (systemAudioSmoke) {
    systemAudioSmoke.stoppedBySmoke = true;
  }

  sendLocalParakeetDaemonCommand('stop');
}

function stopLocalParakeetDaemon({ force = false } = {}) {
  if (!localParakeetDaemonProcess) {
    return;
  }

  const child = localParakeetDaemonProcess;

  if (localParakeetDaemonProcess.stdin?.writable) {
    localParakeetDaemonProcess.stdin.write(`${JSON.stringify({ type: 'quit' })}\n`);
    localParakeetDaemonProcess.stdin.end();
  } else {
    localParakeetDaemonProcess.kill('SIGTERM');
  }

  if (force) {
    setTimeout(() => {
      if (localParakeetDaemonProcess === child) {
        child.kill('SIGTERM');
      }
    }, 500).unref();
  }
}

function stopSystemAudioCapture() {
  if (!systemAudioProcess) {
    return;
  }

  if (systemAudioSmoke) {
    systemAudioSmoke.stoppedBySmoke = true;
  }

  systemAudioProcess.kill('SIGTERM');
  systemAudioProcess = null;
  systemAudioStdout = '';
}

function startLocalTranscriptionWarmDaemon() {
  if (localTranscriptionProcess) {
    return { ok: true };
  }

  const helper = getDesktopBackendCommand(['--local-transcription-daemon']);
  const child = spawn(helper.command, helper.args, {
    cwd: getProjectRoot(),
    env: {
      ...process.env,
      SUSURA_PRELOAD_PARAKEET: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  localTranscriptionProcess = child;
  localTranscriptionStdout = '';

  child.stdout.on('data', handleLocalTranscriptionStdout);

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();

    if (message && !isIgnorableHelperStderr(message)) {
      emitTranscriptionEvent({
        type: 'error',
        message
      });
    }
  });

  child.once('error', (error) => {
    if (localTranscriptionProcess === child) {
      localTranscriptionProcess = null;
      emitTranscriptionEvent({
        type: 'error',
        message: error.message
      });
    }
  });

  child.once('exit', (code, signal) => {
    if (localTranscriptionProcess === child) {
      localTranscriptionProcess = null;
      localTranscriptionStdout = '';
      localTranscriptionStopFlush.cancel('process-exit');

      if (code && code !== 0) {
        emitTranscriptionEvent({
          type: 'error',
          message: `Local transcription backend exited with code ${code}${signal ? ` (${signal})` : ''}.`
        });
      }

      if (localTranscriptionActive) {
        emitTranscriptionEvent({ type: 'closed' });
      }
    }
  });

  return { ok: true, provider: 'parakeet' };
}

function prepareLocalTranscriptionCapture(options) {
  startLocalTranscriptionWarmDaemon();

  const selectedSources = normaliseTranscriptionSources(options?.sources);

  if (selectedSources.length === 0 || !localTranscriptionProcess?.stdin?.writable) {
    return { ok: false };
  }

  localTranscriptionProcess.stdin.write(`${JSON.stringify({
    type: 'prepare',
    sources: selectedSources
  })}\n`);

  return { ok: true, provider: 'parakeet' };
}

function shouldWarmLocalTranscriptionOnStartup() {
  return process.env.SUSURA_DISABLE_PARAKEET_WARMUP !== '1'
    && process.platform === 'darwin'
    && smokeExitMs === 0
    && resourceSmokeMs === 0
    && systemAudioSmokeMs === 0
    && localParakeetSmokeMs === 0;
}

function startLocalTranscriptionCapture(options) {
  startLocalTranscriptionWarmDaemon();
  localTranscriptionStopFlush.cancel('start');

  const selectedSources = normaliseTranscriptionSources(options?.sources);

  if (selectedSources.length === 0) {
    throw new Error('Select at least one audio source.');
  }

  if (!localTranscriptionProcess?.stdin?.writable) {
    throw new Error('Local transcription backend is unavailable.');
  }

  localTranscriptionProcess.stdin.write(`${JSON.stringify({
    type: 'start',
    sources: selectedSources
  })}\n`);
  emitTranscriptionEvent({ type: 'connected' });

  return { ok: true, provider: 'parakeet' };
}

function stopLocalTranscriptionCapture() {
  if (!localTranscriptionProcess) {
    return Promise.resolve({ ok: true });
  }

  if (localTranscriptionProcess.stdin?.writable) {
    const waitForFlush = localTranscriptionStopFlush.wait();
    localTranscriptionProcess.stdin.write(`${JSON.stringify({ type: 'stop' })}\n`);

    return waitForFlush.then(() => ({ ok: true }));
  }

  return Promise.resolve({ ok: true });
}

function normaliseTranscriptionSources(sources) {
  const requestedSources = Array.isArray(sources) ? sources : ['system'];
  return [...new Set(requestedSources)]
    .map((source) => String(source ?? '').trim())
    .filter((source) => source === 'system' || source === 'microphone');
}

function handleLocalTranscriptionStdout(chunk) {
  localTranscriptionStdout += chunk.toString();

  let newlineIndex = localTranscriptionStdout.indexOf('\n');

  while (newlineIndex >= 0) {
    const line = localTranscriptionStdout.slice(0, newlineIndex).trim();
    localTranscriptionStdout = localTranscriptionStdout.slice(newlineIndex + 1);

    if (line) {
      writeTranscriptDebugLog('backend.stdout_line', { line });

      try {
        handleLocalTranscriptionEvent(JSON.parse(line));
      } catch {
        emitTranscriptionEvent({
          type: 'error',
          message: 'Local transcription backend returned an unreadable event.'
        });
      }
    }

    newlineIndex = localTranscriptionStdout.indexOf('\n');
  }
}

function handleLocalTranscriptionEvent(event) {
  writeTranscriptDebugLog('backend.parsed_event', { event });

  if (event.type === 'transcription_completed' && event.text) {
    emitTranscriptionEvent({
      type: 'completed',
      source: event.source,
      utteranceId: event.utterance_id,
      startMs: event.start_ms,
      endMs: event.end_ms,
      text: event.text
    });
    return;
  }

  if (event.type === 'transcription_partial' && event.text) {
    emitTranscriptionEvent({
      type: 'partial',
      source: event.source,
      utteranceId: event.utterance_id,
      startMs: event.start_ms,
      endMs: event.end_ms,
      text: event.text
    });
    return;
  }

  if (event.type === 'speech_started') {
    emitTranscriptionEvent({ type: 'speech-started' });
    return;
  }

  if (event.type === 'speech_stopped') {
    emitTranscriptionEvent({ type: 'speech-stopped' });
    return;
  }

  if (event.type === 'pipeline_metric' && event.name) {
    emitTranscriptionEvent({
      type: 'metric',
      name: event.name,
      utteranceId: event.utterance_id,
      atMs: event.at_ms
    });
    return;
  }

  if (event.type === 'llm_response' && event.text) {
    emitTranscriptionEvent({
      type: 'llm-response',
      text: event.text
    });
    return;
  }

  if (event.type === 'llm_query' && event.text) {
    emitTranscriptionEvent({
      type: 'llm-query',
      text: event.text
    });
    return;
  }

  if (event.type === 'capture_stage' && event.message) {
    emitTranscriptionEvent({
      type: 'stage',
      message: event.message
    });

    if (event.message === 'local transcription stopped') {
      localTranscriptionStopFlush.resolve();
    }

    return;
  }

  if (event.type === 'permission_error' || event.type === 'capture_error') {
    emitTranscriptionEvent({
      type: 'error',
      message: event.message ?? 'Local transcription failed.'
    });
  }
}

const allowedLlmModels = new Set([
  'openai-codex/gpt-5.2',
  'openai-codex/gpt-5.4',
  'openai-codex/gpt-5.4-mini',
  'openai-codex/gpt-5.5'
]);
const allowedLlmThinking = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

class PersistentPiRpcBridge {
  constructor({ model, thinking }) {
    this.model = model;
    this.thinking = thinking;
    this.child = null;
    this.lines = null;
    this.nextId = 1;
    this.pendingCommand = new Map();
    this.activeRequest = null;
    this.ready = false;
    this.exited = false;
    this.stderr = '';
    this.queue = Promise.resolve();
  }

  async request(transcript, onDelta = () => {}) {
    const requestStartedAt = Date.now();
    const operation = async () => {
      await this.start();
      await this.newSession();

      if (rendererRealLlmSmoke) {
        console.log(`susura-llm-timing ${JSON.stringify({
          event: 'pi_rpc_prompt_start',
          atMs: Date.now() - requestStartedAt,
          pid: this.child?.pid
        })}`);
      }

      return this.prompt(transcript, onDelta);
    };
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);

    return result;
  }

  start() {
    if (this.ready && this.child && !this.exited) {
      return Promise.resolve();
    }

    const args = [
      '--mode', 'rpc',
      '--no-session',
      '--no-tools',
      '--no-context-files',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--system-prompt', '',
      '--model', this.model,
      '--thinking', this.thinking
    ];

    if (process.env.SUSURA_PI_SESSION_DIR_MODE === 'app') {
      const sessionDir = path.join(app.getPath('userData'), 'pi-sessions');
      fsSync.mkdirSync(sessionDir, { recursive: true });
      args.push('--session-dir', sessionDir);
    }

    this.ready = true;
    this.exited = false;
    this.child = spawn('pi', args, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => this.handleLine(line));
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
    this.child.once('error', (error) => this.handleExit(error));
    this.child.once('exit', (code) => this.handleExit(new Error(`Pi RPC exited with code ${code}.`)));

    if (rendererRealLlmSmoke) {
      console.log(`susura-llm-timing ${JSON.stringify({
        event: 'pi_rpc_spawned',
        atMs: 0,
        pid: this.child.pid
      })}`);
    }

    return Promise.resolve();
  }

  dispose() {
    this.ready = false;
    this.exited = true;
    this.lines?.close();
    this.child?.kill();
    this.child = null;
    this.lines = null;
  }

  newSession() {
    return this.sendCommand({ type: 'new_session' });
  }

  prompt(message, onDelta) {
    const output = [];

    return new Promise((resolve, reject) => {
      const id = this.nextCommandId();
      const startedAt = Date.now();

      this.pendingCommand.set(id, {
        reject,
        resolve: () => undefined
      });
      this.activeRequest = {
        id,
        onDelta,
        output,
        reject,
        resolve,
        startedAt,
        sawAssistant: false
      };
      this.write({
        id,
        type: 'prompt',
        message
      });
    });
  }

  sendCommand(command) {
    return new Promise((resolve, reject) => {
      const id = this.nextCommandId();

      this.pendingCommand.set(id, { reject, resolve });
      this.write({ id, ...command });
    });
  }

  write(command) {
    if (!this.child?.stdin?.writable || this.exited) {
      throw new Error('Pi RPC bridge is not running.');
    }

    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  nextCommandId() {
    const id = `susura-${this.nextId}`;
    this.nextId += 1;

    return id;
  }

  handleLine(line) {
    let event;

    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (event.id && this.pendingCommand.has(event.id)) {
      const pending = this.pendingCommand.get(event.id);
      this.pendingCommand.delete(event.id);

      if (event.success === false) {
        pending.reject(new Error(event.error ?? `Pi RPC command failed: ${event.command ?? event.id}`));
      } else {
        pending.resolve(event);
      }
    }

    const request = this.activeRequest;

    if (!request) {
      return;
    }

    if (event.type === 'message_start' && event.message?.role === 'assistant') {
      request.sawAssistant = true;
    }

    const assistantEvent = event.assistantMessageEvent;

    if (request.sawAssistant && assistantEvent?.type === 'text_delta') {
      const delta = String(assistantEvent.delta ?? assistantEvent.text ?? assistantEvent.content ?? '');

      if (delta) {
        if (rendererRealLlmSmoke && request.output.length === 0) {
          console.log(`susura-llm-timing ${JSON.stringify({
            event: 'pi_rpc_text_delta',
            atMs: Date.now() - request.startedAt
          })}`);
        }

        request.output.push(delta);
        request.onDelta(delta);
      }
    }

    if (request.sawAssistant && event.type === 'turn_end') {
      this.activeRequest = null;
      request.resolve(request.output.join('').trim() || 'No response returned.');
    }
  }

  handleExit(error) {
    this.ready = false;
    this.exited = true;
    this.lines?.close();

    for (const pending of this.pendingCommand.values()) {
      pending.reject(error);
    }

    this.pendingCommand.clear();

    if (this.activeRequest) {
      this.activeRequest.reject(error);
      this.activeRequest = null;
    }
  }
}

async function requestLlmResponse(transcript, options = {}) {
  assertPiLlmBridgeEnabled();

  const requestStartedAt = Date.now();
  const trace = options.trace && typeof options.trace === 'object'
    ? options.trace
    : null;
  const requestId = typeof options.requestId === 'string' ? options.requestId : undefined;
  const trimmedTranscript = formatLlmTranscript(String(transcript ?? '').trim());
  const attachments = normaliseLlmRequestAttachments(options.attachments);

  if (!trimmedTranscript) {
    throw new Error('There is no transcript to send.');
  }

  if (rendererRealLlmSmoke) {
    console.log(`susura-llm-timing ${JSON.stringify({
      event: 'electron_request_started',
      atMs: 0,
      trace
    })}`);
  }

  emitTranscriptionEvent({ type: 'llm-query', requestId, text: trimmedTranscript });
  const text = await runPiTextRequest(trimmedTranscript, { ...options, attachments }, (delta) => {
    if (rendererRealLlmSmoke) {
      console.log(`susura-llm-timing ${JSON.stringify({
        event: 'electron_delta_emit',
        atMs: Date.now() - requestStartedAt,
        chars: delta.length
      })}`);
    }

    emitTranscriptionEvent({ type: 'llm-response-delta', requestId, text: delta });
  });
  emitTranscriptionEvent({ type: 'llm-response', requestId, text });

  return { ok: true, text };
}

function normaliseLlmRequestAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map(normalisePromptTemplateAttachment)
    .filter(Boolean);
}

function formatLlmTranscript(transcript) {
  const windowChars = Number(process.env.SUSURA_LLM_TRANSCRIPT_WINDOW_CHARS ?? 0);
  const promptShape = process.env.SUSURA_LLM_PROMPT_SHAPE ?? 'raw';
  const windowedTranscript = windowChars > 0 && transcript.length > windowChars
    ? transcript.slice(-windowChars).trim()
    : transcript;

  if (promptShape === 'short-answer') {
    return `Answer concisely:\n${windowedTranscript}`;
  }

  if (promptShape === 'answer-prefix') {
    return `Answer:\n${windowedTranscript}`;
  }

  return windowedTranscript;
}

function runPiTextRequest(transcript, options = {}, onDelta = () => {}) {
  const runStartedAt = Date.now();
  const requestedModel = typeof options.model === 'string' ? options.model : '';
  const requestedThinking = typeof options.reasoning === 'string' ? options.reasoning : '';
  const model = allowedLlmModels.has(requestedModel)
    ? requestedModel
    : process.env.SUSURA_LLM_MODEL
    ?? process.env.SUSURA_BENCH_LLM_MODEL
    ?? 'openai-codex/gpt-5.4-mini';
  const thinking = allowedLlmThinking.has(requestedThinking)
    ? requestedThinking
    : process.env.SUSURA_LLM_THINKING
    ?? process.env.SUSURA_BENCH_LLM_THINKING
    ?? 'off';

  const requestStrategy = process.env.SUSURA_LLM_REQUEST_STRATEGY ?? 'persistent';
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];

  if (attachments.length > 0) {
    return runOneShotPiTextRequest(transcript, { attachments, model, thinking }, onDelta, runStartedAt);
  }

  if (requestStrategy === 'one-shot') {
    return runOneShotPiTextRequest(transcript, { attachments, model, thinking }, onDelta, runStartedAt);
  }

  if (requestStrategy === 'race-one-shot') {
    return runRacedPiTextRequest(transcript, { model, thinking }, onDelta, runStartedAt);
  }

  if (requestStrategy === 'backup-persistent') {
    return runBackupPersistentPiRpcRequest(transcript, { model, thinking }, onDelta);
  }

  if (options.speculative === true) {
    return runBackupPersistentPiRpcRequest(transcript, { model, thinking }, onDelta);
  }

  if (process.env.SUSURA_LLM_DISABLE_PERSISTENT_PI !== '1') {
    return runPersistentPiRpcRequest(transcript, { model, thinking }, onDelta)
      .catch((error) => {
        if (rendererRealLlmSmoke) {
          console.error(`susura-pi-rpc-fallback ${error.message}`);
        }

        return runOneShotPiTextRequest(transcript, { attachments, model, thinking }, onDelta, runStartedAt);
      });
  }

  return runOneShotPiTextRequest(transcript, { attachments, model, thinking }, onDelta, runStartedAt);
}

function runRacedPiTextRequest(transcript, { model, thinking }, onDelta = () => {}, runStartedAt = Date.now()) {
  let winner = null;
  let settled = false;
  const makeDeltaHandler = (id) => (delta) => {
    if (winner === null) {
      winner = id;
    }

    if (winner === id) {
      onDelta(delta);
    }
  };
  const runners = [
    {
      id: 'persistent',
      run: () => runPersistentPiRpcRequest(transcript, { model, thinking }, makeDeltaHandler('persistent'))
    },
    {
      id: 'one-shot',
      run: () => runOneShotPiTextRequest(transcript, { model, thinking }, makeDeltaHandler('one-shot'), runStartedAt)
    }
  ];

  return new Promise((resolve, reject) => {
    let rejected = 0;
    let lastError = null;

    runners.forEach((runner) => {
      runner.run()
        .then((text) => {
          if (!settled) {
            settled = true;
            winner ??= runner.id;
            resolve(text);
          }
        })
        .catch((error) => {
          rejected += 1;
          lastError = error;

          if (rejected === runners.length) {
            reject(lastError);
          }
        });
    });
  });
}

function runPersistentPiRpcRequest(transcript, { model, thinking }, onDelta = () => {}) {
  if (
    !persistentPiRpcBridge
    || persistentPiRpcBridge.model !== model
    || persistentPiRpcBridge.thinking !== thinking
  ) {
    persistentPiRpcBridge?.dispose();
    persistentPiRpcBridge = new PersistentPiRpcBridge({ model, thinking });
  }

  const bridge = persistentPiRpcBridge;

  return withTimeout(
    bridge.request(transcript, onDelta),
    getLlmPersistentTimeoutMs(),
    'Pi RPC request timed out.'
  ).catch((error) => {
    if (persistentPiRpcBridge === bridge) {
      persistentPiRpcBridge.dispose();
      persistentPiRpcBridge = null;
    }

    throw error;
  });
}

function runBackupPersistentPiRpcRequest(transcript, { model, thinking }, onDelta = () => {}) {
  if (
    !backupPersistentPiRpcBridge
    || backupPersistentPiRpcBridge.model !== model
    || backupPersistentPiRpcBridge.thinking !== thinking
  ) {
    backupPersistentPiRpcBridge?.dispose();
    backupPersistentPiRpcBridge = new PersistentPiRpcBridge({ model, thinking });
  }

  return backupPersistentPiRpcBridge.request(transcript, onDelta);
}

function warmPersistentPiRpcBridge() {
  if (!isPiLlmBridgeEnabled()) {
    llmWarmStatus = 'disabled';
    emitLlmStatus();
    return;
  }

  if (process.env.SUSURA_LLM_DISABLE_PERSISTENT_PI === '1') {
    llmWarmStatus = 'ready';
    emitLlmStatus();
    return;
  }

  const model = process.env.SUSURA_LLM_MODEL
    ?? process.env.SUSURA_BENCH_LLM_MODEL
    ?? 'openai-codex/gpt-5.4-mini';
  const thinking = process.env.SUSURA_LLM_THINKING
    ?? process.env.SUSURA_BENCH_LLM_THINKING
    ?? 'off';

  if (!allowedLlmModels.has(model) || !allowedLlmThinking.has(thinking)) {
    llmWarmStatus = 'ready';
    emitLlmStatus();
    return;
  }

  llmWarmStatus = 'warming';
  emitLlmStatus();

  if (!persistentPiRpcBridge) {
    persistentPiRpcBridge = new PersistentPiRpcBridge({ model, thinking });
  }

  const warmupStrategy = process.env.SUSURA_LLM_WARMUP_STRATEGY ?? 'hidden-prompt';
  const warmupPrompt = process.env.SUSURA_LLM_WARMUP_PROMPT ?? 'Reply with OK.';
  const warmupCount = Math.max(1, Number(process.env.SUSURA_LLM_WARMUP_COUNT ?? 1));
  const warmupTimeoutMs = Math.max(1_000, Number(process.env.SUSURA_LLM_WARMUP_TIMEOUT_MS ?? 8_000));
  const warmup = warmupStrategy === 'session-only'
    ? persistentPiRpcBridge.start()
      .then(() => persistentPiRpcBridge?.newSession())
    : runPersistentWarmupPrompts(persistentPiRpcBridge, warmupPrompt, warmupCount);

  let warmupSettled = false;
  const warmupTimeout = setTimeout(() => {
    if (warmupSettled || llmWarmStatus !== 'warming') {
      return;
    }

    llmWarmStatus = 'error';
    persistentPiRpcBridge?.dispose();
    persistentPiRpcBridge = null;
    emitLlmStatus();
  }, warmupTimeoutMs);

  warmup
    .then(() => {
      if (process.env.SUSURA_LLM_PREWARM_BACKUP !== '1') {
        return undefined;
      }

      backupPersistentPiRpcBridge?.dispose();
      backupPersistentPiRpcBridge = new PersistentPiRpcBridge({ model, thinking });

      return runPersistentWarmupPrompts(backupPersistentPiRpcBridge, warmupPrompt, warmupCount);
    })
    .then(() => {
      warmupSettled = true;
      clearTimeout(warmupTimeout);
      llmWarmStatus = 'ready';
      emitLlmStatus();
    })
    .catch((error) => {
      warmupSettled = true;
      clearTimeout(warmupTimeout);
      llmWarmStatus = 'error';
      persistentPiRpcBridge?.dispose();
      persistentPiRpcBridge = null;
      emitLlmStatus();

      console.error(`susura-pi-rpc-warm-failed ${error.message}`);
    });
}

function runPersistentWarmupPrompts(bridge, prompt, count) {
  let chain = Promise.resolve();

  for (let index = 0; index < count; index += 1) {
    chain = chain
      .then(() => bridge.request(prompt, () => undefined))
      .then(() => bridge.newSession());
  }

  return chain;
}

function runOneShotPiTextRequest(transcript, { attachments = [], model, thinking }, onDelta = () => {}, runStartedAt = Date.now()) {
  return new Promise((resolve, reject) => {
    if (rendererRealLlmSmoke) {
      console.log(`susura-llm-timing ${JSON.stringify({
        event: 'pi_child_spawn_start',
        atMs: Date.now() - runStartedAt
      })}`);
    }

    const attachmentArgs = attachments.map((attachment) => `@${attachment.path}`);
    const child = spawn('python3', [
      getBundledScriptPath('run-pi-json.py'),
      '--mode', 'json',
      '--print',
      '--no-session',
      '--no-tools',
      '--no-context-files',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--system-prompt', '',
      '--model', model,
      '--thinking', thinking,
      ...attachmentArgs,
      transcript
    ], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const startedAt = Date.now();
    if (rendererRealLlmSmoke) {
      console.log(`susura-llm-timing ${JSON.stringify({
        event: 'pi_child_spawned',
        atMs: Date.now() - runStartedAt,
        pid: child.pid
      })}`);
    }
    const output = [];
    const errors = [];
    const lines = readline.createInterface({ input: child.stdout });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      lines.close();
      reject(new Error('Pi request timed out.'));
    }, getLlmOneShotTimeoutMs());

    lines.on('line', (line) => {
      if (rendererRealLlmSmoke) {
        console.log(`susura-pi-stdout ${Date.now() - startedAt} ${line.slice(0, 160)}`);
      }

      const timingEvent = piTimingEvent(line);

      if (rendererRealLlmSmoke && timingEvent) {
        console.log(`susura-llm-timing ${JSON.stringify({
          event: timingEvent,
          atMs: Date.now() - runStartedAt
        })}`);
      }

      const delta = piTextDelta(line);

      if (delta) {
        output.push(delta);
        onDelta(delta);
      }
    });

    child.stderr.on('data', (chunk) => {
      if (rendererRealLlmSmoke) {
        console.error(`susura-pi-stderr ${Date.now() - startedAt} ${chunk.toString()}`);
      }

      errors.push(chunk.toString());
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (rendererRealLlmSmoke) {
        console.error(`susura-pi-error ${Date.now() - startedAt} ${error.message}`);
      }

      reject(error);
    });
    child.once('exit', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (rendererRealLlmSmoke) {
        console.log(`susura-pi-exit ${Date.now() - startedAt} ${code}`);
      }

      lines.close();

      if (code === 0) {
        resolve(output.join('').trim() || 'No response returned.');
        return;
      }

      reject(new Error(errors.join('').trim() || `Pi request exited with code ${code}.`));
    });
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timeout = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
}

function getLlmPersistentTimeoutMs() {
  return Math.max(1_000, Number(process.env.SUSURA_LLM_PERSISTENT_TIMEOUT_MS ?? 15_000));
}

function getLlmOneShotTimeoutMs() {
  return Math.max(1_000, Number(process.env.SUSURA_LLM_ONE_SHOT_TIMEOUT_MS ?? 45_000));
}

function piTextDelta(line) {
  try {
    const value = JSON.parse(line);
    const event = value.assistantMessageEvent;

    if (event?.type === 'text_delta') {
      return String(event.delta ?? event.text ?? event.content ?? '');
    }
  } catch {
    return '';
  }

  return '';
}

function piTimingEvent(line) {
  try {
    const value = JSON.parse(line);

    if (value.type === 'session') {
      return 'pi_session';
    }

    if (value.type === 'message_start' && value.message?.role === 'assistant') {
      return 'pi_assistant_message_start';
    }

    if (value.type === 'message_update') {
      const type = value.assistantMessageEvent?.type;

      if (type === 'text_start') {
        return 'pi_text_start';
      }

      if (type === 'text_delta') {
        return 'pi_text_delta';
      }
    }

    if (value.type === 'message_end' && value.message?.role === 'assistant') {
      return 'pi_assistant_message_end';
    }
  } catch {
    return null;
  }

  return null;
}

function handleLocalParakeetDaemonStdout(chunk) {
  localParakeetDaemonStdout += chunk.toString();

  let newlineIndex = localParakeetDaemonStdout.indexOf('\n');

  while (newlineIndex >= 0) {
    const line = localParakeetDaemonStdout.slice(0, newlineIndex).trim();
    localParakeetDaemonStdout = localParakeetDaemonStdout.slice(newlineIndex + 1);

    if (line) {
      try {
        handleSystemAudioHelperEvent(JSON.parse(line));
      } catch {
        emitTranscriptionEvent({
          type: 'error',
          message: 'Local Parakeet helper returned an unreadable event.'
        });
      }
    }

    newlineIndex = localParakeetDaemonStdout.indexOf('\n');
  }
}


function handleSystemAudioHelperEvent(event) {
  if (systemAudioSmoke) {
    if (event.type === 'system_level') {
      systemAudioSmoke.levelEvents += 1;
      systemAudioSmoke.maxLevel = Math.max(systemAudioSmoke.maxLevel, Number(event.level ?? 0));
      systemAudioSmoke.maxDecibels = Math.max(systemAudioSmoke.maxDecibels, Number(event.decibels ?? -120));
    }

    if (event.type === 'audio_frame') {
      systemAudioSmoke.audioFrames += 1;
    }

    if (event.type === 'capture_started') {
      systemAudioSmoke.started = true;
    }

    if (event.type === 'capture_stage') {
      systemAudioSmoke.stages.push(event.message ?? event.type);
    }

    if (event.type === 'permission_error' || event.type === 'capture_error') {
      systemAudioSmoke.errors.push(event.message ?? event.type);
    }
  }

  if (event.type === 'transcription_completed' && event.text) {
    emitTranscriptionEvent({
      type: 'completed',
      source: event.source,
      utteranceId: event.utterance_id,
      startMs: event.start_ms,
      endMs: event.end_ms,
      text: event.text
    });
    return;
  }

  if (event.type === 'transcription_partial' && event.text) {
    emitTranscriptionEvent({
      type: 'partial',
      source: event.source,
      utteranceId: event.utterance_id,
      startMs: event.start_ms,
      endMs: event.end_ms,
      text: event.text
    });
    return;
  }

  if (event.type === 'speech_started') {
    emitTranscriptionEvent({ type: 'speech-started' });
    return;
  }

  if (event.type === 'speech_stopped') {
    emitTranscriptionEvent({ type: 'speech-stopped' });
    return;
  }

  if (event.type === 'capture_started') {
    emitTranscriptionEvent({
      type: 'stage',
      message: 'Core Audio capture started'
    });
    return;
  }

  if (event.type === 'capture_stage' && event.message) {
    emitTranscriptionEvent({
      type: 'stage',
      message: event.message
    });
    return;
  }

  if (event.type === 'permission_error' || event.type === 'capture_error') {
    emitTranscriptionEvent({
      type: 'error',
      message: event.message ?? 'System audio capture failed.'
    });
  }
}

function isIgnorableHelperStderr(message) {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.every((line) => (
    /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|DEBUG)\] \[FluidAudio\./.test(line) ||
    /The file .?manifest\.plist.? couldn.?t be opened because there is no such file\./.test(line)
  ));
}

function startSystemAudioCapture() {
  if (process.platform !== 'darwin') {
    throw new Error('System audio capture is currently macOS-only.');
  }

  if (systemAudioProcess) {
    return { ok: true };
  }

  const helper = getSystemAudioHelperCommand();
  const child = spawn(helper.command, helper.args, {
    cwd: getProjectRoot(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  systemAudioProcess = child;
  systemAudioStdout = '';

  if (systemAudioSmoke) {
    systemAudioSmoke.helper = [helper.command, ...helper.args].join(' ');
    systemAudioSmoke.pid = child.pid;
  }

  child.stdout.on('data', handleSystemAudioStdout);

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();

    if (message) {
      if (isIgnorableHelperStderr(message)) {
        return;
      }

      if (systemAudioSmoke) {
        systemAudioSmoke.errors.push(message);
      }

      emitTranscriptionEvent({
        type: 'error',
        message
      });
    }
  });

  child.once('error', (error) => {
    if (systemAudioSmoke) {
      systemAudioSmoke.errors.push(`helper spawn error: ${error.message}`);
    }

    if (systemAudioProcess === child) {
      systemAudioProcess = null;
      emitTranscriptionEvent({
        type: 'error',
        message: error.message
      });
    }
  });

  child.once('exit', (code, signal) => {
    if (systemAudioSmoke) {
      systemAudioSmoke.exit = { code, signal };
    }

    if (systemAudioProcess === child) {
      systemAudioProcess = null;

      if (code && code !== 0) {
        const message = `System audio helper exited with code ${code}${signal ? ` (${signal})` : ''}.`;

        if (systemAudioSmoke) {
          systemAudioSmoke.errors.push(message);
        }

        emitTranscriptionEvent({
          type: 'error',
          message
        });
      }
    }
  });

  return { ok: true };
}

function handleSystemAudioStdout(chunk) {
  systemAudioStdout += chunk.toString();

  let newlineIndex = systemAudioStdout.indexOf('\n');

  while (newlineIndex >= 0) {
    const line = systemAudioStdout.slice(0, newlineIndex).trim();
    systemAudioStdout = systemAudioStdout.slice(newlineIndex + 1);

    if (line) {
      try {
        handleSystemAudioHelperEvent(JSON.parse(line));
      } catch {
        emitTranscriptionEvent({
          type: 'error',
          message: 'System audio helper returned an unreadable event.'
        });
      }
    }

    newlineIndex = systemAudioStdout.indexOf('\n');
  }
}

function loadRendererSurface(window, surface) {
  if (isDev) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);

    if (surface) {
      url.searchParams.set('susura-surface', surface);
    }

    window.loadURL(url.toString());
    return;
  }

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
    ...(surface ? { query: { 'susura-surface': surface } } : {})
  });
}

function applyPrivateWindowProtection(window) {
  window.setSkipTaskbar(true);

  try {
    window.setContentProtection(true);
  } catch {
    // Unsupported platforms should still keep the overlay usable.
  }

  if (typeof window.setHiddenInMissionControl === 'function') {
    try {
      window.setHiddenInMissionControl(true);
    } catch {
      // Mission Control hiding is best-effort across Electron versions.
    }
  }

  try {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // Best-effort on non-macOS platforms.
  }

  try {
    window.setAlwaysOnTop(true, 'floating');
  } catch {
    window.setAlwaysOnTop(true);
  }
}

function createPrivateOverlayWindow() {
  if (privateOverlayWindow && !privateOverlayWindow.isDestroyed()) {
    return privateOverlayWindow;
  }

  const state = readPrivateOverlayState();
  privateOverlayWindow = new BrowserWindow({
    x: state.overlay.x,
    y: state.overlay.y,
    width: state.overlay.width,
    height: state.overlay.height,
    minWidth: minimumWindowSize.width,
    minHeight: minimumWindowSize.height,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Susura',
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      devTools: isDev,
      nodeIntegration: false,
      spellcheck: false,
      sandbox: false
    }
  });

  applyPrivateWindowProtection(privateOverlayWindow);
  persistPrivateOverlayWindowState(privateOverlayWindow);
  loadRendererSurface(privateOverlayWindow, null);

  privateOverlayWindow.on('closed', () => {
    if (mainWindow === privateOverlayWindow) {
      mainWindow = null;
    }

    privateOverlayWindow = null;

    if (!isQuitting) {
      createPrivateOverlayHandleWindow();
    }
  });

  return privateOverlayWindow;
}

function createPrivateOverlayHandleWindow() {
  if (privateOverlayHandleWindow && !privateOverlayHandleWindow.isDestroyed()) {
    return privateOverlayHandleWindow;
  }

  const state = readPrivateOverlayState();
  privateOverlayHandleWindow = new BrowserWindow({
    x: state.handle.x,
    y: state.handle.y,
    width: handleWindowSize.width,
    height: handleWindowSize.height,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Susura Overlay Handle',
    skipTaskbar: true,
    resizable: false,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      devTools: isDev,
      nodeIntegration: false,
      spellcheck: false,
      sandbox: false
    }
  });

  applyPrivateWindowProtection(privateOverlayHandleWindow);
  privateOverlayHandleWindow.setOpacity(state.handle.opacity);
  persistPrivateOverlayHandleState(privateOverlayHandleWindow);
  loadRendererSurface(privateOverlayHandleWindow, 'handle');

  privateOverlayHandleWindow.on('closed', () => {
    privateOverlayHandleWindow = null;
  });

  privateOverlayHandleWindow.once('ready-to-show', () => showPrivateOverlayHandleWindow());

  return privateOverlayHandleWindow;
}

function persistPrivateOverlayWindowState(window) {
  let saveTimer = null;

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (window.isDestroyed()) {
        return;
      }

      const bounds = window.getBounds();
      const [width, height] = window.getContentSize();
      const anchoredBounds = window.isVisible()
        ? getAnchoredOverlayBounds({ height, width })
        : bounds;

      if (
        window.isVisible()
        && (
          bounds.x !== anchoredBounds.x
          || bounds.y !== anchoredBounds.y
          || bounds.width !== anchoredBounds.width
          || bounds.height !== anchoredBounds.height
        )
      ) {
        window.setBounds(anchoredBounds);
      }

      updatePrivateOverlayState((state) => ({
        ...state,
        overlay: {
          ...state.overlay,
          height: anchoredBounds.height,
          visible: window.isVisible(),
          width: anchoredBounds.width,
          x: anchoredBounds.x,
          y: anchoredBounds.y
        }
      }));
      broadcastPrivateOverlayState();
    }, 250);
  };

  window.on('resize', scheduleSave);
  window.on('show', scheduleSave);
  window.on('hide', scheduleSave);
  window.on('close', () => {
    clearTimeout(saveTimer);
  });
}

function persistPrivateOverlayHandleState(window) {
  let saveTimer = null;

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (window.isDestroyed()) {
        return;
      }

      const bounds = window.getBounds();
      updatePrivateOverlayState((state) => ({
        ...state,
        handle: {
          ...state.handle,
          visible: window.isVisible(),
          x: bounds.x,
          y: bounds.y
        }
      }));
      broadcastPrivateOverlayState();
    }, 250);
  };

  window.on('show', scheduleSave);
  window.on('hide', scheduleSave);
  window.on('close', () => {
    clearTimeout(saveTimer);
  });
}

function broadcastPrivateOverlayState() {
  const status = getPrivateOverlayStatus();

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('susura:private-overlay-state', status);
    }
  });
}

function showPrivateOverlayWindow() {
  const window = createPrivateOverlayWindow();
  const bounds = getAnchoredOverlayBounds();

  updatePrivateOverlayState((current) => ({
    ...current,
    overlay: {
      ...current.overlay,
      height: bounds.height,
      visible: true,
      width: bounds.width,
      x: bounds.x,
      y: bounds.y
    }
  }));

  window.setBounds(bounds);
  window.setIgnoreMouseEvents(false);
  window.show();
  window.focus();
  applyPrivateWindowProtection(window);
  broadcastPrivateOverlayState();
}

function hidePrivateOverlayWindow() {
  const window = privateOverlayWindow;

  updatePrivateOverlayState((state) => ({
    ...state,
    overlay: {
      ...state.overlay,
      visible: false
    }
  }));

  if (window && !window.isDestroyed()) {
    window.hide();
  }

  broadcastPrivateOverlayState();
}

function togglePrivateOverlayWindow() {
  const window = createPrivateOverlayWindow();

  if (window.isVisible()) {
    hidePrivateOverlayWindow();
  } else {
    showPrivateOverlayWindow();
  }
}

function showPrivateOverlayHandleWindow() {
  const window = createPrivateOverlayHandleWindow();
  const bounds = normaliseHandleBounds(window.getBounds());
  const state = updatePrivateOverlayState((current) => ({
    ...current,
    handle: {
      ...current.handle,
      visible: true,
      x: bounds.x,
      y: bounds.y
    }
  }));

  window.setBounds(bounds);
  window.setOpacity(state.handle.opacity);
  window.showInactive();
  applyPrivateWindowProtection(window);
  broadcastPrivateOverlayState();
}

function setPrivateOverlayClickThrough(enabled) {
  const state = updatePrivateOverlayState((current) => ({
    ...current,
    clickThrough: Boolean(enabled)
  }));

  broadcastPrivateOverlayState();
  return getPrivateOverlayStatus();
}

function panicHidePrivateOverlay() {
  hidePrivateOverlayWindow();
  showPrivateOverlayHandleWindow();
}

function showPrivateOverlayHandleMenu(sender) {
  const window = (privateOverlayHandleWindow && !privateOverlayHandleWindow.isDestroyed())
    ? privateOverlayHandleWindow
    : BrowserWindow.fromWebContents(sender);
  const status = getPrivateOverlayStatus();
  const menu = Menu.buildFromTemplate([
    {
      label: status.overlayWindowVisible ? 'Hide Susura' : 'Open Susura',
      click: () => {
        if (status.overlayWindowVisible) {
          hidePrivateOverlayWindow();
        } else {
          showMainWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Susura',
      click: () => {
        app.quit();
      }
    }
  ]);

  menu.popup({ window });
  return status;
}

function showMainWindow() {
  showPrivateOverlayWindow();
}

function resetPrivateOverlayHandlePosition() {
  const state = normalisePrivateOverlayState({
    ...readPrivateOverlayState(),
    handle: {
      visible: true
    }
  });

  writePrivateOverlayState(({
    ...readPrivateOverlayState(),
    handle: state.handle
  }));

  if (privateOverlayHandleWindow && !privateOverlayHandleWindow.isDestroyed()) {
    privateOverlayHandleWindow.setPosition(state.handle.x, state.handle.y);
    privateOverlayHandleWindow.setOpacity(state.handle.opacity);
  }

  showPrivateOverlayHandleWindow();
  return getPrivateOverlayStatus();
}

function normaliseHandleDragPoint(request) {
  return {
    screenX: Number(request?.screenX),
    screenY: Number(request?.screenY)
  };
}

function getVisibleOverlayContentSize() {
  return privateOverlayWindow && !privateOverlayWindow.isDestroyed()
    ? {
      height: privateOverlayWindow.getContentSize()[1],
      width: privateOverlayWindow.getContentSize()[0]
    }
    : {};
}

function cancelPrivateOverlayHandleSnapAnimation() {
  if (!privateOverlayHandleSnapAnimation) {
    return;
  }

  const animation = privateOverlayHandleSnapAnimation;
  privateOverlayHandleSnapAnimation = null;
  clearTimeout(animation.timer);
  animation.resolve(getPrivateOverlayStatus());
}

function easeInOutCubic(progress) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function animatePrivateOverlayHandleToBounds(targetBounds, { durationMs = handleSnapAnimationDurationMs } = {}) {
  const window = privateOverlayHandleWindow;

  cancelPrivateOverlayHandleSnapAnimation();

  if (!window || window.isDestroyed()) {
    return Promise.resolve(getPrivateOverlayStatus());
  }

  const startBounds = window.getBounds();
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const animation = {
      resolve,
      timer: null
    };

    const step = () => {
      if (privateOverlayHandleSnapAnimation !== animation) {
        resolve(getPrivateOverlayStatus());
        return;
      }

      if (window.isDestroyed()) {
        privateOverlayHandleSnapAnimation = null;
        resolve(getPrivateOverlayStatus());
        return;
      }

      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      const eased = easeInOutCubic(progress);
      const nextBounds = {
        height: targetBounds.height,
        width: targetBounds.width,
        x: Math.round(startBounds.x + ((targetBounds.x - startBounds.x) * eased)),
        y: Math.round(startBounds.y + ((targetBounds.y - startBounds.y) * eased))
      };

      window.setBounds(nextBounds);
      positionVisibleOverlayFromHandle(getVisibleOverlayContentSize(), { persist: false });

      if (progress < 1) {
        animation.timer = setTimeout(step, 1000 / 60);
        return;
      }

      privateOverlayHandleSnapAnimation = null;
      window.setBounds(targetBounds);
      resolve(getPrivateOverlayStatus());
    };

    privateOverlayHandleSnapAnimation = animation;
    step();
  });
}

function getHandleDragBounds(request) {
  const point = normaliseHandleDragPoint(request);

  if (!privateOverlayHandleDrag || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) {
    return null;
  }

  return {
    height: handleWindowSize.height,
    width: handleWindowSize.width,
    x: Math.round(point.screenX - privateOverlayHandleDrag.offsetX),
    y: Math.round(point.screenY - privateOverlayHandleDrag.offsetY)
  };
}

function startPrivateOverlayHandleDrag(request) {
  if (!privateOverlayHandleWindow || privateOverlayHandleWindow.isDestroyed()) {
    return getPrivateOverlayStatus();
  }

  cancelPrivateOverlayHandleSnapAnimation();

  const point = normaliseHandleDragPoint(request);

  if (!Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) {
    return getPrivateOverlayStatus();
  }

  const bounds = privateOverlayHandleWindow.getBounds();

  privateOverlayHandleDrag = {
    liveSnapKey: null,
    offsetX: point.screenX - bounds.x,
    offsetY: point.screenY - bounds.y
  };

  return getPrivateOverlayStatus();
}

function movePrivateOverlayHandleDrag(request) {
  if (!privateOverlayHandleWindow || privateOverlayHandleWindow.isDestroyed()) {
    return getPrivateOverlayStatus();
  }

  const dragBounds = getHandleDragBounds(request);

  if (!dragBounds) {
    return getPrivateOverlayStatus();
  }

  const liveSnap = getLiveHandleSnapBounds(dragBounds);

  if (liveSnap) {
    if (privateOverlayHandleDrag.liveSnapKey !== liveSnap.key) {
      privateOverlayHandleDrag.liveSnapKey = liveSnap.key;
      return animatePrivateOverlayHandleToBounds(liveSnap.bounds, {
        durationMs: handleSnapPreviewAnimationDurationMs
      });
    }

    positionVisibleOverlayFromHandle(getVisibleOverlayContentSize(), { persist: false });
    return getPrivateOverlayStatus();
  }

  privateOverlayHandleDrag.liveSnapKey = null;
  cancelPrivateOverlayHandleSnapAnimation();

  const nextHandleBounds = clampHandleBoundsToDisplay(dragBounds);

  privateOverlayHandleWindow.setBounds(nextHandleBounds);
  positionVisibleOverlayFromHandle(getVisibleOverlayContentSize(), { persist: false });
  broadcastPrivateOverlayState();
  return getPrivateOverlayStatus();
}

function endPrivateOverlayHandleDrag(request) {
  if (!privateOverlayHandleWindow || privateOverlayHandleWindow.isDestroyed()) {
    privateOverlayHandleDrag = null;
    return getPrivateOverlayStatus();
  }

  const dragBounds = getHandleDragBounds(request) ?? privateOverlayHandleWindow.getBounds();
  const snappedBounds = magnetiseHandleBoundsToNearestEdge(dragBounds);

  privateOverlayHandleDrag = null;
  return animatePrivateOverlayHandleToBounds(snappedBounds).then(() => {
    if (!privateOverlayHandleWindow || privateOverlayHandleWindow.isDestroyed()) {
      return getPrivateOverlayStatus();
    }

    updatePrivateOverlayState((state) => ({
      ...state,
      handle: {
        ...state.handle,
        visible: privateOverlayHandleWindow.isVisible(),
        x: snappedBounds.x,
        y: snappedBounds.y
      }
    }));
    positionVisibleOverlayFromHandle(getVisibleOverlayContentSize());
    broadcastPrivateOverlayState();
    return getPrivateOverlayStatus();
  });
}

function normaliseOverlayDragPoint(request) {
  return {
    screenX: Number(request?.screenX),
    screenY: Number(request?.screenY)
  };
}

function getOverlayDragBounds(request) {
  const point = normaliseOverlayDragPoint(request);

  if (!privateOverlayWindowDrag || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) {
    return null;
  }

  return {
    height: privateOverlayWindowDrag.height,
    width: privateOverlayWindowDrag.width,
    x: Math.round(point.screenX - privateOverlayWindowDrag.offsetX),
    y: Math.round(point.screenY - privateOverlayWindowDrag.offsetY)
  };
}

function startPrivateOverlayWindowDrag(request) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    return getPrivateOverlayStatus();
  }

  const point = normaliseOverlayDragPoint(request);

  if (!Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) {
    return getPrivateOverlayStatus();
  }

  const bounds = privateOverlayWindow.getBounds();

  privateOverlayWindowDrag = {
    height: bounds.height,
    offsetX: point.screenX - bounds.x,
    offsetY: point.screenY - bounds.y,
    width: bounds.width
  };

  return getPrivateOverlayStatus();
}

function movePrivateOverlayWindowDrag(request) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    return getPrivateOverlayStatus();
  }

  const dragBounds = getOverlayDragBounds(request);

  if (!dragBounds) {
    return getPrivateOverlayStatus();
  }

  const overlayBounds = clampOverlayBoundsToDisplay(dragBounds);
  const handleBounds = getHandleBoundsForOverlayBounds(overlayBounds);

  privateOverlayWindow.setBounds(overlayBounds);
  setPrivateOverlayHandleBounds(handleBounds, { persist: false });
  broadcastPrivateOverlayState();
  return getPrivateOverlayStatus();
}

function endPrivateOverlayWindowDrag(request) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    privateOverlayWindowDrag = null;
    return getPrivateOverlayStatus();
  }

  const dragBounds = getOverlayDragBounds(request) ?? privateOverlayWindow.getBounds();
  const overlayBounds = clampOverlayBoundsToDisplay(dragBounds);
  const snappedHandleBounds = getHandleBoundsForOverlayBounds(overlayBounds, { snap: true });

  privateOverlayWindowDrag = null;
  setPrivateOverlayHandleBounds(snappedHandleBounds);
  const anchoredBounds = getAnchoredOverlayBounds({
    height: overlayBounds.height,
    width: overlayBounds.width
  });

  privateOverlayWindow.setBounds(anchoredBounds);
  updatePrivateOverlayState((state) => ({
    ...state,
    overlay: {
      ...state.overlay,
      height: anchoredBounds.height,
      visible: privateOverlayWindow.isVisible(),
      width: anchoredBounds.width,
      x: anchoredBounds.x,
      y: anchoredBounds.y
    }
  }));
  broadcastPrivateOverlayState();
  return getPrivateOverlayStatus();
}

function applyMacPrivateActivationPolicy() {
  if (process.platform !== 'darwin') {
    return;
  }

  const state = readPrivateOverlayState();

  if (!state.privateMode) {
    return;
  }

  try {
    app.setActivationPolicy('accessory');
  } catch {
    // Older Electron builds may not expose activation policy in all contexts.
  }

  try {
    app.dock?.hide();
  } catch {
    // Dock hiding is best-effort in development.
  }

  Menu.setApplicationMenu(null);
}

function registerPrivateOverlayShortcuts() {
  const shortcuts = [
    ['CommandOrControl+\\', togglePrivateOverlayWindow],
    ['CommandOrControl+Shift+\\', showMainWindow],
    ['CommandOrControl+Alt+\\', panicHidePrivateOverlay]
  ];

  for (const [accelerator, handler] of shortcuts) {
    try {
      globalShortcut.register(accelerator, handler);
    } catch {
      // Shortcut collisions should not prevent launch.
    }
  }
}

function shouldOpenFullAppOverlayOnLaunch() {
  return smokeExitMs > 0
    || systemAudioSmokeMs > 0
    || localParakeetSmokeMs > 0
    || rendererTranscriptionSmokeMs > 0
    || rendererLlmSmoke
    || rendererRealLlmSmoke;
}

function createWindow() {
  mainWindow = createPrivateOverlayWindow();

  if (transcriptDebugLogEnabled) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      if (message.startsWith('susura-renderer-transcript-debug ')) {
        writeTranscriptDebugLog('renderer.console', {
          message: message.replace(/^susura-renderer-transcript-debug /, '')
        });
      }
    });
  }

  if (smokeExitMs > 0) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const waitForRenderer = async () => {
              for (let index = 0; index < 60; index += 1) {
                const setup = document.querySelector('[aria-label="Susura setup"]');
                const homeLayout = document.querySelector('[aria-label="Home layout"]');
                const transcript = document.querySelector('[aria-label="Transcription output"]');
                const aiResponse = document.querySelector('[aria-label="AI response"]');

                if (setup && homeLayout && transcript && aiResponse) {
                  return true;
                }

                await new Promise((resolve) => setTimeout(resolve, 50));
              }

              return false;
            };
            const runtime = await window.susura.getRuntimeContext();
            const started = await window.susura.capture.start();
            const paused = await window.susura.capture.pause();
            const stopped = await window.susura.capture.stop();
            const rendererMounted = await waitForRenderer();
            const transcript = document.querySelector('[aria-label="Transcription output"]');
            const documentElement = document.documentElement;
            const body = document.body;
            const hasOuterScroll =
              documentElement.scrollHeight > window.innerHeight ||
              body.scrollHeight > window.innerHeight;
            return {
              runtime,
              states: [started.state, paused.state, stopped.state],
              rendererVisible: rendererMounted && Boolean(transcript),
              hasOuterScroll,
              hasCredentialBridge: Object.prototype.hasOwnProperty.call(window.susura ?? {}, 'api' + 'Key'),
              contentSize: ${JSON.stringify(mainWindow.getContentSize())},
              minimumSize: ${JSON.stringify(mainWindow.getMinimumSize())},
              maximumSize: ${JSON.stringify(mainWindow.getMaximumSize())},
              resizable: ${JSON.stringify(mainWindow.isResizable())},
              maximizable: ${JSON.stringify(mainWindow.isMaximizable())},
              fullscreenable: ${JSON.stringify(mainWindow.isFullScreenable())}
            };
          })()
        `);

        console.log(`susura-electron-smoke ${JSON.stringify(result)}`);

        if (
          !result.rendererVisible ||
          result.hasOuterScroll ||
          result.hasCredentialBridge ||
          !result.resizable ||
          result.maximizable ||
          result.fullscreenable
        ) {
          app.exitCode = 1;
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(`susura-electron-smoke failed ${error.message}`);
        app.exitCode = 1;
        process.exitCode = 1;
      } finally {
        setTimeout(() => {
          if (app.exitCode) {
            app.exit(app.exitCode);
            return;
          }

          app.exit(0);
        }, smokeExitMs);
        setTimeout(() => {
          process.exit(app.exitCode || process.exitCode || 0);
        }, smokeExitMs + 1_000).unref();
      }
    });
  }

  if (systemAudioSmokeMs > 0) {
    mainWindow.webContents.once('did-finish-load', async () => {
      systemAudioSmoke = {
        started: false,
        levelEvents: 0,
        maxLevel: 0,
        maxDecibels: -120,
        audioFrames: 0,
        errors: [],
        stages: [],
        exit: null,
        helper: null,
        pid: null,
        stoppedBySmoke: false
      };

      try {
        startSystemAudioCapture();
        await new Promise((resolve) => setTimeout(resolve, systemAudioSmokeMs));
      } catch (error) {
        systemAudioSmoke.errors.push(error.message);
      } finally {
        stopSystemAudioCapture();
        const maxRms = Math.pow(10, systemAudioSmoke.maxDecibels / 20);
        const result = {
          started: systemAudioSmoke.started,
          samples: systemAudioSmoke.audioFrames,
          levelEvents: systemAudioSmoke.levelEvents,
          maxLevel: systemAudioSmoke.maxLevel,
          maxDecibels: systemAudioSmoke.maxDecibels,
          maxRms,
          detected: systemAudioSmoke.maxLevel > 1,
          stages: systemAudioSmoke.stages,
          errors: systemAudioSmoke.errors,
          exit: systemAudioSmoke.exit,
          helper: systemAudioSmoke.helper,
          pid: systemAudioSmoke.pid,
          stoppedBySmoke: systemAudioSmoke.stoppedBySmoke
        };

        console.log(`susura-system-audio-smoke ${JSON.stringify(result)}`);
        systemAudioSmoke = null;
        app.quit();
      }
    });
  }

  if (localParakeetSmokeMs > 0) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const events = [];
            const unsubscribe = window.susura.transcription.onEvent((event) => {
              events.push(event);
            });

            await window.susura.transcription.start({ sources: ['system'] });
            await new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(localParakeetSmokeMs)}));
            await window.susura.transcription.stop();
            unsubscribe();

            const completed = events
              .filter((event) => event.type === 'completed' && event.text)
              .map((event) => event.text);
            const completedEvents = events
              .filter((event) => event.type === 'completed' && event.text)
              .map((event) => ({
                utteranceId: event.utteranceId,
                startMs: event.startMs,
                endMs: event.endMs,
                text: event.text
              }));
            const partial = events
              .filter((event) => event.type === 'partial' && event.text)
              .map((event) => event.text);
            const errors = events
              .filter((event) => event.type === 'error')
              .map((event) => event.message);
            const stages = events
              .filter((event) => event.type === 'stage')
              .map((event) => event.message);
            const metrics = events
              .filter((event) => event.type === 'metric');

            return {
              completed,
              completedEvents,
              completedCount: completed.length,
              partialCount: partial.length,
              detected: completed.length > 0,
              errors,
              stages,
              metrics
            };
          })()
        `);

        console.log(`susura-local-parakeet-smoke ${JSON.stringify(result)}`);

        if (!result.detected || result.errors.length > 0) {
          app.exitCode = 1;
        }
      } catch (error) {
        console.error(`susura-local-parakeet-smoke failed ${error.message}`);
        app.exitCode = 1;
      } finally {
        app.quit();
      }
    });
  }

  if (rendererTranscriptionSmokeMs > 0) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const events = [];
            const snapshots = [];
            const statusPattern = /^(Not listening\\.|Requesting audio access\\.\\.\\.|Starting local Parakeet\\.\\.\\.|Loading local Parakeet\\.\\.\\.|Listening with local Parakeet\\.\\.\\.|Listening\\. Waiting for speech\\.\\.\\.|Speech detected\\.\\.\\.|Transcribing local audio\\.\\.\\.|local Parakeet capture started|local Parakeet loaded|reading default output device|creating Core Audio process tap|creating private aggregate device|reading Core Audio tap format|Core Audio tap format .*|creating aggregate device IO callback|starting aggregate device|Core Audio capture started|starting system audio capture|starting microphone capture|microphone capture started)$/;
            let previousLongest = '';
            let clearCount = 0;
            const unsubscribe = window.susura.transcription.onEvent((event) => {
              events.push(event);
            });

            await new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(rendererRealLlmSmoke ? 1500 : 300)}));

            const output = document.querySelector('[aria-label="Transcription output"]');
            const startButton = Array.from(document.querySelectorAll('button'))
              .find((button) => /start listening/i.test(button.textContent ?? ''));

            if (!output || !startButton) {
              throw new Error('Renderer transcription controls were not found.');
            }

            const startedAt = Date.now();
            const sample = () => {
              const text = (output.textContent ?? '').trim();
              snapshots.push({
                atMs: Date.now() - startedAt,
                text
              });

              if (!text || statusPattern.test(text)) {
                return;
              }

              if (previousLongest && text.length + 20 < previousLongest.length) {
                clearCount += 1;
              }

              if (text.length > previousLongest.length) {
                previousLongest = text;
              }
            };

            sample();
            startButton.click();

            const interval = setInterval(sample, 500);
            await new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(rendererTranscriptionSmokeMs)}));
            clearInterval(interval);
            sample();

            const stopButton = Array.from(document.querySelectorAll('button'))
              .find((button) => /stop listening/i.test(button.textContent ?? ''));

            if (stopButton) {
              stopButton.click();
              await new Promise((resolve) => setTimeout(resolve, 1_500));
              sample();
            }

            unsubscribe();

            const completed = events
              .filter((event) => event.type === 'completed' && event.text)
              .map((event) => event.text);
            const completedEvents = events
              .filter((event) => event.type === 'completed' && event.text)
              .map((event) => ({
                utteranceId: event.utteranceId,
                startMs: event.startMs,
                endMs: event.endMs,
                text: event.text
              }));
            const partial = events
              .filter((event) => event.type === 'partial' && event.text)
              .map((event) => event.text);
            const errors = events
              .filter((event) => event.type === 'error')
              .map((event) => event.message);
            const stages = events
              .filter((event) => event.type === 'stage')
              .map((event) => event.message);
            const metrics = events
              .filter((event) => event.type === 'metric');
            const renderedOutput = (output.textContent ?? '').trim();

            return {
              renderedOutput,
              longestOutput: previousLongest,
              snapshots,
              snapshotCount: snapshots.length,
              clearCount,
              completed,
              completedEvents,
              completedCount: completed.length,
              partialCount: partial.length,
              detected: completed.length > 0 || partial.length > 0 || previousLongest.length > 0,
              errors,
              stages,
              metrics
            };
          })()
        `);

        console.log(`susura-renderer-transcription-smoke ${JSON.stringify(result)}`);

        if (!result.detected || result.errors.length > 0) {
          app.exitCode = 1;
        }
      } catch (error) {
        console.error(`susura-renderer-transcription-smoke failed ${error.message}`);
        app.exitCode = 1;
      } finally {
        app.quit();
      }
    });
  }

  if (rendererLlmSmoke || rendererRealLlmSmoke) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const llmSmokeMode = process.env.SUSURA_LLM_SMOKE_MODE ?? 'stop';
        const speculativeStopDelayMs = Number(process.env.SUSURA_LLM_SPECULATIVE_STOP_DELAY_MS ?? 500);
        const llmSmokeTranscript = process.env.SUSURA_LLM_SMOKE_TRANSCRIPT ?? 'What is the refund policy?';
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const llmSmokeMode = ${JSON.stringify(llmSmokeMode)};
            const speculativeStopDelayMs = ${JSON.stringify(speculativeStopDelayMs)};
            const llmSmokeTranscript = ${JSON.stringify(llmSmokeTranscript)};
            const snapshots = [];
            const response = () => document.querySelector('[aria-label="AI response"]');
            const transcript = () => document.querySelector('[aria-label="Transcription output"]');
            const startButton = () => Array.from(document.querySelectorAll('button'))
              .find((button) => /start listening/i.test(button.textContent ?? ''));
            const stopButton = () => Array.from(document.querySelectorAll('button'))
              .find((button) => /stop listening/i.test(button.textContent ?? ''));

            if (!window.susura?.transcription) {
              throw new Error('Transcription bridge was not found.');
            }

            await new Promise((resolve) => setTimeout(resolve, 300));

            for (let index = 0; index < 200; index += 1) {
              const status = await window.susura.llm.status();

              if (status.ready) {
                break;
              }

              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            startButton()?.click();
            await new Promise((resolve) => setTimeout(resolve, 50));
            await window.susura.smokeEmitTranscriptionEvent({
              type: 'completed',
              utteranceId: 1,
              text: llmSmokeTranscript
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            snapshots.push({ phase: 'transcript', value: transcript()?.value ?? '' });
            let stopClickedAt = performance.now();
            let speculativePromise = null;

            if (llmSmokeMode === 'speculative') {
              speculativePromise = window.susura.transcription.requestLlm({
                model: ${JSON.stringify(process.env.SUSURA_LLM_MODEL ?? 'openai-codex/gpt-5.4-mini')},
                reasoning: ${JSON.stringify(process.env.SUSURA_LLM_THINKING ?? 'off')},
                trace: {
                  requestedAt: Date.now(),
                  speculative: true
                },
                transcript: transcript()?.value ?? ''
              });
              await new Promise((resolve) => setTimeout(resolve, speculativeStopDelayMs));
              stopClickedAt = performance.now();
            } else {
              stopButton()?.click();
            }

            snapshots.push({ phase: 'after-stop', value: response()?.value ?? '' });
            let firstResponseTextAt = null;

            if ((response()?.value ?? '').trim() && (response()?.value ?? '').trim() !== 'No response yet.') {
              firstResponseTextAt = stopClickedAt;
            }

            for (let index = 0; index < 800; index += 1) {
              if (firstResponseTextAt !== null) {
                break;
              }

              await new Promise((resolve) => setTimeout(resolve, 25));
              const value = response()?.value ?? '';

              snapshots.push({
                phase: 'poll',
                atMs: Math.round(performance.now() - stopClickedAt),
                value
              });

              if (value.trim() && value.trim() !== 'No response yet.') {
                firstResponseTextAt = performance.now();
                break;
              }
            }

            await speculativePromise?.catch(() => undefined);
            await new Promise((resolve) => setTimeout(resolve, 500));
            snapshots.push({ phase: 'final', value: response()?.value ?? '' });

            return {
              llmSmokeMode,
              stopToFirstResponseTextMs: firstResponseTextAt === null
                ? null
                : Math.round(firstResponseTextAt - stopClickedAt),
              snapshots,
              streamed: snapshots.some((snapshot) => snapshot.phase === 'poll' && snapshot.value),
              finalValue: response()?.value ?? ''
            };
          })()
        `);

        console.log(`susura-renderer-llm-smoke ${JSON.stringify(result)}`);

        if (!result.streamed || !result.finalValue) {
          process.exitCode = 1;
          app.exitCode = 1;
        }
      } catch (error) {
        console.error(`susura-renderer-llm-smoke failed ${error.message}`);
        process.exitCode = 1;
        app.exitCode = 1;
      } finally {
        app.quit();
      }
    });
  }

  if (resourceSmokeMs > 0) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        const metrics = app.getAppMetrics().map((metric) => ({
          pid: metric.pid,
          type: metric.type,
          cpuPercent: metric.cpu.percentCPUUsage,
          workingSetMb: metric.memory.workingSetSize / 1024,
          privateMb: typeof metric.memory.privateBytes === 'number'
            ? metric.memory.privateBytes / 1024
            : null
        }));
        const totalWorkingSetMb = metrics.reduce((total, metric) => total + metric.workingSetMb, 0);
        const privateMetrics = metrics.filter((metric) => typeof metric.privateMb === 'number');
        const totalPrivateMb = privateMetrics.length > 0
          ? privateMetrics.reduce((total, metric) => total + metric.privateMb, 0)
          : null;
        const result = {
          maxWorkingSetMb: resourceSmokeMaxWorkingSetMb,
          processCount: metrics.length,
          totalWorkingSetMb,
          totalPrivateMb,
          metrics
        };

        console.log(`susura-resource-smoke ${JSON.stringify(result)}`);

        if (totalWorkingSetMb > resourceSmokeMaxWorkingSetMb) {
          app.exitCode = 1;
        }

        app.quit();
      }, resourceSmokeMs);
    });
  }

  return mainWindow;
}

function startResourceSmokeTimer() {
  if (resourceSmokeMs <= 0) {
    return;
  }

  setTimeout(() => {
    const metrics = app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      cpuPercent: metric.cpu.percentCPUUsage,
      workingSetMb: metric.memory.workingSetSize / 1024,
      privateMb: typeof metric.memory.privateBytes === 'number'
        ? metric.memory.privateBytes / 1024
        : null
    }));
    const totalWorkingSetMb = metrics.reduce((total, metric) => total + metric.workingSetMb, 0);
    const privateMetrics = metrics.filter((metric) => typeof metric.privateMb === 'number');
    const totalPrivateMb = privateMetrics.length > 0
      ? privateMetrics.reduce((total, metric) => total + metric.privateMb, 0)
      : null;
    const result = {
      maxWorkingSetMb: resourceSmokeMaxWorkingSetMb,
      processCount: metrics.length,
      totalWorkingSetMb,
      totalPrivateMb,
      metrics
    };

    console.log(`susura-resource-smoke ${JSON.stringify(result)}`);

    if (totalWorkingSetMb > resourceSmokeMaxWorkingSetMb) {
      app.exitCode = 1;
      process.exitCode = 1;
    }

    app.quit();
  }, resourceSmokeMs);
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system';
  applyMacPrivateActivationPolicy();
  if (shouldWarmLocalTranscriptionOnStartup()) {
    startLocalTranscriptionWarmDaemon();
  }
  warmPersistentPiRpcBridge();
  updatePrivateOverlayState((state) => ({
    ...state,
    overlay: {
      ...state.overlay,
      visible: false
    }
  }));
  if (resourceSmokeMs > 0) {
    updatePrivateOverlayState((state) => ({
      ...state,
      handle: {
        ...state.handle,
        visible: true
      }
    }));
  }

  createPrivateOverlayHandleWindow();

  if (shouldOpenFullAppOverlayOnLaunch()) {
    createWindow();
    showPrivateOverlayWindow();
  }

  startResourceSmokeTimer();
  registerPrivateOverlayShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPrivateOverlayHandleWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (localTranscriptionProcess?.stdin?.writable) {
    localTranscriptionProcess.stdin.write(`${JSON.stringify({ type: 'quit' })}\n`);
    localTranscriptionProcess.stdin.end();
  }
  stopSystemAudioCapture();
  stopLocalParakeetDaemon({ force: true });
  persistentPiRpcBridge?.dispose();
  persistentPiRpcBridge = null;
  backupPersistentPiRpcBridge?.dispose();
  backupPersistentPiRpcBridge = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('susura:get-runtime-context', () => ({
  platform: process.platform,
  arch: process.arch,
  isMac: process.platform === 'darwin',
  vmTestingTarget: 'Parallels macOS VM'
}));

ipcMain.handle('susura:private-overlay-status', () => getPrivateOverlayStatus());

ipcMain.handle('susura:private-overlay-toggle', () => {
  togglePrivateOverlayWindow();
  return getPrivateOverlayStatus();
});

ipcMain.handle('susura:private-overlay-hide', () => {
  hidePrivateOverlayWindow();
  return getPrivateOverlayStatus();
});

ipcMain.handle('susura:private-overlay-handle-menu', (event) => showPrivateOverlayHandleMenu(event.sender));

ipcMain.handle('susura:private-overlay-handle-drag-start', (_event, request) => startPrivateOverlayHandleDrag(request));

ipcMain.handle('susura:private-overlay-handle-drag-move', (_event, request) => movePrivateOverlayHandleDrag(request));

ipcMain.handle('susura:private-overlay-handle-drag-end', (_event, request) => endPrivateOverlayHandleDrag(request));

ipcMain.handle('susura:private-overlay-window-drag-start', (_event, request) => startPrivateOverlayWindowDrag(request));

ipcMain.handle('susura:private-overlay-window-drag-move', (_event, request) => movePrivateOverlayWindowDrag(request));

ipcMain.handle('susura:private-overlay-window-drag-end', (_event, request) => endPrivateOverlayWindowDrag(request));

ipcMain.handle('susura:private-overlay-show-main', () => {
  showMainWindow();
  return getPrivateOverlayStatus();
});

ipcMain.handle('susura:private-overlay-panic-hide', () => {
  panicHidePrivateOverlay();
  return getPrivateOverlayStatus();
});

ipcMain.handle('susura:private-overlay-set-click-through', (_event, request) => (
  setPrivateOverlayClickThrough(Boolean(request?.enabled))
));

ipcMain.handle('susura:private-overlay-reset-handle', () => resetPrivateOverlayHandlePosition());

ipcMain.handle('susura:capture-status', () => captureStatus);

ipcMain.handle('susura:permissions-status', () => getPermissionsStatus());

ipcMain.handle('susura:permissions-open', (_event, request) => {
  const permission = typeof request === 'object' && request !== null
    ? request.permission
    : undefined;

  return openPermissionsSettings(permission);
});

ipcMain.handle('susura:permissions-request', (_event, request) => {
  const permission = typeof request === 'object' && request !== null
    ? request.permission
    : undefined;

  return requestPermission(permission);
});

ipcMain.handle('susura:settings-reset', (event) => {
  resetWindowState(BrowserWindow.fromWebContents(event.sender));
  resetPromptTemplates();

  return { ok: true };
});

ipcMain.handle('susura:prompt-templates-list', () => readPromptTemplateState());

ipcMain.handle('susura:prompt-templates-choose-attachments', (event) => (
  choosePromptTemplateAttachments(BrowserWindow.fromWebContents(event.sender))
));

ipcMain.handle('susura:prompt-templates-reset', () => resetPromptTemplates());

ipcMain.handle('susura:prompt-templates-save', (_event, request) => {
  const template = typeof request === 'object' && request !== null
    ? request.template
    : null;

  return savePromptTemplate(template);
});

ipcMain.handle('susura:prompt-templates-delete', (_event, request) => {
  const id = typeof request === 'object' && request !== null && typeof request.id === 'string'
    ? request.id
    : '';

  return deletePromptTemplate(id);
});

ipcMain.handle('susura:prompt-templates-set-selected', (_event, request) => {
  const id = typeof request === 'object' && request !== null && typeof request.id === 'string'
    ? request.id
    : null;

  return setSelectedPromptTemplate(id);
});

ipcMain.handle('susura:capture-start', () => {
  captureStatus.state = 'testing';

  return captureStatus;
});

ipcMain.handle('susura:capture-pause', () => {
  captureStatus.state = 'paused';

  return captureStatus;
});

ipcMain.handle('susura:capture-stop', () => {
  captureStatus.state = 'idle';

  return captureStatus;
});

ipcMain.handle('susura:transcription-start', (_event, request) => new Promise((resolve, reject) => {
  if (rendererLlmSmoke || rendererRealLlmSmoke) {
    localTranscriptionActive = true;
    resolve({ ok: true });
    return;
  }

  const normalisedRequest = typeof request === 'object' && request !== null
    ? request
    : { sources: ['system'] };

  localTranscriptionActive = true;

  try {
    resolve(startLocalTranscriptionCapture(normalisedRequest));
  } catch (error) {
    reject(error);
  }
}));

ipcMain.handle('susura:transcription-prepare', (_event, request) => {
  if (rendererLlmSmoke || rendererRealLlmSmoke) {
    return { ok: true };
  }

  const normalisedRequest = typeof request === 'object' && request !== null
    ? request
    : { sources: ['system'] };

  return prepareLocalTranscriptionCapture(normalisedRequest);
});

ipcMain.handle('susura:transcription-stop', async () => {
  if (rendererLlmSmoke || rendererRealLlmSmoke) {
    localTranscriptionActive = false;
    return { ok: true };
  }

  await stopLocalTranscriptionCapture();
  stopSystemAudioCapture();
  localTranscriptionActive = false;

  return { ok: true };
});

ipcMain.handle('susura:llm-request', async (_event, request) => {
  const transcript = typeof request === 'object' && request !== null
    ? request.transcript
    : '';

  if (rendererLlmSmoke) {
    const requestId = typeof request === 'object' && request !== null && typeof request.requestId === 'string'
      ? request.requestId
      : undefined;

    emitTranscriptionEvent({ type: 'llm-query', requestId, text: transcript });
    await new Promise((resolve) => setTimeout(resolve, 50));
    emitTranscriptionEvent({ type: 'llm-response-delta', requestId, text: 'Refunds ' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    emitTranscriptionEvent({ type: 'llm-response-delta', requestId, text: 'arrive live.' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    emitTranscriptionEvent({ type: 'llm-response', requestId, text: 'Refunds arrive live.' });

    return { ok: true, text: 'Refunds arrive live.' };
  }

  const options = typeof request === 'object' && request !== null
    ? {
      attachments: request.attachments,
      model: request.model,
      requestId: request.requestId,
      reasoning: request.reasoning,
      speculative: request.speculative,
      trace: request.trace
    }
    : {};

  return requestLlmResponse(transcript, options);
});

ipcMain.handle('susura:llm-status', () => ({
  ok: true,
  ready: llmWarmStatus === 'ready',
  status: llmWarmStatus
}));

ipcMain.handle('susura:smoke-emit-transcription-event', (_event, event) => {
  if (!rendererLlmSmoke && !rendererRealLlmSmoke) {
    throw new Error('Smoke event injection is disabled.');
  }

  emitTranscriptionEvent(event);

  return { ok: true };
});

ipcMain.handle('susura:system-audio-start', () => {
  return startSystemAudioCapture();
});

ipcMain.handle('susura:system-audio-stop', () => {
  stopSystemAudioCapture();

  return { ok: true };
});

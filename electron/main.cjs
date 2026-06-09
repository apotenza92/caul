const { app, BrowserWindow, Menu, desktopCapturer, dialog, globalShortcut, ipcMain, nativeTheme, screen, session, shell, systemPreferences } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fsSync = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const {
  getSystemAudioPermissionDeniedState,
  getSystemAudioPermissionGrantedState,
  getSystemAudioPermissionRequestedState,
  getSystemAudioPermissionStatusFromState,
  isSystemAudioPermissionProbeGrantedEvent
} = require('./permissions.cjs');
const { getPreferredOverlaySizeForEdge } = require('./privateOverlayGeometry.cjs');
const { createStopFlushController } = require('./transcriptionStopFlush.cjs');
const { createUpdaterService } = require('./updater.cjs');
const { createHistoryService } = require('./history.cjs');
const { getUsableSelectedLocalAiModelId } = require('./localAiSelection.cjs');
const { createLocalLlmService } = require('./localLlm.cjs');
const { buildLocalLlmPromptWithAttachments, forgetLocalLlmAttachments, preloadLocalLlmAttachments } = require('./llmAttachments.cjs');
const { createProfileService } = require('./profile.cjs');
const {
  buildSystemProfile,
  getCurrentMemoryFit,
  getBenchmarkCacheKey,
  loadBestModelCatalogue,
  recommendFromCatalogue,
  writeLiveModelCatalogue
} = require('./modelRecommendation.cjs');
const { refreshModelCatalogue } = require('./modelCatalogueRefresh.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const smokeExitMs = Number(process.env.CAUL_SMOKE_EXIT_MS ?? 0);
const systemAudioSmokeMs = Number(process.env.CAUL_SYSTEM_AUDIO_SMOKE_MS ?? 0);
const localParakeetSmokeMs = Number(process.env.CAUL_LOCAL_PARAKEET_SMOKE_MS ?? 0);
const rendererTranscriptionSmokeMs = Number(process.env.CAUL_RENDERER_TRANSCRIPTION_SMOKE_MS ?? 0);
const rendererTranscriptionSmokeNoLlm = process.env.CAUL_RENDERER_TRANSCRIPTION_SMOKE_NO_LLM === '1';
const rendererTranscriptionSmokeBridgeStart = process.env.CAUL_RENDERER_TRANSCRIPTION_SMOKE_BRIDGE_START === '1';
const rendererTranscriptionSmokeGuiClicks = process.env.CAUL_RENDERER_TRANSCRIPTION_SMOKE_GUI_CLICKS === '1';
const rendererLlmSmoke = process.env.CAUL_RENDERER_LLM_SMOKE === '1';
const rendererRealLlmSmoke = process.env.CAUL_RENDERER_REAL_LLM_SMOKE === '1';
const onboardingSmokeDir = process.env.CAUL_ONBOARDING_SMOKE_DIR;
const onboardingLocalAiLagSmoke = process.env.CAUL_ONBOARDING_LOCAL_AI_LAG_SMOKE === '1';
const resourceSmokeMs = Number(process.env.CAUL_RESOURCE_SMOKE_MS ?? 0);
const resourceSmokeMaxWorkingSetMb = Number(process.env.CAUL_RESOURCE_SMOKE_MAX_WORKING_SET_MB ?? 450);
const packagedLaunchSmokeMs = Number(process.env.CAUL_PACKAGED_LAUNCH_SMOKE_MS ?? 0);
const packagedLaunchSmokeRequiresOnboarding = process.env.CAUL_PACKAGED_LAUNCH_SMOKE_REQUIRE_ONBOARDING === '1';
const packagedLaunchSmokeWaitMs = Number(process.env.CAUL_PACKAGED_LAUNCH_SMOKE_WAIT_MS ?? (packagedLaunchSmokeRequiresOnboarding ? 5000 : 1000));
const packagedUpdaterSmoke = process.env.CAUL_PACKAGED_UPDATER_SMOKE === '1';
const packagedPrivacySmoke = process.env.CAUL_PACKAGED_PRIVACY_SMOKE === '1';
const packagedOnboardingCompletionSmoke = process.env.CAUL_PACKAGED_ONBOARDING_COMPLETION_SMOKE === '1';
const windowsExternalCaptureProbe = process.env.CAUL_WINDOWS_EXTERNAL_CAPTURE_PROBE === '1';
const smokeOutputFile = process.env.CAUL_SMOKE_OUTPUT_FILE;
const piLlmBridgeMode = String(process.env.CAUL_PI_LLM_BRIDGE ?? '').trim().toLowerCase();

const defaultAppWindowSize = {
  width: 960,
  height: 688
};
const maximumOverlayWindowSize = {
  width: 1200,
  height: 900
};
const handleWindowSizePresets = {
  small: 32,
  medium: 48,
  large: 64
};

function emitSmokeLine(line) {
  console.log(line);

  if (!smokeOutputFile) {
    return;
  }

  try {
    fsSync.mkdirSync(path.dirname(smokeOutputFile), { recursive: true });
    fsSync.appendFileSync(smokeOutputFile, `${line}${os.EOL}`);
  } catch (error) {
    console.error(`caul-smoke-output failed ${error.message}`);
  }
}

function exitSmokeProcess(code = app.exitCode || process.exitCode || 0) {
  if (typeof process.reallyExit === 'function') {
    process.reallyExit(code);
  }

  process.exit(code);
}
const defaultHandleSizePreset = 'medium';
const onboardingContentSize = {
  width: 496,
  initialHeight: 560,
  minHeight: 360
};
const minimumWindowSize = {
  width: 600,
  height: 400
};
const minimumOverlayWindowSize = {
  width: 416,
  height: 400
};
const nonCompactOverlayTransitionWidth = 960;
const resetWindowSize = {
  width: defaultAppWindowSize.width,
  height: defaultAppWindowSize.height
};
const overlayWindowGap = 4;
const overlayWindowResizeOutset = 8;
const windowScreenMargin = 8;
const handleMidpointMagnetPx = 72;
const handleSnapPreviewAnimationDurationMs = 140;
const handleSnapAnimationDurationMs = 260;
const windowStateFileName = 'window-state.json';
const privateOverlayStateFileName = 'private-overlay-state.json';
const promptTemplatesFileName = 'prompt-templates.json';
const setupStateFileName = 'setup-state.json';
const portableLlmModels = new Set([
  'openai-codex/gpt-5.2',
  'openai-codex/gpt-5.4',
  'openai-codex/gpt-5.4-mini',
  'openai-codex/gpt-5.5'
]);
const portableLlmReasoningLevels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const transcriptionRecommendationTtlMs = 7 * 24 * 60 * 60 * 1000;
const parakeetArchiveUrl = 'https://blob.handy.computer/parakeet-v3-int8.tar.gz';
const parakeetModelDirName = 'parakeet-tdt-0.6b-v3-int8';
const moonshineTinyArchiveUrl = 'https://blob.handy.computer/moonshine-tiny-streaming-en.tar.gz';
const moonshineTinyModelDirName = 'moonshine-tiny-streaming-en';
const defaultPiChatGptProvider = 'openai-codex';
const defaultPiChatGptModel = 'openai-codex/gpt-5.5';
const defaultAiProvider = 'local';
const onboardingModelCatalogueRefreshTimeoutMs = Number(process.env.CAUL_ONBOARDING_MODEL_CATALOGUE_REFRESH_TIMEOUT_MS ?? 8000);
const localAiFirstTokenTargetMs = Number(process.env.CAUL_LOCAL_AI_FIRST_TOKEN_TARGET_MS ?? 2500);
const localAiTotalResponseTargetMs = Number(process.env.CAUL_LOCAL_AI_TOTAL_RESPONSE_TARGET_MS ?? 9000);
const parakeetRequiredFiles = [
  'encoder-model.int8.onnx',
  'decoder_joint-model.int8.onnx',
  'nemo128.onnx',
  'vocab.txt'
];
let transcriptDebugLogPath = null;
let mainWindow = null;
let privateOverlayWindow = null;
let privateOverlayHandleWindow = null;
let privateOverlayHandleDrag = null;
let privateOverlayHandleSnapAnimation = null;
let privateOverlayWindowDrag = null;
let privateOverlayWindowResize = null;
let onboardingWindow = null;
let updaterService = null;
let parakeetDownload = null;
let localModelDownload = null;
let piChatGptLoginPromise = null;
let piAuthStorageImportPromise = null;
let isQuitting = false;
let isInstallingDownloadedUpdate = false;
let packagedLaunchSmokeStarted = false;
const packagedPrivacySmokeState = {
  captureProbe: null,
  mainHttpRequests: [],
  nativeProtection: new WeakMap(),
  rendererHttpRequests: [],
  protectedWindows: new WeakSet()
};

const starterPromptTemplates = [
  {
    id: 'starter-answer-with-star',
    name: 'STAR',
    prompt: 'Use STAR when answering interview-style questions.\n\nStructure the answer as:\nSituation: brief context\nTask: what needed to be done\nAction: what I did\nResult: outcome or lesson\n\nKeep it concise and natural to say aloud.'
  },
  {
    id: 'starter-use-my-cv',
    name: 'CV',
    prompt: 'Use my CV as background context.\n\nPrefer specific experience, projects, achievements and skills from the CV. If no CV content or readable CV attachment is provided, say you cannot review the CV until it is attached. Do not invent details, use placeholders or give a generic CV review.'
  },
  {
    id: 'starter-job-description',
    name: 'PD',
    prompt: 'Use the position description as role context.\n\nConnect answers to the role duties, skills and selection criteria where useful.'
  }
];
const defaultSelectedPromptTemplateIds = [];

if (packagedPrivacySmoke) {
  installPackagedPrivacyMainNetworkHooks();
}

function installPackagedPrivacyMainNetworkHooks() {
  const originalRequest = https.request.bind(https);
  const originalGet = https.get.bind(https);

  https.request = (...args) => {
    recordPackagedPrivacyMainRequest(args[0]);
    return originalRequest(...args);
  };

  https.get = (...args) => {
    recordPackagedPrivacyMainRequest(args[0]);
    return originalGet(...args);
  };
}

function recordPackagedPrivacyMainRequest(target) {
  packagedPrivacySmokeState.mainHttpRequests.push(normalisePrivacyRequestTarget(target));
}

function normalisePrivacyRequestTarget(target) {
  if (typeof target === 'string') {
    return target;
  }

  if (target instanceof URL) {
    return target.toString();
  }

  if (target && typeof target === 'object') {
    const protocol = target.protocol ?? 'https:';
    const host = target.hostname ?? target.host ?? 'unknown-host';
    const pathName = target.path ?? target.pathname ?? '';

    return `${protocol}//${host}${pathName}`;
  }

  return 'unknown';
}

function installPackagedPrivacyRendererNetworkHooks() {
  if (!packagedPrivacySmoke) {
    return;
  }

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) {
      packagedPrivacySmokeState.rendererHttpRequests.push(details.url);
    }

    callback({});
  });
}

async function getPackagedPrivacySmokeSummary() {
  const privateWindows = await getPrivateWindowProtectionSummary();
  const rawAudioFiles = listUserDataFilesMatching((filePath) => (
    /\.(?:aif|aiff|flac|m4a|mp3|pcm|raw|wav)$/i.test(filePath)
  ));
  const transcriptDebugFiles = listUserDataFilesMatching((filePath) => (
    /(?:^|[\\/])transcript-debug\.jsonl$/i.test(filePath)
  ));
  const ok = packagedPrivacySmokeState.mainHttpRequests.length === 0
    && packagedPrivacySmokeState.rendererHttpRequests.length === 0
    && rawAudioFiles.length === 0
    && transcriptDebugFiles.length === 0
    && privateWindows.ok;

  return {
    ok,
    privateWindows,
    mainHttpRequests: packagedPrivacySmokeState.mainHttpRequests,
    rawAudioFiles,
    rendererHttpRequests: packagedPrivacySmokeState.rendererHttpRequests,
    transcriptDebugFiles
  };
}

async function getPrivateWindowProtectionSummary() {
  const contentProtectionSupported = process.platform === 'darwin' || process.platform === 'win32';
  const diagnosticWindow = getPrivateWindowProtectionDiagnosticSummary();
  const captureProbe = await getPrivateWindowCaptureProbeSummary();
  const windows = [
    ['overlay', privateOverlayWindow, true],
    ['handle', privateOverlayHandleWindow, false],
    ...(shouldProtectAllAppWindows() ? [['onboarding', onboardingWindow]] : [])
  ].map(([name, window, requiresProtection = true]) => {
    const exists = Boolean(window && !window.isDestroyed());
    const contentProtected = exists && typeof window.isContentProtected === 'function'
      ? window.isContentProtected()
      : null;

    return {
      contentProtected,
      exists,
      name,
      nativeProtection: exists ? packagedPrivacySmokeState.nativeProtection.get(window) ?? null : null,
      protectionAttempted: exists ? packagedPrivacySmokeState.protectedWindows.has(window) : false,
      requiresProtection
    };
  });
  const shouldProtect = shouldProtectPrivateWindowContent();

  return {
    contentProtectionSupported,
    captureProbe,
    diagnosticWindow,
    ok: !shouldProtect || windows.every((window) => (
      !window.exists
      || !window.requiresProtection
      || (
        process.platform === 'win32'
          ? captureProbe?.ok === true && window.protectionAttempted === true
          : contentProtectionSupported
          ? window.contentProtected === true || window.nativeProtection?.ok === true
          : window.protectionAttempted === true
      )
    )),
    shouldProtect,
    windows
  };
}

async function getPrivateWindowCaptureProbeSummary() {
  if (!packagedPrivacySmoke || process.platform !== 'win32') {
    return null;
  }

  if (packagedPrivacySmokeState.captureProbe) {
    return packagedPrivacySmokeState.captureProbe;
  }

  packagedPrivacySmokeState.captureProbe = await runWindowsCaptureProtectionProbe();

  return packagedPrivacySmokeState.captureProbe;
}

async function runWindowsCaptureProtectionProbe() {
  const display = screen.getPrimaryDisplay();
  const { workArea, scaleFactor } = display;
  const windowSize = {
    height: 96,
    width: 128
  };
  const protectedBounds = {
    x: workArea.x + 24,
    y: workArea.y + 24,
    ...windowSize
  };
  const controlBounds = {
    x: workArea.x + 168,
    y: workArea.y + 24,
    ...windowSize
  };
  let protectedWindow = null;
  let controlWindow = null;

  try {
    protectedWindow = createCaptureProbeWindow(protectedBounds, '#ff0000', true);
    controlWindow = createCaptureProbeWindow(controlBounds, '#00ff00', false);

    await Promise.all([
      waitForWindowReadyToShow(protectedWindow),
      waitForWindowReadyToShow(controlWindow)
    ]);

    controlWindow.show();
    protectedWindow.show();
    controlWindow.moveTop();
    protectedWindow.moveTop();
    await wait(800);

    const capture = await capturePrimaryDisplayPixels(display);
    const protectedPixelCount = countRgbPixelsInRect(capture, protectedBounds, scaleFactor, {
      b: 0,
      g: 0,
      r: 255
    });
    const controlPixelCount = countRgbPixelsInRect(capture, controlBounds, scaleFactor, {
      b: 0,
      g: 255,
      r: 0
    });
    const minimumExpectedPixels = Math.round(windowSize.width * windowSize.height * scaleFactor * scaleFactor * 0.12);

    return {
      controlPixelCount,
      controlVisible: controlPixelCount >= minimumExpectedPixels,
      minimumExpectedPixels,
      ok: controlPixelCount >= minimumExpectedPixels && protectedPixelCount < minimumExpectedPixels,
      protectedPixelCount,
      protectedExcluded: protectedPixelCount < minimumExpectedPixels,
      type: 'windows_capture_protection_probe'
    };
  } catch (error) {
    return {
      error: error.message,
      ok: false,
      type: 'windows_capture_protection_probe'
    };
  } finally {
    for (const window of [protectedWindow, controlWindow]) {
      if (window && !window.isDestroyed()) {
        window.destroy();
      }
    }
  }
}

async function runWindowsExternalCaptureProtectionProbe() {
  if (process.platform !== 'win32') {
    emitSmokeLine(`caul-windows-capture-probe ${JSON.stringify({
      error: 'Windows capture protection probe only runs on Windows.',
      ok: false
    })}`);
    app.exitCode = 1;
    app.exit(1);
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { workArea, scaleFactor } = display;
  const windowSize = {
    height: 96,
    width: 128
  };
  const protectedBounds = {
    x: workArea.x + 24,
    y: workArea.y + 24,
    ...windowSize
  };
  const controlBounds = {
    x: workArea.x + 168,
    y: workArea.y + 24,
    ...windowSize
  };
  const holdMs = Number(process.env.CAUL_WINDOWS_EXTERNAL_CAPTURE_PROBE_MS ?? 8000);
  const protectedWindow = createCaptureProbeWindow(protectedBounds, '#ff0000', true);
  const controlWindow = createCaptureProbeWindow(controlBounds, '#00ff00', false);

  await Promise.all([
    waitForWindowReadyToShow(protectedWindow),
    waitForWindowReadyToShow(controlWindow)
  ]);

  controlWindow.show();
  protectedWindow.show();
  controlWindow.moveTop();
  protectedWindow.moveTop();
  await wait(250);
  protectedWindow.setContentProtection(true);
  protectedWindow.moveTop();
  await wait(250);
  const internalCapture = await runWindowsVisibleCaptureAnalysis(display, protectedBounds, controlBounds, scaleFactor, windowSize);

  emitSmokeLine(`caul-windows-capture-probe ${JSON.stringify({
    controlBounds,
    display: {
      id: display.id,
      scaleFactor,
      workArea
    },
    holdMs,
    internalCapture,
    ok: true,
    protectedContentProtected: typeof protectedWindow.isContentProtected === 'function'
      ? protectedWindow.isContentProtected()
      : null,
    protectedBounds
  })}`);

  setTimeout(() => {
    app.exit(0);
  }, holdMs);
}

async function runWindowsVisibleCaptureAnalysis(display, protectedBounds, controlBounds, scaleFactor, windowSize) {
  try {
    const capture = await capturePrimaryDisplayPixels(display);
    const protectedPixelCount = countRgbPixelsInRect(capture, protectedBounds, scaleFactor, {
      b: 0,
      g: 0,
      r: 255
    });
    const controlPixelCount = countRgbPixelsInRect(capture, controlBounds, scaleFactor, {
      b: 0,
      g: 255,
      r: 0
    });
    const minimumExpectedPixels = Math.round(windowSize.width * windowSize.height * scaleFactor * scaleFactor * 0.12);

    return {
      controlPixelCount,
      controlVisible: controlPixelCount >= minimumExpectedPixels,
      minimumExpectedPixels,
      ok: controlPixelCount >= minimumExpectedPixels && protectedPixelCount < minimumExpectedPixels,
      protectedExcluded: protectedPixelCount < minimumExpectedPixels,
      protectedPixelCount,
      type: 'windows_visible_capture_analysis'
    };
  } catch (error) {
    return {
      error: error.message,
      ok: false,
      type: 'windows_visible_capture_analysis'
    };
  }
}

function createCaptureProbeWindow(bounds, colour, protect) {
  const window = new BrowserWindow({
    ...bounds,
    alwaysOnTop: true,
    backgroundColor: colour,
    frame: false,
    focusable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: false,
    webPreferences: {
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:${colour};width:100vw;height:100vh"></body></html>`)}`);

  if (protect) {
    window.setContentProtection(true);
  }

  return window;
}

function waitForWindowReadyToShow(window) {
  if (window.isDestroyed()) {
    return Promise.resolve();
  }

  if (!window.webContents.isLoading()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
  });
}

async function capturePrimaryDisplayPixels(display) {
  const thumbnailSize = {
    height: Math.round(display.size.height * display.scaleFactor),
    width: Math.round(display.size.width * display.scaleFactor)
  };
  const sources = await desktopCapturer.getSources({
    thumbnailSize,
    types: ['screen']
  });
  const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Desktop capture did not return a screen thumbnail.');
  }

  const size = source.thumbnail.getSize();

  return {
    bitmap: source.thumbnail.toBitmap(),
    height: size.height,
    width: size.width
  };
}

function countRgbPixelsInRect(capture, bounds, scaleFactor, target) {
  const startX = Math.max(0, Math.floor(bounds.x * scaleFactor));
  const startY = Math.max(0, Math.floor(bounds.y * scaleFactor));
  const endX = Math.min(capture.width, Math.ceil((bounds.x + bounds.width) * scaleFactor));
  const endY = Math.min(capture.height, Math.ceil((bounds.y + bounds.height) * scaleFactor));
  let count = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = ((y * capture.width) + x) * 4;
      const b = capture.bitmap[offset] ?? 0;
      const g = capture.bitmap[offset + 1] ?? 0;
      const r = capture.bitmap[offset + 2] ?? 0;

      if (
        Math.abs(r - target.r) <= 28
        && Math.abs(g - target.g) <= 28
        && Math.abs(b - target.b) <= 28
      ) {
        count += 1;
      }
    }
  }

  return count;
}

function getPrivateWindowProtectionDiagnosticSummary() {
  if (!packagedPrivacySmoke || process.platform !== 'win32') {
    return null;
  }

  let window = null;

  try {
    window = new BrowserWindow({
      width: 32,
      height: 32,
      show: false,
      frame: true,
      transparent: false,
      backgroundColor: '#111111',
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        devTools: false,
        nodeIntegration: false,
        sandbox: false
      }
    });
    window.setContentProtection(true);

    return {
      contentProtected: typeof window.isContentProtected === 'function' ? window.isContentProtected() : null,
      ok: typeof window.isContentProtected === 'function' ? window.isContentProtected() === true : false
    };
  } catch (error) {
    return {
      error: error.message,
      ok: false
    };
  } finally {
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

function listUserDataFilesMatching(predicate) {
  const root = app.getPath('userData');
  const matches = [];

  function visit(directory) {
    let entries = [];

    try {
      entries = fsSync.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && predicate(filePath)) {
        matches.push(path.relative(root, filePath));
      }
    }
  }

  visit(root);

  return matches.sort();
}

function getProjectRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function getAppDisplayName() {
  const name = String(app.getName() || '').toLowerCase();

  if (name.includes('dev-private')) {
    return 'Caul Dev-Private';
  }

  if (name.includes('dev')) {
    return 'Caul Dev';
  }

  if (name.includes('beta')) {
    return 'Caul Beta';
  }

  return 'Caul';
}

function getAppChannel() {
  const name = String(app.getName() || '').toLowerCase();

  if (name.includes('dev-private')) {
    return 'dev-private';
  }

  if (name.includes('dev')) {
    return 'dev';
  }

  if (name.includes('beta')) {
    return 'beta';
  }

  return 'stable';
}

function getUpdaterService() {
  if (!updaterService) {
    updaterService = createUpdaterService({
      appChannel: getAppChannel(),
      appName: getAppDisplayName(),
      forceEnabled: process.env.CAUL_FORCE_UPDATE_CHECKS === '1',
      isDev,
      onAfterSuccessfulCheck: refreshLiveModelCatalogueAfterUpdateCheck,
      onBeforeInstallDownloadedUpdate: prepareForDownloadedUpdateInstall
    });
  }

  return updaterService;
}

function prepareForDownloadedUpdateInstall() {
  isInstallingDownloadedUpdate = true;
  isQuitting = true;
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
}

function getBundledExecutablePath(name) {
  const executableName = process.platform === 'win32' && !name.endsWith('.exe')
    ? `${name}.exe`
    : name;

  return path.join(process.resourcesPath, 'bin', executableName);
}

function getBundledScriptPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', name)
    : path.join(__dirname, '..', 'scripts', name);
}

if (process.env.CAUL_USER_DATA_DIR) {
  app.setPath('userData', process.env.CAUL_USER_DATA_DIR);
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

function getSetupStatePath() {
  return path.join(app.getPath('userData'), setupStateFileName);
}

function getParakeetModelRoot() {
  return path.join(app.getPath('userData'), 'models');
}

function getParakeetModelPath() {
  return path.join(getParakeetModelRoot(), parakeetModelDirName);
}

function getMoonshineTinyModelPath() {
  return path.join(getParakeetModelRoot(), moonshineTinyModelDirName);
}

function getLocalModelPath(modelId = getPreferredLocalModelId()) {
  return modelId === 'moonshine-tiny' ? getMoonshineTinyModelPath() : getParakeetModelPath();
}

function getPiAgentDir() {
  return path.join(app.getPath('userData'), 'pi-agent');
}

function getPiAuthPath() {
  return path.join(getPiAgentDir(), 'auth.json');
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

function mergeStarterPromptTemplates(templates) {
  const starterTemplates = createStarterPromptTemplates();
  const starterTemplatesById = new Map(starterTemplates.map((template) => [template.id, template]));
  const customTemplates = templates.filter((template) => !starterTemplatesById.has(template.id));

  return [
    ...starterTemplates,
    ...customTemplates
  ];
}

function getCustomStarterPromptTemplateId(id) {
  return `custom-${id}`;
}

function isStarterPromptTemplateCustomised(template, starterTemplate) {
  return template.name !== starterTemplate.name
    || template.prompt !== starterTemplate.prompt
    || (template.attachments ?? []).length > 0;
}

function asCustomStarterPromptTemplate(template, existingTemplates = []) {
  const customId = getCustomStarterPromptTemplateId(template.id);
  const existingCustom = existingTemplates.find((item) => item.id === customId);
  const collisionTemplates = existingTemplates.filter((item) => item.id !== customId && item.id !== template.id);

  return {
    ...template,
    createdAt: existingCustom?.createdAt ?? template.createdAt,
    id: customId,
    name: getAvailablePromptTemplateName(template.name, collisionTemplates),
    updatedAt: template.updatedAt
  };
}

function getAvailablePromptTemplateName(name, templates) {
  const trimmedName = String(name ?? '').trim();
  const baseName = trimmedName || 'Untitled';
  const usedNames = new Set(templates
    .map((template) => String(template?.name ?? '').trim().toLocaleLowerCase())
    .filter(Boolean));

  if (!usedNames.has(baseName.toLocaleLowerCase())) {
    return baseName;
  }

  const customName = `${baseName} custom`;

  if (!usedNames.has(customName.toLocaleLowerCase())) {
    return customName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${customName} ${index}`;

    if (!usedNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  return `${customName} ${Date.now()}`;
}

function resolvePromptTemplateNameCollisions(templates) {
  const starterTemplateIds = new Set(starterPromptTemplates.map((template) => template.id));

  return templates.reduce((items, template) => {
    if (starterTemplateIds.has(template.id)) {
      return [...items, template];
    }

    return [
      ...items,
      {
        ...template,
        name: getAvailablePromptTemplateName(template.name, items)
      }
    ];
  }, []);
}

function preserveCustomisedStarterPromptTemplates(templates) {
  const starterTemplates = createStarterPromptTemplates();
  const starterTemplatesById = new Map(starterTemplates.map((template) => [template.id, template]));
  const preservedCustomStarters = templates
    .filter((template) => {
      const starterTemplate = starterTemplatesById.get(template.id);
      return starterTemplate && isStarterPromptTemplateCustomised(template, starterTemplate);
    })
    .map((template) => asCustomStarterPromptTemplate(template, templates));
  const existingCustomTemplates = templates.filter((template) => !starterTemplatesById.has(template.id));
  const customTemplatesById = new Map([...existingCustomTemplates, ...preservedCustomStarters].map((template) => [template.id, template]));

  return resolvePromptTemplateNameCollisions([
    ...starterTemplates,
    ...customTemplatesById.values()
  ]);
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
  const promptTemplates = mergeStarterPromptTemplates(templates);
  const requestedSelectedIds = Array.isArray(value?.selectedTemplateIds)
    ? value.selectedTemplateIds
    : defaultSelectedPromptTemplateIds;
  const selectedTemplateIds = requestedSelectedIds.filter((id, index) => (
    typeof id === 'string'
    && requestedSelectedIds.indexOf(id) === index
    && promptTemplates.some((template) => template.id === id)
  ));

  return {
    ok: true,
    selectedTemplateIds,
    templates: promptTemplates
  };
}

function readLegacyPromptTemplateStateFromUserData() {
  try {
    return normalisePromptTemplateState(JSON.parse(fsSync.readFileSync(getPromptTemplatesPath(), 'utf8')));
  } catch {
    return normalisePromptTemplateState(null);
  }
}

function readPromptTemplateState() {
  return normalisePromptTemplateState(getProfileService().readPrompts());
}

function writePromptTemplateState(state) {
  const nextState = normalisePromptTemplateState(state);

  return normalisePromptTemplateState(getProfileService().writePrompts({
    selectedTemplateIds: nextState.selectedTemplateIds,
    templates: nextState.templates
  }));
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

  const starterTemplate = createStarterPromptTemplates().find((item) => item.id === normalised.id);
  const templateToSave = starterTemplate && isStarterPromptTemplateCustomised(normalised, starterTemplate)
    ? asCustomStarterPromptTemplate(normalised, existing.templates)
    : normalised;
  const previousTemplate = existing.templates.find((item) => item.id === templateToSave.id);
  forgetLocalLlmAttachments(getRemovedPromptTemplateAttachments(
    previousTemplate?.attachments ?? [],
    templateToSave.attachments ?? []
  ));
  const templates = existing.templates.some((item) => item.id === templateToSave.id)
    ? existing.templates.map((item) => (item.id === templateToSave.id ? templateToSave : item))
    : [...existing.templates, templateToSave];

  return writePromptTemplateState({
    selectedTemplateIds: existing.selectedTemplateIds,
    templates
  });
}

function deletePromptTemplate(id) {
  const existing = readPromptTemplateState();
  const deletedTemplate = existing.templates.find((template) => template.id === id);
  const templates = existing.templates.filter((template) => template.id !== id);
  forgetLocalLlmAttachments(deletedTemplate?.attachments ?? []);

  return writePromptTemplateState({
    selectedTemplateIds: existing.selectedTemplateIds.filter((selectedId) => selectedId !== id),
    templates
  });
}

function resetPromptTemplates() {
  const existing = readPromptTemplateState();
  const nextTemplates = preserveCustomisedStarterPromptTemplates(existing.templates);
  forgetLocalLlmAttachments(getRemovedPromptTemplateAttachments(
    existing.templates.flatMap((template) => template.attachments ?? []),
    nextTemplates.flatMap((template) => template.attachments ?? [])
  ));

  return writePromptTemplateState({
    selectedTemplateIds: defaultSelectedPromptTemplateIds,
    templates: nextTemplates
  });
}

function getRemovedPromptTemplateAttachments(previousAttachments, nextAttachments) {
  const nextPaths = new Set(nextAttachments
    .map((attachment) => attachment?.path)
    .filter((filePath) => typeof filePath === 'string' && filePath));

  return previousAttachments.filter((attachment) => (
    typeof attachment?.path === 'string'
    && attachment.path
    && !nextPaths.has(attachment.path)
  ));
}

async function choosePromptTemplateAttachments(window) {
  const result = await dialog.showOpenDialog(window, {
    buttonLabel: 'Add attachments',
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) {
    return { ok: true, attachments: [] };
  }

  const attachments = result.filePaths
    .map((filePath) => normalisePromptTemplateAttachment({ path: filePath }))
    .filter(Boolean);
  void preloadLocalLlmAttachments(attachments).catch((error) => {
    console.warn('Failed to pre-process local AI attachments', error);
  });

  return {
    ok: true,
    attachments
  };
}

function readSetupState() {
  try {
    const state = JSON.parse(fsSync.readFileSync(getSetupStatePath(), 'utf8'));

    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function writeSetupState(update) {
  const state = {
    ...readSetupState(),
    ...update
  };

  fsSync.mkdirSync(app.getPath('userData'), { recursive: true });
  fsSync.writeFileSync(getSetupStatePath(), `${JSON.stringify(state, null, 2)}\n`);

  return state;
}

function getDefaultCaulFolder() {
  try {
    return path.join(app.getPath('documents'), 'Caul');
  } catch {
    return path.join(app.getPath('userData'), 'Caul');
  }
}

function getProfileService() {
  if (!profileService) {
    profileService = createProfileService({
      getDefaultFolder: getDefaultCaulFolder,
      normalisePrompts: normalisePortablePromptTemplateStorage,
      normaliseSettings: normalisePortableSettings,
      readLegacyPrompts: readLegacyPromptTemplateStateFromUserData,
      readLegacySettings: readLegacyPortableSettings,
      readPointerState: readSetupState,
      writePointerState: writeSetupState
    });
  }

  return profileService;
}

function normalisePortableSettings(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const settings = {};

  if (typeof value.historyEnabled === 'boolean') {
    settings.historyEnabled = value.historyEnabled;
  }

  if (value.selectedLocalTranscriptionModel === 'parakeet' || value.selectedLocalTranscriptionModel === 'moonshine-tiny') {
    settings.selectedLocalTranscriptionModel = value.selectedLocalTranscriptionModel;
  }

  if (value.selectedAiProvider === 'cloud' || value.selectedAiProvider === 'local') {
    settings.selectedAiProvider = value.selectedAiProvider;
  }

  if (typeof value.selectedLocalAiModel === 'string' && value.selectedLocalAiModel.trim()) {
    settings.selectedLocalAiModel = value.selectedLocalAiModel.trim();
  }

  if (portableLlmModels.has(value.llmModel)) {
    settings.llmModel = value.llmModel;
  }

  if (portableLlmReasoningLevels.has(value.llmReasoning)) {
    settings.llmReasoning = value.llmReasoning;
  }

  if (typeof value.generalInstructions === 'string') {
    settings.generalInstructions = value.generalInstructions;
  }

  if (typeof value.autoCollapse === 'boolean') {
    settings.autoCollapse = value.autoCollapse;
  }

  if (typeof value.autoUpdateTranscriptionModel === 'boolean') {
    settings.autoUpdateTranscriptionModel = value.autoUpdateTranscriptionModel;
  }

  if (typeof value.autoUpdateAiModel === 'boolean') {
    settings.autoUpdateAiModel = value.autoUpdateAiModel;
  }

  return settings;
}

function normalisePortablePromptTemplateStorage(value) {
  const state = normalisePromptTemplateState(value);

  return {
    selectedTemplateIds: state.selectedTemplateIds,
    templates: state.templates
  };
}

function readLegacyPortableSettings() {
  const state = readSetupState();
  const settings = {};

  if (typeof state.historyEnabled === 'boolean') {
    settings.historyEnabled = state.historyEnabled;
  }

  if (state.selectedLocalTranscriptionModel === 'parakeet' || state.selectedLocalTranscriptionModel === 'moonshine-tiny') {
    settings.selectedLocalTranscriptionModel = state.selectedLocalTranscriptionModel;
  }

  if (state.selectedAiProvider === 'cloud' || state.selectedAiProvider === 'local') {
    settings.selectedAiProvider = state.selectedAiProvider;
  }

  return settings;
}

function readProfileSettings() {
  return getProfileService().readSettings();
}

function updateProfileSettings(update) {
  return getProfileService().updateSettings(update);
}

function readHistoryState() {
  const settings = readProfileSettings();

  return {
    ...readSetupState(),
    ...(typeof settings.historyEnabled === 'boolean' ? { historyEnabled: settings.historyEnabled } : {})
  };
}

function writeHistoryState(update) {
  const privateUpdate = { ...update };

  if (Object.hasOwn(privateUpdate, 'historyEnabled')) {
    updateProfileSettings({ historyEnabled: Boolean(privateUpdate.historyEnabled) });
    delete privateUpdate.historyEnabled;
  }

  if (Object.keys(privateUpdate).length > 0) {
    writeSetupState(privateUpdate);
  }

  return readHistoryState();
}

function loadPortablePreferences(request) {
  const current = readProfileSettings();
  const legacy = normalisePortableSettings(request?.legacy);
  const merged = {
    ...legacy,
    ...current
  };

  if (JSON.stringify(merged) !== JSON.stringify(current)) {
    updateProfileSettings(merged);
  }

  return {
    ok: true,
    preferences: readProfileSettings()
  };
}

function savePortablePreferences(update) {
  return {
    ok: true,
    preferences: updateProfileSettings(update)
  };
}

function getHistoryService() {
  if (!historyService) {
    historyService = createHistoryService({
      dialog,
      getDocumentsPath: () => app.getPath('documents'),
      moveProfileFiles: (fromFolder, toFolder) => getProfileService().movePortableFiles(fromFolder, toFolder),
      openPath: (folder) => shell.openPath(folder),
      readState: readHistoryState,
      writeState: writeHistoryState
    });
  }

  return historyService;
}

function seedPackagedOnboardingCompletionSmokeState() {
  if (!packagedOnboardingCompletionSmoke) {
    return;
  }

  writeSetupState({
    selectedLocalTranscriptionModel: 'moonshine-tiny',
    selectedAiProvider: 'cloud',
    selectedPiModel: defaultPiChatGptModel
  });
  updateProfileSettings({
    selectedAiProvider: 'cloud',
    selectedLocalTranscriptionModel: 'moonshine-tiny'
  });

  const modelDir = getMoonshineTinyModelPath();
  fsSync.mkdirSync(modelDir, { recursive: true });

  for (const fileName of [
    'frontend.ort',
    'encoder.ort',
    'adapter.ort',
    'cross_kv.ort',
    'decoder_kv.ort',
    'streaming_config.json',
    'tokenizer.bin'
  ]) {
    const filePath = path.join(modelDir, fileName);

    if (!fsSync.existsSync(filePath)) {
      fsSync.writeFileSync(filePath, fileName === 'streaming_config.json' ? '{}\n' : '');
    }
  }
}

async function completeOnboarding() {
  const status = await getOnboardingStatus();

  if (!status.complete) {
    return status;
  }

  writeSetupState({
    onboardingCompletedAt: new Date().toISOString()
  });

  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.close();
  }

  showPrivateOverlayWindow();

  return getOnboardingStatus();
}

async function reopenOnboarding() {
  createOnboardingWindow().show();
  return getOnboardingStatus();
}

function setSelectedPromptTemplates(ids) {
  const existing = readPromptTemplateState();
  const requestedIds = Array.isArray(ids) ? ids : [];
  const selectedTemplateIds = requestedIds.filter((id, index) => (
    typeof id === 'string'
    && requestedIds.indexOf(id) === index
    && existing.templates.some((template) => template.id === id)
  ));

  return writePromptTemplateState({
    selectedTemplateIds,
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

  if (mainWindow === privateOverlayWindow) {
    mainWindow.setBounds(getAnchoredOverlayBounds(resetWindowSize, { orientForEdge: false }));
    const state = readPrivateOverlayState();

    writePrivateOverlayState({
      ...state,
      overlay: {
        ...state.overlay,
        ...mainWindow.getBounds(),
        visible: mainWindow.isVisible()
      }
    });
    broadcastPrivateOverlayState();
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
  const rawHandle = state && typeof state === 'object' && state.handle && typeof state.handle === 'object'
    ? state.handle
    : {};
  const handleSize = normaliseHandleSizePreset(rawHandle.size);
  const handleWindowSize = getHandleWindowSize(handleSize);
  const defaultHandleX = workArea.x + Math.round((workArea.width - handleWindowSize.width) / 2);
  const defaultHandleY = workArea.y + windowScreenMargin;
  const defaultOverlayX = workArea.x + Math.round((workArea.width - defaultAppWindowSize.width) / 2);
  const defaultOverlayY = workArea.y + 48;
  const handle = rawHandle;
  const overlay = state && typeof state === 'object' && state.overlay && typeof state.overlay === 'object'
    ? state.overlay
    : {};
  const handleBounds = normaliseStoredHandleBounds({
    height: handleWindowSize.height,
    rawBounds: handle,
    size: handleSize,
    width: handleWindowSize.width,
    x: normaliseCoordinate(handle.x, defaultHandleX),
    y: normaliseCoordinate(handle.y, defaultHandleY)
  });
  const overlayBounds = normaliseStoredOverlayBounds({
    height: clampNumber(Number(overlay.height), minimumOverlayWindowSize.height, maximumOverlayWindowSize.height, defaultAppWindowSize.height),
    rawBounds: overlay,
    width: clampNumber(Number(overlay.width), minimumOverlayWindowSize.width, maximumOverlayWindowSize.width, defaultAppWindowSize.width),
    x: normaliseCoordinate(overlay.x, defaultOverlayX),
    y: normaliseCoordinate(overlay.y, defaultOverlayY)
  });
  const handleDisplay = screen.getDisplayMatching(handleBounds);
  const overlayDisplay = screen.getDisplayMatching(overlayBounds);

  return {
    clickThrough: Boolean(state?.clickThrough),
    handle: {
      ...getDisplayPersistence(handleBounds, handleDisplay),
      opacity: clampNumber(Number(handle.opacity), 0.35, 1, 0.82),
      size: handleSize,
      visible: true,
      x: handleBounds.x,
      y: handleBounds.y
    },
    overlay: {
      ...getDisplayPersistence(overlayBounds, overlayDisplay),
      height: overlayBounds.height,
      visible: Boolean(overlay.visible),
      width: overlayBounds.width,
      x: overlayBounds.x,
      y: overlayBounds.y
    },
    privateMode: true
  };
}

function normaliseStoredHandleBounds(bounds) {
  const restoredBounds = getRestoredBoundsForStoredDisplay(bounds.rawBounds, bounds);

  return normaliseHandleBounds({
    ...restoredBounds,
    height: bounds.height,
    width: bounds.width
  });
}

function normaliseStoredOverlayBounds(bounds) {
  const restoredBounds = getRestoredBoundsForStoredDisplay(bounds.rawBounds, bounds);

  return clampOverlayBoundsToDisplay(restoredBounds);
}

function getRestoredBoundsForStoredDisplay(rawBounds, fallbackBounds) {
  const fallback = {
    height: Math.round(Number(fallbackBounds.height)),
    width: Math.round(Number(fallbackBounds.width)),
    x: Math.round(Number(fallbackBounds.x)),
    y: Math.round(Number(fallbackBounds.y))
  };
  const storedDisplay = getDisplayById(rawBounds?.displayId);
  const relative = normaliseRelativeBounds(rawBounds?.relative);

  if (
    storedDisplay
    && relative
    && !isStoredWorkAreaCurrent(rawBounds?.workArea, storedDisplay.workArea)
  ) {
    return getBoundsFromDisplayRelativeBounds(relative, storedDisplay);
  }

  if (isBoundsVisibleOnAnyDisplay(fallback)) {
    return fallback;
  }

  if (storedDisplay && relative) {
    return getBoundsFromDisplayRelativeBounds(relative, storedDisplay);
  }

  if (relative) {
    return getBoundsFromDisplayRelativeBounds(relative, screen.getPrimaryDisplay());
  }

  return fallback;
}

function getDisplayById(displayId) {
  const numericDisplayId = Number(displayId);

  if (!Number.isFinite(numericDisplayId)) {
    return null;
  }

  return screen.getAllDisplays().find((display) => display.id === numericDisplayId) ?? null;
}

function normaliseRelativeBounds(relative) {
  if (!relative || typeof relative !== 'object') {
    return null;
  }

  const x = Number(relative.x);
  const y = Number(relative.y);
  const width = Number(relative.width);
  const height = Number(relative.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return { height, width, x, y };
}

function isStoredWorkAreaCurrent(storedWorkArea, currentWorkArea) {
  if (!storedWorkArea || typeof storedWorkArea !== 'object') {
    return false;
  }

  return ['x', 'y', 'width', 'height'].every((key) => (
    Math.round(Number(storedWorkArea[key])) === Math.round(Number(currentWorkArea[key]))
  ));
}

function getBoundsFromDisplayRelativeBounds(relative, display) {
  const workArea = display.workArea;

  return {
    height: Math.round(relative.height * workArea.height),
    width: Math.round(relative.width * workArea.width),
    x: workArea.x + Math.round(relative.x * workArea.width),
    y: workArea.y + Math.round(relative.y * workArea.height)
  };
}

function isBoundsVisibleOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some((display) => rectanglesIntersect(bounds, display.workArea));
}

function getDisplayPersistence(bounds, display = screen.getDisplayMatching(bounds)) {
  const workArea = display.workArea;

  return {
    displayId: display.id,
    relative: {
      height: getDisplayRelativeNumber(bounds.height, workArea.height),
      width: getDisplayRelativeNumber(bounds.width, workArea.width),
      x: getDisplayRelativeNumber(bounds.x - workArea.x, workArea.width),
      y: getDisplayRelativeNumber(bounds.y - workArea.y, workArea.height)
    },
    workArea: {
      height: workArea.height,
      width: workArea.width,
      x: workArea.x,
      y: workArea.y
    }
  };
}

function getDisplayRelativeNumber(value, size) {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(size)) || Number(size) <= 0) {
    return 0;
  }

  return Number((Number(value) / Number(size)).toFixed(6));
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

function normaliseHandleSizePreset(size) {
  return Object.prototype.hasOwnProperty.call(handleWindowSizePresets, size)
    ? size
    : defaultHandleSizePreset;
}

function getHandleSizePresetForBounds(bounds) {
  const width = Number(bounds?.width);

  if (!Number.isFinite(width)) {
    return normaliseHandleSizePreset(bounds?.size);
  }

  return Object.entries(handleWindowSizePresets)
    .reduce((best, [size, pixels]) => {
      const distance = Math.abs(width - pixels);

      return distance < best.distance ? { distance, size } : best;
    }, { distance: Infinity, size: defaultHandleSizePreset }).size;
}

function getHandleWindowSize(size = defaultHandleSizePreset) {
  const pixels = handleWindowSizePresets[normaliseHandleSizePreset(size)];

  return {
    height: pixels,
    width: pixels
  };
}

function normaliseHandleBounds(bounds) {
  const handleWindowSize = getHandleWindowSize(getHandleSizePresetForBounds(bounds));
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
  const handleWindowSize = getHandleWindowSize(getHandleSizePresetForBounds(bounds));

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

function isHandleBoundsAtDisplayCorner(bounds, display = screen.getDisplayMatching(bounds)) {
  const workArea = display.workArea;
  const minX = workArea.x + windowScreenMargin;
  const maxX = workArea.x + workArea.width - bounds.width - windowScreenMargin;
  const minY = workArea.y + windowScreenMargin;
  const maxY = workArea.y + workArea.height - bounds.height - windowScreenMargin;
  const isAtHorizontalCorner = Math.abs(bounds.x - minX) <= 1 || Math.abs(bounds.x - maxX) <= 1;
  const isAtVerticalCorner = Math.abs(bounds.y - minY) <= 1 || Math.abs(bounds.y - maxY) <= 1;

  return isAtHorizontalCorner && isAtVerticalCorner;
}

function getPrivateOverlayHandleBounds() {
  if (privateOverlayHandleWindow && !privateOverlayHandleWindow.isDestroyed()) {
    return privateOverlayHandleWindow.getBounds();
  }

  const state = readPrivateOverlayState();
  const handleWindowSize = getHandleWindowSize(state.handle.size);

  return {
    height: handleWindowSize.height,
    width: handleWindowSize.width,
    x: state.handle.x,
    y: state.handle.y
  };
}

function getAnchoredOverlayBounds(size = {}, { orientForEdge = true, restoreNonCompactWidth = true } = {}) {
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
  const widthMax = Math.max(minimumOverlayWindowSize.width, Math.min(maximumOverlayWindowSize.width, horizontalSpace));
  const heightMax = Math.max(minimumOverlayWindowSize.height, Math.min(maximumOverlayWindowSize.height, verticalSpace));
  const requestedWidth = Number(size.width);
  const requestedHeight = Number(size.height);
  const preferredOverlaySize = getPreferredOverlaySizeForEdge({
    height: Number.isFinite(requestedHeight)
      ? requestedHeight
      : state.overlay.height,
    width: Number.isFinite(requestedWidth)
      ? requestedWidth
      : restoreNonCompactWidth
        ? Math.max(Number(state.overlay.width), nonCompactOverlayTransitionWidth)
        : state.overlay.width
  }, edge, {
    minimumNonCompactWidth: restoreNonCompactWidth ? nonCompactOverlayTransitionWidth : 0,
    orient: orientForEdge
  });
  const preferredOverlayWidth = preferredOverlaySize.width;
  const preferredOverlayHeight = preferredOverlaySize.height;
  let width = clampNumber(preferredOverlayWidth, minimumOverlayWindowSize.width, widthMax, defaultAppWindowSize.width);
  let height = clampNumber(preferredOverlayHeight, minimumOverlayWindowSize.height, heightMax, defaultAppWindowSize.height);
  let x = workArea.x + windowScreenMargin;
  let y = workArea.y + windowScreenMargin;

  if (edge === 'top' || edge === 'bottom') {
    const availableHeight = Math.max(edge === 'top' ? bottomSpace : topSpace, minimumOverlayWindowSize.height);

    height = clampNumber(preferredOverlayHeight, minimumOverlayWindowSize.height, Math.min(heightMax, availableHeight), defaultAppWindowSize.height);
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
    const availableWidth = Math.max(edge === 'right' ? leftSpace : rightSpace, minimumOverlayWindowSize.width);

    width = clampNumber(preferredOverlayWidth, minimumOverlayWindowSize.width, Math.min(widthMax, availableWidth), defaultAppWindowSize.width);
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
    minimumOverlayWindowSize.width,
    Math.min(maximumOverlayWindowSize.width, workArea.width - (windowScreenMargin * 2)),
    defaultAppWindowSize.width
  );
  const height = clampNumber(
    Math.round(Number(bounds.height)),
    minimumOverlayWindowSize.height,
    Math.min(maximumOverlayWindowSize.height, workArea.height - (windowScreenMargin * 2)),
    defaultAppWindowSize.height
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

function getOverlayWindowBoundsForVisualBounds(bounds) {
  return {
    height: Math.max(1, Math.round(Number(bounds.height)) + (overlayWindowResizeOutset * 2)),
    width: Math.max(1, Math.round(Number(bounds.width)) + (overlayWindowResizeOutset * 2)),
    x: Math.round(Number(bounds.x)) - overlayWindowResizeOutset,
    y: Math.round(Number(bounds.y)) - overlayWindowResizeOutset
  };
}

function getVisualBoundsForOverlayWindowBounds(bounds) {
  return {
    height: Math.max(minimumOverlayWindowSize.height, Math.round(Number(bounds.height)) - (overlayWindowResizeOutset * 2)),
    width: Math.max(minimumOverlayWindowSize.width, Math.round(Number(bounds.width)) - (overlayWindowResizeOutset * 2)),
    x: Math.round(Number(bounds.x)) + overlayWindowResizeOutset,
    y: Math.round(Number(bounds.y)) + overlayWindowResizeOutset
  };
}

function getPrivateOverlayWindowVisualBounds() {
  if (privateOverlayWindow && !privateOverlayWindow.isDestroyed()) {
    return getVisualBoundsForOverlayWindowBounds(privateOverlayWindow.getBounds());
  }

  return readPrivateOverlayState().overlay;
}

function setPrivateOverlayWindowVisualBounds(bounds, animate = false) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    return null;
  }

  const visualBounds = clampOverlayBoundsToDisplay(bounds);
  privateOverlayWindow.setBounds(getOverlayWindowBoundsForVisualBounds(visualBounds), animate);
  return visualBounds;
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
  const handleWindowSize = getHandleWindowSize(readPrivateOverlayState().handle.size);
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

  const bounds = getAnchoredOverlayBounds(size, {
    orientForEdge: false,
    restoreNonCompactWidth: false
  });

  setPrivateOverlayWindowVisualBounds(bounds);

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
  const overlayBounds = hasOverlayWindow ? getPrivateOverlayWindowVisualBounds() : state.overlay;

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
let localTranscriptionModelId = null;
let localTranscriptionStdout = '';
const localTranscriptionStopFlush = createStopFlushController();
let localParakeetDaemonProcess = null;
let localParakeetDaemonStdout = '';
let persistentPiRpcBridge = null;
let backupPersistentPiRpcBridge = null;
let packagedLaunchSmokeCompleted = false;
let llmWarmStatus = isPiLlmBridgeEnabled() ? 'warming' : 'disabled';
let historyService = null;
let localLlmService = null;
let profileService = null;

function isPiLlmBridgeEnabled() {
  if (rendererRealLlmSmoke) {
    return true;
  }

  if (piLlmBridgeMode) {
    return ['1', 'enabled', 'on', 'pi', 'true', 'yes'].includes(piLlmBridgeMode);
  }

  return Boolean(readSetupState().selectedPiModel || getInferredPiModelFromAuth());
}

function assertPiLlmBridgeEnabled() {
  if (!isPiLlmBridgeEnabled()) {
    throw new Error('AI is not configured yet. Open onboarding or Settings to sign in with ChatGPT or set up local AI.');
  }
}

function writeTranscriptDebugLog(stage, payload = {}) {
  if (!isTranscriptDebugLogEnabled()) {
    return;
  }

  const entry = {
    at: new Date().toISOString(),
    pid: process.pid,
    stage,
    ...payload
  };

  console.log(`caul-transcript-debug ${JSON.stringify(entry)}`);

  try {
    if (!transcriptDebugLogPath) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      fsSync.mkdirSync(logDir, { recursive: true });
      transcriptDebugLogPath = path.join(logDir, 'transcript-debug.jsonl');
    }

    fsSync.appendFileSync(transcriptDebugLogPath, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error(`caul-transcript-debug-write-failed ${error.message}`);
  }
}

function isTranscriptDebugLogEnabled() {
  return process.env.CAUL_TRANSCRIPT_DEBUG_LOG === '1' || getAppChannel() === 'dev';
}

function emitTranscriptionEvent(event) {
  if (process.env.CAUL_BENCH_TRANSCRIPTION_EVENT_LOG === '1' && event.name !== 'frame_received_at') {
    console.log(`caul-transcription-event ${JSON.stringify(event)}`);
  }

  writeTranscriptDebugLog('electron.emit_transcription_event', { event });

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('caul:transcription-event', event);
  });
}

function emitLlmStatus() {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('caul:llm-status', {
      ok: true,
      ready: llmWarmStatus === 'ready',
      status: llmWarmStatus
    });
  });
}

async function getPermissionsStatus() {
  const isMac = process.platform === 'darwin';
  const screenRecordingStatus = isMac
    ? await getScreenRecordingPermissionStatus()
    : 'unsupported';
  const systemAudioStatus = isMac
    ? getSystemAudioPermissionStatus()
    : 'unsupported';

  return {
    ok: true,
    platform: process.platform,
    permissions: [
      {
        description: 'Required when listening to speaker audio output.',
        id: 'screen-recording',
        label: 'Screen & System Audio Recording',
        status: screenRecordingStatus
      },
      {
        description: 'Required when listening to audio from other apps.',
        id: 'system-audio',
        label: 'System Audio',
        status: systemAudioStatus
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

function getSystemAudioPermissionStatus() {
  return getSystemAudioPermissionStatusFromState(readSetupState());
}

async function getScreenRecordingPermissionStatus() {
  const electronStatus = mapMacMediaAccessStatus(systemPreferences.getMediaAccessStatus('screen'));

  if (electronStatus === 'granted') {
    return electronStatus;
  }

  const helperStatus = await getAudioHelperScreenCapturePermissionStatus(false);

  if (helperStatus === 'granted') {
    return helperStatus;
  }

  return electronStatus;
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

    if (!granted) {
      openPermissionsSettings(permission);
    }

    return { ok: granted };
  }

  if (permission === 'screen-recording') {
    const status = await getAudioHelperScreenCapturePermissionStatus(true);

    if (status === 'granted') {
      return { ok: true };
    }

    return {
      ok: false,
      message: 'macOS did not grant Screen & System Audio Recording yet.'
    };
  }

  if (permission === 'system-audio') {
    return requestSystemAudioPermission();
  }

  return { ok: false, message: 'Unknown permission.' };
}

async function requestSystemAudioPermission() {
  writeSetupState(getSystemAudioPermissionRequestedState());

  try {
    const result = await runSystemAudioPermissionProbe();

    if (result.ok) {
      writeSetupState(getSystemAudioPermissionGrantedState());

      return { ok: true };
    }

    writeSetupState(getSystemAudioPermissionDeniedState());
    openPermissionsSettings('system-audio');

    return {
      ok: false,
      message: result.message ?? 'macOS did not grant System Audio permission yet.'
    };
  } catch (error) {
    writeSetupState(getSystemAudioPermissionDeniedState());
    openPermissionsSettings('system-audio');

    return {
      ok: false,
      message: error instanceof Error ? error.message : 'macOS did not grant System Audio permission yet.'
    };
  }
}

function runSystemAudioPermissionProbe() {
  return new Promise((resolve, reject) => {
    const command = getAudioHelperCommand(['--stream-system-audio', '--duration', '3']);
    const child = spawn(command.command, command.args, {
      cwd: getProjectRoot(),
      env: {
        ...process.env,
        ...getAudioHelperEnvironment()
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    let settled = false;
    let sawCaptureOutput = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      resolve({
        ok: false,
        message: 'Timed out waiting for macOS System Audio permission.'
      });
    }, 10000);

    const settle = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve(value);
    };

    const reader = readline.createInterface({ input: child.stdout });

    reader.on('line', (line) => {
      let event;

      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (isSystemAudioPermissionProbeGrantedEvent(event)) {
        sawCaptureOutput = true;
        settle({ ok: true });
        return;
      }

      if (event?.type === 'permission_error') {
        settle({
          ok: false,
          message: event.message ?? 'macOS did not grant System Audio permission yet.'
        });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (sawCaptureOutput) {
        resolve({ ok: true });
        return;
      }

      resolve({
        ok: false,
        message: stderr.trim() || `System Audio permission probe exited with code ${code}.`
      });
    });
  });
}

async function getAudioHelperScreenCapturePermissionStatus(request) {
  const command = getAudioHelperCommand([
    request ? '--request-screen-capture-permission' : '--screen-capture-permission-status'
  ]);

  try {
    const event = await runJsonLineCommand(command, 8000);

    if (event?.type === 'screen_capture_permission' && event.text === 'granted') {
      return 'granted';
    }

    const electronStatus = mapMacMediaAccessStatus(systemPreferences.getMediaAccessStatus('screen'));

    return electronStatus === 'unknown' ? 'not-determined' : electronStatus;
  } catch {
    return mapMacMediaAccessStatus(systemPreferences.getMediaAccessStatus('screen'));
  }
}

function runJsonLineCommand(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      reject(new Error('Timed out waiting for helper response.'));
    }, timeoutMs);

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const reader = readline.createInterface({ input: child.stdout });

    reader.on('line', (line) => {
      try {
        settle(resolve, JSON.parse(line));
      } catch {
        // Ignore non-JSON helper output.
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => settle(reject, error));
    child.on('close', (code) => {
      if (!settled) {
        settle(reject, new Error(stderr.trim() || `Helper exited with code ${code}.`));
      }
    });
  });
}

async function isPermissionSetupComplete() {
  const status = await getPermissionsStatus();

  return status.permissions.every((permission) => (
    permission.status === 'granted' || permission.status === 'unsupported'
  ));
}

function validateParakeetModelDir(modelDir = getParakeetModelPath()) {
  try {
    return parakeetRequiredFiles.every((fileName) => fsSync.existsSync(path.join(modelDir, fileName)));
  } catch {
    return false;
  }
}

function validateMoonshineTinyModelDir(modelDir = getMoonshineTinyModelPath()) {
  try {
    return [
      'frontend.ort',
      'encoder.ort',
      'adapter.ort',
      'cross_kv.ort',
      'decoder_kv.ort',
      'streaming_config.json',
      'tokenizer.bin'
    ].every((fileName) => fsSync.existsSync(path.join(modelDir, fileName)));
  } catch {
    return false;
  }
}

function validateLocalTranscriptionModel(modelId = getPreferredLocalModelId()) {
  return modelId === 'moonshine-tiny'
    ? validateMoonshineTinyModelDir()
    : validateParakeetModelDir();
}

function normaliseLocalTranscriptionModelId(modelId) {
  return modelId === 'moonshine-tiny' ? 'moonshine-tiny' : 'parakeet';
}

function getSelectedLocalTranscriptionModelId() {
  const selectedModel = readProfileSettings().selectedLocalTranscriptionModel;

  return selectedModel === 'parakeet' || selectedModel === 'moonshine-tiny'
    ? selectedModel
    : null;
}

function getPreferredLocalModelId() {
  const selectedModel = getSelectedLocalTranscriptionModelId();

  if (selectedModel) {
    return selectedModel;
  }

  const recommendation = getTranscriptionRecommendation();
  return recommendation.recommendedModel?.id ?? 'parakeet';
}

function getParakeetStatus(modelId = getPreferredLocalModelId()) {
  if (parakeetDownload || localModelDownload) {
    const download = parakeetDownload ?? localModelDownload;
    return {
      ok: true,
      installed: false,
      modelId: download.modelId,
      modelName: download.modelName,
      progress: download.progress,
      status: 'downloading'
    };
  }

  const normalisedModelId = normaliseLocalTranscriptionModelId(modelId);
  const installed = validateLocalTranscriptionModel(normalisedModelId);

  return {
    ok: true,
    installed,
    modelDir: getLocalModelPath(normalisedModelId),
    modelId: normalisedModelId,
    modelName: normalisedModelId === 'moonshine-tiny' ? 'Moonshine tiny' : 'Parakeet v3',
    status: installed ? 'installed' : 'missing'
  };
}

function setPreferredLocalTranscriptionModel(modelId) {
  const selectedLocalTranscriptionModel = normaliseLocalTranscriptionModelId(modelId);

  updateProfileSettings({ selectedLocalTranscriptionModel });
  emitParakeetStatus();

  return getParakeetStatus(selectedLocalTranscriptionModel);
}

function getTranscriptionRecommendation() {
  const state = readSetupState();
  const cached = state.transcriptionRecommendation;

  if (
    cached
    && typeof cached === 'object'
    && typeof cached.createdAtMs === 'number'
    && Date.now() - cached.createdAtMs < transcriptionRecommendationTtlMs
  ) {
    return cached;
  }

  const recommendation = buildTranscriptionRecommendation();
  writeSetupState({ transcriptionRecommendation: recommendation });

  return recommendation;
}

function buildTranscriptionRecommendation() {
  const profile = getLocalSystemProfile();
  const catalogue = getModelCatalogue();
  const benchmarkRecommendation = recommendFromCatalogue(catalogue, profile);
  const cpuCores = profile.cpuCores;
  const totalMemoryGb = profile.totalMemoryGb;
  const freeMemoryGb = profile.freeMemoryGb;
  const probe = runShortMachineProbe();
  const isAppleSilicon = profile.accelerator === 'apple-silicon';
  const parakeetScore = Math.round(
    (totalMemoryGb * 5)
    + (cpuCores * 7)
    + Math.min(40, probe.score)
    + (isAppleSilicon ? 35 : 0)
  );
  const moonshineScore = Math.round(
    (totalMemoryGb * 8)
    + (cpuCores * 10)
    + Math.min(45, probe.score)
  );
  const recommended = benchmarkRecommendation.transcription.recommendation;
  const recommendedModel = benchmarkRecommendation.transcription.model
    ? {
      id: benchmarkRecommendation.transcription.model.id,
      name: benchmarkRecommendation.transcription.model.name,
      reason: benchmarkRecommendation.transcription.reason
    }
    : undefined;
  const autoDownloadModel = process.env.CAUL_DISABLE_MODEL_AUTO_DOWNLOAD !== '1';

  return {
    ok: true,
    autoDownloadParakeet: autoDownloadModel && Boolean(recommendedModel),
    autoDownloadModel: autoDownloadModel && Boolean(recommendedModel),
    benchmark: {
      catalogueLastReviewed: catalogue.lastReviewed,
      recommendationSource: benchmarkRecommendation.transcription.source,
      staleEntries: benchmarkRecommendation.staleCatalogueEntries
    },
    createdAtMs: Date.now(),
    recommended,
    recommendedModel,
    resources: {
      accelerator: profile.accelerator,
      arch: profile.arch,
      cpuCores,
      freeMemoryGb,
      gpu: profile.gpu,
      localRuntimes: profile.localRuntimes,
      platform: profile.platform,
      totalMemoryGb
    },
    score: {
      machineProbeIterationsPerMs: probe.iterationsPerMs,
      parakeet: parakeetScore,
      moonshineTiny: moonshineScore
    },
    status: 'ready',
    summary: recommended === 'local-parakeet'
      ? 'Recommended: Parakeet local transcription'
      : recommended === 'local-moonshine-tiny'
        ? 'Recommended: Moonshine local transcription'
        : 'No local transcription model is recommended for this machine'
  };
}

function getAiRecommendation() {
  const profile = getLocalSystemProfile();
  const catalogue = getModelCatalogue();
  const benchmarkRecommendation = recommendFromCatalogue(catalogue, profile, {
    benchmarkCache: readLocalAiBenchmarkCache()
  });
  const recommendedProvider = benchmarkRecommendation.ai.recommendation === 'cloud' ? 'cloud' : 'local';

  return {
    benchmark: {
      catalogueLastReviewed: catalogue.lastReviewed,
      recommendationSource: benchmarkRecommendation.ai.source,
      staleEntries: benchmarkRecommendation.staleCatalogueEntries
    },
    benchmarkRequired: benchmarkRecommendation.ai.benchmarkRequired,
    candidateScore: benchmarkRecommendation.ai.candidateScore,
    fallbackCandidateId: benchmarkRecommendation.ai.fallbackCandidateId,
    fitFailures: benchmarkRecommendation.ai.fitFailures,
    localRuntime: benchmarkRecommendation.ai.localRuntime,
    modelOptimisationProfile: benchmarkRecommendation.ai.modelOptimisationProfile,
    performanceStatus: benchmarkRecommendation.ai.performanceStatus,
    provider: getSelectedAiProvider(recommendedProvider),
    recommended: benchmarkRecommendation.ai.recommendation,
    recommendedModel: benchmarkRecommendation.ai.model
      ? {
        id: benchmarkRecommendation.ai.model.id,
        name: benchmarkRecommendation.ai.model.name,
        reason: benchmarkRecommendation.ai.reason,
        runtime: benchmarkRecommendation.ai.model.runtime
      }
      : null,
    resources: profile,
    selectionReason: benchmarkRecommendation.ai.selectionReason,
    status: 'ready',
    summary: benchmarkRecommendation.ai.recommendation === 'local'
      ? `Recommended: ${benchmarkRecommendation.ai.model.name} local AI responses`
      : benchmarkRecommendation.ai.recommendation === 'cloud'
        ? 'Cloud AI is recommended for this machine'
        : 'No AI response model is recommended for this machine',
    viable: benchmarkRecommendation.ai.viable
  };
}

function getModelCatalogue() {
  try {
    return loadBestModelCatalogue({
      allowLive: true,
      userDataPath: app.getPath('userData')
    });
  } catch (error) {
    console.error('Failed to load model catalogue:', error);

    return {
      version: 1,
      lastReviewed: 'unknown',
      sources: {
        asrLeaderboard: { name: 'Hugging Face Open ASR Leaderboard' },
        llmLeaderboard: { name: 'Artificial Analysis LLM Leaderboard' }
      },
      transcription: [],
      aiResponse: []
    };
  }
}

function getLocalAiBenchmarkCachePath() {
  return path.join(app.getPath('userData'), 'model-catalogue', 'local-ai-benchmarks.json');
}

function readLocalAiBenchmarkCache() {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(getLocalAiBenchmarkCachePath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalAiBenchmarkCache(cache) {
  const cachePath = getLocalAiBenchmarkCachePath();
  fsSync.mkdirSync(path.dirname(cachePath), { recursive: true });
  fsSync.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function getLocalAiBenchmarkCacheKey(model, profile = getLocalSystemProfile()) {
  const recommendation = recommendFromCatalogue(getModelCatalogue(), profile);
  const optimisationProfile = recommendation.ai.modelOptimisationProfile;

  return getBenchmarkCacheKey(model, optimisationProfile);
}

async function benchmarkLocalAiModel(modelId = getPreferredLocalAiModelId(), { timeoutMs = 12_000 } = {}) {
  const service = getLocalLlmService();
  const model = service.getModelById(modelId);

  if (!model) {
    throw new Error('Requested local AI model is not available for this machine.');
  }

  const profile = getLocalSystemProfile();
  const cacheKey = getLocalAiBenchmarkCacheKey(model, profile);
  const benchmark = await service.benchmark(model.id, { timeoutMs });
  const cache = readLocalAiBenchmarkCache();
  cache[cacheKey] = {
    ...benchmark,
    createdAtMs: Date.now(),
    machineFingerprint: recommendFromCatalogue(getModelCatalogue(), profile).ai.modelOptimisationProfile.machineFingerprint,
    modelId: model.id,
    quantisation: model.quantisation,
    runtime: model.runtime
  };
  writeLocalAiBenchmarkCache(cache);

  return benchmark;
}

let liveModelCatalogueRefreshPromise = null;
let onboardingLiveModelCatalogueRefreshAttempted = false;

async function refreshLiveModelCatalogue({ includeStatus = true, resetRuntime = true, timeoutMs = 0 } = {}) {
  const baseCatalogue = loadBestModelCatalogue({
    allowLive: true,
    userDataPath: app.getPath('userData')
  });
  const refreshTask = refreshModelCatalogue(baseCatalogue)
    .then((result) => ({
      result,
      livePath: writeLiveModelCatalogue(app.getPath('userData'), result.catalogue)
    }));
  const { result, livePath } = timeoutMs > 0
    ? await withTimeout(refreshTask, timeoutMs, 'Model catalogue refresh timed out.')
    : await refreshTask;

  writeSetupState({ transcriptionRecommendation: null });

  if (resetRuntime) {
    localLlmService?.stop?.();
    localLlmService = null;
  }

  return {
    ok: true,
    livePath,
    reviewedAt: result.reviewedAt,
    sourceReports: result.sourceReports,
    ...(includeStatus ? { status: await getOnboardingStatus({ refreshCatalogue: false }) } : {})
  };
}

async function ensureLiveModelCatalogueForOnboarding() {
  if (onboardingLiveModelCatalogueRefreshAttempted) {
    return;
  }

  const settings = readProfileSettings();
  if (settings.autoUpdateAiModel === false && settings.autoUpdateTranscriptionModel === false) {
    return;
  }

  const currentCatalogue = loadBestModelCatalogue({
    allowLive: true,
    userDataPath: app.getPath('userData')
  });
  if (currentCatalogue.source === 'live-cache') {
    return;
  }

  onboardingLiveModelCatalogueRefreshAttempted = true;

  try {
    await refreshLiveModelCatalogue({
      includeStatus: false,
      resetRuntime: false,
      timeoutMs: onboardingModelCatalogueRefreshTimeoutMs
    });
  } catch (error) {
    console.error('Onboarding model catalogue refresh failed; using bundled fallback:', error);
    loadBestModelCatalogue({
      allowLive: false,
      userDataPath: app.getPath('userData')
    });
  }
}

async function refreshLiveModelCatalogueAfterUpdateCheck() {
  const settings = readProfileSettings();

  if (!readSetupState().onboardingCompletedAt) {
    return;
  }

  if (settings.autoUpdateAiModel === false && settings.autoUpdateTranscriptionModel === false) {
    return;
  }

  if (captureStatus.state !== 'idle' || localTranscriptionActive) {
    return;
  }

  if (!liveModelCatalogueRefreshPromise) {
    liveModelCatalogueRefreshPromise = refreshLiveModelCatalogue({ includeStatus: false, resetRuntime: false })
      .catch((error) => {
        console.error('Scheduled model catalogue refresh failed:', error);
      })
      .finally(() => {
        liveModelCatalogueRefreshPromise = null;
      });
  }

  await liveModelCatalogueRefreshPromise;
  localLlmService?.stop?.();
  localLlmService = null;
  await reconcileAutoUpdatedModels();
}

async function reconcileAutoUpdatedModels() {
  const settings = readProfileSettings();

  if (process.env.CAUL_DISABLE_MODEL_AUTO_DOWNLOAD === '1') {
    return;
  }

  if (captureStatus.state !== 'idle' || localTranscriptionActive) {
    return;
  }

  if (settings.autoUpdateTranscriptionModel !== false) {
    try {
      await reconcileAutoUpdatedTranscriptionModel();
    } catch (error) {
      console.error('Automatic transcription model update failed:', error);
    }
  }

  if (settings.autoUpdateAiModel !== false && getSelectedAiProvider() === 'local') {
    try {
      await reconcileAutoUpdatedLocalAiModel();
    } catch (error) {
      console.error('Automatic local AI model update failed:', error);
    }
  }
}

async function reconcileAutoUpdatedTranscriptionModel() {
  const recommendation = getTranscriptionRecommendation();
  const recommendedModelId = recommendation.recommendedModel?.id;

  if (!recommendedModelId || !['parakeet', 'moonshine-tiny'].includes(recommendedModelId)) {
    return;
  }

  const currentModelId = getSelectedLocalTranscriptionModelId();
  if (currentModelId === recommendedModelId && validateLocalTranscriptionModel(recommendedModelId)) {
    return;
  }

  const status = await downloadLocalTranscriptionModel(recommendedModelId);
  if (status.installed && status.modelId === recommendedModelId) {
    setPreferredLocalTranscriptionModel(recommendedModelId);
  }
}

async function reconcileAutoUpdatedLocalAiModel() {
  const recommendation = getAiRecommendation();
  const recommendedModelId = recommendation.recommendedModel?.id;

  if (recommendation.recommended !== 'local' || !recommendedModelId) {
    return;
  }

  const model = getModelCatalogue().aiResponse.find((candidate) => candidate.id === recommendedModelId) ?? null;
  const fit = model ? getCurrentMemoryFit(model, getLocalSystemProfile()) : { ok: false };

  if (!fit.ok) {
    return;
  }

  const currentModelId = getSelectedLocalAiModelId();
  if (
    currentModelId === recommendedModelId
    && ['ready', 'warm', 'warming'].includes(getLocalLlmService().status(recommendedModelId).status)
  ) {
    return;
  }

  const status = await downloadLocalAiModel(recommendedModelId);
  if (status.status === 'ready' && status.model?.id === recommendedModelId) {
    setPreferredLocalAiModel(recommendedModelId);
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
}

function getLocalLlmService() {
  if (!localLlmService) {
    localLlmService = createLocalLlmService({
      app,
      catalogue: getModelCatalogue(),
      emitStatus: emitLocalLlmStatus
    });
  }

  return localLlmService;
}

function refreshLocalLlmService() {
  localLlmService?.stop?.();
  localLlmService = createLocalLlmService({
    app,
    catalogue: getModelCatalogue(),
    emitStatus: emitLocalLlmStatus
  });

  return localLlmService;
}

function getLocalLlmServiceForModel(modelId) {
  const service = getLocalLlmService();

  if (!modelId || service.getModelById(modelId)) {
    return service;
  }

  return refreshLocalLlmService();
}

function emitLocalLlmStatus() {
  const status = getLocalLlmService().status(getSelectedLocalAiModelId());

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('caul:local-llm-status', status);
  });
}

function getLocalSystemProfile() {
  const profile = buildSystemProfile();
  profile.localRuntimes.caulLlamaCpp = getLocalLlmService().status(getSelectedLocalAiModelId());

  return profile;
}

function getSelectedLocalAiModelId() {
  return getUsableSelectedLocalAiModelId({
    selectedModelId: readProfileSettings().selectedLocalAiModel,
    service: getLocalLlmService()
  });
}

function getPreferredLocalAiModelId() {
  return getSelectedLocalAiModelId() ?? getLocalLlmService().getRecommendedModel()?.id ?? null;
}

function setPreferredLocalAiModel(modelId) {
  const service = getLocalLlmServiceForModel(modelId);
  const model = service.getModelById(modelId);

  if (!model) {
    throw new Error('Requested local AI model is not available for this machine.');
  }

  updateProfileSettings({ selectedLocalAiModel: model.id });
  emitLocalLlmStatus();
  if (getSelectedAiProvider() === 'local') {
    void warmSelectedLocalAiIfReady('model-selected');
  }

  return service.status(model.id);
}

async function downloadLocalAiModel(modelId = getPreferredLocalAiModelId()) {
  const service = getLocalLlmServiceForModel(modelId);
  const model = service.getModelById(modelId);

  if (!model) {
    throw new Error('Requested local AI model is not available for this machine.');
  }

  const status = await service.download(model.id);
  updateProfileSettings({ selectedLocalAiModel: model.id });
  emitLocalLlmStatus();
  if (getSelectedAiProvider() === 'local') {
    void warmSelectedLocalAiIfReady('download-complete');
  }

  return status;
}

function isLocalAiRuntimeInstalled(status) {
  return Boolean(
    status
    && status.runtime?.supported
    && status.runtime?.installed
    && status.model?.installed
  );
}

function isLocalAiRuntimeWarmable(status) {
  return Boolean(
    isLocalAiRuntimeInstalled(status)
    && status.status !== 'downloading'
    && status.status !== 'missing'
  );
}

async function warmSelectedLocalAiIfReady(reason = 'startup') {
  if (getSelectedAiProvider() !== 'local') {
    return getLocalLlmService().status(getSelectedLocalAiModelId());
  }

  const modelId = getPreferredLocalAiModelId();
  const service = getLocalLlmServiceForModel(modelId);
  const status = service.status(modelId);

  if (!isLocalAiRuntimeWarmable(status)) {
    return status;
  }

  try {
    return await service.warm(modelId);
  } catch (error) {
    console.error(`Local AI warm-up failed during ${reason}:`, error);
    emitLocalLlmStatus();
    return service.status(modelId);
  }
}

async function adaptLocalAiModelAfterBenchmark(modelId) {
  if (captureStatus.state !== 'idle' || localTranscriptionActive) {
    return;
  }

  const benchmark = await benchmarkLocalAiModel(modelId).catch((error) => ({
    failureReason: error.message,
    modelId,
    ok: false,
    status: 'failed'
  }));

  if (isLocalAiBenchmarkLiveCallReady(benchmark)) {
    return;
  }

  const nextRecommendation = getAiRecommendation();
  const fallbackModelId = nextRecommendation.recommended === 'local'
    && nextRecommendation.recommendedModel?.id !== modelId
    ? nextRecommendation.recommendedModel.id
    : nextRecommendation.fallbackCandidateId;

  if (!fallbackModelId || fallbackModelId === modelId) {
    return;
  }

  const fallbackModel = getLocalLlmService().getModelById(fallbackModelId);
  const fit = fallbackModel ? getCurrentMemoryFit(fallbackModel, getLocalSystemProfile()) : { ok: false };
  if (!fallbackModel || !fit.ok) {
    return;
  }

  const fallbackStatus = await downloadLocalAiModel(fallbackModel.id);
  if (fallbackStatus.status === 'ready' || fallbackStatus.status === 'warm') {
    await benchmarkLocalAiModel(fallbackModel.id).catch((error) => {
      console.error('Fallback local AI benchmark failed:', error);
    });
  }
}

function isLocalAiBenchmarkLiveCallReady(benchmark) {
  return Boolean(
    benchmark?.ok
    && Number(benchmark.firstTokenMs ?? Infinity) <= localAiFirstTokenTargetMs
    && Number(benchmark.totalMs ?? Infinity) <= localAiTotalResponseTargetMs
    && Number(benchmark.tokensPerSecond ?? 0) >= 4
  );
}

function getSelectedAiProvider(fallbackProvider = defaultAiProvider) {
  const provider = readProfileSettings().selectedAiProvider;

  return provider === 'cloud' || provider === 'local' ? provider : fallbackProvider;
}

function setSelectedAiProvider(provider) {
  const selectedAiProvider = provider === 'cloud' ? 'cloud' : 'local';

  updateProfileSettings({ selectedAiProvider });
  if (selectedAiProvider === 'local') {
    void warmSelectedLocalAiIfReady('provider-selected');
  }

  return getOnboardingStatus();
}

function runShortMachineProbe() {
  const startedAt = process.hrtime.bigint();
  const durationNs = BigInt(75_000_000);
  let iterations = 0;
  let value = 0;

  while (process.hrtime.bigint() - startedAt < durationNs) {
    value = (value + Math.sqrt((iterations % 997) + 1)) % 1000;
    iterations += 1;
  }

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const iterationsPerMs = Math.round(iterations / Math.max(1, elapsedMs));

  return {
    iterationsPerMs,
    score: Math.min(40, Math.round(iterationsPerMs / 1200)),
    value
  };
}

function emitParakeetStatus() {
  const status = getParakeetStatus();

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('caul:parakeet-status', status);
  });
}

function downloadLocalTranscriptionModel(modelId = getPreferredLocalModelId()) {
  const selectedLocalTranscriptionModel = normaliseLocalTranscriptionModelId(modelId);
  updateProfileSettings({ selectedLocalTranscriptionModel });

  return selectedLocalTranscriptionModel === 'moonshine-tiny'
    ? downloadMoonshineTinyModel()
    : downloadParakeetModel();
}

function downloadParakeetModel(downloadUrl = parakeetArchiveUrl) {
  if (validateParakeetModelDir()) {
    return Promise.resolve(getParakeetStatus());
  }

  if (parakeetDownload) {
    return Promise.resolve(getParakeetStatus());
  }

  fsSync.mkdirSync(getParakeetModelRoot(), { recursive: true });

  const archivePath = path.join(getParakeetModelRoot(), 'parakeet-v3-int8.tar.gz');
  const temporaryPath = `${archivePath}.download`;
  const file = fsSync.createWriteStream(temporaryPath);
  const download = {
    file,
    modelId: 'parakeet',
    modelName: 'Parakeet v3',
    progress: {
      downloadedBytes: 0,
      percent: 0,
      totalBytes: null
    },
    request: null
  };
  parakeetDownload = download;
  emitParakeetStatus();

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      if (parakeetDownload === download) {
        parakeetDownload = null;
      }

      file.destroy();
      fsSync.rmSync(temporaryPath, { force: true });
      emitParakeetStatus();
      if (error?.message === 'Parakeet download cancelled.') {
        resolve(getParakeetStatus());
        return;
      }
      reject(error);
    };

    const request = https.get(downloadUrl, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        request.destroy();
        parakeetDownload = null;
        file.destroy();
        fsSync.rmSync(temporaryPath, { force: true });
        downloadParakeetModel(new URL(response.headers.location, downloadUrl).toString()).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        fail(new Error(`Parakeet download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const totalBytes = Number(response.headers['content-length']);
      download.progress.totalBytes = Number.isFinite(totalBytes) ? totalBytes : null;

      response.on('data', (chunk) => {
        download.progress.downloadedBytes += chunk.length;
        download.progress.percent = download.progress.totalBytes
          ? Math.min(100, Math.round((download.progress.downloadedBytes / download.progress.totalBytes) * 100))
          : 0;
        emitParakeetStatus();
      });

      response.pipe(file);
      file.once('finish', () => {
        file.close(() => {
          fsSync.renameSync(temporaryPath, archivePath);
          const tar = spawn('tar', ['-xzf', archivePath, '-C', getParakeetModelRoot()], {
            stdio: ['ignore', 'ignore', 'pipe']
          });
          const errors = [];

          tar.stderr.on('data', (chunk) => errors.push(chunk.toString()));
          tar.once('error', fail);
          tar.once('exit', (code) => {
            if (code !== 0) {
              fail(new Error(errors.join('').trim() || 'Failed to extract Parakeet model.'));
              return;
            }

            if (!validateParakeetModelDir()) {
              fail(new Error('Downloaded Parakeet model is missing required files.'));
              return;
            }

            fsSync.rmSync(archivePath, { force: true });

            if (parakeetDownload === download) {
              parakeetDownload = null;
            }

            emitParakeetStatus();
            resolve(getParakeetStatus());
          });
        });
      });
    });

    download.request = request;
    request.once('error', fail);
  });
}

function downloadMoonshineTinyModel(downloadUrl = moonshineTinyArchiveUrl) {
  if (validateMoonshineTinyModelDir()) {
    return Promise.resolve(getParakeetStatus());
  }

  if (localModelDownload) {
    return Promise.resolve(getParakeetStatus());
  }

  const modelPath = getMoonshineTinyModelPath();
  fsSync.mkdirSync(getParakeetModelRoot(), { recursive: true });

  const archivePath = path.join(getParakeetModelRoot(), 'moonshine-tiny-streaming-en.tar.gz');
  const temporaryPath = `${archivePath}.download`;
  const file = fsSync.createWriteStream(temporaryPath);
  const download = {
    file,
    modelId: 'moonshine-tiny',
    modelName: 'Moonshine tiny',
    progress: {
      downloadedBytes: 0,
      percent: 0,
      totalBytes: null
    },
    request: null
  };
  localModelDownload = download;
  emitParakeetStatus();

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      if (localModelDownload === download) {
        localModelDownload = null;
      }

      file.destroy();
      fsSync.rmSync(temporaryPath, { force: true });
      emitParakeetStatus();
      if (error?.message === 'Local model download cancelled.') {
        resolve(getParakeetStatus());
        return;
      }
      reject(error);
    };

    const request = https.get(downloadUrl, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        request.destroy();
        localModelDownload = null;
        file.destroy();
        fsSync.rmSync(temporaryPath, { force: true });
        downloadMoonshineTinyModel(new URL(response.headers.location, downloadUrl).toString()).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        fail(new Error(`Moonshine model download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const totalBytes = Number(response.headers['content-length']);
      download.progress.totalBytes = Number.isFinite(totalBytes) ? totalBytes : null;

      response.on('data', (chunk) => {
        download.progress.downloadedBytes += chunk.length;
        download.progress.percent = download.progress.totalBytes
          ? Math.min(100, Math.round((download.progress.downloadedBytes / download.progress.totalBytes) * 100))
          : 0;
        emitParakeetStatus();
      });

      response.pipe(file);
      file.once('finish', () => {
        file.close(() => {
          fsSync.renameSync(temporaryPath, archivePath);
          fsSync.rmSync(modelPath, { recursive: true, force: true });

          const tar = spawn('tar', ['-xzf', archivePath, '-C', getParakeetModelRoot()], {
            stdio: ['ignore', 'ignore', 'pipe']
          });
          const errors = [];

          tar.stderr.on('data', (chunk) => errors.push(chunk.toString()));
          tar.once('error', fail);
          tar.once('exit', (code) => {
            if (code !== 0) {
              fail(new Error(errors.join('').trim() || 'Failed to extract Moonshine model.'));
              return;
            }

            const nestedPath = path.join(getParakeetModelRoot(), 'moonshine-streaming', moonshineTinyModelDirName);
            if (!validateMoonshineTinyModelDir() && validateMoonshineTinyModelDir(nestedPath)) {
              fsSync.renameSync(nestedPath, modelPath);
              fsSync.rmSync(path.join(getParakeetModelRoot(), 'moonshine-streaming'), { recursive: true, force: true });
            }

            if (!validateMoonshineTinyModelDir()) {
              fail(new Error('Downloaded Moonshine model is missing required files.'));
              return;
            }

            fsSync.rmSync(archivePath, { force: true });

            if (localModelDownload === download) {
              localModelDownload = null;
            }

            emitParakeetStatus();
            resolve(getParakeetStatus());
          });
        });
      });
    });

    download.request = request;
    request.once('error', fail);
  });
}

function cancelParakeetDownload() {
  if (localModelDownload) {
    localModelDownload.request?.destroy(new Error('Local model download cancelled.'));
    localModelDownload.file?.destroy();
    localModelDownload = null;
    fsSync.rmSync(path.join(getParakeetModelRoot(), 'moonshine-tiny-streaming-en.tar.gz.download'), { force: true });
    emitParakeetStatus();

    return getParakeetStatus();
  }

  if (!parakeetDownload) {
    return getParakeetStatus();
  }

  parakeetDownload.request?.destroy(new Error('Parakeet download cancelled.'));
  parakeetDownload.file?.destroy();
  parakeetDownload = null;
  fsSync.rmSync(path.join(getParakeetModelRoot(), 'parakeet-v3-int8.tar.gz.download'), { force: true });
  emitParakeetStatus();

  return getParakeetStatus();
}

function removeLocalTranscriptionModel(modelId) {
  const selectedLocalTranscriptionModel = normaliseLocalTranscriptionModelId(modelId);

  if (selectedLocalTranscriptionModel === 'moonshine-tiny') {
    if (localModelDownload) {
      localModelDownload.request?.destroy(new Error('Local model download cancelled.'));
      localModelDownload.file?.destroy();
      localModelDownload = null;
    }

    fsSync.rmSync(getMoonshineTinyModelPath(), { recursive: true, force: true });
    fsSync.rmSync(path.join(getParakeetModelRoot(), 'moonshine-streaming'), { recursive: true, force: true });
    fsSync.rmSync(path.join(getParakeetModelRoot(), 'moonshine-tiny-streaming-en.tar.gz'), { force: true });
    fsSync.rmSync(path.join(getParakeetModelRoot(), 'moonshine-tiny-streaming-en.tar.gz.download'), { force: true });
  } else {
    if (parakeetDownload) {
      parakeetDownload.request?.destroy(new Error('Parakeet download cancelled.'));
      parakeetDownload.file?.destroy();
      parakeetDownload = null;
    }

    fsSync.rmSync(getParakeetModelPath(), { recursive: true, force: true });
    fsSync.rmSync(path.join(getParakeetModelRoot(), 'parakeet-v3-int8.tar.gz'), { force: true });
    fsSync.rmSync(path.join(getParakeetModelRoot(), 'parakeet-v3-int8.tar.gz.download'), { force: true });
  }

  emitParakeetStatus();

  return getParakeetStatus();
}

function getPiEnvironment() {
  return {
    ...process.env,
    PI_CODING_AGENT_DIR: getPiAgentDir(),
    PI_CODING_AGENT_SESSION_DIR: path.join(getPiAgentDir(), 'sessions'),
    ELECTRON_RUN_AS_NODE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0'
  };
}

function getPiCliPath() {
  if (app.isPackaged) {
    const bundledPath = path.join(
      process.resourcesPath,
      'pi',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'cli.js'
    );

    return fsSync.existsSync(bundledPath) ? bundledPath : null;
  }

  try {
    return require.resolve('@earendil-works/pi-coding-agent/dist/cli.js');
  } catch {
    const localPath = path.join(
      getProjectRoot(),
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'cli.js'
    );

    return fsSync.existsSync(localPath) ? localPath : null;
  }
}

function getPiSpawnCommand(args = []) {
  const cliPath = getPiCliPath();

  if (cliPath) {
    return {
      command: process.execPath,
      args: [cliPath, ...args]
    };
  }

  return {
    command: 'pi',
    args
  };
}

function getPiStatus() {
  const state = readSetupState();
  const cliPath = getPiCliPath();
  warmPiAuthStorage(cliPath);
  const selectedModel = typeof state.selectedPiModel === 'string' ? state.selectedPiModel : '';
  const inferredModel = selectedModel || getInferredPiModelFromAuth();
  const connected = Boolean(inferredModel);

  return {
    ok: true,
    agentDir: getPiAgentDir(),
    bundled: Boolean(cliPath),
    connected,
    selectedModel: inferredModel || null,
    status: connected ? 'ready' : 'disconnected'
  };
}

function getInferredPiModelFromAuth() {
  return getStoredPiAuthProviderIds().includes(defaultPiChatGptProvider)
    ? defaultPiChatGptModel
    : '';
}

function getStoredPiAuthProviderIds() {
  try {
    const auth = JSON.parse(fsSync.readFileSync(getPiAuthPath(), 'utf8'));

    return auth && typeof auth === 'object' ? Object.keys(auth) : [];
  } catch {
    return [];
  }
}

function openPiSetup(mode = 'login') {
  if (mode === 'chatgpt-login' || mode === 'login') {
    return openPiChatGptLogin();
  }

  return {
    ok: false,
    message: 'Cloud AI setup is handled inside Caul. Sign in with ChatGPT first.'
  };
}

function openPiChatGptLogin() {
  const cliPath = getPiCliPath();

  if (!cliPath) {
    return { ok: false, message: 'Bundled ChatGPT sign-in is unavailable.' };
  }

  fsSync.mkdirSync(getPiAgentDir(), { recursive: true });

  if (piChatGptLoginPromise) {
    return piChatGptLoginPromise;
  }

  piChatGptLoginPromise = runPiChatGptBrowserLogin(cliPath)
    .finally(() => {
      piChatGptLoginPromise = null;
    });

  return piChatGptLoginPromise;
}

async function runPiChatGptBrowserLogin(cliPath) {
  try {
    const { AuthStorage } = await (piAuthStorageImportPromise ?? importPiAuthStorage(cliPath));

    withPiInProcessEnvironment(() => {
      fsSync.mkdirSync(path.join(getPiAgentDir(), 'sessions'), { recursive: true });
    });

    await wait(50);

    const authStorage = AuthStorage.create(getPiAuthPath());
    await withPiInProcessEnvironmentAsync(() => authStorage.login(defaultPiChatGptProvider, {
      onAuth: (info) => {
        if (info?.url) {
          void openUrlInDefaultBrowser(info.url).catch((error) => {
            console.error('Failed to open ChatGPT sign-in URL in the default browser:', error);
          });
        }
      },
      onProgress: () => {},
      onPrompt: async () => {
        throw new Error('ChatGPT sign in did not complete in the browser.');
      }
    }));

    writeSetupState({ selectedPiModel: defaultPiChatGptModel });
    emitLlmStatus();

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function openUrlInDefaultBrowser(url) {
  if (process.platform !== 'darwin') {
    return shell.openExternal(url);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', [url], {
      detached: true,
      stdio: 'ignore'
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function importPiAuthStorage(cliPath) {
  const modulePath = path.join(path.dirname(cliPath), 'core', 'auth-storage.js');

  if (!fsSync.existsSync(modulePath)) {
    throw new Error('Bundled Pi auth storage is unavailable.');
  }

  return import(pathToFileURL(modulePath).href);
}

function warmPiAuthStorage(cliPath) {
  if (!cliPath || piAuthStorageImportPromise) {
    return;
  }

  piAuthStorageImportPromise = importPiAuthStorage(cliPath).catch((error) => {
    piAuthStorageImportPromise = null;
    console.error('Failed to warm Pi auth storage:', error);
  });
}

function getPiInProcessEnvironment() {
  return {
    PI_CODING_AGENT_DIR: getPiAgentDir(),
    PI_CODING_AGENT_SESSION_DIR: path.join(getPiAgentDir(), 'sessions'),
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0'
  };
}

function withPiInProcessEnvironment(callback) {
  const previous = getCurrentPiEnvironment();
  const next = getPiInProcessEnvironment();

  process.env.PI_CODING_AGENT_DIR = next.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = next.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_SKIP_VERSION_CHECK = next.PI_SKIP_VERSION_CHECK;
  process.env.PI_TELEMETRY = next.PI_TELEMETRY;

  try {
    return callback();
  } finally {
    restorePiEnvironment(previous);
  }
}

async function withPiInProcessEnvironmentAsync(callback) {
  const previous = getCurrentPiEnvironment();
  const next = getPiInProcessEnvironment();

  process.env.PI_CODING_AGENT_DIR = next.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = next.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_SKIP_VERSION_CHECK = next.PI_SKIP_VERSION_CHECK;
  process.env.PI_TELEMETRY = next.PI_TELEMETRY;

  try {
    return await callback();
  } finally {
    restorePiEnvironment(previous);
  }
}

function withPiEnvironment(callback) {
  const previous = getCurrentPiEnvironment();
  const next = getPiEnvironment();

  process.env.ELECTRON_RUN_AS_NODE = next.ELECTRON_RUN_AS_NODE;
  process.env.PI_CODING_AGENT_DIR = next.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = next.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_SKIP_VERSION_CHECK = next.PI_SKIP_VERSION_CHECK;
  process.env.PI_TELEMETRY = next.PI_TELEMETRY;

  try {
    return callback();
  } finally {
    restorePiEnvironment(previous);
  }
}

async function withPiEnvironmentAsync(callback) {
  const previous = getCurrentPiEnvironment();
  const next = getPiEnvironment();

  process.env.ELECTRON_RUN_AS_NODE = next.ELECTRON_RUN_AS_NODE;
  process.env.PI_CODING_AGENT_DIR = next.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = next.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_SKIP_VERSION_CHECK = next.PI_SKIP_VERSION_CHECK;
  process.env.PI_TELEMETRY = next.PI_TELEMETRY;

  try {
    return await callback();
  } finally {
    restorePiEnvironment(previous);
  }
}

function getCurrentPiEnvironment() {
  return {
    ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    PI_CODING_AGENT_SESSION_DIR: process.env.PI_CODING_AGENT_SESSION_DIR,
    PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK,
    PI_TELEMETRY: process.env.PI_TELEMETRY
  };
}

function restorePiEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function savePiModel(model) {
  const selectedPiModel = typeof model === 'string' ? model.trim() : '';

  if (!selectedPiModel) {
    return getPiStatus();
  }

  writeSetupState({ selectedPiModel });
  emitLlmStatus();

  return getPiStatus();
}

function disconnectPi() {
  persistentPiRpcBridge?.dispose();
  persistentPiRpcBridge = null;
  backupPersistentPiRpcBridge?.dispose();
  backupPersistentPiRpcBridge = null;
  fsSync.rmSync(getPiAgentDir(), { force: true, recursive: true });
  writeSetupState({ selectedPiModel: null });
  llmWarmStatus = 'disabled';
  emitLlmStatus();

  return getPiStatus();
}

async function getOnboardingStatus({ refreshCatalogue = true } = {}) {
  if (refreshCatalogue) {
    await ensureLiveModelCatalogueForOnboarding();
  }

  const permissions = await getPermissionsStatus();
  const permissionsComplete = permissions.permissions
    .filter((permission) => permission.id !== 'microphone')
    .every((permission) => (
      permission.status === 'granted' || permission.status === 'unsupported'
    ));
  const parakeet = getParakeetStatus();
  const pi = getPiStatus();
  const ai = getAiRecommendation();
  const transcription = getTranscriptionRecommendation();
  const profileSettings = readProfileSettings();
  const selectedLocalTranscriptionModel = getSelectedLocalTranscriptionModelId();
  const selectedAiProvider = ai.provider;
  const transcriptionModelReady = Boolean(
    selectedLocalTranscriptionModel
    && parakeet.installed
    && parakeet.modelId === selectedLocalTranscriptionModel
  );
  const complete = permissionsComplete && transcriptionModelReady;

  return {
    ok: true,
    autoUpdate: {
      ai: profileSettings.autoUpdateAiModel !== false,
      transcription: profileSettings.autoUpdateTranscriptionModel !== false
    },
    complete,
    completedAt: readSetupState().onboardingCompletedAt ?? null,
    ai,
    parakeet,
    permissions,
    pi,
    required: !complete,
    selectedLocalTranscriptionModel,
    transcription
  };
}

async function shouldShowOnboarding() {
  if (onboardingSmokeDir) {
    return true;
  }

  if (packagedOnboardingCompletionSmoke) {
    return !readSetupState().onboardingCompletedAt;
  }

  return (await getOnboardingStatus()).required;
}

function getAudioHelperCommand(args) {
  if (app.isPackaged) {
    const bundledPath = getBundledExecutablePath('CaulAudioHelper');

    if (fsSync.existsSync(bundledPath)) {
      return {
        command: bundledPath,
        args
      };
    }
  }

  const packagePath = path.join(__dirname, '..', 'native', 'macos-audio-helper');
  const releaseBinaryPath = path.join(packagePath, '.build', 'release', 'CaulAudioHelper');
  const debugBinaryPath = path.join(packagePath, '.build', 'debug', 'CaulAudioHelper');
  const binaryPath = fsSync.existsSync(releaseBinaryPath) ? releaseBinaryPath : debugBinaryPath;

  if (fsSync.existsSync(binaryPath)) {
    return {
      command: binaryPath,
      args
    };
  }

  return {
    command: 'swift',
    args: ['run', '--package-path', packagePath, 'CaulAudioHelper', ...args]
  };
}

function getSystemAudioHelperCommand() {
  const captureArg = '--stream-system-audio';

  return getDesktopBackendCommand([captureArg]);
}

function getAudioHelperEnvironment() {
  const bundledPath = getBundledExecutablePath('CaulAudioHelper');

  return fsSync.existsSync(bundledPath)
    ? { CAUL_AUDIO_HELPER_PATH: bundledPath }
    : {};
}

function getDesktopBackendCommand(args) {
  const backendName = process.platform === 'win32'
    ? 'caul-desktop-backend.exe'
    : 'caul-desktop-backend';

  if (app.isPackaged) {
    const bundledPath = getBundledExecutablePath(backendName);

    if (fsSync.existsSync(bundledPath)) {
      return {
        command: bundledPath,
        args
      };
    }
  }

  const releaseBinaryPath = path.join(__dirname, '..', 'target', 'release', backendName);
  const debugBinaryPath = path.join(__dirname, '..', 'target', 'debug', backendName);
  const binaryPath = fsSync.existsSync(releaseBinaryPath) ? releaseBinaryPath : debugBinaryPath;

  if (fsSync.existsSync(binaryPath)) {
    return {
      command: binaryPath,
      args
    };
  }

  return {
    command: 'cargo',
    args: ['run', '-p', 'caul-desktop-backend', '--', ...args]
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

  writeChildStdin(localParakeetDaemonProcess, { type }, 'local-parakeet-command');
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

function writeChildStdin(child, payload, stage) {
  if (!child?.stdin?.writable || child.stdin.destroyed) {
    writeTranscriptDebugLog('child_stdin_unavailable', { stage });
    return false;
  }

  try {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return true;
  } catch (error) {
    writeTranscriptDebugLog('child_stdin_write_failed', {
      message: error instanceof Error ? error.message : String(error),
      stage
    });
    return false;
  }
}

function stopLocalParakeetDaemon({ force = false } = {}) {
  if (!localParakeetDaemonProcess) {
    return;
  }

  const child = localParakeetDaemonProcess;

  if (localParakeetDaemonProcess.stdin?.writable) {
    writeChildStdin(localParakeetDaemonProcess, { type: 'quit' }, 'local-parakeet-quit');
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

function stopLocalTranscriptionWarmDaemon(force = false) {
  if (!localTranscriptionProcess) {
    return;
  }

  const child = localTranscriptionProcess;

  if (child.stdin?.writable) {
    writeChildStdin(child, { type: 'quit' }, 'local-transcription-quit');
    child.stdin.end();
  } else {
    child.kill('SIGTERM');
  }

  if (force) {
    child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
  }

  localTranscriptionProcess = null;
  localTranscriptionModelId = null;
  localTranscriptionStdout = '';
}

function startLocalTranscriptionWarmDaemon() {
  const modelId = getPreferredLocalModelId();
  if (localTranscriptionProcess && localTranscriptionModelId === modelId) {
    return { ok: true };
  }

  if (localTranscriptionProcess && localTranscriptionModelId !== modelId) {
    stopLocalTranscriptionWarmDaemon(true);
  }

  const helper = getDesktopBackendCommand(['--local-transcription-daemon']);
  const child = spawn(helper.command, helper.args, {
    cwd: getProjectRoot(),
    env: {
      ...process.env,
      ...getAudioHelperEnvironment(),
      CAUL_MODEL_ROOT: getParakeetModelRoot(),
      CAUL_PRELOAD_LOCAL_TRANSCRIPTION: '1',
      CAUL_TRANSCRIPTION_MODEL: modelId
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  localTranscriptionProcess = child;
  localTranscriptionModelId = modelId;
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
      localTranscriptionModelId = null;
      emitTranscriptionEvent({
        type: 'error',
        message: error.message
      });
    }
  });

  child.once('exit', (code, signal) => {
    if (localTranscriptionProcess === child) {
      localTranscriptionProcess = null;
      localTranscriptionModelId = null;
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

  return { ok: true, provider: modelId };
}

function prepareLocalTranscriptionCapture(options) {
  if (!validateLocalTranscriptionModel()) {
    return { ok: false, message: 'Download the recommended local transcription model in onboarding or Settings before listening.' };
  }

  startLocalTranscriptionWarmDaemon();

  const selectedSources = normaliseTranscriptionSources(options?.sources);

  if (selectedSources.length === 0 || !localTranscriptionProcess?.stdin?.writable) {
    return { ok: false };
  }

  writeTranscriptDebugLog('backend.prepare_requested', {
    selectedSources
  });

  writeChildStdin(localTranscriptionProcess, {
    type: 'prepare',
    sources: selectedSources
  }, 'local-transcription-prepare');

  return { ok: true, provider: getPreferredLocalModelId() };
}

function shouldWarmLocalTranscriptionOnStartup() {
  return process.env.CAUL_DISABLE_PARAKEET_WARMUP !== '1'
    && validateLocalTranscriptionModel()
    && process.platform === 'darwin'
    && smokeExitMs === 0
    && resourceSmokeMs === 0
    && systemAudioSmokeMs === 0
    && localParakeetSmokeMs === 0;
}

async function shouldPrepareLocalTranscriptionOnStartup() {
  if (process.env.CAUL_DISABLE_TRANSCRIPTION_HOT_PREPARE === '1') {
    return false;
  }

  if (!shouldWarmLocalTranscriptionOnStartup()) {
    return false;
  }

  const status = await getOnboardingStatus();

  if (status.required) {
    return false;
  }

  const permissionsById = new Map(
    status.permissions.permissions.map((permission) => [permission.id, permission])
  );
  const screenRecording = permissionsById.get('screen-recording');
  const systemAudio = permissionsById.get('system-audio');
  const ready = (permission) => (
    permission?.status === 'granted' || permission?.status === 'unsupported'
  );

  return ready(screenRecording) && ready(systemAudio);
}

async function prepareLocalTranscriptionOnStartup() {
  if (!(await shouldPrepareLocalTranscriptionOnStartup())) {
    return;
  }

  wait(750)
    .then(() => prepareLocalTranscriptionCapture({ sources: ['system'] }))
    .catch((error) => {
      writeTranscriptDebugLog('startup_hot_prepare_failed', {
        message: error instanceof Error ? error.message : String(error)
      });
    });
}

function startLocalTranscriptionCapture(options) {
  if (!validateLocalTranscriptionModel()) {
    throw new Error('Download the recommended local transcription model in onboarding or Settings before listening.');
  }

  startLocalTranscriptionWarmDaemon();
  localTranscriptionStopFlush.cancel('start');

  const selectedSources = normaliseTranscriptionSources(options?.sources);

  if (selectedSources.length === 0) {
    throw new Error('Select at least one audio source.');
  }

  if (!localTranscriptionProcess?.stdin?.writable) {
    throw new Error('Local transcription backend is unavailable.');
  }

  writeTranscriptDebugLog('backend.start_requested', {
    selectedSources
  });

  writeChildStdin(localTranscriptionProcess, {
    type: 'start',
    sources: selectedSources
  }, 'local-transcription-start');
  emitTranscriptionEvent({ type: 'connected' });

  return { ok: true, provider: getPreferredLocalModelId() };
}

function stopLocalTranscriptionCapture() {
  if (!localTranscriptionProcess) {
    return Promise.resolve({ ok: true });
  }

  if (localTranscriptionProcess.stdin?.writable) {
    const waitForFlush = localTranscriptionStopFlush.wait();
    writeChildStdin(localTranscriptionProcess, { type: 'stop' }, 'local-transcription-stop');

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
        console.log(`caul-llm-timing ${JSON.stringify({
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

    if (process.env.CAUL_PI_SESSION_DIR_MODE === 'app') {
      const sessionDir = path.join(app.getPath('userData'), 'pi-sessions');
      fsSync.mkdirSync(sessionDir, { recursive: true });
      args.push('--session-dir', sessionDir);
    }

    this.ready = true;
    this.exited = false;
    const pi = getPiSpawnCommand(args);
    this.child = spawn(pi.command, pi.args, {
      env: getPiEnvironment(),
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
      console.log(`caul-llm-timing ${JSON.stringify({
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
    const id = `caul-${this.nextId}`;
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
          console.log(`caul-llm-timing ${JSON.stringify({
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
    console.log(`caul-llm-timing ${JSON.stringify({
      event: 'electron_request_started',
      atMs: 0,
      trace
    })}`);
  }

  emitTranscriptionEvent({ type: 'llm-query', requestId, text: trimmedTranscript });
  const onDelta = (delta) => {
    if (rendererRealLlmSmoke) {
      console.log(`caul-llm-timing ${JSON.stringify({
        event: 'electron_delta_emit',
        atMs: Date.now() - requestStartedAt,
        chars: delta.length
      })}`);
    }

    emitTranscriptionEvent({ type: 'llm-response-delta', requestId, text: delta });
  };
  const selectedAiProvider = getSelectedAiProvider();
  const text = selectedAiProvider === 'local'
    ? await getLocalLlmService().request(
      await buildLocalLlmPromptWithAttachments(trimmedTranscript, attachments),
      { modelId: getSelectedLocalAiModelId(), onDelta }
    )
    : await requestCloudLlmResponse(trimmedTranscript, { ...options, attachments }, onDelta);
  emitTranscriptionEvent({ type: 'llm-response', requestId, text });

  return { ok: true, text };
}

function requestCloudLlmResponse(transcript, options, onDelta) {
  assertPiLlmBridgeEnabled();

  return runPiTextRequest(transcript, options, onDelta);
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
  const windowChars = Number(process.env.CAUL_LLM_TRANSCRIPT_WINDOW_CHARS ?? 0);
  const promptShape = process.env.CAUL_LLM_PROMPT_SHAPE ?? 'raw';
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
  const configuredModel = typeof readSetupState().selectedPiModel === 'string'
    ? readSetupState().selectedPiModel
    : getInferredPiModelFromAuth();
  const model = requestedModel
    || configuredModel
    || process.env.CAUL_LLM_MODEL
    || process.env.CAUL_BENCH_LLM_MODEL
    || 'openai-codex/gpt-5.4-mini';
  const thinking = allowedLlmThinking.has(requestedThinking)
    ? requestedThinking
    : process.env.CAUL_LLM_THINKING
    ?? process.env.CAUL_BENCH_LLM_THINKING
    ?? 'off';

  const requestStrategy = process.env.CAUL_LLM_REQUEST_STRATEGY ?? 'persistent';
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];

  if (attachments.length > 0) {
    return runPiAttachmentRequestWithTextFallback(
      transcript,
      { attachments, model, thinking },
      onDelta,
      runStartedAt
    );
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

  if (process.env.CAUL_LLM_DISABLE_PERSISTENT_PI !== '1') {
    return runPersistentPiRpcRequest(transcript, { model, thinking }, onDelta)
      .catch((error) => {
        if (rendererRealLlmSmoke) {
          console.error(`caul-pi-rpc-fallback ${error.message}`);
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

function runPiAttachmentRequestWithTextFallback(transcript, { attachments = [], model, thinking }, onDelta = () => {}, runStartedAt = Date.now()) {
  let emittedDelta = false;
  const trackedDelta = (delta) => {
    emittedDelta = true;
    onDelta(delta);
  };

  return runOneShotPiTextRequest(transcript, { attachments, model, thinking }, trackedDelta, runStartedAt)
    .catch(async (error) => {
      if (emittedDelta) {
        throw error;
      }

      const fallbackPrompt = await buildLocalLlmPromptWithAttachments(transcript, attachments);

      if (rendererRealLlmSmoke) {
        console.error(`caul-pi-attachment-fallback ${error.message}`);
      }

      return runOneShotPiTextRequest(fallbackPrompt, { attachments: [], model, thinking }, onDelta, runStartedAt);
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

  if (process.env.CAUL_LLM_DISABLE_PERSISTENT_PI === '1') {
    llmWarmStatus = 'ready';
    emitLlmStatus();
    return;
  }

  const model = readSetupState().selectedPiModel
    || getInferredPiModelFromAuth()
    || process.env.CAUL_LLM_MODEL
    || process.env.CAUL_BENCH_LLM_MODEL
    || 'openai-codex/gpt-5.4-mini';
  const thinking = process.env.CAUL_LLM_THINKING
    ?? process.env.CAUL_BENCH_LLM_THINKING
    ?? 'off';

  if (!allowedLlmThinking.has(thinking)) {
    llmWarmStatus = 'ready';
    emitLlmStatus();
    return;
  }

  llmWarmStatus = 'warming';
  emitLlmStatus();

  if (!persistentPiRpcBridge) {
    persistentPiRpcBridge = new PersistentPiRpcBridge({ model, thinking });
  }

  const warmupStrategy = process.env.CAUL_LLM_WARMUP_STRATEGY ?? 'hidden-prompt';
  const warmupPrompt = process.env.CAUL_LLM_WARMUP_PROMPT ?? 'Reply with OK.';
  const warmupCount = Math.max(1, Number(process.env.CAUL_LLM_WARMUP_COUNT ?? 1));
  const warmupTimeoutMs = Math.max(1_000, Number(process.env.CAUL_LLM_WARMUP_TIMEOUT_MS ?? 8_000));
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
      if (process.env.CAUL_LLM_PREWARM_BACKUP !== '1') {
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

      console.error(`caul-pi-rpc-warm-failed ${error.message}`);
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
      console.log(`caul-llm-timing ${JSON.stringify({
        event: 'pi_child_spawn_start',
        atMs: Date.now() - runStartedAt
      })}`);
    }

    const attachmentArgs = attachments.map((attachment) => `@${attachment.path}`);
    const pi = getPiSpawnCommand([
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
    ]);
    const child = spawn(pi.command, pi.args, {
      env: getPiEnvironment(),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const startedAt = Date.now();
    if (rendererRealLlmSmoke) {
      console.log(`caul-llm-timing ${JSON.stringify({
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
        console.log(`caul-pi-stdout ${Date.now() - startedAt} ${line.slice(0, 160)}`);
      }

      const timingEvent = piTimingEvent(line);

      if (rendererRealLlmSmoke && timingEvent) {
        console.log(`caul-llm-timing ${JSON.stringify({
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
        console.error(`caul-pi-stderr ${Date.now() - startedAt} ${chunk.toString()}`);
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
        console.error(`caul-pi-error ${Date.now() - startedAt} ${error.message}`);
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
        console.log(`caul-pi-exit ${Date.now() - startedAt} ${code}`);
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
  return Math.max(1_000, Number(process.env.CAUL_LLM_PERSISTENT_TIMEOUT_MS ?? 15_000));
}

function getLlmOneShotTimeoutMs() {
  return Math.max(1_000, Number(process.env.CAUL_LLM_ONE_SHOT_TIMEOUT_MS ?? 45_000));
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
  if (systemAudioProcess) {
    return { ok: true };
  }

  const helper = getSystemAudioHelperCommand();
  const child = spawn(helper.command, helper.args, {
    cwd: getProjectRoot(),
    env: {
      ...process.env,
      ...getAudioHelperEnvironment()
    },
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
    const url = new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');

    if (surface) {
      url.searchParams.set('caul-surface', surface);
    }

    console.log(`Loading dev renderer ${url.toString()}`);
    window.loadURL(url.toString());
    return;
  }

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
    ...(surface ? { query: { 'caul-surface': surface } } : {})
  });
}

function applyPrivateWindowProtection(window) {
  if (isDev) {
    window.setSkipTaskbar(false);

    try {
      window.setContentProtection(false);
    } catch {
      // Unsupported platforms should still keep the window usable.
    }

    applyPrivateWindowWorkspaceBehaviour(window);

    setPrivateWindowAlwaysOnTop(window);
    return;
  }

  if (process.env.CAUL_DISABLE_PRIVATE_WINDOW_PROTECTION === '1') {
    window.setSkipTaskbar(false);
    return;
  }

  window.setSkipTaskbar(true);

  if (shouldProtectPrivateWindowContent()) {
    setPrivateWindowContentProtection(window, true);
  } else {
    setPrivateWindowContentProtection(window, false);
  }

  applyPrivateWindowWorkspaceBehaviour(window);

  setPrivateWindowAlwaysOnTop(window);
}

function setPrivateWindowContentProtection(window, enabled) {
  try {
    window.setContentProtection(enabled);

    if (enabled) {
      packagedPrivacySmokeState.protectedWindows.add(window);
      applyWindowsNativeContentProtection(window);
    }
  } catch {
    // Unsupported platforms should still keep the overlay usable.
  }
}

function applyWindowsNativeContentProtection(window) {
  if (process.platform !== 'win32' || !window || window.isDestroyed()) {
    return;
  }

  try {
    const handle = window.getNativeWindowHandle();
    const hwnd = handle.length >= 8
      ? handle.readBigUInt64LE(0).toString()
      : String(handle.readUInt32LE(0));
    const command = getDesktopBackendCommand(['--protect-window-hwnd', hwnd]);
    const result = spawnSync(command.command, command.args, {
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    const text = String(result.stdout ?? '').trim();
    const errorText = String(result.stderr ?? '').trim();

    if (text) {
      console.log(text);

      try {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const parsed = JSON.parse(lines.at(-1) ?? '{}');

        if (parsed?.type === 'window_display_affinity') {
          packagedPrivacySmokeState.nativeProtection.set(window, parsed);
        }
      } catch {
        packagedPrivacySmokeState.nativeProtection.set(window, {
          ok: false,
          output: text,
          type: 'window_display_affinity'
        });
      }
    }

    if (errorText) {
      console.error(errorText);
    }
  } catch (error) {
    console.error(`window-display-affinity failed ${error.message}`);
  }
}

function refreshPrivateWindowContentProtection(window) {
  if (!window || window.isDestroyed() || !shouldProtectPrivateWindowContent()) {
    return;
  }

  setPrivateWindowContentProtection(window, true);
}

function refreshPrivateWindowContentProtectionSoon(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.once('show', () => refreshPrivateWindowContentProtection(window));
  window.webContents.once('did-finish-load', () => refreshPrivateWindowContentProtection(window));

  for (const delayMs of [50, 250, 1000]) {
    setTimeout(() => refreshPrivateWindowContentProtection(window), delayMs);
  }
}

function refreshDevPrivateAppWindowProtectionSoon(window) {
  if (!window || window.isDestroyed() || !shouldProtectAllAppWindows()) {
    return;
  }

  window.once('show', () => setPrivateWindowContentProtection(window, true));
  window.webContents.once('did-finish-load', () => setPrivateWindowContentProtection(window, true));

  for (const delayMs of [50, 250, 1000]) {
    setTimeout(() => {
      if (!window.isDestroyed()) {
        setPrivateWindowContentProtection(window, true);
      }
    }, delayMs);
  }
}

function applyPrivateWindowWorkspaceBehaviour(window) {
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
}

function setPrivateWindowAlwaysOnTop(window) {
  try {
    window.setAlwaysOnTop(true, 'floating');
  } catch {
    window.setAlwaysOnTop(true);
  }
}

function shouldProtectPrivateWindowContent() {
  if (process.env.CAUL_ENABLE_PRIVATE_WINDOW_PROTECTION === '1') {
    return true;
  }

  return !isDev && getAppChannel() !== 'dev';
}

function shouldProtectAllAppWindows() {
  return !isDev && getAppChannel() === 'dev-private';
}

function shouldUseOpaquePrivateWindowsForProtection() {
  return process.platform === 'win32' && shouldProtectPrivateWindowContent();
}

function createPrivateOverlayWindow() {
  if (privateOverlayWindow && !privateOverlayWindow.isDestroyed()) {
    return privateOverlayWindow;
  }

  const state = readPrivateOverlayState();
  const windowBounds = getOverlayWindowBoundsForVisualBounds(state.overlay);
  privateOverlayWindow = new BrowserWindow({
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: minimumOverlayWindowSize.width + (overlayWindowResizeOutset * 2),
    minHeight: minimumOverlayWindowSize.height + (overlayWindowResizeOutset * 2),
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: getAppDisplayName(),
    skipTaskbar: true,
    resizable: false,
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
  refreshPrivateWindowContentProtectionSoon(privateOverlayWindow);
  persistPrivateOverlayWindowState(privateOverlayWindow);
  loadRendererSurface(privateOverlayWindow, null);
  runPackagedLaunchSmokeIfRequested(privateOverlayWindow, 'private-overlay');

  privateOverlayWindow.on('blur', () => {
    setTimeout(() => {
      const window = privateOverlayWindow;

      if (isQuitting || !window || window.isDestroyed() || !window.isVisible() || window.isFocused()) {
        return;
      }

      if (
        onboardingWindow
        && !onboardingWindow.isDestroyed()
        && onboardingWindow.isFocused()
      ) {
        return;
      }

      hidePrivateOverlayWindow();
    }, 0);
  });

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

function createOnboardingWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    return onboardingWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const width = onboardingContentSize.width;
  const height = onboardingContentSize.initialHeight;

  onboardingWindow = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
    minWidth: width,
    minHeight: onboardingContentSize.minHeight,
    useContentSize: true,
    show: false,
    frame: true,
    title: getAppDisplayName(),
    resizable: false,
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

  if (shouldProtectAllAppWindows()) {
    onboardingWindow.setSkipTaskbar(true);
    setPrivateWindowContentProtection(onboardingWindow, true);
    refreshDevPrivateAppWindowProtectionSoon(onboardingWindow);
  }

  loadRendererSurface(onboardingWindow, 'onboarding');
  runPackagedLaunchSmokeIfRequested(onboardingWindow, 'onboarding');

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;

    if (!isQuitting) {
      void shouldShowOnboarding().then((required) => {
        if (!required) {
          createPrivateOverlayHandleWindow();
        }
      });
    }
  });

  onboardingWindow.once('ready-to-show', () => {
    onboardingWindow.show();
    onboardingWindow.focus();
    runPackagedLaunchSmokeIfRequested(onboardingWindow, 'onboarding');
    runOnboardingSmokeIfRequested(onboardingWindow);
  });

  return onboardingWindow;
}

async function clickVisibleButtonInWindow(window, buttonText, options = {}) {
  if (!window || window.isDestroyed()) {
    return { ok: false, error: 'Window is not available.' };
  }

  const timeoutMs = Number(options.timeoutMs ?? 8_000);
  const target = await window.webContents.executeJavaScript(`
    (async () => {
      const deadline = Date.now() + ${JSON.stringify(timeoutMs)};
      const wanted = ${JSON.stringify(String(buttonText).toLowerCase())};
      const textOf = (element) => [element?.textContent || '', element?.getAttribute?.('aria-label') || ''].join(' ')
        .replace(/\\s+/g, ' ')
        .trim();
      const getButton = () => Array.from(document.querySelectorAll('button'))
        .find((candidate) => textOf(candidate).toLowerCase().includes(wanted)) ?? null;
      let button = null;
      let lastDisabled = false;
      let lastRect = null;

      while (Date.now() <= deadline) {
        button = getButton();

        if (button) {
          button.scrollIntoView({ block: 'center', inline: 'center' });
          await new Promise((resolve) => setTimeout(resolve, 50));
          const rect = button.getBoundingClientRect();
          lastDisabled = Boolean(button.disabled);
          lastRect = {
            height: rect.height,
            width: rect.width
          };

          if (!button.disabled && rect.width > 0 && rect.height > 0) {
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!button) {
        return {
          ok: false,
          error: 'Button was not found.',
          wanted,
          body: document.body.textContent?.slice(0, 500)
        };
      }

      const rect = button.getBoundingClientRect();

      if (button.disabled || rect.width <= 0 || rect.height <= 0) {
        return {
          ok: false,
          disabled: lastDisabled,
          error: 'Button is not clickable.',
          height: lastRect?.height ?? rect.height,
          text: textOf(button),
          width: lastRect?.width ?? rect.width
        };
      }

      return {
        ok: true,
        height: rect.height,
        text: textOf(button),
        width: rect.width,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    })()
  `);

  if (!target?.ok) {
    return target;
  }

  window.show();
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: target.x,
    y: target.y
  });
  await wait(50);
  window.webContents.sendInputEvent({
    button: 'left',
    clickCount: 1,
    type: 'mouseDown',
    x: target.x,
    y: target.y
  });
  await wait(50);
  window.webContents.sendInputEvent({
    button: 'left',
    clickCount: 1,
    type: 'mouseUp',
    x: target.x,
    y: target.y
  });

  return {
    ...target,
    ok: true,
    method: 'electron-input-event'
  };
}

async function clickPackagedOnboardingPermissionButtons(window) {
  const clicks = [];

  for (const buttonText of ['grant screen & system audio recording', 'grant system audio']) {
    const click = await clickVisibleButtonInWindow(window, buttonText, { timeoutMs: 2_000 });
    clicks.push({
      buttonText,
      click
    });

    if (click.ok) {
      await wait(1500);
    }
  }

  return clicks;
}

function runPackagedLaunchSmokeIfRequested(window, surface) {
  if (packagedLaunchSmokeMs <= 0 || packagedLaunchSmokeStarted || packagedLaunchSmokeCompleted || window.isDestroyed()) {
    return;
  }

  const runSmoke = async () => {
    if (packagedLaunchSmokeStarted || packagedLaunchSmokeCompleted) {
      return;
    }

    packagedLaunchSmokeStarted = true;

    try {
      const result = await getPackagedLaunchSmokeRendererResult(window);
      let onboardingClick = null;
      let onboardingPermissionClicks = [];
      if (packagedOnboardingCompletionSmoke && result.hasOnboarding) {
        onboardingPermissionClicks = await clickPackagedOnboardingPermissionButtons(window);
        onboardingClick = await clickVisibleButtonInWindow(window, 'start using caul', { timeoutMs: 15_000 });
        result.completion = {
          ...(result.completion ?? {}),
          clicked: onboardingClick.ok === true,
          click: onboardingClick,
          clickMethod: onboardingClick.ok === true ? 'electron-input-event' : 'failed',
          permissionClicks: onboardingPermissionClicks
        };
      }
      const completion = packagedOnboardingCompletionSmoke
        ? await getPackagedOnboardingCompletionSmokeSummary()
        : null;
      const summary = {
        ok: packagedLaunchSmokeRequiresOnboarding
          ? Boolean(result.hasOnboarding)
          : Boolean(result.hasOnboarding || result.hasHomeLayout || result.hasHandle),
        appName: app.getName(),
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        requiresOnboarding: packagedLaunchSmokeRequiresOnboarding,
        resourcesPath: process.resourcesPath,
        surface,
        ...result
      };

      if (completion) {
        if (onboardingClick) {
          completion.click = onboardingClick;
          completion.clicked = onboardingClick.ok === true;
          completion.clickMethod = onboardingClick.ok === true ? 'electron-input-event' : 'failed';
          completion.permissionClicks = onboardingPermissionClicks;
        }
        summary.completion = completion;
        summary.ok = summary.ok && completion.ok;
      }

      const privacy = packagedPrivacySmoke ? await getPackagedPrivacySmokeSummary() : null;

      if (privacy) {
        summary.privacy = privacy;
        summary.ok = summary.ok && privacy.ok;
      }

      if (packagedUpdaterSmoke) {
        summary.ok = summary.ok && summary.updates?.ok === true;
      }

      emitSmokeLine(`caul-packaged-launch-smoke ${JSON.stringify(summary)}`);
      packagedLaunchSmokeCompleted = true;

      if (!summary.ok || !summary.isPackaged) {
        app.exitCode = 1;
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`caul-packaged-launch-smoke failed ${error.message}`);
      app.exitCode = 1;
      process.exitCode = 1;
    } finally {
      setTimeout(() => {
        app.exit(app.exitCode || process.exitCode || 0);
      }, packagedLaunchSmokeMs);
    }
  };

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => {
      void runSmoke();
    });
  } else {
    void runSmoke();
  }
}

function getPackagedLaunchSmokeRendererResult(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      const waitUntil = Date.now() + ${JSON.stringify(packagedLaunchSmokeWaitMs)};
      let onboarding = null;
      let homeLayout = null;
      let handle = null;
      let completion = null;
      let updates = null;

      while (Date.now() <= waitUntil) {
        const bodyText = (document.body?.textContent ?? '').trim();
        onboarding = document.querySelector('[aria-label="Caul setup"]')
          || (bodyText.includes('Welcome to Caul') && bodyText.includes('Start using Caul'));
        homeLayout = document.querySelector('[aria-label="Home layout"]');
        handle = document.querySelector('[aria-label="Caul overlay handle"]');

        if (${JSON.stringify(packagedLaunchSmokeRequiresOnboarding)} ? onboarding : (onboarding || homeLayout || handle)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (${JSON.stringify(packagedOnboardingCompletionSmoke)} && onboarding) {
        const startButton = Array.from(document.querySelectorAll('button'))
          .find((button) => (button.textContent ?? '').includes('Start using Caul')) ?? null;
        completion = {
          attempted: true,
          buttonEnabled: Boolean(startButton && !startButton.disabled),
          clicked: false,
          clickMethod: 'pending-electron-input-event'
        };
      }

      const runtime = await window.caul.getRuntimeContext();
      if (${JSON.stringify(packagedUpdaterSmoke)}) {
        const bridge = window.caul?.settings?.updates;
        updates = {
          ok: false,
          statusAvailable: Boolean(bridge?.status),
          initial: null,
          afterDaily: null,
          afterWeekly: null,
          manualCheck: null
        };

        if (bridge?.status && bridge?.setFrequency && bridge?.checkNow) {
          updates.initial = await bridge.status();
          updates.afterDaily = await bridge.setFrequency('daily');
          updates.afterWeekly = await bridge.setFrequency('weekly');
          updates.manualCheck = await bridge.checkNow();
          updates.ok = updates.initial?.frequency === 'weekly'
            && updates.afterDaily?.frequency === 'daily'
            && updates.afterWeekly?.frequency === 'weekly'
            && updates.manualCheck?.frequency === 'weekly'
            && updates.manualCheck?.lastResult?.status === 'disabled';
        }
      }

      return {
        runtime,
        updates,
        completion,
        hasHandle: Boolean(handle),
        hasOnboarding: Boolean(onboarding),
        hasHomeLayout: Boolean(homeLayout),
        location: window.location.href,
        title: document.title,
        bodyTextLength: (document.body?.textContent ?? '').trim().length,
        bodyTextSample: (document.body?.textContent ?? '').trim().slice(0, 500)
      };
    })()
  `);
}

async function getPackagedOnboardingCompletionSmokeSummary() {
  await wait(5000);

  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  const windowSurfaces = [];

  for (const window of windows) {
    try {
      windowSurfaces.push(await getPackagedWindowSurfaceFlags(window));
    } catch (error) {
      windowSurfaces.push({ error: error.message });
    }
  }

  const setupState = readSetupState();
  const completedAt = typeof setupState.onboardingCompletedAt === 'string'
    ? setupState.onboardingCompletedAt
    : null;
  const hasHandle = windowSurfaces.some((surface) => surface.hasHandle);
  const hasHomeLayout = windowSurfaces.some((surface) => surface.hasHomeLayout);

  return {
    ok: Boolean(completedAt && (hasHandle || hasHomeLayout)),
    completedAt,
    hasHandle,
    hasHomeLayout,
    windowSurfaces
  };
}

function getPackagedWindowSurfaceFlags(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const bodyText = (document.body?.textContent ?? '').trim();
      return {
        hasHandle: Boolean(document.querySelector('[aria-label="Caul overlay handle"]')),
        hasHomeLayout: Boolean(document.querySelector('[aria-label="Home layout"]')),
        hasOnboarding: Boolean(document.querySelector('[aria-label="Caul setup"]'))
          || (bodyText.includes('Welcome to Caul') && bodyText.includes('Start using Caul')),
        location: window.location.href,
        title: document.title
      };
    })()
  `);
}

function startPackagedLaunchSmokeFallback() {
  if (packagedLaunchSmokeMs <= 0) {
    return;
  }

  setTimeout(async () => {
    if (packagedLaunchSmokeCompleted) {
      return;
    }

    const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
    const rendererResults = [];

    for (const window of windows) {
      try {
        rendererResults.push(await getPackagedLaunchSmokeRendererResult(window));
      } catch (error) {
        rendererResults.push({ error: error.message });
      }
    }

    const hasOnboarding = rendererResults.some((result) => result.hasOnboarding);
    const hasHomeLayout = rendererResults.some((result) => result.hasHomeLayout);
    const hasHandle = rendererResults.some((result) => result.hasHandle);

    let onboardingClick = null;
    let onboardingPermissionClicks = [];

    if (packagedOnboardingCompletionSmoke && hasOnboarding) {
      const onboardingSmokeWindow = windows.find((candidate, index) => rendererResults[index]?.hasOnboarding);
      if (onboardingSmokeWindow) {
        onboardingPermissionClicks = await clickPackagedOnboardingPermissionButtons(onboardingSmokeWindow);
        onboardingClick = await clickVisibleButtonInWindow(onboardingSmokeWindow, 'start using caul', { timeoutMs: 15_000 });
      } else {
        onboardingClick = { ok: false, error: 'No onboarding window was available for GUI input.' };
      }
    }

    const completion = packagedOnboardingCompletionSmoke
      ? await getPackagedOnboardingCompletionSmokeSummary()
      : null;
    const summary = {
      ok: packagedLaunchSmokeRequiresOnboarding
        ? hasOnboarding
        : Boolean(hasOnboarding || hasHomeLayout || hasHandle || windows.length > 0),
      appName: app.getName(),
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      requiresOnboarding: packagedLaunchSmokeRequiresOnboarding,
      resourcesPath: process.resourcesPath,
      surface: 'main-process-window',
      hasHandle,
      hasHomeLayout,
      hasOnboarding,
      rendererResults,
      windowCount: windows.length,
      windows: windows.map((window) => {
        if (window.isDestroyed()) {
          return {
            destroyed: true
          };
        }

        return {
          bounds: window.getBounds(),
          title: window.getTitle(),
          visible: window.isVisible()
        };
      })
    };

    if (completion) {
      if (onboardingClick) {
        completion.click = onboardingClick;
        completion.clicked = onboardingClick.ok === true;
        completion.clickMethod = onboardingClick.ok === true ? 'electron-input-event' : 'failed';
        completion.permissionClicks = onboardingPermissionClicks;
      }
      summary.completion = completion;
      summary.ok = summary.ok && completion.ok;
    }

    const privacy = packagedPrivacySmoke ? await getPackagedPrivacySmokeSummary() : null;

    if (privacy) {
      summary.privacy = privacy;
      summary.ok = summary.ok && privacy.ok;
    }

    if (packagedUpdaterSmoke) {
      summary.ok = summary.ok && rendererResults.some((result) => result.updates?.ok === true);
    }

    console.log(`caul-packaged-launch-smoke ${JSON.stringify(summary)}`);
    packagedLaunchSmokeCompleted = true;

    if (!summary.ok || !summary.isPackaged) {
      app.exitCode = 1;
      process.exitCode = 1;
    }

    setTimeout(() => {
      app.exit(app.exitCode || process.exitCode || 0);
    }, packagedLaunchSmokeMs);
  }, packagedLaunchSmokeRequiresOnboarding ? Math.max(8000, packagedLaunchSmokeMs * 8) : Math.max(1000, packagedLaunchSmokeMs * 4));
}

function fitOnboardingWindowToContent(sender, size = {}) {
  const window = onboardingWindow && !onboardingWindow.isDestroyed()
    ? onboardingWindow
    : null;

  if (!window || sender !== window.webContents || typeof size.height !== 'number') {
    return { ok: false };
  }

  const display = screen.getDisplayMatching(window.getBounds());
  const workArea = display.workArea;
  const width = onboardingContentSize.width;
  const minHeight = onboardingContentSize.minHeight;
  const maxHeight = Math.max(minHeight, workArea.height - 80);
  const height = Math.min(maxHeight, Math.max(minHeight, Math.ceil(size.height)));

  window.setContentSize(width, height);
  const bounds = window.getBounds();
  window.setPosition(
    workArea.x + Math.round((workArea.width - bounds.width) / 2),
    workArea.y + Math.round((workArea.height - bounds.height) / 2)
  );

  return { ok: true };
}

async function runOnboardingSmokeIfRequested(window) {
  if (!onboardingSmokeDir || window.isDestroyed()) {
    return;
  }

  fsSync.mkdirSync(onboardingSmokeDir, { recursive: true });

  if (onboardingLocalAiLagSmoke) {
    setTimeout(async () => {
      try {
        const clickTarget = await window.webContents.executeJavaScript(`
          (async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const textOf = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
            const findButton = (name) => Array.from(document.querySelectorAll('button'))
              .find((button) => textOf(button) === name);
            const waitFor = async (predicate, timeoutMs = 2000) => {
              const startedAt = performance.now();

              while (performance.now() - startedAt < timeoutMs) {
                const value = predicate();

                if (value) {
                  return value;
                }

                await delay(16);
              }

              return null;
            };

            window.dispatchEvent(new CustomEvent('caul:onboarding-smoke-step', { detail: 'ai' }));
            await waitFor(() => findButton('Download local AI') || findButton('Local'), 2000);

            if (!findButton('Download local AI')) {
              findButton('Local')?.click();
            }

            const button = await waitFor(() => findButton('Download local AI'), 2000);

            if (!button) {
              return {
                ok: false,
                error: 'Download local AI button was not visible',
                body: document.body.textContent?.slice(0, 500)
              };
            }

            let rafActive = true;
            let maxFrameGapMs = 0;
            let lastFrameAt = performance.now();
            const trackFrame = () => {
              const now = performance.now();
              maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrameAt);
              lastFrameAt = now;

              if (rafActive) {
                requestAnimationFrame(trackFrame);
              }
            };
            requestAnimationFrame(trackFrame);

            await delay(50);
            window.__caulLocalAiLagSmoke = {
              clickedAt: performance.now(),
              maxFrameGapMs,
              progressText: null,
              trackFrameStop: () => {
                rafActive = false;
                window.__caulLocalAiLagSmoke.maxFrameGapMs = maxFrameGapMs;
              }
            };

            const rect = button.getBoundingClientRect();
            return {
              ok: true,
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2)
            };
          })()
        `);

        if (!clickTarget?.ok) {
          const image = await window.webContents.capturePage();
          fsSync.writeFileSync(path.join(onboardingSmokeDir, 'local-ai-lag.png'), image.toPNG());
          console.log(`caul-onboarding-local-ai-lag-smoke ${JSON.stringify(clickTarget)}`);
          app.exitCode = 1;
          exitSmokeProcess();
          return;
        }

        window.focus();
        window.webContents.focus();
        window.webContents.sendInputEvent({
          type: 'mouseMove',
          x: clickTarget.x,
          y: clickTarget.y
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        window.webContents.sendInputEvent({
          button: 'left',
          clickCount: 1,
          type: 'mouseDown',
          x: clickTarget.x,
          y: clickTarget.y
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        window.webContents.sendInputEvent({
          button: 'left',
          clickCount: 1,
          type: 'mouseUp',
          x: clickTarget.x,
          y: clickTarget.y
        });

        const result = await window.webContents.executeJavaScript(`
          (async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const textOf = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
            const findButton = (name) => Array.from(document.querySelectorAll('button'))
              .find((button) => textOf(button) === name);
            const waitFor = async (predicate, timeoutMs = 1500) => {
              const startedAt = performance.now();

              while (performance.now() - startedAt < timeoutMs) {
                const value = predicate();

                if (value) {
                  return value;
                }

                await delay(16);
              }

              return null;
            };
            const smoke = window.__caulLocalAiLagSmoke;
            let clickMethod = 'electron-input';
            let progressText = await waitFor(() => {
              const body = document.body.textContent || '';
              return body.includes('Preparing local AI') ? 'Preparing local AI' : null;
            }, 250);

            if (!progressText) {
              clickMethod = 'renderer-smoke-event';
              smoke.clickedAt = performance.now();
              window.dispatchEvent(new CustomEvent('caul:onboarding-smoke-download-local-ai'));

              progressText = await waitFor(() => {
                const body = document.body.textContent || '';
                return body.includes('Preparing local AI') ? 'Preparing local AI' : null;
              }, 250);
            }

            if (!progressText) {
              const button = findButton('Download local AI');
              if (button) {
                clickMethod = 'renderer-click-fallback';
                smoke.clickedAt = performance.now();
                for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
                  button.dispatchEvent(new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window
                  }));
                }
                button.click();
              }

              progressText = await waitFor(() => {
                const body = document.body.textContent || '';
                return body.includes('Preparing local AI') ? 'Preparing local AI' : null;
              }, 1500);
            }

            const visibleFeedbackMs = performance.now() - smoke.clickedAt;
            smoke.trackFrameStop();
            await delay(16);

            const ok = Boolean(progressText)
              && visibleFeedbackMs <= 500
              && smoke.maxFrameGapMs <= 250;

            return {
              ok,
              clickMethod,
              visibleFeedbackMs,
              maxFrameGapMs: smoke.maxFrameGapMs,
              progressText,
              body: ok ? undefined : document.body.textContent?.slice(0, 500)
            };
          })()
        `);

        if (window.isDestroyed()) {
          return;
        }

        const image = await window.webContents.capturePage();
        fsSync.writeFileSync(path.join(onboardingSmokeDir, 'local-ai-lag.png'), image.toPNG());

        console.log(`caul-onboarding-local-ai-lag-smoke ${JSON.stringify(result)}`);

        if (!result?.ok) {
          app.exitCode = 1;
        }

        exitSmokeProcess();
      } catch (error) {
        console.error(`caul-onboarding-local-ai-lag-smoke ${JSON.stringify({ ok: false, error: error.message })}`);
        app.exitCode = 1;
        exitSmokeProcess();
      }
    }, 800);
    return;
  }

  const steps = [
    ['permissions', 'permissions.png'],
    ['parakeet', 'parakeet.png'],
    ['ai', 'ai.png']
  ];

  setTimeout(async () => {
    try {
      for (const [step, fileName] of steps) {
        if (window.isDestroyed()) {
          return;
        }

        await window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('caul:onboarding-smoke-step', { detail: ${JSON.stringify(step)} }))`);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const image = await window.webContents.capturePage();
        fsSync.writeFileSync(path.join(onboardingSmokeDir, fileName), image.toPNG());
      }

      console.log(`caul-onboarding-smoke ${JSON.stringify({ ok: true, dir: onboardingSmokeDir })}`);
      exitSmokeProcess();
    } catch (error) {
      console.error(`caul-onboarding-smoke ${JSON.stringify({ ok: false, error: error.message })}`);
      app.exitCode = 1;
      exitSmokeProcess();
    }
  }, 800);
}

function createPrivateOverlayHandleWindow() {
  if (privateOverlayHandleWindow && !privateOverlayHandleWindow.isDestroyed()) {
    return privateOverlayHandleWindow;
  }

  const state = readPrivateOverlayState();
  const handleWindowSize = getHandleWindowSize(state.handle.size);
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
    title: 'Caul Overlay Handle',
    alwaysOnTop: true,
    focusable: false,
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

  if (!shouldUseOpaquePrivateWindowsForProtection()) {
    privateOverlayHandleWindow.setOpacity(state.handle.opacity);
  }
  persistPrivateOverlayHandleState(privateOverlayHandleWindow);
  loadRendererSurface(privateOverlayHandleWindow, 'handle');
  runPackagedLaunchSmokeIfRequested(privateOverlayHandleWindow, 'private-overlay-handle');

  privateOverlayHandleWindow.on('closed', () => {
    privateOverlayHandleWindow = null;
  });

  privateOverlayHandleWindow.once('ready-to-show', () => showPrivateOverlayHandleWindow());

  return privateOverlayHandleWindow;
}

function persistPrivateOverlayWindowState(window) {
  let saveTimer = null;
  let applyingAnchoredResize = false;
  let lastAnchoredResizeBounds = null;

  const persistBounds = (bounds) => {
    const visualBounds = getVisualBoundsForOverlayWindowBounds(bounds);

    updatePrivateOverlayState((state) => ({
      ...state,
      overlay: {
        ...state.overlay,
        height: visualBounds.height,
        visible: window.isVisible(),
        width: visualBounds.width,
        x: visualBounds.x,
        y: visualBounds.y
      }
    }));
    broadcastPrivateOverlayState();
  };

  const setAnchoredBounds = (size, { persist = false } = {}) => {
    if (window.isDestroyed() || !window.isVisible()) {
      return window.isDestroyed() ? null : getPrivateOverlayWindowVisualBounds();
    }

    const bounds = getPrivateOverlayWindowVisualBounds();
    const anchoredBounds = getAnchoredOverlayBounds(size, {
      orientForEdge: false,
      restoreNonCompactWidth: false
    });

    if (
      bounds.x === anchoredBounds.x
      && bounds.y === anchoredBounds.y
      && bounds.width === anchoredBounds.width
      && bounds.height === anchoredBounds.height
    ) {
      return anchoredBounds;
    }

    applyingAnchoredResize = true;
    lastAnchoredResizeBounds = anchoredBounds;
    window.setBounds(getOverlayWindowBoundsForVisualBounds(anchoredBounds), false);
    setImmediate(() => {
      applyingAnchoredResize = false;
    });

    if (persist) {
      persistBounds(getOverlayWindowBoundsForVisualBounds(anchoredBounds));
    }

    return anchoredBounds;
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (window.isDestroyed()) {
        return;
      }

      const [contentWidth, contentHeight] = window.getContentSize();
      const width = Math.max(1, contentWidth - (overlayWindowResizeOutset * 2));
      const height = Math.max(1, contentHeight - (overlayWindowResizeOutset * 2));
      const anchoredBounds = lastAnchoredResizeBounds ?? setAnchoredBounds({ height, width }) ?? window.getBounds();

      persistBounds(getOverlayWindowBoundsForVisualBounds(anchoredBounds));
      lastAnchoredResizeBounds = null;
    }, 250);
  };

  window.on('will-resize', (event, bounds) => {
    if (applyingAnchoredResize || !window.isVisible()) {
      return;
    }

    event.preventDefault();
    setAnchoredBounds({
      height: Math.max(1, bounds.height - (overlayWindowResizeOutset * 2)),
      width: Math.max(1, bounds.width - (overlayWindowResizeOutset * 2))
    }, {
      persist: true
    });
    scheduleSave();
  });
  window.on('resize', () => {
    if (!applyingAnchoredResize) {
      const [contentWidth, contentHeight] = window.getContentSize();
      const width = Math.max(1, contentWidth - (overlayWindowResizeOutset * 2));
      const height = Math.max(1, contentHeight - (overlayWindowResizeOutset * 2));
      setAnchoredBounds({ height, width }, { persist: true });
    }

    scheduleSave();
  });
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
      window.webContents.send('caul:private-overlay-state', status);
    }
  });
}

function showPrivateOverlayWindow() {
  const window = createPrivateOverlayWindow();
  const bounds = getAnchoredOverlayBounds({}, {
    orientForEdge: false,
    restoreNonCompactWidth: false
  });

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

  setPrivateOverlayWindowVisualBounds(bounds);
  window.setIgnoreMouseEvents(false);
  applyPrivateWindowProtection(window);
  focusPrivateOverlayWindow(window);
  window.show();
  focusPrivateOverlayWindow(window);
  setImmediate(() => focusPrivateOverlayWindow(window));
  showPrivateOverlayHandleWindow();
  broadcastPrivateOverlayState();
}

function focusPrivateOverlayWindow(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  try {
    app.focus({ steal: true });
  } catch {
    try {
      app.focus();
    } catch {
      // App activation is best-effort when running as a Dockless accessory app.
    }
  }

  try {
    window.focus();
  } catch {
    // Best-effort across platforms and Electron window states.
  }

  try {
    window.moveTop();
  } catch {
    // Some platforms may not support explicit front ordering.
  }
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
  if (!shouldUseOpaquePrivateWindowsForProtection()) {
    window.setOpacity(state.handle.opacity);
  }
  window.setIgnoreMouseEvents(false);
  applyPrivateWindowWorkspaceBehaviour(window);
  try {
    window.setAlwaysOnTop(true, 'pop-up-menu');
  } catch {
    window.setAlwaysOnTop(true);
  }
  window.showInactive();
  try {
    window.moveTop();
  } catch {
    // Some platforms may not support explicit front ordering for accessory windows.
  }
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

function setPrivateOverlayHandleSize(size) {
  const handleSize = normaliseHandleSizePreset(size);
  const nextSize = getHandleWindowSize(handleSize);
  const window = createPrivateOverlayHandleWindow();
  const currentBounds = window.getBounds();
  const currentCentreX = currentBounds.x + Math.round(currentBounds.width / 2);
  const currentCentreY = currentBounds.y + Math.round(currentBounds.height / 2);
  const nextBounds = normaliseHandleBounds({
    height: nextSize.height,
    size: handleSize,
    width: nextSize.width,
    x: currentCentreX - Math.round(nextSize.width / 2),
    y: currentCentreY - Math.round(nextSize.height / 2)
  });

  window.setBounds(nextBounds);
  updatePrivateOverlayState((state) => ({
    ...state,
    handle: {
      ...state.handle,
      size: handleSize,
      visible: window.isVisible(),
      x: nextBounds.x,
      y: nextBounds.y
    }
  }));
  positionVisibleOverlayFromHandle(getVisibleOverlayContentSize());
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
      label: 'Quit Caul',
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

function resetPrivateOverlayWindowPosition() {
  const wasOverlayVisible = Boolean(privateOverlayWindow && !privateOverlayWindow.isDestroyed() && privateOverlayWindow.isVisible());
  const state = normalisePrivateOverlayState({
    ...readPrivateOverlayState(),
    overlay: {
      visible: wasOverlayVisible
    }
  });

  writePrivateOverlayState(({
    ...readPrivateOverlayState(),
    overlay: state.overlay
  }));

  if (privateOverlayWindow && !privateOverlayWindow.isDestroyed()) {
    setPrivateOverlayWindowVisualBounds(state.overlay);
  }

  if (wasOverlayVisible) {
    showPrivateOverlayWindow();
  } else {
    broadcastPrivateOverlayState();
  }

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
      height: getPrivateOverlayWindowVisualBounds().height,
      width: getPrivateOverlayWindowVisualBounds().width
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

  const handleBounds = getPrivateOverlayHandleBounds();

  return {
    height: handleBounds.height,
    width: handleBounds.width,
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

  const bounds = getPrivateOverlayWindowVisualBounds();

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

  setPrivateOverlayWindowVisualBounds(overlayBounds);
  setPrivateOverlayHandleBounds(handleBounds, { persist: false });
  broadcastPrivateOverlayState();
  return getPrivateOverlayStatus();
}

function endPrivateOverlayWindowDrag(request) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    privateOverlayWindowDrag = null;
    return getPrivateOverlayStatus();
  }

  const dragBounds = getOverlayDragBounds(request) ?? getPrivateOverlayWindowVisualBounds();
  const overlayBounds = clampOverlayBoundsToDisplay(dragBounds);
  const snappedHandleBounds = getHandleBoundsForOverlayBounds(overlayBounds, { snap: true });

  privateOverlayWindowDrag = null;
  setPrivateOverlayHandleBounds(snappedHandleBounds);
  const anchoredBounds = getAnchoredOverlayBounds({
    height: overlayBounds.height,
    width: overlayBounds.width
  }, {
    orientForEdge: false,
    restoreNonCompactWidth: false
  });

  setPrivateOverlayWindowVisualBounds(anchoredBounds);
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

function normaliseOverlayResizeRequest(request) {
  const direction = typeof request?.direction === 'string'
    ? request.direction.toLowerCase()
    : '';

  return {
    direction: /^[nesw]{1,2}$/.test(direction) ? direction : '',
    screenX: Number(request?.screenX),
    screenY: Number(request?.screenY)
  };
}

function startPrivateOverlayWindowResize(request) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    return getPrivateOverlayStatus();
  }

  const point = normaliseOverlayResizeRequest(request);

  if (!point.direction || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) {
    return getPrivateOverlayStatus();
  }

  const overlayBounds = getPrivateOverlayWindowVisualBounds();
  const handleBounds = getPrivateOverlayHandleBounds();
  const display = screen.getDisplayMatching(handleBounds);
  const edge = getNearestHandleEdge(handleBounds, display);
  const handleIsCornerSnapped = isHandleBoundsAtDisplayCorner(handleBounds, display);
  const handleCentreX = handleBounds.x + Math.round(handleBounds.width / 2);
  const handleCentreY = handleBounds.y + Math.round(handleBounds.height / 2);
  const anchorX = handleCentreX;
  const anchorY = edge === 'top'
    ? handleBounds.y + handleBounds.height + overlayWindowGap
    : edge === 'bottom'
      ? handleBounds.y - overlayWindowGap
      : handleCentreY;

  privateOverlayWindowResize = {
    anchorX,
    anchorY,
    direction: point.direction,
    edge,
    handleIsCornerSnapped,
    height: overlayBounds.height,
    pointerOffsetX: point.direction.includes('e')
      ? point.screenX - (overlayBounds.x + overlayBounds.width)
      : point.direction.includes('w')
        ? point.screenX - overlayBounds.x
        : 0,
    pointerOffsetY: point.direction.includes('s')
      ? point.screenY - (overlayBounds.y + overlayBounds.height)
      : point.direction.includes('n')
        ? point.screenY - overlayBounds.y
        : 0,
    width: overlayBounds.width,
    x: overlayBounds.x,
    y: overlayBounds.y
  };

  return getPrivateOverlayStatus();
}

function getOverlayResizeBounds(request) {
  const point = normaliseOverlayResizeRequest(request);

  if (
    !privateOverlayWindowResize
    || !Number.isFinite(point.screenX)
    || !Number.isFinite(point.screenY)
  ) {
    return null;
  }

  const resize = privateOverlayWindowResize;
  let width = resize.width;
  let height = resize.height;
  const canMirrorResize = !resize.handleIsCornerSnapped;
  const mirrorHorizontalResize = canMirrorResize && (resize.edge === 'top' || resize.edge === 'bottom');
  const mirrorVerticalResize = canMirrorResize && (resize.edge === 'left' || resize.edge === 'right');
  const pointX = point.screenX - resize.pointerOffsetX;
  const pointY = point.screenY - resize.pointerOffsetY;

  if (resize.direction.includes('e') || resize.direction.includes('w')) {
    if (mirrorHorizontalResize) {
      width = resize.direction.includes('e')
        ? (pointX - resize.anchorX) * 2
        : (resize.anchorX - pointX) * 2;
    } else {
      width = resize.direction.includes('e')
        ? pointX - resize.x
        : resize.x + resize.width - pointX;
    }
  }

  if (resize.direction.includes('n') || resize.direction.includes('s')) {
    if (mirrorVerticalResize) {
      height = resize.direction.includes('s')
        ? (pointY - resize.anchorY) * 2
        : (resize.anchorY - pointY) * 2;
    } else if (resize.edge === 'left' || resize.edge === 'right') {
      height = resize.direction.includes('s')
        ? pointY - resize.y
        : resize.y + resize.height - pointY;
    } else if (resize.edge === 'top') {
      height = pointY - resize.anchorY;
    } else {
      height = resize.anchorY - pointY;
    }
  }

  const bounds = getAnchoredOverlayBounds({
    height,
    width
  }, {
    orientForEdge: false,
    restoreNonCompactWidth: false
  });

  if (resize.direction.includes('e') || resize.direction.includes('w')) {
    const display = screen.getDisplayMatching(getPrivateOverlayHandleBounds());
    const workArea = display.workArea;

    if (mirrorHorizontalResize) {
      bounds.x = clampNumber(
        Math.round(resize.anchorX - (bounds.width / 2)),
        workArea.x + windowScreenMargin,
        workArea.x + workArea.width - bounds.width - windowScreenMargin,
        bounds.x
      );
    } else if (resize.edge === 'top' || resize.edge === 'bottom') {
      bounds.x = resize.direction.includes('e')
        ? clampNumber(
          resize.x,
          workArea.x + windowScreenMargin,
          workArea.x + workArea.width - bounds.width - windowScreenMargin,
          bounds.x
        )
        : clampNumber(
          resize.x + resize.width - bounds.width,
          workArea.x + windowScreenMargin,
          workArea.x + workArea.width - bounds.width - windowScreenMargin,
          bounds.x
        );
    }
  }

  if (
    mirrorVerticalResize
    && (resize.direction.includes('n') || resize.direction.includes('s'))
  ) {
    const display = screen.getDisplayMatching(getPrivateOverlayHandleBounds());
    const workArea = display.workArea;

    bounds.y = clampNumber(
      Math.round(resize.anchorY - (bounds.height / 2)),
      workArea.y + windowScreenMargin,
      workArea.y + workArea.height - bounds.height - windowScreenMargin,
      bounds.y
    );
  }

  if (
    (resize.edge === 'left' || resize.edge === 'right')
    && (resize.direction.includes('n') || resize.direction.includes('s'))
    && !mirrorVerticalResize
  ) {
    const display = screen.getDisplayMatching(getPrivateOverlayHandleBounds());
    const workArea = display.workArea;

    bounds.y = resize.direction.includes('s')
      ? clampNumber(
        resize.y,
        workArea.y + windowScreenMargin,
        workArea.y + workArea.height - bounds.height - windowScreenMargin,
        bounds.y
      )
      : clampNumber(
        resize.y + resize.height - bounds.height,
        workArea.y + windowScreenMargin,
        workArea.y + workArea.height - bounds.height - windowScreenMargin,
        bounds.y
      );
  }

  return bounds;
}

function movePrivateOverlayWindowResize(request) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    return getPrivateOverlayStatus();
  }

  const bounds = getOverlayResizeBounds(request);

  if (!bounds) {
    return getPrivateOverlayStatus();
  }

  setPrivateOverlayWindowVisualBounds(bounds, false);
  return null;
}

function endPrivateOverlayWindowResize(request) {
  if (!privateOverlayWindow || privateOverlayWindow.isDestroyed()) {
    privateOverlayWindowResize = null;
    return getPrivateOverlayStatus();
  }

  const bounds = getOverlayResizeBounds(request) ?? getPrivateOverlayWindowVisualBounds();

  privateOverlayWindowResize = null;
  setPrivateOverlayWindowVisualBounds(bounds, false);
  updatePrivateOverlayState((state) => ({
    ...state,
    overlay: {
      ...state.overlay,
      height: bounds.height,
      visible: privateOverlayWindow.isVisible(),
      width: bounds.width,
      x: bounds.x,
      y: bounds.y
    }
  }));
  broadcastPrivateOverlayState();
  return getPrivateOverlayStatus();
}

function applyMacPrivateActivationPolicy() {
  if (process.platform !== 'darwin') {
    return;
  }

  if (isDev) {
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
  return isDev
    || smokeExitMs > 0
    || systemAudioSmokeMs > 0
    || localParakeetSmokeMs > 0
    || rendererTranscriptionSmokeMs > 0
    || rendererLlmSmoke
    || rendererRealLlmSmoke;
}

function createWindow() {
  mainWindow = createPrivateOverlayWindow();

  if (isTranscriptDebugLogEnabled()) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      if (message.startsWith('caul-renderer-transcript-debug ')) {
        writeTranscriptDebugLog('renderer.console', {
          message: message.replace(/^caul-renderer-transcript-debug /, '')
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
                const setup = document.querySelector('[aria-label="Caul setup"]');
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
            const runtime = await window.caul.getRuntimeContext();
            const started = await window.caul.capture.start();
            const paused = await window.caul.capture.pause();
            const stopped = await window.caul.capture.stop();
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
              hasCredentialBridge: Object.prototype.hasOwnProperty.call(window.caul ?? {}, 'api' + 'Key'),
              contentSize: ${JSON.stringify(mainWindow.getContentSize())},
              minimumSize: ${JSON.stringify(mainWindow.getMinimumSize())},
              maximumSize: ${JSON.stringify(mainWindow.getMaximumSize())},
              resizable: ${JSON.stringify(mainWindow.isResizable())},
              maximizable: ${JSON.stringify(mainWindow.isMaximizable())},
              fullscreenable: ${JSON.stringify(mainWindow.isFullScreenable())}
            };
          })()
        `);

        console.log(`caul-electron-smoke ${JSON.stringify(result)}`);

        if (
          !result.rendererVisible ||
          result.hasOuterScroll ||
          result.hasCredentialBridge ||
          result.resizable ||
          result.maximizable ||
          result.fullscreenable
        ) {
          app.exitCode = 1;
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(`caul-electron-smoke failed ${error.message}`);
        app.exitCode = 1;
        process.exitCode = 1;
      } finally {
        stopLocalTranscriptionWarmDaemon(true);
        exitSmokeProcess();
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

        console.log(`caul-system-audio-smoke ${JSON.stringify(result)}`);
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
            const unsubscribe = window.caul.transcription.onEvent((event) => {
              events.push(event);
            });

            await window.caul.transcription.start({ sources: ['system'] });
            await new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(localParakeetSmokeMs)}));
            await window.caul.transcription.stop();
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

        console.log(`caul-local-parakeet-smoke ${JSON.stringify(result)}`);

        if (!result.detected || result.errors.length > 0) {
          app.exitCode = 1;
        }
      } catch (error) {
        console.error(`caul-local-parakeet-smoke failed ${error.message}`);
        app.exitCode = 1;
      } finally {
        app.quit();
      }
    });
  }

  if (rendererTranscriptionSmokeMs > 0) {
    emitSmokeLine(`caul-renderer-transcription-smoke-armed ${JSON.stringify({
      armed: true,
      detected: false,
      errors: [],
      rendererTranscriptionSmokeMs
    })}`);

    const runRendererTranscriptionSmoke = async () => {
      const guiClickResults = [];
      const scheduleGuiClick = (delayMs, buttonText, phase) => {
        setTimeout(async () => {
          try {
            const click = await clickVisibleButtonInWindow(mainWindow, buttonText);
            guiClickResults.push({
              ...click,
              phase,
              scheduledAtMs: delayMs
            });
          } catch (error) {
            guiClickResults.push({
              error: error.message,
              ok: false,
              phase,
              scheduledAtMs: delayMs
            });
          }
        }, delayMs).unref();
      };

      try {
        if (rendererTranscriptionSmokeGuiClicks) {
          scheduleGuiClick(700, 'start listening', 'start');
          scheduleGuiClick(rendererTranscriptionSmokeMs + 1_000, 'stop listening', 'stop');
          scheduleGuiClick(rendererTranscriptionSmokeMs + 3_500, 'start listening', 'restart');
          scheduleGuiClick(rendererTranscriptionSmokeMs + 6_000, 'stop listening', 'final-stop');
        }

        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const events = [];
            const snapshots = [];
            const eventStartedAt = Date.now();
            const statusPattern = /^(Not listening\\.|Requesting audio access\\.\\.\\.|Starting local Parakeet\\.\\.\\.|Loading local Parakeet\\.\\.\\.|Listening with local Parakeet\\.\\.\\.|Listening\\. Waiting for speech\\.\\.\\.|Speech detected\\.\\.\\.|Transcribing local audio\\.\\.\\.|local Parakeet capture started|local Parakeet loaded|checking ScreenCaptureKit permission|reading ScreenCaptureKit shareable content|starting ScreenCaptureKit audio stream|ScreenCaptureKit format .*|ScreenCaptureKit audio capture started|reading default output device|creating Core Audio process tap|creating private aggregate device|reading Core Audio tap format|Core Audio tap format .*|creating aggregate device IO callback|starting aggregate device|Core Audio capture started|starting system audio capture|starting microphone capture|microphone capture started)$/;
            const transcriptPlaceholder = 'Your live transcript will appear here once you start listening.';
            let previousLongest = '';
            let clearCount = 0;
            let usedBridgeFallback = false;
            let restartAttempted = false;
            let restartStartButtonFound = false;
            let restartStartButtonDisabled = null;
            let restartUsedBridgeFallback = false;
            let autoSendButtonFound = false;
            let autoSendDisabled = false;
            const guiClickMode = ${JSON.stringify(rendererTranscriptionSmokeGuiClicks)};
            const unsubscribe = window.caul.transcription.onEvent((event) => {
              events.push({
                ...event,
                smokeAtMs: Date.now() - eventStartedAt
              });
            });

            await new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(rendererRealLlmSmoke ? 1500 : 300)}));

            const output = document.querySelector('[aria-label="Transcription output"]');
            const findButton = (pattern) => Array.from(document.querySelectorAll('button'))
              .find((button) => pattern.test(button.textContent ?? ''));
            const waitForButton = async (pattern, timeoutMs = 5_000) => {
              const deadline = Date.now() + timeoutMs;

              while (Date.now() < deadline) {
                const button = findButton(pattern);

                if (button) {
                  return button;
                }

                await new Promise((resolve) => setTimeout(resolve, 100));
              }

              return null;
            };
            const startButton = findButton(/start listening/i);

            if (!output) {
              throw new Error('Renderer transcription controls were not found.');
            }

            const autoSendButton = document.querySelector('button[aria-label="Auto Send"]');
            autoSendButtonFound = Boolean(autoSendButton);

            if (autoSendButton?.getAttribute('aria-pressed') === 'true') {
              autoSendButton.click();
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            autoSendDisabled = autoSendButton?.getAttribute('aria-pressed') === 'false';

            const startedAt = Date.now();
            const sample = () => {
              const sectionBodies = Array.from(output.querySelectorAll('.transcript-section-body'))
                .map((section) => (section.textContent ?? '').trim())
                .filter(Boolean);
              const text = (sectionBodies.join('\\n') || output.textContent || '').trim();
              snapshots.push({
                atMs: Date.now() - startedAt,
                text
              });

              if (!text || text === transcriptPlaceholder || statusPattern.test(text)) {
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
            if (guiClickMode) {
              await new Promise((resolve) => setTimeout(resolve, 1_200));
            } else if (${JSON.stringify(rendererTranscriptionSmokeBridgeStart)}) {
              usedBridgeFallback = true;
              await window.caul.transcription.start({ sources: ['system'] });
            } else if (startButton && !startButton.disabled) {
              startButton.click();
            } else {
              usedBridgeFallback = true;
              await window.caul.transcription.start({ sources: ['system'] });
            }

            const injectedText = ${JSON.stringify(process.env.CAUL_RENDERER_TRANSCRIPTION_SMOKE_INJECT_TEXT ?? '')};
            if (injectedText && window.caul?.smokeEmitTranscriptionEvent) {
              await new Promise((resolve) => setTimeout(resolve, 300));
              await window.caul.smokeEmitTranscriptionEvent({
                type: 'completed',
                utteranceId: 1001,
                text: injectedText
              });
            }

            const interval = setInterval(sample, 500);
            await new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(rendererTranscriptionSmokeMs)}));
            clearInterval(interval);
            sample();

            const stopButton = findButton(/stop listening/i);

            if (guiClickMode) {
              await new Promise((resolve) => setTimeout(resolve, 1_800));
              sample();
            } else if (stopButton) {
              stopButton.click();
              await new Promise((resolve) => setTimeout(resolve, 1_500));
              sample();
            } else if (${JSON.stringify(rendererTranscriptionSmokeNoLlm)}) {
              await window.caul.transcription.stop();
              await new Promise((resolve) => setTimeout(resolve, 1_500));
              sample();
            }

            const restartStartButton = await waitForButton(/start listening/i);
            restartAttempted = true;
            restartStartButtonFound = Boolean(restartStartButton);
            restartStartButtonDisabled = restartStartButton ? Boolean(restartStartButton.disabled) : null;

            if (guiClickMode) {
              await new Promise((resolve) => setTimeout(resolve, 3_500));
            } else if (${JSON.stringify(rendererTranscriptionSmokeBridgeStart)}) {
              restartUsedBridgeFallback = true;
              await window.caul.transcription.start({ sources: ['system'] });
              await new Promise((resolve) => setTimeout(resolve, 2_000));
            } else if (restartStartButton && !restartStartButton.disabled) {
              restartStartButton.click();
              await new Promise((resolve) => setTimeout(resolve, 2_000));
            } else {
              restartUsedBridgeFallback = true;
              await window.caul.transcription.start({ sources: ['system'] });
              await new Promise((resolve) => setTimeout(resolve, 2_000));
            }

            sample();

            const restartStopButton = findButton(/stop listening/i);
            if (guiClickMode) {
              await new Promise((resolve) => setTimeout(resolve, 1_000));
            } else if (restartStopButton) {
              restartStopButton.click();
            } else {
              await window.caul.transcription.stop();
            }

            await new Promise((resolve) => setTimeout(resolve, 1_000));
            sample();

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
            const firstPartialAtMs = events
              .filter((event) => event.type === 'partial' && event.text)
              .map((event) => event.smokeAtMs)
              .find((atMs) => typeof atMs === 'number') ?? null;
            const firstCompletedAtMs = events
              .filter((event) => event.type === 'completed' && event.text)
              .map((event) => event.smokeAtMs)
              .find((atMs) => typeof atMs === 'number') ?? null;
            const errors = events
              .filter((event) => event.type === 'error')
              .map((event) => event.message);
            const stages = events
              .filter((event) => event.type === 'stage')
              .map((event) => event.message);
            const metrics = events
              .filter((event) => event.type === 'metric');
            const renderedTranscriptOutput = Array.from(output.querySelectorAll('.transcript-section-body'))
              .map((section) => (section.textContent ?? '').trim())
              .filter(Boolean)
              .join('\\n');
            const renderedOutput = renderedTranscriptOutput || (output.textContent ?? '').trim();

            return {
              renderedOutput,
              renderedTranscriptOutput,
              longestOutput: previousLongest,
              snapshots,
              snapshotCount: snapshots.length,
              startButtonFound: Boolean(startButton),
              startButtonDisabled: Boolean(startButton?.disabled),
              guiClickMode,
              usedBridgeFallback,
              autoSendButtonFound,
              autoSendDisabled,
              restartAttempted,
              restartStartButtonFound,
              restartStartButtonDisabled,
              restartUsedBridgeFallback,
              clearCount,
              completed,
              completedEvents,
              completedCount: completed.length,
              partialCount: partial.length,
              firstPartialAtMs,
              firstCompletedAtMs,
              detected: completed.length > 0 || partial.length > 0 || previousLongest.length > 0,
              errors,
              stages,
              metrics
            };
          })()
        `);

        result.guiClicks = guiClickResults;
        emitSmokeLine(`caul-renderer-transcription-smoke ${JSON.stringify(result)}`);

        if (!result.detected || result.errors.length > 0) {
          app.exitCode = 1;
        }
      } catch (error) {
        emitSmokeLine(`caul-renderer-transcription-smoke ${JSON.stringify({
          detected: false,
          errors: [error.message],
          failed: true,
          modelDiagnostics: {
            selectedLocalTranscriptionModel: getSelectedLocalTranscriptionModelId(),
            preferredLocalModel: getPreferredLocalModelId(),
            localModelPath: getLocalModelPath(),
            parakeetModelPath: getParakeetModelPath(),
            parakeetModelValid: validateParakeetModelDir(),
            userData: app.getPath('userData')
          }
        })}`);
        app.exitCode = 1;
      } finally {
        app.quit();
      }
    };

    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', runRendererTranscriptionSmoke);
    } else {
      setImmediate(runRendererTranscriptionSmoke);
    }
  }

  if (rendererLlmSmoke || rendererRealLlmSmoke) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const llmSmokeMode = process.env.CAUL_LLM_SMOKE_MODE ?? 'stop';
        const speculativeStopDelayMs = Number(process.env.CAUL_LLM_SPECULATIVE_STOP_DELAY_MS ?? 500);
        const llmSmokeTranscript = process.env.CAUL_LLM_SMOKE_TRANSCRIPT ?? 'What is the refund policy?';
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const llmSmokeMode = ${JSON.stringify(llmSmokeMode)};
            const speculativeStopDelayMs = ${JSON.stringify(speculativeStopDelayMs)};
            const llmSmokeTranscript = ${JSON.stringify(llmSmokeTranscript)};
            const snapshots = [];
            const response = () => document.querySelector('[aria-label="AI response"]');
            const transcript = () => document.querySelector('[aria-label="Transcription output"]');
            const visibleText = (element) => {
              if (!element) {
                return '';
              }

              if ('value' in element) {
                return element.value ?? '';
              }

              return element.textContent ?? '';
            };
            const startButton = () => Array.from(document.querySelectorAll('button'))
              .find((button) => /start listening/i.test(button.textContent ?? ''));
            const stopButton = () => Array.from(document.querySelectorAll('button'))
              .find((button) => /stop listening/i.test(button.textContent ?? ''));

            if (!window.caul?.transcription) {
              throw new Error('Transcription bridge was not found.');
            }

            await new Promise((resolve) => setTimeout(resolve, 300));

            for (let index = 0; index < 200; index += 1) {
              const status = await window.caul.llm.status();

              if (status.ready) {
                break;
              }

              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            startButton()?.click();
            await new Promise((resolve) => setTimeout(resolve, 50));
            await window.caul.smokeEmitTranscriptionEvent({
              type: 'completed',
              utteranceId: 1,
              text: llmSmokeTranscript
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            snapshots.push({ phase: 'transcript', value: visibleText(transcript()) });
            let stopClickedAt = performance.now();
            let speculativePromise = null;
            let speculativeResult = null;

            if (llmSmokeMode === 'speculative') {
              speculativePromise = window.caul.transcription.requestLlm({
                model: ${JSON.stringify(process.env.CAUL_LLM_MODEL ?? 'openai-codex/gpt-5.4-mini')},
                reasoning: ${JSON.stringify(process.env.CAUL_LLM_THINKING ?? 'off')},
                trace: {
                  requestedAt: Date.now(),
                  speculative: true
                },
                transcript: visibleText(transcript())
              }).then((response) => {
                speculativeResult = response;
                return response;
              });
              await new Promise((resolve) => setTimeout(resolve, speculativeStopDelayMs));
              stopClickedAt = performance.now();
            } else {
              stopButton()?.click();
            }

            snapshots.push({ phase: 'after-stop', value: visibleText(response()) });
            let firstResponseTextAt = null;

            if (visibleText(response()).trim() && visibleText(response()).trim() !== 'No response yet.') {
              firstResponseTextAt = stopClickedAt;
            }

            for (let index = 0; index < 800; index += 1) {
              if (firstResponseTextAt !== null) {
                break;
              }

              await new Promise((resolve) => setTimeout(resolve, 25));
              const value = visibleText(response());

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
            snapshots.push({ phase: 'final', value: visibleText(response()) });
            const finalValue = visibleText(response()) || (speculativeResult?.ok ? speculativeResult.text : '');

            return {
              llmSmokeMode,
              stopToFirstResponseTextMs: firstResponseTextAt === null
                ? null
                : Math.round(firstResponseTextAt - stopClickedAt),
              snapshots,
              streamed: snapshots.some((snapshot) => snapshot.phase === 'poll' && snapshot.value),
              finalValue,
              speculativeResult
            };
          })()
        `);

        console.log(`caul-renderer-llm-smoke ${JSON.stringify(result)}`);

        if (!result.finalValue || result.finalValue.trim() === 'No response yet.') {
          process.exitCode = 1;
          app.exitCode = 1;
        }
      } catch (error) {
        console.error(`caul-renderer-llm-smoke failed ${error.message}`);
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

        console.log(`caul-resource-smoke ${JSON.stringify(result)}`);

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

    console.log(`caul-resource-smoke ${JSON.stringify(result)}`);

    if (totalWorkingSetMb > resourceSmokeMaxWorkingSetMb) {
      app.exitCode = 1;
      process.exitCode = 1;
    }

    app.quit();
  }, resourceSmokeMs);
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'system';
  if (windowsExternalCaptureProbe) {
    await runWindowsExternalCaptureProtectionProbe();
    return;
  }

  seedPackagedOnboardingCompletionSmokeState();
  installPackagedPrivacyRendererNetworkHooks();
  applyMacPrivateActivationPolicy();
  if (shouldWarmLocalTranscriptionOnStartup()) {
    startLocalTranscriptionWarmDaemon();
    void prepareLocalTranscriptionOnStartup();
  }
  if (smokeExitMs === 0 && !onboardingSmokeDir) {
    void warmSelectedLocalAiIfReady('startup');
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

  if (await shouldShowOnboarding()) {
    createOnboardingWindow();
  } else {
    createPrivateOverlayHandleWindow();
  }

  if (shouldOpenFullAppOverlayOnLaunch()) {
    createWindow();
    showPrivateOverlayWindow();
  }

  startResourceSmokeTimer();
  registerPrivateOverlayShortcuts();
  startPackagedLaunchSmokeFallback();
  getUpdaterService().startSchedule();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (await shouldShowOnboarding()) {
        createOnboardingWindow();
      } else {
        createPrivateOverlayHandleWindow();
      }
    }
  });
});

function performAppShutdownCleanup() {
  stopLocalTranscriptionWarmDaemon(true);
  stopSystemAudioCapture();
  stopLocalParakeetDaemon({ force: true });
  cancelParakeetDownload();
  getLocalLlmService().cancelDownload();
  getLocalLlmService().stop();

  if (isInstallingDownloadedUpdate) {
    return;
  }

  persistentPiRpcBridge?.dispose();
  persistentPiRpcBridge = null;
  backupPersistentPiRpcBridge?.dispose();
  backupPersistentPiRpcBridge = null;
}

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  updaterService?.stopSchedule();
  performAppShutdownCleanup();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('caul:get-runtime-context', () => ({
  platform: process.platform,
  arch: process.arch,
  isMac: process.platform === 'darwin',
  appChannel: getAppChannel(),
  appName: getAppDisplayName(),
  vmTestingTarget: 'Parallels macOS VM'
}));

ipcMain.handle('caul:private-overlay-status', () => getPrivateOverlayStatus());

ipcMain.handle('caul:private-overlay-toggle', () => {
  togglePrivateOverlayWindow();
  return getPrivateOverlayStatus();
});

ipcMain.handle('caul:private-overlay-hide', () => {
  hidePrivateOverlayWindow();
  return getPrivateOverlayStatus();
});

ipcMain.handle('caul:private-overlay-handle-menu', (event) => showPrivateOverlayHandleMenu(event.sender));

ipcMain.handle('caul:private-overlay-handle-drag-start', (_event, request) => startPrivateOverlayHandleDrag(request));

ipcMain.handle('caul:private-overlay-handle-drag-move', (_event, request) => movePrivateOverlayHandleDrag(request));

ipcMain.handle('caul:private-overlay-handle-drag-end', (_event, request) => endPrivateOverlayHandleDrag(request));

ipcMain.handle('caul:private-overlay-window-drag-start', (_event, request) => startPrivateOverlayWindowDrag(request));

ipcMain.handle('caul:private-overlay-window-drag-move', (_event, request) => movePrivateOverlayWindowDrag(request));

ipcMain.handle('caul:private-overlay-window-drag-end', (_event, request) => endPrivateOverlayWindowDrag(request));

ipcMain.handle('caul:private-overlay-window-resize-start', (_event, request) => startPrivateOverlayWindowResize(request));

ipcMain.handle('caul:private-overlay-window-resize-move', (_event, request) => movePrivateOverlayWindowResize(request));

ipcMain.on('caul:private-overlay-window-resize-move-live', (_event, request) => {
  movePrivateOverlayWindowResize(request);
});

ipcMain.handle('caul:private-overlay-window-resize-end', (_event, request) => endPrivateOverlayWindowResize(request));

ipcMain.handle('caul:private-overlay-show-main', () => {
  showMainWindow();
  return getPrivateOverlayStatus();
});

ipcMain.handle('caul:private-overlay-panic-hide', () => {
  panicHidePrivateOverlay();
  return getPrivateOverlayStatus();
});

ipcMain.handle('caul:private-overlay-set-click-through', (_event, request) => (
  setPrivateOverlayClickThrough(Boolean(request?.enabled))
));

ipcMain.handle('caul:private-overlay-set-handle-size', (_event, request) => (
  setPrivateOverlayHandleSize(request?.size)
));

ipcMain.handle('caul:private-overlay-reset-handle', () => resetPrivateOverlayHandlePosition());

ipcMain.handle('caul:capture-status', () => captureStatus);

ipcMain.handle('caul:permissions-status', () => getPermissionsStatus());

ipcMain.handle('caul:permissions-open', (_event, request) => {
  const permission = typeof request === 'object' && request !== null
    ? request.permission
    : undefined;

  return openPermissionsSettings(permission);
});

ipcMain.handle('caul:permissions-request', (_event, request) => {
  const permission = typeof request === 'object' && request !== null
    ? request.permission
    : undefined;

  return requestPermission(permission);
});

ipcMain.handle('caul:settings-reset', (event) => {
  resetWindowState(BrowserWindow.fromWebContents(event.sender));
  resetPrivateOverlayHandlePosition();
  resetPrivateOverlayWindowPosition();
  resetPromptTemplates();

  return { ok: true };
});

ipcMain.handle('caul:settings-quit', () => {
  app.quit();
  return { ok: true };
});

ipcMain.handle('caul:settings-relaunch', () => {
  app.relaunch();
  app.quit();
  return { ok: true };
});

ipcMain.handle('caul:preferences-load', (_event, request) => loadPortablePreferences(request));

ipcMain.handle('caul:preferences-save', (_event, request) => savePortablePreferences(request));

ipcMain.handle('caul:model-catalogue-refresh', () => refreshLiveModelCatalogue());

ipcMain.handle('caul:updates-status', () => getUpdaterService().status());

ipcMain.handle('caul:updates-set-frequency', (_event, request) => (
  getUpdaterService().setFrequency(request?.frequency)
));

ipcMain.handle('caul:updates-check-now', () => getUpdaterService().checkNow());

ipcMain.handle('caul:updates-download-and-install', () => getUpdaterService().downloadAndInstall());

ipcMain.handle('caul:updates-install-downloaded', () => getUpdaterService().installDownloadedUpdate());

ipcMain.handle('caul:updates-open-download-page', () => getUpdaterService().openDownloadPage());

ipcMain.handle('caul:history-status', () => getHistoryService().getStatus());

ipcMain.handle('caul:history-set-enabled', (_event, request) => (
  getHistoryService().setEnabled(request?.enabled)
));

ipcMain.handle('caul:history-open-folder', () => getHistoryService().openFolder());

ipcMain.handle('caul:history-choose-folder', (event) => (
  getHistoryService().chooseFolder(BrowserWindow.fromWebContents(event.sender))
));

ipcMain.handle('caul:history-save-session', (_event, request) => (
  getHistoryService().saveSession(request)
));

ipcMain.handle('caul:onboarding-status', () => getOnboardingStatus());

ipcMain.handle('caul:onboarding-complete', () => completeOnboarding());

ipcMain.handle('caul:onboarding-fit-content', (event, size) => fitOnboardingWindowToContent(event.sender, size));

ipcMain.handle('caul:onboarding-open', () => reopenOnboarding());

ipcMain.handle('caul:parakeet-status', () => getParakeetStatus());

ipcMain.handle('caul:parakeet-download', (_event, request) => downloadLocalTranscriptionModel(request?.modelId));

ipcMain.handle('caul:parakeet-remove', (_event, request) => removeLocalTranscriptionModel(request?.modelId));

ipcMain.handle('caul:parakeet-set-model', (_event, request) => setPreferredLocalTranscriptionModel(request?.modelId));

ipcMain.handle('caul:parakeet-cancel-download', () => cancelParakeetDownload());

ipcMain.handle('caul:pi-status', () => getPiStatus());

ipcMain.handle('caul:pi-chatgpt-login', () => openPiSetup('chatgpt-login'));

ipcMain.handle('caul:pi-login', () => openPiSetup('login'));

ipcMain.handle('caul:pi-model', () => openPiSetup('model'));

ipcMain.handle('caul:pi-save-model', (_event, request) => {
  const model = typeof request === 'object' && request !== null ? request.model : '';
  return savePiModel(model);
});

ipcMain.handle('caul:ai-provider', (_event, request) => setSelectedAiProvider(request?.provider));

ipcMain.handle('caul:local-llm-status', () => getLocalLlmService().status(getSelectedLocalAiModelId()));

ipcMain.handle('caul:local-llm-download', (_event, request) => {
  if (onboardingLocalAiLagSmoke) {
    return new Promise(() => {});
  }

  return downloadLocalAiModel(request?.modelId);
});

ipcMain.handle('caul:local-llm-set-model', (_event, request) => setPreferredLocalAiModel(request?.modelId));

ipcMain.handle('caul:local-llm-benchmark', (_event, request) => benchmarkLocalAiModel(request?.modelId));

ipcMain.handle('caul:local-llm-cancel-download', () => getLocalLlmService().cancelDownload());

ipcMain.handle('caul:pi-disconnect', () => disconnectPi());

ipcMain.handle('caul:prompt-templates-list', () => readPromptTemplateState());

ipcMain.handle('caul:prompt-templates-choose-attachments', (event) => (
  choosePromptTemplateAttachments(BrowserWindow.fromWebContents(event.sender))
));

ipcMain.handle('caul:prompt-templates-reset', () => resetPromptTemplates());

ipcMain.handle('caul:prompt-templates-save', (_event, request) => {
  const template = typeof request === 'object' && request !== null
    ? request.template
    : null;

  return savePromptTemplate(template);
});

ipcMain.handle('caul:prompt-templates-delete', (_event, request) => {
  const id = typeof request === 'object' && request !== null && typeof request.id === 'string'
    ? request.id
    : '';

  return deletePromptTemplate(id);
});

ipcMain.handle('caul:prompt-templates-set-selected', (_event, request) => {
  const ids = typeof request === 'object' && request !== null && Array.isArray(request.ids)
    ? request.ids
    : [];

  return setSelectedPromptTemplates(ids);
});

ipcMain.handle('caul:capture-start', () => {
  captureStatus.state = 'testing';

  return captureStatus;
});

ipcMain.handle('caul:capture-pause', () => {
  captureStatus.state = 'paused';

  return captureStatus;
});

ipcMain.handle('caul:capture-stop', () => {
  captureStatus.state = 'idle';

  return captureStatus;
});

ipcMain.handle('caul:transcription-start', (_event, request) => new Promise((resolve, reject) => {
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

ipcMain.handle('caul:transcription-prepare', (_event, request) => {
  if (rendererLlmSmoke || rendererRealLlmSmoke) {
    return { ok: true };
  }

  const normalisedRequest = typeof request === 'object' && request !== null
    ? request
    : { sources: ['system'] };

  return prepareLocalTranscriptionCapture(normalisedRequest);
});

ipcMain.handle('caul:transcription-stop', async () => {
  if (rendererLlmSmoke || rendererRealLlmSmoke) {
    localTranscriptionActive = false;
    return { ok: true };
  }

  await stopLocalTranscriptionCapture();
  stopSystemAudioCapture();
  localTranscriptionActive = false;

  return { ok: true };
});

ipcMain.handle('caul:llm-request', async (_event, request) => {
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

ipcMain.handle('caul:llm-status', () => ({
  ok: true,
  ready: llmWarmStatus === 'ready',
  status: llmWarmStatus
}));

ipcMain.handle('caul:smoke-emit-transcription-event', (_event, event) => {
  if (!rendererLlmSmoke && !rendererRealLlmSmoke && rendererTranscriptionSmokeMs <= 0) {
    throw new Error('Smoke event injection is disabled.');
  }

  emitTranscriptionEvent(event);

  return { ok: true };
});

ipcMain.handle('caul:system-audio-start', () => {
  return startSystemAudioCapture();
});

ipcMain.handle('caul:system-audio-stop', () => {
  stopSystemAudioCapture();

  return { ok: true };
});

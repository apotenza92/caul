const { app, BrowserWindow, dialog, shell } = require('electron');
const fsSync = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { createTufVerifiedUpdateFeed } = require('./tufUpdateFeed.cjs');

const updateFrequencyFileName = 'update-frequency.json';
const lastUpdateCheckFileName = 'last-update-check.json';
const githubOwner = 'apotenza92';
const githubRepo = 'caul';
const releasesApiUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/releases?per_page=20`;
const updateFrequencies = ['never', 'startup', 'hourly', 'sixHours', 'twelveHours', 'daily', 'weekly', 'monthly'];
const updateFrequencyMs = {
  hourly: 60 * 60 * 1000,
  sixHours: 6 * 60 * 60 * 1000,
  twelveHours: 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
};

function createUpdaterService({
  appChannel,
  appName,
  createVerifiedFeed = createTufVerifiedUpdateFeed,
  env = process.env,
  isDev,
  onAfterSuccessfulCheck,
  onBeforeInstallDownloadedUpdate,
  onInstallHandoffStarting,
  packageMetadata = require('../package.json'),
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  forceEnabled = false,
  repositoryUrl = 'https://github.com/apotenza92/caul/releases'
} = {}) {
  const { autoUpdater } = require('electron-updater');
  const testFeedUrl = resolveUpdateTestFeed(env);
  const testTufRepositoryUrl = resolveTufTestRepository(env);
  const testMode = env.CAUL_UPDATE_TEST_MODE === '1';
  const updaterEventPath = testMode ? String(env.CAUL_UPDATER_EVENT_PATH ?? '').trim() : '';
  let scheduleTimer = null;
  let checking = false;
  let downloading = false;
  let lastResult = null;
  let availableUpdate = null;
  let verifiedFeed = null;
  let verifiedFeedPromise = null;
  const installHandoff = createUpdateInstallHandoffController({
    platform,
    startExitFallback: onInstallHandoffStarting
  });

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = appChannel === 'beta';
  configureUpdaterDownloadMode(autoUpdater, { env, platform });

  autoUpdater.on('download-progress', (progress) => {
    downloading = true;
    lastResult = {
      ok: true,
      status: 'downloading',
      message: `Downloading update ${Math.round(progress.percent ?? 0)}%`,
      progress: {
        percent: Math.round(progress.percent ?? 0),
        transferred: progress.transferred ?? 0,
        total: progress.total ?? null
      }
    };
    emitStatus();
  });

  autoUpdater.on('update-downloaded', () => {
    downloading = false;
    lastResult = {
      ok: true,
      status: 'ready',
      message: 'Update downloaded. Restart Caul to install it.'
    };
    writeUpdaterTestEvent(updaterEventPath, 'update-downloaded', {
      currentVersion: app.getVersion(),
      version: availableUpdate?.version
    });
    emitStatus();
    if (testMode && env.CAUL_E2E_INSTALL_UPDATE === '1') {
      scheduleUpdaterTestAction(() => {
        void installDownloadedUpdate();
      });
    }
  });

  autoUpdater.on('error', (error) => {
    installHandoff.cancel();
    recordError(error);
  });

  function isEnabled() {
    if (isUpdateSmokeDisabled()) {
      return false;
    }

    return forceEnabled || (app.isPackaged && !isDev && !isLocalDevChannel(appChannel));
  }

  function getFrequencyPath() {
    return path.join(app.getPath('userData'), updateFrequencyFileName);
  }

  function getLastUpdateCheckPath() {
    return path.join(app.getPath('userData'), lastUpdateCheckFileName);
  }

  function readFrequency() {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(getFrequencyPath(), 'utf8'));
      return normaliseUpdateFrequency(parsed?.frequency);
    } catch {
      return 'weekly';
    }
  }

  function writeFrequency(frequency) {
    const nextFrequency = normaliseUpdateFrequency(frequency);
    fsSync.mkdirSync(app.getPath('userData'), { recursive: true });
    fsSync.writeFileSync(getFrequencyPath(), `${JSON.stringify({ frequency: nextFrequency }, null, 2)}\n`);
    return nextFrequency;
  }

  function readLastCheckTime() {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(getLastUpdateCheckPath(), 'utf8'));
      return typeof parsed?.checkedAt === 'string' ? parsed.checkedAt : null;
    } catch {
      return null;
    }
  }

  function writeLastCheckTime(date = new Date()) {
    const checkedAt = date.toISOString();
    fsSync.mkdirSync(app.getPath('userData'), { recursive: true });
    fsSync.writeFileSync(getLastUpdateCheckPath(), `${JSON.stringify({ checkedAt }, null, 2)}\n`);
    return checkedAt;
  }

  function status() {
    return {
      appChannel,
      appName,
      appVersion: app.getVersion(),
      automaticInstall: automaticInstallSupported(platform, env),
      availableUpdate,
      checking,
      downloading,
      enabled: isEnabled(),
      frequency: readFrequency(),
      lastCheckedAt: readLastCheckTime(),
      lastResult
    };
  }

  function emitStatus() {
    const payload = status();
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('caul:updates-status', payload);
      }
    });
  }

  function recordError(error, fallbackMessage = 'Update check failed.') {
    const message = error?.message ?? fallbackMessage;
    checking = false;
    downloading = false;
    lastResult = {
      ok: false,
      status: 'error',
      message
    };
    writeUpdaterTestEvent(updaterEventPath, 'error', {
      currentVersion: app.getVersion(),
      message
    });
    emitStatus();
    return status();
  }

  function startSchedule() {
    stopSchedule();

    if (testMode && env.CAUL_E2E_EXPECT_VERSION === app.getVersion()) {
      writeUpdaterTestEvent(updaterEventPath, 'updated-runtime-launched', {
        currentVersion: app.getVersion(),
        pid: process.pid
      });
      scheduleUpdaterTestAction(() => app.quit());
      return;
    }

    if (!isEnabled()) {
      emitStatus();
      return;
    }

    const frequency = readFrequency();

    if (frequency === 'never') {
      emitStatus();
      return;
    }

    if (shouldCheckForUpdates(frequency, readLastCheckTime(), Date.now())) {
      void checkNow({ automatic: true });
    }

    const intervalMs = frequency === 'startup'
      ? null
      : updateFrequencyMs[frequency];

    if (intervalMs) {
      scheduleTimer = setInterval(() => {
        if (shouldCheckForUpdates(readFrequency(), readLastCheckTime(), Date.now())) {
          void checkNow({ automatic: true });
        }
      }, Math.min(intervalMs, 60 * 60 * 1000));
      scheduleTimer.unref?.();
    }
  }

  function stopSchedule() {
    if (scheduleTimer) {
      clearInterval(scheduleTimer);
      scheduleTimer = null;
    }
  }

  function setFrequency(frequency) {
    const nextFrequency = writeFrequency(frequency);
    startSchedule();
    emitStatus();
    return status();
  }

  async function checkNow({ automatic = false } = {}) {
    if (!isEnabled()) {
      lastResult = {
        ok: false,
        status: 'disabled',
        message: isUpdateSmokeDisabled()
          ? 'Updates are disabled for this smoke run.'
          : 'Updates are disabled for this build.'
      };
      emitStatus();
      return status();
    }

    if (checking || downloading) {
      return status();
    }

    checking = true;
    lastResult = {
      ok: true,
      status: 'checking',
      message: automatic ? 'Checking for updates automatically.' : 'Checking for updates.'
    };
    emitStatus();

    try {
      if (usesTufUpdater(platform, env)) {
        const feed = await ensureVerifiedFeed();
        await feed.refresh();
        configureUpdaterFeed(autoUpdater, {
          appChannel,
          testFeedUrl: feed.feedUrl
        });
        const result = await autoUpdater.checkForUpdates();
        const updateInfo = result?.updateInfo;
        const currentVersion = app.getVersion();
        writeLastCheckTime();
        await notifyAfterSuccessfulCheck({ automatic });
        if (!updateInfo?.version || !isVersionNewer(updateInfo.version, currentVersion)) {
          availableUpdate = null;
          checking = false;
          lastResult = {
            ok: true,
            status: 'not-available',
            message: 'Caul is up to date.'
          };
          emitStatus();
          return status();
        }
        availableUpdate = {
          authenticated: true,
          downloadUrl: repositoryUrl,
          prerelease: appChannel === 'beta',
          releaseName: updateInfo.releaseName || `Caul ${updateInfo.version}`,
          releaseNotes: normaliseUpdaterReleaseNotes(updateInfo.releaseNotes),
          version: updateInfo.version
        };
        checking = false;
        lastResult = {
          ok: true,
          status: 'available',
          message: `Caul ${updateInfo.version} is available.`
        };
        writeUpdaterTestEvent(updaterEventPath, 'update-available', {
          currentVersion,
          version: updateInfo.version
        });
        emitStatus();
        if (testMode && env.CAUL_E2E_INSTALL_UPDATE === '1') {
          scheduleUpdaterTestAction(() => {
            void downloadAndInstall();
          });
        }
        return status();
      }

      const releases = await fetchGitHubReleases(testFeedUrl ? `${testFeedUrl.replace(/\/$/, '')}/releases.json` : releasesApiUrl);
      const targetRelease = findTargetRelease(releases, appChannel === 'beta');
      const currentVersion = app.getVersion();
      writeLastCheckTime();
      await notifyAfterSuccessfulCheck({ automatic });

      if (!targetRelease || !isVersionNewer(targetRelease.version, currentVersion)) {
        availableUpdate = null;
        checking = false;
        lastResult = {
          ok: true,
          status: 'not-available',
          message: 'Caul is up to date.'
        };
        emitStatus();
        return status();
      }

      availableUpdate = {
        asset: selectUpdateAsset(targetRelease.assets, {
          appChannel,
          arch: process.arch,
          platform
        }),
        downloadUrl: targetRelease.htmlUrl,
        prerelease: targetRelease.prerelease,
        releaseName: targetRelease.name,
        releaseNotes: targetRelease.releaseNotes,
        version: targetRelease.version
      };
      checking = false;
      lastResult = {
        ok: true,
        status: 'available',
        message: `Caul ${targetRelease.version} is available.`
      };
      emitStatus();

      if (platform === 'darwin') {
        autoUpdater.allowPrerelease = targetRelease.prerelease;
        configureUpdaterFeed(autoUpdater, { appChannel, testFeedUrl });
      }

      return status();
    } catch (error) {
      return recordError(error);
    }
  }

  async function notifyAfterSuccessfulCheck({ automatic }) {
    if (typeof onAfterSuccessfulCheck !== 'function') {
      return;
    }

    try {
      await onAfterSuccessfulCheck({ automatic });
    } catch (error) {
      console.error('Post-update-check hook failed:', error);
    }
  }

  async function downloadAndInstall() {
    if (!availableUpdate) {
      await checkNow();
    }

    if (!availableUpdate) {
      return status();
    }

    if (automaticInstallSupported(platform, env)) {
      try {
        downloading = true;
        lastResult = {
          ok: true,
          status: 'downloading',
          message: 'Downloading update.'
        };
        emitStatus();
        autoUpdater.allowPrerelease = Boolean(availableUpdate.prerelease);
        if (usesTufUpdater(platform, env)) {
          const feed = await ensureVerifiedFeed();
          await feed.refresh();
          configureUpdaterFeed(autoUpdater, { appChannel, testFeedUrl: feed.feedUrl });
        } else {
          configureUpdaterFeed(autoUpdater, { appChannel, testFeedUrl });
        }
        await autoUpdater.checkForUpdates();
        await autoUpdater.downloadUpdate();
        return status();
      } catch (error) {
        return recordError(error, 'Update download failed.');
      }
    }

    await shell.openExternal(availableUpdate.downloadUrl || repositoryUrl);
    lastResult = {
      ok: true,
      status: 'external',
      message: platform === 'linux'
        ? 'Opened the Caul release page. Upgrade this package with your system package manager.'
        : 'Opened the Caul release page.'
    };
    emitStatus();
    return status();
  }

  async function installDownloadedUpdate() {
    downloading = false;
    lastResult = {
      ok: true,
      status: 'installing',
      message: 'Restarting to install update.'
    };
    emitStatus();

    if (automaticInstallSupported(platform, env)) {
      try {
        await closeVerifiedFeed();
        onBeforeInstallDownloadedUpdate?.();
        writeUpdaterTestEvent(updaterEventPath, 'install-handoff-started', {
          currentVersion: app.getVersion(),
          version: availableUpdate?.version
        });
        installHandoff.start(() => {
          autoUpdater.quitAndInstall(platform === 'win32', true);
        });
        return status();
      } catch (error) {
        installHandoff.cancel();
        return recordError(error, 'Update installation could not start.');
      }
    }

    await shell.openExternal(availableUpdate?.downloadUrl || repositoryUrl);
    return status();
  }

  async function openDownloadPage() {
    await shell.openExternal(availableUpdate?.downloadUrl || repositoryUrl);
    return { ok: true };
  }

  function showAvailableDialog() {
    if (!availableUpdate) {
      return;
    }

    const window = BrowserWindow.getFocusedWindow();
    void dialog.showMessageBox(window, {
      buttons: ['Download', 'Later'],
      cancelId: 1,
      defaultId: 0,
      detail: availableUpdate.releaseNotes || 'Open Caul settings to review and download this update.',
      message: `Caul ${availableUpdate.version} is available.`,
      type: 'info'
    }).then((result) => {
      if (result.response === 0) {
        void downloadAndInstall();
      }
    });
  }

  async function ensureVerifiedFeed() {
    if (!usesTufUpdater(platform, env)) {
      throw new Error('TUF updating is unavailable for this package.');
    }
    if (verifiedFeed) return verifiedFeed;
    if (verifiedFeedPromise) return verifiedFeedPromise;
    const metadata = validatePackagedTufMetadata(packageMetadata, {
      appChannel,
      testRepositoryUrl: testTufRepositoryUrl
    });
    verifiedFeedPromise = createVerifiedFeed({
      allowLoopbackHttp: Boolean(testTufRepositoryUrl),
      embeddedRootPath: path.join(resourcesPath, 'update-trust', 'root.json'),
      repositoryUrl: metadata.repositoryUrl,
      targetName: metadata.targetName,
      trustDir: path.join(app.getPath('userData'), 'update-trust')
    }).then((feed) => {
      verifiedFeed = feed;
      return feed;
    }).finally(() => {
      verifiedFeedPromise = null;
    });
    return verifiedFeedPromise;
  }

  let verifiedFeedClosePromise = null;
  function closeVerifiedFeed() {
    if (!verifiedFeed) return Promise.resolve();
    if (!verifiedFeedClosePromise) {
      verifiedFeedClosePromise = Promise.resolve()
        .then(() => verifiedFeed.close())
        .finally(() => {
          verifiedFeed = null;
          verifiedFeedClosePromise = null;
        });
    }
    return verifiedFeedClosePromise;
  }

  return {
    checkNow,
    downloadAndInstall,
    installDownloadedUpdate,
    openDownloadPage,
    setFrequency,
    showAvailableDialog,
    startSchedule,
    status,
    stopSchedule: () => {
      stopSchedule();
      void closeVerifiedFeed();
    }
  };
}

function isLocalDevChannel(channel) {
  return channel === 'dev' || channel === 'dev-private';
}

function createUpdateInstallHandoffController({
  platform = process.platform,
  startExitFallback
} = {}) {
  let cancelExitFallback = null;

  function cancel() {
    if (!cancelExitFallback) {
      return false;
    }

    const cancelPending = cancelExitFallback;
    cancelExitFallback = null;
    cancelPending();
    return true;
  }

  function start(handoff) {
    if (typeof handoff !== 'function') {
      throw new Error('Update installation requires a handoff function.');
    }
    if (
      platform === 'win32'
      && startExitFallback !== undefined
      && typeof startExitFallback !== 'function'
    ) {
      throw new Error('Windows update installation exit guard must be a function.');
    }

    cancel();
    if (platform === 'win32' && startExitFallback) {
      const cancellation = startExitFallback();
      if (typeof cancellation !== 'function') {
        throw new Error('Windows update installation exit guard must be cancellable.');
      }
      cancelExitFallback = cancellation;
    }

    try {
      handoff();
    } catch (error) {
      cancel();
      throw error;
    }
  }

  return { cancel, start };
}

function normaliseUpdateFrequency(value) {
  return updateFrequencies.includes(value) ? value : 'weekly';
}

function shouldCheckForUpdates(frequency, lastCheckedAt, nowMs = Date.now()) {
  const normalised = normaliseUpdateFrequency(frequency);

  if (normalised === 'never') {
    return false;
  }

  if (normalised === 'startup') {
    return true;
  }

  const intervalMs = updateFrequencyMs[normalised];

  if (!intervalMs || !lastCheckedAt) {
    return true;
  }

  const lastMs = Date.parse(lastCheckedAt);

  return !Number.isFinite(lastMs) || nowMs - lastMs >= intervalMs;
}

function configureUpdaterFeed(autoUpdater, { appChannel, testFeedUrl }) {
  const channel = appChannel === 'beta' ? 'beta' : 'latest';
  if (testFeedUrl) {
    // The authenticated local feed still points at GitHub's S3-backed release assets.
    // Match Electron's GitHub provider and retain differential downloads as single ranges.
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: testFeedUrl,
      channel,
      useMultipleRangeRequest: false
    });
    return;
  }
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: githubOwner,
    repo: githubRepo,
    channel
  });
}

function automaticInstallSupported(platform = process.platform, env = process.env) {
  return platform === 'darwin' || platform === 'win32' || (platform === 'linux' && Boolean(env.APPIMAGE));
}

function usesTufUpdater(platform = process.platform, env = process.env) {
  return platform !== 'darwin' && automaticInstallSupported(platform, env);
}

function validatePackagedTufMetadata(packageMetadata, {
  appChannel,
  testRepositoryUrl
} = {}) {
  const channel = packageMetadata?.caulReleaseChannel;
  const repositoryUrl = testRepositoryUrl || packageMetadata?.caulTufRepositoryUrl;
  const targetName = packageMetadata?.caulUpdateTargetName;
  if (
    channel !== appChannel
    || !['stable', 'beta'].includes(channel)
    || typeof repositoryUrl !== 'string'
    || !repositoryUrl
    || typeof targetName !== 'string'
    || !targetName
  ) {
    throw new Error('Packaged Caul TUF updater metadata is invalid.');
  }
  return { channel, repositoryUrl, targetName };
}

function normaliseUpdaterReleaseNotes(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry : entry?.note)
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .join('\n\n');
  }
  return typeof value === 'string' ? value.trim() : '';
}

function writeUpdaterTestEvent(filePath, name, details = {}) {
  if (!filePath) return;
  const target = path.resolve(filePath);
  const event = {
    at: new Date().toISOString(),
    name,
    pid: process.pid,
    ...details
  };
  fsSync.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fsSync.appendFileSync(`${target}.jsonl`, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  const temporary = `${target}.${process.pid}.tmp`;
  fsSync.writeFileSync(temporary, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  fsSync.renameSync(temporary, target);
}

function scheduleUpdaterTestAction(action, delayMs = 100) {
  return setTimeout(action, delayMs);
}

function fetchGitHubReleases(url = releasesApiUrl) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http:') ? require('node:http') : https;
    const request = client.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Caul/${app.getVersion()}`
      }
    }, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub returned HTTP ${response.statusCode}.`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('GitHub returned an unreadable release response.'));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15_000, () => {
      request.destroy(new Error('GitHub update check timed out.'));
    });
  });
}

function findTargetRelease(releases, includePrereleases) {
  const candidates = Array.isArray(releases)
    ? releases
      .filter((release) => release && !release.draft)
      .filter((release) => includePrereleases || !release.prerelease)
      .map((release) => ({
        assets: Array.isArray(release.assets)
          ? release.assets.map((asset) => ({
            name: asset.name,
            size: asset.size,
            url: asset.browser_download_url
          }))
          : [],
        htmlUrl: release.html_url,
        name: release.name || release.tag_name,
        prerelease: Boolean(release.prerelease),
        releaseNotes: typeof release.body === 'string' ? release.body.trim() : '',
        version: normaliseReleaseVersion(release.tag_name || release.name || '')
      }))
      .filter((release) => release.version)
    : [];

  return candidates.sort((first, second) => compareVersions(second.version, first.version))[0] ?? null;
}

function selectUpdateAsset(assets, { appChannel, arch, platform }) {
  const beta = appChannel === 'beta';
  const architecture = arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = Array.isArray(assets) ? assets : [];
  const belongsToChannel = (name) => (beta ? /beta/i.test(name) : !/beta/i.test(name));

  if (platform === 'win32') {
    return candidates.find((asset) => (
      belongsToChannel(asset.name)
      && new RegExp(`windows-${architecture}`, 'i').test(asset.name)
      && /\.exe$/i.test(asset.name)
    )) ?? null;
  }

  if (platform === 'linux') {
    const extension = process.env.APPIMAGE
      ? 'AppImage'
      : os.release().toLowerCase().includes('fedora')
      ? 'rpm'
      : 'deb';

    return candidates.find((asset) => (
      belongsToChannel(asset.name)
      && new RegExp(`(?:linux-${architecture}|${architecture})`, 'i').test(asset.name)
      && new RegExp(`\\.${extension}$`, 'i').test(asset.name)
    )) ?? null;
  }

  return null;
}

function normaliseReleaseVersion(value) {
  const version = String(value ?? '').trim().replace(/^v/i, '');
  return /^(?:\d+\.\d+\.\d+|\d+\.\d+\.\d+-beta\.[1-9]\d*)$/.test(version) ? version : null;
}

function isUpdateSmokeDisabled(env = process.env) {
  return env.CAUL_DISABLE_UPDATE_CHECKS === '1';
}

function resolveUpdateTestFeed(env = process.env) {
  return env.CAUL_UPDATE_TEST_MODE === '1'
    ? String(env.CAUL_UPDATE_FEED_URL ?? '').trim()
    : '';
}

function resolveTufTestRepository(env = process.env) {
  return env.CAUL_UPDATE_TEST_MODE === '1'
    ? String(env.CAUL_TUF_TEST_REPOSITORY_URL ?? '').trim()
    : '';
}

function configureUpdaterDownloadMode(
  autoUpdater,
  { env = process.env, platform = process.platform } = {}
) {
  if (
    platform === 'win32'
    || (
      env.CAUL_UPDATE_TEST_MODE === '1'
      && env.CAUL_UPDATER_DISABLE_DIFFERENTIAL_DOWNLOAD === '1'
    )
  ) {
    autoUpdater.disableDifferentialDownload = true;
    return true;
  }
  return false;
}

function isVersionNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function compareVersions(first, second) {
  const left = parseVersion(first);
  const right = parseVersion(second);

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] > right[key] ? 1 : -1;
    }
  }

  if (left.prerelease === right.prerelease) {
    return 0;
  }

  if (!left.prerelease) {
    return 1;
  }

  if (!right.prerelease) {
    return -1;
  }

  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true, sensitivity: 'base' });
}

function parseVersion(version) {
  const [, major = '0', minor = '0', patch = '0', prerelease = ''] = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/) ?? [];
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease
  };
}

module.exports = {
  automaticInstallSupported,
  compareVersions,
  configureUpdaterDownloadMode,
  configureUpdaterFeed,
  createUpdateInstallHandoffController,
  createUpdaterService,
  findTargetRelease,
  isUpdateSmokeDisabled,
  isLocalDevChannel,
  normaliseUpdaterReleaseNotes,
  normaliseReleaseVersion,
  normaliseUpdateFrequency,
  resolveTufTestRepository,
  resolveUpdateTestFeed,
  scheduleUpdaterTestAction,
  selectUpdateAsset,
  shouldCheckForUpdates,
  usesTufUpdater,
  validatePackagedTufMetadata,
  writeUpdaterTestEvent,
  updateFrequencies
};

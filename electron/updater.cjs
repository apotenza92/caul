const { app, BrowserWindow, dialog, shell } = require('electron');
const { createHash } = require('node:crypto');
const fsSync = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

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
  isDev,
  onAfterSuccessfulCheck,
  onBeforeInstallDownloadedUpdate,
  forceEnabled = false,
  repositoryUrl = 'https://github.com/apotenza92/caul/releases'
} = {}) {
  const { autoUpdater } = require('electron-updater');
  const testFeedUrl = resolveUpdateTestFeed(process.env);
  let scheduleTimer = null;
  let checking = false;
  let downloading = false;
  let lastResult = null;
  let availableUpdate = null;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = appChannel === 'beta';

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
    emitStatus();
  });

  autoUpdater.on('error', (error) => {
    checking = false;
    downloading = false;
    lastResult = {
      ok: false,
      status: 'error',
      message: error?.message ?? 'Update check failed.'
    };
    emitStatus();
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
      automaticInstall: process.platform === 'darwin',
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

  function startSchedule() {
    stopSchedule();

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
          platform: process.platform
        }),
        checksumAsset: selectReleaseChecksumAsset(targetRelease.assets),
        downloadUrl: targetRelease.htmlUrl,
        prerelease: targetRelease.prerelease,
        releaseName: targetRelease.name,
        version: targetRelease.version
      };
      checking = false;
      lastResult = {
        ok: true,
        status: 'available',
        message: `Caul ${targetRelease.version} is available.`
      };
      emitStatus();

      if (process.platform === 'darwin') {
        autoUpdater.allowPrerelease = targetRelease.prerelease;
        configureUpdaterFeed(autoUpdater, { appChannel, testFeedUrl });
      }

      return status();
    } catch (error) {
      checking = false;
      lastResult = {
        ok: false,
        status: 'error',
        message: error?.message ?? 'Update check failed.'
      };
      emitStatus();
      return status();
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

    if (process.platform === 'darwin') {
      downloading = true;
      lastResult = {
        ok: true,
        status: 'downloading',
        message: 'Downloading update.'
      };
      emitStatus();
      autoUpdater.allowPrerelease = Boolean(availableUpdate.prerelease);
      configureUpdaterFeed(autoUpdater, { appChannel, testFeedUrl });
      await autoUpdater.checkForUpdates();
      await autoUpdater.downloadUpdate();
      return status();
    }

    if (availableUpdate.asset?.url) {
      downloading = true;
      lastResult = {
        ok: true,
        status: 'downloading',
        message: `Downloading ${availableUpdate.asset.name}.`
      };
      emitStatus();
      try {
        const filePath = await downloadAndVerifyAsset({
          asset: availableUpdate.asset,
          checksumAsset: availableUpdate.checksumAsset,
          downloadsDirectory: app.getPath('downloads'),
          userAgent: `Caul/${app.getVersion()}`
        });
        downloading = false;
        lastResult = {
          ok: true,
          status: 'downloaded',
          message: `Downloaded and verified ${availableUpdate.asset.name} in Downloads.`
        };
        emitStatus();
        shell.showItemInFolder(filePath);
      } catch (error) {
        downloading = false;
        lastResult = {
          ok: false,
          status: 'error',
          message: error?.message ?? 'Update download verification failed.'
        };
        emitStatus();
      }
      return status();
    }

    await shell.openExternal(availableUpdate.downloadUrl || repositoryUrl);
    lastResult = {
      ok: true,
      status: 'external',
      message: 'Opened the Caul release page.'
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

    if (process.platform === 'darwin') {
      onBeforeInstallDownloadedUpdate?.();
      autoUpdater.quitAndInstall(false, true);
      return status();
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
      message: `Caul ${availableUpdate.version} is available.`,
      type: 'info'
    }).then((result) => {
      if (result.response === 0) {
        void downloadAndInstall();
      }
    });
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
    stopSchedule
  };
}

function isLocalDevChannel(channel) {
  return channel === 'dev' || channel === 'dev-private';
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
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeedUrl, channel });
    return;
  }
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: githubOwner,
    repo: githubRepo,
    channel
  });
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

function selectReleaseChecksumAsset(assets) {
  const candidates = Array.isArray(assets) ? assets : [];
  return candidates.find((asset) => asset?.name === 'SHA256SUMS' && typeof asset.url === 'string') ?? null;
}

function parseReleaseChecksums(contents) {
  if (typeof contents !== 'string') {
    throw new Error('Release checksum manifest is unreadable.');
  }

  const checksums = new Map();
  const lines = contents.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error('Release checksum manifest is empty.');
  }

  for (const line of lines) {
    const match = line.match(/^([a-fA-F0-9]{64}) {2}([^/\\]+)$/);
    if (!match) {
      throw new Error('Release checksum manifest contains a malformed entry.');
    }
    const [, checksum, fileName] = match;
    if (checksums.has(fileName)) {
      throw new Error(`Release checksum manifest contains duplicate entries for ${fileName}.`);
    }
    checksums.set(fileName, checksum.toLowerCase());
  }

  return checksums;
}

function resolveExpectedAssetChecksum(contents, assetName) {
  if (typeof assetName !== 'string' || path.basename(assetName) !== assetName) {
    throw new Error('Update asset name is invalid.');
  }
  const checksum = parseReleaseChecksums(contents).get(assetName);
  if (!checksum) {
    throw new Error(`Release checksum manifest does not contain ${assetName}.`);
  }
  return checksum;
}

async function downloadAndVerifyAsset({
  asset,
  checksumAsset,
  downloadsDirectory,
  userAgent
}) {
  if (!asset || typeof asset.name !== 'string' || typeof asset.url !== 'string') {
    throw new Error('The selected update package is invalid.');
  }
  if (path.basename(asset.name) !== asset.name) {
    throw new Error('The selected update package name is invalid.');
  }
  if (!checksumAsset || typeof checksumAsset.url !== 'string') {
    throw new Error('This release does not provide the required SHA256SUMS integrity manifest.');
  }

  const checksumManifest = await downloadText(checksumAsset.url, { userAgent });
  const expectedChecksum = resolveExpectedAssetChecksum(checksumManifest, asset.name);
  const filePath = resolveAvailableDownloadPath(downloadsDirectory, asset.name);
  const temporaryPath = `${filePath}.download`;
  fsSync.mkdirSync(downloadsDirectory, { recursive: true });
  fsSync.rmSync(temporaryPath, { force: true });

  try {
    const downloaded = await downloadFile(asset.url, temporaryPath, { userAgent });
    if (Number.isSafeInteger(asset.size) && asset.size >= 0 && downloaded.size !== asset.size) {
      throw new Error(`Downloaded size mismatch for ${asset.name}.`);
    }
    if (downloaded.sha256 !== expectedChecksum) {
      throw new Error(`SHA-256 verification failed for ${asset.name}.`);
    }
    fsSync.renameSync(temporaryPath, filePath);
    return filePath;
  } catch (error) {
    fsSync.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function resolveAvailableDownloadPath(directory, fileName) {
  const initialPath = path.join(directory, fileName);
  if (!fsSync.existsSync(initialPath)) {
    return initialPath;
  }

  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = path.join(directory, `${stem} (${index})${extension}`);
    if (!fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not select an available download path for ${fileName}.`);
}

function downloadText(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = requestUrl(url, {
      headers: {
        'User-Agent': options.userAgent ?? 'Caul'
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error('Update download exceeded the redirect limit.'));
          return;
        }
        const redirectUrl = new URL(response.headers.location, url).toString();
        downloadText(redirectUrl, options, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Checksum download returned HTTP ${response.statusCode}.`));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          request.destroy(new Error('Release checksum manifest exceeds 1 MiB.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(15_000, () => {
      request.destroy(new Error('Checksum download timed out.'));
    });
  });
}

function downloadFile(url, destination, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let file = null;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      file?.destroy();
      reject(error);
    };
    const request = requestUrl(url, {
      headers: {
        'User-Agent': options.userAgent ?? 'Caul'
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= 5) {
          fail(new Error('Update download exceeded the redirect limit.'));
          return;
        }
        const redirectUrl = new URL(response.headers.location, url).toString();
        settled = true;
        downloadFile(redirectUrl, destination, options, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        fail(new Error(`Update download returned HTTP ${response.statusCode}.`));
        return;
      }

      const hash = createHash('sha256');
      file = fsSync.createWriteStream(destination);
      let size = 0;

      response.on('data', (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      });
      response.on('error', fail);
      file.on('error', fail);
      file.on('finish', () => {
        file.close(() => {
          if (settled) return;
          settled = true;
          resolve({ sha256: hash.digest('hex'), size });
        });
      });
      response.pipe(file);
    });

    request.on('error', fail);
    request.setTimeout(30_000, () => {
      request.destroy(new Error('Update download timed out.'));
    });
  });
}

function requestUrl(url, options, onResponse) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported update download protocol: ${parsed.protocol}`);
  }
  if (parsed.protocol === 'http:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]') {
    throw new Error('Insecure update downloads are allowed only from a loopback test feed.');
  }
  const client = parsed.protocol === 'https:' ? https : require('node:http');
  return client.get(parsed, options, onResponse);
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
  compareVersions,
  configureUpdaterFeed,
  createUpdaterService,
  downloadAndVerifyAsset,
  findTargetRelease,
  isUpdateSmokeDisabled,
  isLocalDevChannel,
  normaliseReleaseVersion,
  normaliseUpdateFrequency,
  parseReleaseChecksums,
  resolveExpectedAssetChecksum,
  resolveUpdateTestFeed,
  selectReleaseChecksumAsset,
  selectUpdateAsset,
  shouldCheckForUpdates,
  updateFrequencies
};

const { existsSync, realpathSync } = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function canonicaliseFilePath(filePath, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let cursor = pathApi.resolve(filePath);
  const missingSegments = [];

  if (platform === 'darwin') {
    for (const alias of ['/etc', '/tmp', '/var']) {
      if (cursor === alias || cursor.startsWith(`${alias}${pathApi.sep}`)) {
        cursor = `/private${cursor}`;
        break;
      }
    }
  }

  const asarBoundary = cursor.toLowerCase().lastIndexOf(`.asar${pathApi.sep}`);
  if (asarBoundary >= 0) {
    missingSegments.push(...cursor.slice(asarBoundary + 6).split(pathApi.sep).filter(Boolean));
    cursor = cursor.slice(0, asarBoundary + 5);
  }

  while (!existsSync(cursor)) {
    const parent = pathApi.dirname(cursor);
    if (parent === cursor) break;
    missingSegments.unshift(pathApi.basename(cursor));
    cursor = parent;
  }

  try {
    cursor = realpathSync.native(cursor);
  } catch {
    // Preserve the normalised absolute path when no ancestor can be resolved.
  }

  const canonical = pathApi.resolve(cursor, ...missingSegments);
  return platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function createTrustedRendererUrlChecker({ devServerUrl, isDev, platform = process.platform, rendererFilePath }) {
  const devUrl = parseUrl(devServerUrl);
  const productionUrl = rendererFilePath ? parseUrl(pathToFileURL(rendererFilePath).toString()) : null;
  const productionPath = rendererFilePath ? canonicaliseFilePath(rendererFilePath, platform) : null;

  if (isDev && (!devUrl || !['http:', 'https:'].includes(devUrl.protocol))) {
    throw new Error('The development renderer URL must use HTTP or HTTPS.');
  }

  if (!isDev && !productionUrl) {
    throw new Error('The packaged renderer file path is required.');
  }

  const candidateCache = new Map();
  const checkCandidate = (candidate) => {
    const url = parseUrl(candidate);
    if (!url) return false;

    if (isDev) {
      return url.origin === devUrl.origin;
    }

    if (url.protocol !== 'file:' || url.origin !== productionUrl.origin) return false;

    try {
      return canonicaliseFilePath(fileURLToPath(url), platform) === productionPath;
    } catch {
      return false;
    }
  };

  return (candidate) => {
    if (candidateCache.has(candidate)) return candidateCache.get(candidate);
    const trusted = checkCandidate(candidate);
    if (candidateCache.size >= 16) candidateCache.clear();
    candidateCache.set(candidate, trusted);
    return trusted;
  };
}

function isSafeExternalUrl(candidate) {
  const url = parseUrl(candidate);
  return Boolean(url && url.protocol === 'https:' && url.username === '' && url.password === '');
}

function installRendererNavigationPolicy({ webContents, isTrustedRendererUrl, openExternal, reportError = console.error }) {
  const openSafeExternalUrl = (candidate) => {
    if (!isSafeExternalUrl(candidate)) return;
    Promise.resolve(openExternal(candidate)).catch((error) => {
      reportError(`Failed to open external URL: ${error.message}`);
    });
  };

  webContents.on('will-navigate', (event, candidate) => {
    if (isTrustedRendererUrl(candidate)) return;
    event.preventDefault();
    openSafeExternalUrl(candidate);
  });

  webContents.on('will-redirect', (event, candidate) => {
    if (!isTrustedRendererUrl(candidate)) event.preventDefault();
  });

  webContents.on('will-attach-webview', (event) => event.preventDefault());

  webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalUrl(url);
    return { action: 'deny' };
  });
}

function createTrustedIpcRegistrar({ ipcMain, isTrustedEvent, reportBlocked = console.warn }) {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedEvent(event, channel)) {
          throw new Error(`Blocked untrusted IPC sender for ${channel}.`);
        }

        return handler(event, ...args);
      });
    },
    on(channel, handler) {
      ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedEvent(event, channel)) {
          reportBlocked(`Blocked untrusted IPC sender for ${channel}.`);
          return;
        }

        handler(event, ...args);
      });
    }
  };
}

function isTrustedIpcEvent(event, { isKnownWebContents, isTrustedRendererUrl }) {
  if (!event?.sender || !isKnownWebContents(event.sender)) return false;
  const senderUrl = event.senderFrame?.url;
  return typeof senderUrl === 'string' && isTrustedRendererUrl(senderUrl);
}

module.exports = {
  canonicaliseFilePath,
  createTrustedIpcRegistrar,
  createTrustedRendererUrlChecker,
  installRendererNavigationPolicy,
  isSafeExternalUrl,
  isTrustedIpcEvent
};

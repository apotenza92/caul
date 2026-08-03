const { pathToFileURL } = require('node:url');

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function createTrustedRendererUrlChecker({ devServerUrl, isDev, rendererFilePath }) {
  const devUrl = parseUrl(devServerUrl);
  const productionUrl = rendererFilePath ? parseUrl(pathToFileURL(rendererFilePath).toString()) : null;

  if (isDev && (!devUrl || !['http:', 'https:'].includes(devUrl.protocol))) {
    throw new Error('The development renderer URL must use HTTP or HTTPS.');
  }

  if (!isDev && !productionUrl) {
    throw new Error('The packaged renderer file path is required.');
  }

  return (candidate) => {
    const url = parseUrl(candidate);
    if (!url) return false;

    if (isDev) {
      return url.origin === devUrl.origin;
    }

    return url.protocol === 'file:'
      && url.origin === productionUrl.origin
      && url.pathname === productionUrl.pathname;
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
  createTrustedIpcRegistrar,
  createTrustedRendererUrlChecker,
  installRendererNavigationPolicy,
  isSafeExternalUrl,
  isTrustedIpcEvent
};

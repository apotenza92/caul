const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { BaseFetcher, Updater } = require('tuf-js');
const { DownloadHTTPError } = require('tuf-js/dist/error');

function isLoopbackHost(hostname) {
  return ['127.0.0.1', '::1'].includes(hostname);
}

function validateRepositoryUrl(value, { allowLoopbackHttp = false } = {}) {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Caul TUF repository URLs must not contain credentials, queries or fragments.');
  }
  if (
    parsed.protocol !== 'https:'
    && !(allowLoopbackHttp && parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))
  ) {
    throw new Error('Caul TUF repositories must use HTTPS. Loopback HTTP is test-only.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function validateTargetName(value) {
  if (
    typeof value !== 'string'
    || !value
    || value === '.'
    || value === '..'
    || value !== path.posix.basename(value)
    || value.includes('\\')
    || value.includes('\0')
  ) {
    throw new Error(`Unsafe TUF update target name: ${value}`);
  }
  return value;
}

function initializeTrustedRoot({ embeddedRootPath, metadataDir }) {
  const trustedRootPath = path.join(metadataDir, 'root.json');
  fs.mkdirSync(metadataDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(trustedRootPath)) {
    if (!fs.statSync(trustedRootPath).isFile()) {
      throw new Error('The persisted Caul TUF root is not a regular file.');
    }
    return { initialized: false, trustedRootPath };
  }
  if (!embeddedRootPath || !fs.statSync(embeddedRootPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Caul has no embedded TUF trust root.');
  }
  fs.copyFileSync(embeddedRootPath, trustedRootPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(trustedRootPath, 0o600);
  return { initialized: true, trustedRootPath };
}

class NoRedirectFetcher extends BaseFetcher {
  constructor({ timeoutMs = 15_000, userAgent = 'Caul desktop updater' } = {}) {
    super();
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
  }

  async fetch(url) {
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (response.status >= 300 && response.status < 400) {
      response.body?.cancel().catch(() => {});
      throw new Error(`Caul refused redirected TUF metadata from ${url}.`);
    }
    if (!response.ok || !response.body) {
      response.body?.cancel().catch(() => {});
      throw new DownloadHTTPError('Caul TUF download failed.', response.status);
    }
    return response.body;
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function createTufVerifiedUpdateFeed({
  allowLoopbackHttp = false,
  embeddedRootPath,
  fetcher = new NoRedirectFetcher(),
  repositoryUrl,
  targetName,
  trustDir,
  UpdaterClass = Updater
} = {}) {
  const normalisedRepositoryUrl = validateRepositoryUrl(repositoryUrl, { allowLoopbackHttp });
  const normalisedTargetName = validateTargetName(targetName);
  const metadataDir = path.join(trustDir, 'metadata');
  const targetDir = path.join(trustDir, 'targets');
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const trust = initializeTrustedRoot({ embeddedRootPath, metadataDir });

  const targetPath = path.join(targetDir, normalisedTargetName);
  let targetBytes = null;
  let refreshPromise = null;
  const refresh = () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const updater = new UpdaterClass({
        metadataBaseUrl: `${normalisedRepositoryUrl}/metadata`,
        targetBaseUrl: `${normalisedRepositoryUrl}/targets`,
        metadataDir,
        targetDir,
        fetcher
      });
      await updater.refresh();
      const targetInfo = await updater.getTargetInfo(normalisedTargetName);
      if (!targetInfo) {
        throw new Error(`The signed Caul update repository has no ${normalisedTargetName} target.`);
      }
      const cachedTargetPath = await updater.findCachedTarget(targetInfo, targetPath);
      if (!cachedTargetPath) {
        const temporaryTargetPath = `${targetPath}.${process.pid}.tmp`;
        try {
          await updater.downloadTarget(targetInfo, temporaryTargetPath);
          fs.rmSync(targetPath, { force: true });
          fs.renameSync(temporaryTargetPath, targetPath);
        } finally {
          fs.rmSync(temporaryTargetPath, { force: true });
        }
      }
      targetBytes = fs.readFileSync(targetPath);
      return targetPath;
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };
  await refresh();

  const requestPath = `/${encodeURIComponent(normalisedTargetName)}`;
  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method) || pathname !== requestPath) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (!targetBytes) {
      response.writeHead(503, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': targetBytes.length,
      'Content-Type': 'application/yaml'
    });
    response.end(request.method === 'HEAD' ? undefined : targetBytes);
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await close(server);
    throw new Error('Caul could not start its verified local update feed.');
  }
  let closePromise = null;
  const closeFeed = () => {
    if (closePromise) return closePromise;
    closePromise = server.listening ? close(server) : Promise.resolve();
    return closePromise;
  };

  return {
    close: closeFeed,
    feedUrl: `http://127.0.0.1:${address.port}`,
    refresh,
    targetPath,
    trustInitialized: trust.initialized,
    trustedRootPath: trust.trustedRootPath
  };
}

module.exports = {
  createTufVerifiedUpdateFeed,
  initializeTrustedRoot,
  isLoopbackHost,
  NoRedirectFetcher,
  validateRepositoryUrl,
  validateTargetName
};

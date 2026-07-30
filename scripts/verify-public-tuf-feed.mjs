#!/usr/bin/env node

import { setTimeout as delay } from 'node:timers/promises';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTufVerifiedUpdateFeed, isLoopbackHost } = require('../electron/tufUpdateFeed.cjs');

class RedirectedPublicFeedError extends Error {}

function listFiles(root, relative = '') {
  const directory = path.join(root, relative);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelative = path.posix.join(relative.split(path.sep).join('/'), entry.name);
    if (entry.isDirectory()) return listFiles(root, entryRelative);
    if (!entry.isFile()) throw new Error(`Unexpected updater-feed entry: ${entryRelative}`);
    return [entryRelative];
  }).sort();
}

function validateBaseUrl(value, { allowLoopbackHttp = false } = {}) {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Public updater-feed URLs must not contain credentials, queries or fragments.');
  }
  if (
    parsed.protocol !== 'https:'
    && !(allowLoopbackHttp && parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))
  ) {
    throw new Error('Public updater-feed verification requires HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function fetchPublicBytes(url, {
  attempts = 12,
  fetchImpl = fetch,
  retryDelayMs = 5_000,
  timeoutMs = 30_000
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status >= 300 && response.status < 400) {
        throw new RedirectedPublicFeedError(`Public updater feed redirected ${url}.`);
      }
      if (!response.ok) throw new Error(`Public updater feed returned HTTP ${response.status} for ${url}.`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof RedirectedPublicFeedError) throw error;
      lastError = error;
      if (attempt < attempts) await delay(retryDelayMs);
    }
  }
  throw lastError;
}

async function verifyPublicTufFeed({
  allowLoopbackHttp = false,
  attempts = 12,
  baseUrl,
  embeddedRootPath,
  expectedDirectory,
  fetchImpl = fetch,
  retryDelayMs = 5_000
}) {
  const normalisedBaseUrl = validateBaseUrl(baseUrl, { allowLoopbackHttp });
  if (!statSync(embeddedRootPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Embedded TUF root is missing: ${embeddedRootPath}`);
  }
  const files = listFiles(expectedDirectory);
  if (!files.includes('.nojekyll') || !files.includes('PUBLICATION.txt') || !files.includes('SHA256SUMS')) {
    throw new Error('Sealed updater-feed evidence is missing publication control files.');
  }

  for (const relative of files) {
    const publicBytes = await fetchPublicBytes(
      `${normalisedBaseUrl}/${relative.split('/').map(encodeURIComponent).join('/')}`,
      { attempts, fetchImpl, retryDelayMs }
    );
    const expectedBytes = readFileSync(path.join(expectedDirectory, ...relative.split('/')));
    if (!publicBytes.equals(expectedBytes)) {
      throw new Error(`Public updater-feed bytes differ for ${relative}.`);
    }
  }

  const targets = files.filter((relative) => (
    /^(?:stable|beta)\/(?:win32|linux)\/(?:arm64|x64)\/[^/]+\.yml$/.test(relative)
  ));
  if (targets.length === 0) throw new Error('Sealed updater-feed evidence has no TUF targets.');
  const trustRoot = mkdtempSync(path.join(tmpdir(), 'caul-public-tuf-'));
  try {
    for (const relative of targets) {
      const [channel, platform, arch, targetName] = relative.split('/');
      const feed = await createTufVerifiedUpdateFeed({
        allowLoopbackHttp,
        embeddedRootPath,
        repositoryUrl: `${normalisedBaseUrl}/${channel}/${platform}/${arch}/tuf`,
        targetName,
        trustDir: path.join(trustRoot, channel, platform, arch)
      });
      try {
        const expectedBytes = readFileSync(path.join(expectedDirectory, ...relative.split('/')));
        if (!readFileSync(feed.targetPath).equals(expectedBytes)) {
          throw new Error(`TUF returned unexpected target bytes for ${relative}.`);
        }
      } finally {
        await feed.close();
      }
    }
  } finally {
    rmSync(trustRoot, { recursive: true, force: true });
  }
  return { files, targets };
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Arguments must use --name value pairs.');
    }
    values[key.slice(2)] = value;
  }
  return values;
}

async function main(argv = process.argv.slice(2)) {
  const args = argumentsFrom(argv);
  for (const name of ['expected', 'embedded-root', 'base-url']) {
    if (!args[name]) throw new Error(`Missing --${name}.`);
  }
  const result = await verifyPublicTufFeed({
    baseUrl: args['base-url'],
    embeddedRootPath: path.resolve(args['embedded-root']),
    expectedDirectory: path.resolve(args.expected)
  });
  process.stdout.write(
    `Verified ${result.files.length} public feed files and ${result.targets.length} TUF targets.\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  fetchPublicBytes,
  listFiles,
  RedirectedPublicFeedError,
  validateBaseUrl,
  verifyPublicTufFeed
};

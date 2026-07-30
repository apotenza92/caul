import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fetchPublicBytes,
  validateBaseUrl,
  verifyPublicTufFeed
} from './verify-public-tuf-feed.mjs';

const require = createRequire(import.meta.url);
const { createProductionTrust } = require('./create-tuf-production-trust.cjs');
const { onlineRoles, signUpdateRepository } = require('./sign-tuf-update-repository.cjs');
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => (
    new Promise((resolve) => server.close(resolve))
  )));
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'caul-public-feed-'));
  const expected = path.join(root, 'expected');
  const embeddedRootPath = path.join(root, 'public', 'root.json');
  const privateKeyBundlePath = path.join(root, 'private', 'keys.json');
  createProductionTrust({
    privateKeyBundlePath,
    rootExpires: '2036-01-01T00:00:00Z',
    rootPath: embeddedRootPath
  });
  const privateBundle = JSON.parse(readFileSync(privateKeyBundlePath, 'utf8'));
  const targetName = 'latest.yml';
  const targetDirectory = path.join(expected, 'stable', 'win32', 'x64');
  mkdirSync(targetDirectory, { recursive: true });
  const targetPath = path.join(targetDirectory, targetName);
  writeFileSync(targetPath, 'version: 0.1.44\nfiles: []\n');
  signUpdateRepository({
    now: new Date('2026-07-30T00:00:00.000Z'),
    outputDirectory: path.join(targetDirectory, 'tuf'),
    previousMetadataDirectory: null,
    privateKeys: Object.fromEntries(onlineRoles.map((role) => [
      role,
      privateBundle.roles[role].private_key_pem
    ])),
    rootPath: embeddedRootPath,
    targetName,
    targetPath
  });
  writeFileSync(path.join(expected, '.nojekyll'), '');
  writeFileSync(path.join(expected, 'PUBLICATION.txt'), 'Caul test publication\n');
  const checksummed = [];
  const walk = (directory, relative = '') => {
    for (const entry of require('node:fs').readdirSync(directory, { withFileTypes: true })) {
      const next = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(path.join(directory, entry.name), next);
      else if (entry.name !== 'SHA256SUMS') checksummed.push(next);
    }
  };
  walk(expected);
  checksummed.sort();
  writeFileSync(
    path.join(expected, 'SHA256SUMS'),
    `${checksummed.map((name) => (
      `${sha256(readFileSync(path.join(expected, ...name.split('/'))))}  ${name}`
    )).join('\n')}\n`
  );

  const server = createServer((request, response) => {
    const relative = decodeURIComponent(request.url.slice(1));
    const target = path.resolve(expected, relative);
    const resolvedExpected = path.resolve(expected);
    if (
      !target.startsWith(`${resolvedExpected}${path.sep}`)
      && target !== resolvedExpected
    ) {
      response.writeHead(400).end();
      return;
    }
    try {
      const bytes = readFileSync(target);
      response.writeHead(200, { 'Content-Length': bytes.length });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    embeddedRootPath,
    expected,
    root
  };
}

describe('public updater-feed verification', () => {
  it('re-downloads exact bytes anonymously and verifies the real TUF target path', async () => {
    const value = await fixture();
    try {
      const result = await verifyPublicTufFeed({
        allowLoopbackHttp: true,
        attempts: 1,
        baseUrl: value.baseUrl,
        embeddedRootPath: value.embeddedRootPath,
        expectedDirectory: value.expected,
        retryDelayMs: 0
      });
      expect(result.targets).toEqual(['stable/win32/x64/latest.yml']);
      expect(result.files).toContain('.nojekyll');
      expect(result.files).toContain('SHA256SUMS');
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('rejects public redirects instead of silently following them', async () => {
    await expect(fetchPublicBytes('https://updates.invalid/metadata', {
      attempts: 1,
      fetchImpl: async () => ({
        status: 302
      }),
      retryDelayMs: 0
    })).rejects.toThrow(/redirected/);
  });

  it('rejects credentials, queries and non-literal loopback HTTP base URLs', () => {
    expect(() => validateBaseUrl('https://user:secret@updates.example/feed'))
      .toThrow(/credentials/);
    expect(() => validateBaseUrl('https://updates.example/feed?channel=stable'))
      .toThrow(/queries/);
    expect(() => validateBaseUrl('http://localhost:1234/feed', { allowLoopbackHttp: true }))
      .toThrow(/HTTPS/);
  });
});

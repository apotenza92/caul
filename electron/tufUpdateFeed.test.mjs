import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalize } from '@tufjs/canonical-json';

const require = createRequire(import.meta.url);
const {
  createTufVerifiedUpdateFeed,
  initializeTrustedRoot,
  validateRepositoryUrl,
  validateTargetName
} = require('./tufUpdateFeed.cjs');

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => (
    new Promise((resolve) => server.close(resolve))
  )));
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function signedMetadata(signed, keyID, privateKey) {
  return {
    signatures: [{
      keyid: keyID,
      sig: sign(null, Buffer.from(canonicalize(signed)), privateKey).toString('hex')
    }],
    signed
  };
}

function tufFixture({
  expires = '2035-01-01T00:00:00Z',
  targetName = 'latest.yml'
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const key = {
    keytype: 'ed25519',
    scheme: 'ed25519',
    keyval: { public: publicDer.subarray(-32).toString('hex') }
  };
  const keyID = sha256(Buffer.from(canonicalize(key)));
  const role = { keyids: [keyID], threshold: 1 };
  const targetBytes = Buffer.from('version: 0.1.44\nfiles: []\n');
  const targets = signedMetadata({
    _type: 'targets',
    spec_version: '1.0.31',
    version: 1,
    expires,
    targets: {
      [targetName]: {
        length: targetBytes.length,
        hashes: { sha256: sha256(targetBytes) }
      }
    }
  }, keyID, privateKey);
  const targetsBytes = Buffer.from(JSON.stringify(targets));
  const snapshot = signedMetadata({
    _type: 'snapshot',
    spec_version: '1.0.31',
    version: 1,
    expires,
    meta: {
      'targets.json': {
        version: 1,
        length: targetsBytes.length,
        hashes: { sha256: sha256(targetsBytes) }
      }
    }
  }, keyID, privateKey);
  const snapshotBytes = Buffer.from(JSON.stringify(snapshot));
  const timestamp = signedMetadata({
    _type: 'timestamp',
    spec_version: '1.0.31',
    version: 1,
    expires,
    meta: {
      'snapshot.json': {
        version: 1,
        length: snapshotBytes.length,
        hashes: { sha256: sha256(snapshotBytes) }
      }
    }
  }, keyID, privateKey);
  const root = signedMetadata({
    _type: 'root',
    spec_version: '1.0.31',
    version: 1,
    expires: '2036-01-01T00:00:00Z',
    consistent_snapshot: false,
    keys: { [keyID]: key },
    roles: {
      root: role,
      snapshot: role,
      targets: role,
      timestamp: role
    }
  }, keyID, privateKey);
  return {
    expires,
    keyID,
    metadata: {
      'root.json': Buffer.from(JSON.stringify(root)),
      'snapshot.json': snapshotBytes,
      'targets.json': targetsBytes,
      'timestamp.json': Buffer.from(JSON.stringify(timestamp))
    },
    privateKey,
    targetBytes,
    targetName
  };
}

function rebuildSnapshotAndTimestamp(fixture) {
  const targetsBytes = fixture.metadata['targets.json'];
  const snapshot = signedMetadata({
    _type: 'snapshot',
    spec_version: '1.0.31',
    version: 1,
    expires: fixture.expires,
    meta: {
      'targets.json': {
        version: 1,
        length: targetsBytes.length,
        hashes: { sha256: sha256(targetsBytes) }
      }
    }
  }, fixture.keyID, fixture.privateKey);
  const snapshotBytes = Buffer.from(JSON.stringify(snapshot));
  fixture.metadata['snapshot.json'] = snapshotBytes;
  fixture.metadata['timestamp.json'] = Buffer.from(JSON.stringify(signedMetadata({
    _type: 'timestamp',
    spec_version: '1.0.31',
    version: 1,
    expires: fixture.expires,
    meta: {
      'snapshot.json': {
        version: 1,
        length: snapshotBytes.length,
        hashes: { sha256: sha256(snapshotBytes) }
      }
    }
  }, fixture.keyID, fixture.privateKey)));
}

async function fixtureServer(fixture, { redirectTimestamp = false, requests = [] } = {}) {
  const server = createServer((request, response) => {
    requests.push(request.url);
    const match = request.url.match(/^\/(metadata|targets)\/([^/?]+)$/);
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    if (match[1] === 'metadata' && match[2] === '2.root.json') {
      response.writeHead(404).end();
      return;
    }
    if (redirectTimestamp && match[1] === 'metadata' && match[2] === 'timestamp.json') {
      response.writeHead(302, { Location: '/metadata/redirected-timestamp.json' }).end();
      return;
    }
    const bytes = match[1] === 'metadata'
      ? fixture.metadata[match[2]]
      : match[2] === fixture.targetName ? fixture.targetBytes : null;
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Length': bytes.length });
    response.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

describe('TUF update feed', () => {
  it('permits production HTTPS and explicit loopback tests only', () => {
    expect(validateRepositoryUrl('https://updates.example/caul/'))
      .toBe('https://updates.example/caul');
    expect(() => validateRepositoryUrl('http://updates.example/caul'))
      .toThrow(/HTTPS/);
    expect(validateRepositoryUrl(
      'http://127.0.0.1:1234/repository',
      { allowLoopbackHttp: true }
    )).toBe('http://127.0.0.1:1234/repository');
    expect(() => validateRepositoryUrl(
      'http://example.com/repository',
      { allowLoopbackHttp: true }
    )).toThrow(/HTTPS/);
    expect(() => validateRepositoryUrl(
      'http://localhost:1234/repository',
      { allowLoopbackHttp: true }
    )).toThrow(/HTTPS/);
    expect(() => validateRepositoryUrl('https://user:secret@updates.example/caul'))
      .toThrow(/credentials/);
    expect(() => validateRepositoryUrl('https://updates.example/caul?channel=stable'))
      .toThrow(/queries/);
  });

  it('rejects unsafe target names', () => {
    expect(validateTargetName('latest.yml')).toBe('latest.yml');
    expect(() => validateTargetName('../latest.yml')).toThrow(/Unsafe/);
    expect(() => validateTargetName('.')).toThrow(/Unsafe/);
    expect(() => validateTargetName('..')).toThrow(/Unsafe/);
    expect(() => validateTargetName('nested/latest.yml')).toThrow(/Unsafe/);
    expect(() => validateTargetName('latest\\evil.yml')).toThrow(/Unsafe/);
  });

  it('initialises embedded trust once and never overwrites an advanced root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'caul-tuf-bootstrap-'));
    try {
      const embedded = path.join(root, 'embedded-root.json');
      const metadata = path.join(root, 'metadata');
      writeFileSync(embedded, 'root version one');
      const first = initializeTrustedRoot({ embeddedRootPath: embedded, metadataDir: metadata });
      expect(first.initialized).toBe(true);
      writeFileSync(first.trustedRootPath, 'advanced root version two');
      writeFileSync(embedded, 'replacement app root');
      const second = initializeTrustedRoot({ embeddedRootPath: embedded, metadataDir: metadata });
      expect(second.initialized).toBe(false);
      expect(readFileSync(second.trustedRootPath, 'utf8')).toBe('advanced root version two');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serves only metadata bytes authenticated by TUF and closes idempotently', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'caul-tuf-feed-'));
    const fixture = tufFixture();
    const requests = [];
    const repositoryUrl = await fixtureServer(fixture, { requests });
    let feed;
    try {
      const embeddedRootPath = path.join(root, 'embedded-root.json');
      writeFileSync(embeddedRootPath, fixture.metadata['root.json']);
      feed = await createTufVerifiedUpdateFeed({
        allowLoopbackHttp: true,
        embeddedRootPath,
        repositoryUrl,
        targetName: fixture.targetName,
        trustDir: path.join(root, 'trust')
      });
      expect(feed.trustInitialized).toBe(true);
      const response = await fetch(`${feed.feedUrl}/${fixture.targetName}`);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.targetBytes);
      expect((await fetch(`${feed.feedUrl}/unexpected.yml`)).status).toBe(404);
      expect(readFileSync(feed.targetPath)).toEqual(fixture.targetBytes);
      await feed.refresh();
      expect(readFileSync(feed.targetPath)).toEqual(fixture.targetBytes);
      expect(requests.filter((request) => request === `/targets/${fixture.targetName}`))
        .toHaveLength(1);
      await feed.close();
      await feed.close();
      feed = null;
    } finally {
      if (feed) await feed.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'corrupt target bytes',
      mutate: (fixture) => {
        fixture.targetBytes = Buffer.from('malicious update metadata');
      },
      expected: /hash|length/i
    },
    {
      label: 'wrong target signature',
      mutate: (fixture) => {
        fixture.metadata['targets.json'] = Buffer.from(JSON.stringify({
          ...JSON.parse(fixture.metadata['targets.json']),
          signatures: [{ keyid: '0'.repeat(64), sig: '0'.repeat(128) }]
        }));
        rebuildSnapshotAndTimestamp(fixture);
      },
      expected: /signed|signature|threshold/i
    },
    {
      label: 'missing targets metadata',
      mutate: (fixture) => {
        delete fixture.metadata['targets.json'];
      },
      expected: /download|HTTP|404/i
    },
    {
      label: 'expired metadata',
      fixtureOptions: { expires: '2020-01-01T00:00:00Z' },
      expected: /expired/i
    }
  ])('fails closed for $label', async ({ expected, fixtureOptions, mutate }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'caul-tuf-reject-'));
    const fixture = tufFixture(fixtureOptions);
    mutate?.(fixture);
    const repositoryUrl = await fixtureServer(fixture);
    try {
      const embeddedRootPath = path.join(root, 'embedded-root.json');
      writeFileSync(embeddedRootPath, fixture.metadata['root.json']);
      await expect(createTufVerifiedUpdateFeed({
        allowLoopbackHttp: true,
        embeddedRootPath,
        repositoryUrl,
        targetName: fixture.targetName,
        trustDir: path.join(root, 'trust')
      })).rejects.toThrow(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses redirected metadata even when the destination is loopback', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'caul-tuf-redirect-'));
    const fixture = tufFixture();
    const repositoryUrl = await fixtureServer(fixture, { redirectTimestamp: true });
    try {
      const embeddedRootPath = path.join(root, 'embedded-root.json');
      writeFileSync(embeddedRootPath, fixture.metadata['root.json']);
      await expect(createTufVerifiedUpdateFeed({
        allowLoopbackHttp: true,
        embeddedRootPath,
        repositoryUrl,
        targetName: fixture.targetName,
        trustDir: path.join(root, 'trust')
      })).rejects.toThrow(/redirected/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

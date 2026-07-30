import { generateKeyPairSync } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createProductionTrust,
  recoverProductionRoot,
  roleNames
} = require('./create-tuf-production-trust.cjs');
const {
  expiryDays,
  onlineRoles,
  signUpdateRepository,
  verifyEnvelope
} = require('./sign-tuf-update-repository.cjs');

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'caul-production-tuf-'));
  const rootPath = path.join(directory, 'public', 'root.json');
  const privateKeyBundlePath = path.join(directory, 'private', 'keys.json');
  const created = createProductionTrust({
    privateKeyBundlePath,
    rootExpires: '2036-01-01T00:00:00Z',
    rootPath
  });
  const privateBundle = JSON.parse(readFileSync(privateKeyBundlePath, 'utf8'));
  return {
    created,
    directory,
    privateBundle,
    privateKeyBundlePath,
    rootPath
  };
}

describe('production TUF trust', () => {
  it('creates separate offline root and online role keys without private material in the app root', () => {
    const value = fixture();
    try {
      const rootText = readFileSync(value.rootPath, 'utf8');
      const root = JSON.parse(rootText);
      const keyIDs = roleNames.map((role) => root.signed.roles[role].keyids[0]);
      expect(new Set(keyIDs).size).toBe(roleNames.length);
      expect(root.signed.version).toBe(1);
      expect(root.signed.spec_version).toBe('1.0.31');
      expect(root.signed.consistent_snapshot).toBe(false);
      expect(rootText).not.toContain('PRIVATE KEY');
      expect(value.privateBundle.roles.root.private_key_pem).toContain('PRIVATE KEY');
      expect(statSync(value.privateKeyBundlePath).mode & 0o777).toBe(0o600);
      verifyEnvelope(root, root, 'root');
      expect(() => createProductionTrust({
        privateKeyBundlePath: value.privateKeyBundlePath,
        rootPath: value.rootPath
      })).toThrow(/must not already exist/);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('recovers the exact public root from the sealed private document', () => {
    const value = fixture();
    try {
      const expected = readFileSync(value.rootPath);
      rmSync(value.rootPath);
      const recovered = recoverProductionRoot({
        privateKeyBundlePath: value.privateKeyBundlePath,
        rootPath: value.rootPath
      });
      expect(readFileSync(value.rootPath)).toEqual(expected);
      expect(recovered.rootSha256).toBe(value.created.rootSha256);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('signs expiring metadata with online keys and increments verified prior versions', () => {
    const value = fixture();
    try {
      const targetName = 'latest.yml';
      const targetPath = path.join(value.directory, targetName);
      const firstOutput = path.join(value.directory, 'repository-1');
      const secondOutput = path.join(value.directory, 'repository-2');
      writeFileSync(targetPath, 'version: 0.1.44\nfiles: []\n');
      const privateKeys = Object.fromEntries(onlineRoles.map((role) => [
        role,
        value.privateBundle.roles[role].private_key_pem
      ]));
      const now = new Date('2026-07-30T00:00:00.000Z');
      const first = signUpdateRepository({
        now,
        outputDirectory: firstOutput,
        previousMetadataDirectory: null,
        privateKeys,
        rootPath: value.rootPath,
        targetName,
        targetPath
      });
      expect(first.versions).toEqual({ targets: 1, snapshot: 1, timestamp: 1 });
      for (const role of onlineRoles) {
        const envelope = JSON.parse(
          readFileSync(path.join(firstOutput, 'metadata', `${role}.json`), 'utf8')
        );
        verifyEnvelope(envelope, first.root, role);
        const expectedExpiry = new Date(
          now.getTime() + expiryDays[role] * 24 * 60 * 60 * 1000
        ).toISOString();
        expect(envelope.signed.expires).toBe(expectedExpiry);
      }
      expect(readFileSync(path.join(firstOutput, 'targets', targetName), 'utf8'))
        .toBe(readFileSync(targetPath, 'utf8'));
      expect(readFileSync(path.join(firstOutput, 'EVIDENCE.txt'), 'utf8'))
        .toContain('Caul production TUF repository');

      const second = signUpdateRepository({
        now: new Date('2026-07-31T00:00:00.000Z'),
        outputDirectory: secondOutput,
        previousMetadataDirectory: path.join(firstOutput, 'metadata'),
        privateKeys,
        rootPath: value.rootPath,
        targetName,
        targetPath
      });
      expect(second.versions).toEqual({ targets: 2, snapshot: 2, timestamp: 2 });
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('rejects a wrong online key and never accepts the offline root key for online signing', () => {
    const value = fixture();
    try {
      const targetPath = path.join(value.directory, 'latest.yml');
      writeFileSync(targetPath, 'version: 0.1.44\nfiles: []\n');
      const wrongKey = generateKeyPairSync('ed25519').privateKey
        .export({ format: 'pem', type: 'pkcs8' });
      const privateKeys = Object.fromEntries(onlineRoles.map((role) => [
        role,
        value.privateBundle.roles[role].private_key_pem
      ]));
      privateKeys.targets = wrongKey;
      expect(() => signUpdateRepository({
        now: new Date('2026-07-30T00:00:00.000Z'),
        outputDirectory: path.join(value.directory, 'wrong-key'),
        previousMetadataDirectory: null,
        privateKeys,
        rootPath: value.rootPath,
        targetName: 'latest.yml',
        targetPath
      })).toThrow(/does not match/);

      privateKeys.targets = value.privateBundle.roles.root.private_key_pem;
      expect(() => signUpdateRepository({
        now: new Date('2026-07-30T00:00:00.000Z'),
        outputDirectory: path.join(value.directory, 'offline-root-key'),
        previousMetadataDirectory: null,
        privateKeys,
        rootPath: value.rootPath,
        targetName: 'latest.yml',
        targetPath
      })).toThrow(/does not match/);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it.each(['.', '..', '../latest.yml', 'nested/latest.yml', 'latest\\evil.yml'])(
    'rejects the unsafe production target name %s',
    (targetName) => {
      const value = fixture();
      try {
        const targetPath = path.join(value.directory, 'latest.yml');
        writeFileSync(targetPath, 'version: 0.1.44\nfiles: []\n');
        const privateKeys = Object.fromEntries(onlineRoles.map((role) => [
          role,
          value.privateBundle.roles[role].private_key_pem
        ]));
        expect(() => signUpdateRepository({
          now: new Date('2026-07-30T00:00:00.000Z'),
          outputDirectory: path.join(value.directory, 'unsafe-target'),
          previousMetadataDirectory: null,
          privateKeys,
          rootPath: value.rootPath,
          targetName,
          targetPath
        })).toThrow(/Unsafe/);
      } finally {
        rmSync(value.directory, { recursive: true, force: true });
      }
    }
  );
});

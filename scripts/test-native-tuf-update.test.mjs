import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  artifactName,
  candidatePackageRequestPaths,
  corruptedPayload,
  prepareSignedTarget,
  requireAuditScenario,
  resolveAuditAssetPath,
  updaterEventTimeoutMs,
  waitForPathRemoval,
  windowsAuditProfileDirectories,
  windowsSilentInstallArguments
} = require('./test-native-tuf-update.cjs');

describe('native TUF updater audit helpers', () => {
  it('rewrites only checksum-verified package URLs to the loopback server', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'caul-native-target-'));
    try {
      const artifactNameValue = 'Caul-windows-x64-setup.exe';
      const artifact = Buffer.from('candidate package');
      const artifactPath = path.join(directory, artifactNameValue);
      writeFileSync(artifactPath, artifact);
      const metadataPath = path.join(directory, 'latest.yml');
      writeFileSync(metadataPath, yaml.dump({
        version: '0.1.44',
        files: [{
          url: artifactNameValue,
          sha512: createHash('sha512').update(artifact).digest('base64'),
          size: artifact.length
        }],
        path: artifactNameValue,
        sha512: createHash('sha512').update(artifact).digest('base64')
      }));
      const prepared = prepareSignedTarget({
        baseUrl: 'http://127.0.0.1:43127',
        candidateDirectory: directory,
        candidateMetadata: metadataPath
      });
      const rewritten = yaml.load(prepared.bytes.toString('utf8'));
      expect(rewritten.files[0].url)
        .toBe('http://127.0.0.1:43127/assets/0.1.44/Caul-windows-x64-setup.exe');
      expect(rewritten.path).toBe(rewritten.files[0].url);
      expect(prepared.version).toBe('0.1.44');

      writeFileSync(artifactPath, 'tampered');
      expect(() => prepareSignedTarget({
        baseUrl: 'http://127.0.0.1:43127',
        candidateDirectory: directory,
        candidateMetadata: metadataPath
      })).toThrow(/SHA-512 does not match/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects escaping artifact names', () => {
    expect(artifactName('https://example.invalid/Caul.AppImage')).toBe('Caul.AppImage');
    expect(() => artifactName('')).toThrow(/invalid artifact URL/);
    expect(() => artifactName('%2F')).toThrow(/Unsafe/);
    expect(() => artifactName('nested%5Cevil.exe')).toThrow(/Unsafe/);
  });

  it('distinguishes package requests from optional blockmap requests', () => {
    const packagePaths = candidatePackageRequestPaths(
      new Set(['Caul windows x64 setup.exe']),
      '0.1.54'
    );
    expect(packagePaths.has('/assets/0.1.54/Caul windows x64 setup.exe')).toBe(true);
    expect(packagePaths.has('/assets/0.1.54/Caul windows x64 setup.exe.blockmap'))
      .toBe(false);
  });

  it('maps versioned audit URLs to distinct current and previous blockmaps', () => {
    const inputs = {
      candidateDirectory: '/audit/candidate',
      candidateVersion: '0.1.54',
      previousBlockmap: '/audit/previous/setup.exe.blockmap',
      requestedName: 'setup.exe.blockmap'
    };
    expect(resolveAuditAssetPath({
      ...inputs,
      requestedVersion: '0.1.54'
    })).toBe('/audit/candidate/setup.exe.blockmap');
    expect(resolveAuditAssetPath({
      ...inputs,
      requestedVersion: '0.0.1'
    })).toBe('/audit/previous/setup.exe.blockmap');
    expect(resolveAuditAssetPath({
      ...inputs,
      requestedName: 'setup.exe',
      requestedVersion: '0.0.1'
    })).toBeNull();
  });

  it('uses only the explicit native audit scenarios', () => {
    expect(requireAuditScenario('valid')).toBe('valid');
    expect(requireAuditScenario('corrupt-payload')).toBe('corrupt-payload');
    expect(requireAuditScenario('wrong-signature')).toBe('wrong-signature');
    expect(() => requireAuditScenario('checksum-only')).toThrow(/must be one of/);
  });

  it('allows bounded native package lifecycles without weakening Linux feedback', () => {
    expect(updaterEventTimeoutMs('win32')).toBe(15 * 60_000);
    expect(updaterEventTimeoutMs('linux')).toBe(5 * 60_000);
  });

  it('truncates corrupt package bytes without changing the source file', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'caul-corrupt-payload-'));
    try {
      const packagePath = path.join(directory, 'Caul.AppImage');
      const original = Buffer.from('native package bytes');
      writeFileSync(packagePath, original);
      const corrupted = corruptedPayload(packagePath, 8);
      expect(corrupted).not.toEqual(original);
      expect(corrupted).toHaveLength(8);
      expect(readFileSync(packagePath)).toEqual(original);
      expect(() => corruptedPayload(packagePath, 0)).toThrow(/positive integer/);

      const emptyPath = path.join(directory, 'empty');
      writeFileSync(emptyPath, '');
      expect(() => corruptedPayload(emptyPath)).toThrow(/Cannot truncate/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires confirmed native uninstaller removal', () => {
    const removed = path.join(tmpdir(), `caul-removed-${process.pid}`);
    rmSync(removed, { recursive: true, force: true });
    expect(() => waitForPathRemoval(removed, { timeoutMs: 10 })).not.toThrow();

    const retained = mkdtempSync(path.join(tmpdir(), 'caul-retained-install-'));
    try {
      mkdirSync(path.join(retained, 'child'));
      expect(() => waitForPathRemoval(retained, {
        intervalMs: 1,
        timeoutMs: 10
      })).toThrow(/Timed out/);
    } finally {
      rmSync(retained, { recursive: true, force: true });
    }
  });

  it('puts the explicit NSIS install directory last for silent audits', () => {
    expect(windowsSilentInstallArguments('C:\\audit\\Caul Beta'))
      .toEqual(['/S', '/D=C:\\audit\\Caul Beta']);
    expect(() => windowsSilentInstallArguments('')).toThrow(/requires a destination/);
  });

  it('isolates Windows updater caches inside each disposable audit profile', () => {
    expect(windowsAuditProfileDirectories('C:\\audit\\scenario')).toEqual({
      appData: path.join('C:\\audit\\scenario', 'windows-profile', 'roaming'),
      localAppData: path.join('C:\\audit\\scenario', 'windows-profile', 'local')
    });
  });
});

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
import { createServer, request as httpRequest } from 'node:http';
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
  serveBytes,
  stageWindowsDifferentialBase,
  updaterEventTimeoutMs,
  waitForPathRemoval,
  waitForPidExit,
  windowsAuditProfileDirectories,
  windowsDifferentialRequestPaths,
  windowsSilentInstallArguments
} = require('./test-native-tuf-update.cjs');

function requestBytes(server, { method = 'GET', range } = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      method,
      path: '/',
      port: address.port,
      headers: range ? { Range: range } : undefined
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        statusCode: response.statusCode
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

describe('native TUF updater audit helpers', () => {
  it('records timestamped Windows lifecycle and process evidence', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, 'test-native-tuf-update.cjs'),
      'utf8'
    );

    expect(source).toContain("name: 'original-runtime-launched'");
    expect(source).toContain("name: 'original-runtime-exited'");
    expect(source).toContain("name: 'updater-terminal-event'");
    expect(source).toContain("'PROCESS_OBSERVATIONS.json'");
    expect(source).toContain('recordEvidenceCleanupFailure(evidenceDirectory, cleanupFailure)');
    expect(source).toContain('at: new Date().toISOString()');
    expect(source).toContain('inspectWindowsProcessesWithin(directory)');
    expect(source).toContain('Get-Process -ErrorAction SilentlyContinue');
    expect(source).toContain('windowsDetailedProcessesRelatedTo(directory)');
    expect(source).toContain("const inspection = spawn(");
    expect(source).not.toContain("const processes = windowsProcessesWithin(directory)");
  });

  it('requires the original runtime PID to exit naturally', async () => {
    await expect(waitForPidExit(process.pid, { intervalMs: 1, timeoutMs: 5 }))
      .rejects.toThrow(/remained alive/);
    await expect(waitForPidExit(2_147_483_647, { intervalMs: 1, timeoutMs: 5 }))
      .resolves.toBeUndefined();
  });

  it('serves Electron differential downloads as standard multipart byte ranges', async () => {
    const bytes = Buffer.from('abcdefghij');
    const server = createServer((request, response) => serveBytes(request, response, bytes));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const response = await requestBytes(server, { range: 'bytes=0-2, 6-8' });
      expect(response.statusCode).toBe(206);
      const contentType = response.headers['content-type'];
      const boundary = contentType?.match(
        /^multipart\/byteranges; boundary=(caul-[a-f0-9]+)$/
      )?.[1];
      expect(boundary).toBeTruthy();
      expect(response.body).toEqual(Buffer.from(
        `--${boundary}\r\n`
        + 'Content-Type: application/octet-stream\r\n'
        + 'Content-Range: bytes 0-2/10\r\n'
        + '\r\n'
        + 'abc\r\n'
        + `--${boundary}\r\n`
        + 'Content-Type: application/octet-stream\r\n'
        + 'Content-Range: bytes 6-8/10\r\n'
        + '\r\n'
        + 'ghi\r\n'
        + `--${boundary}--\r\n`
      ));
      expect(Number(response.headers['content-length'])).toBe(response.body.length);

      const single = await requestBytes(server, { range: 'bytes=2-4' });
      expect(single.statusCode).toBe(206);
      expect(single.headers['content-range']).toBe('bytes 2-4/10');
      expect(single.body).toEqual(Buffer.from('cde'));

      const invalid = await requestBytes(server, { range: 'bytes=20-30' });
      expect(invalid.statusCode).toBe(416);
      expect(invalid.headers['content-range']).toBe('bytes */10');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    }
  });

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
    expect(windowsDifferentialRequestPaths(new Set(['setup.exe']), '0.1.56'))
      .toEqual([
        '/assets/0.1.56/setup.exe.blockmap',
        '/assets/0.0.1/setup.exe.blockmap'
      ]);
  });

  it('uses only the explicit native audit scenarios', () => {
    expect(requireAuditScenario('valid')).toBe('valid');
    expect(requireAuditScenario('corrupt-payload')).toBe('corrupt-payload');
    expect(requireAuditScenario('wrong-signature')).toBe('wrong-signature');
    expect(() => requireAuditScenario('checksum-only')).toThrow(/must be one of/);
  });

  it('allows bounded native package lifecycles without weakening Linux feedback', () => {
    expect(updaterEventTimeoutMs('win32')).toBe(60 * 60_000);
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

  it('seeds the exact previous installer for a Windows differential update', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'caul-windows-differential-'));
    try {
      const previousArtifact = path.join(directory, 'previous.exe');
      writeFileSync(previousArtifact, 'verified previous installer');
      const localAppData = path.join(directory, 'local');
      const stable = stageWindowsDifferentialBase({
        channel: 'stable',
        localAppData,
        previousArtifact
      });
      expect(stable).toBe(path.join(localAppData, 'caul-updater', 'installer.exe'));
      expect(readFileSync(stable)).toEqual(readFileSync(previousArtifact));

      const beta = stageWindowsDifferentialBase({
        channel: 'beta',
        localAppData,
        previousArtifact
      });
      expect(beta).toBe(path.join(localAppData, 'caul-beta-updater', 'installer.exe'));
      expect(readFileSync(beta)).toEqual(readFileSync(previousArtifact));
      expect(() => stageWindowsDifferentialBase({
        channel: 'preview',
        localAppData,
        previousArtifact
      })).toThrow(/stable or beta/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

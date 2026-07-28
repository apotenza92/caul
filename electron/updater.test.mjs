import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  compareVersions,
  configureUpdaterFeed,
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
  shouldCheckForUpdates
} = require('./updater.cjs');

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => (
    new Promise((resolve) => server.close(resolve))
  )));
});

describe('updater helpers', () => {
  it('defaults invalid update frequencies to weekly', () => {
    expect(normaliseUpdateFrequency('daily')).toBe('daily');
    expect(normaliseUpdateFrequency('monthly')).toBe('monthly');
    expect(normaliseUpdateFrequency('nonsense')).toBe('weekly');
    expect(normaliseUpdateFrequency(undefined)).toBe('weekly');
  });

  it('honours the smoke-only update disable flag', () => {
    expect(isUpdateSmokeDisabled({ CAUL_DISABLE_UPDATE_CHECKS: '1' })).toBe(true);
    expect(isUpdateSmokeDisabled({ CAUL_DISABLE_UPDATE_CHECKS: '0' })).toBe(false);
    expect(isUpdateSmokeDisabled({})).toBe(false);
  });

  it('allows a local updater feed only under the explicit package test gate', () => {
    expect(resolveUpdateTestFeed({ CAUL_UPDATE_FEED_URL: 'http://127.0.0.1:1234/' })).toBe('');
    expect(resolveUpdateTestFeed({
      CAUL_UPDATE_TEST_MODE: '1',
      CAUL_UPDATE_FEED_URL: 'http://127.0.0.1:1234/'
    })).toBe('http://127.0.0.1:1234/');
  });

  it('selects the stable or beta metadata file explicitly for generic updater feeds', () => {
    const configurations = [];
    const autoUpdater = { setFeedURL: (configuration) => configurations.push(configuration) };

    configureUpdaterFeed(autoUpdater, { appChannel: 'stable', testFeedUrl: 'http://127.0.0.1:1234/' });
    configureUpdaterFeed(autoUpdater, { appChannel: 'beta', testFeedUrl: 'http://127.0.0.1:1234/' });

    expect(configurations).toEqual([
      { provider: 'generic', url: 'http://127.0.0.1:1234/', channel: 'latest' },
      { provider: 'generic', url: 'http://127.0.0.1:1234/', channel: 'beta' }
    ]);
  });

  it('treats standard and private dev channels as local builds', () => {
    expect(isLocalDevChannel('dev')).toBe(true);
    expect(isLocalDevChannel('dev-private')).toBe(true);
    expect(isLocalDevChannel('beta')).toBe(false);
    expect(isLocalDevChannel('stable')).toBe(false);
  });

  it('decides scheduled checks from persisted frequency and last check time', () => {
    const now = Date.parse('2026-06-04T00:00:00.000Z');

    expect(shouldCheckForUpdates('never', null, now)).toBe(false);
    expect(shouldCheckForUpdates('startup', '2026-06-04T00:00:00.000Z', now)).toBe(true);
    expect(shouldCheckForUpdates('weekly', null, now)).toBe(true);
    expect(shouldCheckForUpdates('weekly', '2026-06-01T00:00:00.000Z', now)).toBe(false);
    expect(shouldCheckForUpdates('weekly', '2026-05-20T00:00:00.000Z', now)).toBe(true);
    expect(shouldCheckForUpdates('monthly', '2026-05-20T00:00:00.000Z', now)).toBe(false);
    expect(shouldCheckForUpdates('monthly', '2026-05-01T00:00:00.000Z', now)).toBe(true);
  });

  it('keeps stable users on stable releases only', () => {
    const releases = [
      { draft: false, prerelease: true, tag_name: 'v0.3.0-beta.1', html_url: 'beta' },
      {
        body: '- Adds calmer updates.',
        draft: false,
        prerelease: false,
        tag_name: 'v0.2.0',
        html_url: 'stable'
      },
      { draft: true, prerelease: false, tag_name: 'v9.0.0', html_url: 'draft' }
    ];

    expect(findTargetRelease(releases, false)).toMatchObject({
      htmlUrl: 'stable',
      releaseNotes: '- Adds calmer updates.',
      version: '0.2.0'
    });
  });

  it('lets beta users track the highest stable or prerelease version', () => {
    const releases = [
      { draft: false, prerelease: false, tag_name: 'v0.2.0', html_url: 'stable' },
      { draft: false, prerelease: true, tag_name: 'v0.3.0-beta.1', html_url: 'beta' },
      { draft: false, prerelease: false, tag_name: 'v0.1.9', html_url: 'old' }
    ];

    expect(findTargetRelease(releases, true)).toMatchObject({
      htmlUrl: 'beta',
      version: '0.3.0-beta.1'
    });
  });

  it('accepts only stable and numbered beta release versions', () => {
    expect(normaliseReleaseVersion('v1.2.3')).toBe('1.2.3');
    expect(normaliseReleaseVersion('v1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(normaliseReleaseVersion('v1.2.3-alpha.1')).toBeNull();
    expect(normaliseReleaseVersion('v1.2.3-rc.1')).toBeNull();
    expect(normaliseReleaseVersion('v1.2.3-beta.0')).toBeNull();

    expect(findTargetRelease([
      { draft: false, prerelease: true, tag_name: 'v9.0.0-rc.1', html_url: 'rc' },
      { draft: false, prerelease: true, tag_name: 'v2.0.0-alpha.1', html_url: 'alpha' },
      { draft: false, prerelease: true, tag_name: 'v1.2.3-beta.2', html_url: 'beta' }
    ], true)).toMatchObject({ htmlUrl: 'beta', version: '1.2.3-beta.2' });
  });

  it('orders stable releases above prereleases of the same version', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.1-beta.1', '1.0.0')).toBe(1);
  });

  it('selects matching platform assets without crossing stable and beta channels', () => {
    const assets = [
      { name: 'Caul-windows-arm64-setup.exe', url: 'stable-win' },
      { name: 'Caul-windows-x64-setup.exe', url: 'stable-win-x64' },
      { name: 'Caul-Beta-windows-arm64-setup.exe', url: 'beta-win' },
      { name: 'Caul-Beta-windows-x64-setup.exe', url: 'beta-win-x64' },
      { name: 'caul-arm64.deb', url: 'stable-linux' },
      { name: 'caul-x64.AppImage', url: 'stable-linux-x64-appimage' },
      { name: 'caul-beta-arm64.deb', url: 'beta-linux' },
      { name: 'SHA256SUMS', url: 'checksums' }
    ];

    expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'arm64', platform: 'win32' })).toMatchObject({
      url: 'stable-win'
    });
    expect(selectUpdateAsset(assets, { appChannel: 'beta', arch: 'arm64', platform: 'win32' })).toMatchObject({
      url: 'beta-win'
    });
    expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'x64', platform: 'win32' })).toMatchObject({
      url: 'stable-win-x64'
    });
    expect(selectUpdateAsset(assets, { appChannel: 'beta', arch: 'x64', platform: 'win32' })).toMatchObject({
      url: 'beta-win-x64'
    });
    expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'arm64', platform: 'linux' })).toMatchObject({
      url: 'stable-linux'
    });
    process.env.APPIMAGE = '/tmp/Caul.AppImage';
    try {
      expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'x64', platform: 'linux' })).toMatchObject({
        url: 'stable-linux-x64-appimage'
      });
    } finally {
      delete process.env.APPIMAGE;
    }
    expect(selectReleaseChecksumAsset(assets)).toMatchObject({ url: 'checksums' });
    expect(selectReleaseChecksumAsset(assets.filter((asset) => asset.name !== 'SHA256SUMS'))).toBeNull();
    expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'arm64', platform: 'darwin' })).toBeNull();
  });

  it('parses exact release checksums and rejects missing, malformed or duplicate entries', () => {
    const stable = 'a'.repeat(64);
    const beta = 'b'.repeat(64);
    const manifest = `${stable}  Caul-windows-arm64-setup.exe\n${beta}  Caul-Beta-windows-arm64-setup.exe\n`;

    expect(parseReleaseChecksums(manifest)).toEqual(new Map([
      ['Caul-windows-arm64-setup.exe', stable],
      ['Caul-Beta-windows-arm64-setup.exe', beta]
    ]));
    expect(resolveExpectedAssetChecksum(manifest, 'Caul-windows-arm64-setup.exe')).toBe(stable);
    expect(resolveExpectedAssetChecksum(manifest, 'Caul-Beta-windows-arm64-setup.exe')).toBe(beta);
    expect(() => resolveExpectedAssetChecksum(manifest, 'caul-arm64.deb')).toThrow(/does not contain/);
    expect(() => parseReleaseChecksums('not-a-checksum')).toThrow(/malformed/);
    expect(() => parseReleaseChecksums(`${stable}  package.exe\n${stable}  package.exe\n`)).toThrow(/duplicate/);
  });

  it('downloads a package only after its published SHA-256 and size match', async () => {
    const packageName = 'Caul-windows-x64-setup.exe';
    const packageBytes = Buffer.from('verified Windows package fixture');
    const checksum = createHash('sha256').update(packageBytes).digest('hex');
    const server = await startFixtureServer({
      '/SHA256SUMS': `${checksum}  ${packageName}\n`,
      [`/${packageName}`]: packageBytes
    });
    const downloadsDirectory = mkdtempSync(join(tmpdir(), 'caul-updater-download-'));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const filePath = await downloadAndVerifyAsset({
      asset: { name: packageName, size: packageBytes.length, url: `${baseUrl}/${packageName}` },
      checksumAsset: { name: 'SHA256SUMS', url: `${baseUrl}/SHA256SUMS` },
      downloadsDirectory,
      userAgent: 'Caul/Test'
    });

    expect(readFileSync(filePath)).toEqual(packageBytes);
  });

  it.each([
    {
      label: 'missing checksum manifest',
      checksumAsset: null,
      manifest: null,
      expected: /does not provide/
    },
    {
      label: 'missing package checksum',
      manifest: `${'a'.repeat(64)}  another-package.exe\n`,
      expected: /does not contain/
    },
    {
      label: 'malformed checksum manifest',
      manifest: 'not-a-checksum\n',
      expected: /malformed/
    },
    {
      label: 'checksum mismatch',
      manifest: `${'0'.repeat(64)}  Caul-windows-arm64-setup.exe\n`,
      expected: /verification failed/
    },
    {
      label: 'download size mismatch',
      manifest: null,
      sizeAdjustment: 1,
      expected: /size mismatch/
    }
  ])('rejects a download with $label and leaves no package behind', async ({
    checksumAsset: checksumOverride,
    expected,
    manifest: requestedManifest,
    sizeAdjustment = 0
  }) => {
    const packageName = 'Caul-windows-arm64-setup.exe';
    const packageBytes = Buffer.from('untrusted package fixture');
    const actualChecksum = createHash('sha256').update(packageBytes).digest('hex');
    const manifest = requestedManifest ?? `${actualChecksum}  ${packageName}\n`;
    const server = await startFixtureServer({
      '/SHA256SUMS': manifest,
      [`/${packageName}`]: packageBytes
    });
    const downloadsDirectory = mkdtempSync(join(tmpdir(), 'caul-updater-reject-'));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const checksumAsset = checksumOverride === null
      ? null
      : { name: 'SHA256SUMS', url: `${baseUrl}/SHA256SUMS` };

    await expect(downloadAndVerifyAsset({
      asset: {
        name: packageName,
        size: packageBytes.length + sizeAdjustment,
        url: `${baseUrl}/${packageName}`
      },
      checksumAsset,
      downloadsDirectory,
      userAgent: 'Caul/Test'
    })).rejects.toThrow(expected);
    expect(() => readFileSync(join(downloadsDirectory, packageName))).toThrow();
    expect(() => readFileSync(join(downloadsDirectory, `${packageName}.download`))).toThrow();
  });

  it('keeps automatic package installation scoped to signed macOS builds', () => {
    const source = require('node:fs').readFileSync(require.resolve('./updater.cjs'), 'utf8');
    expect(source).not.toContain('isLinuxAppImage');
    expect(source.match(/process\.platform === 'darwin'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('autoUpdater.autoDownload = false');
    expect(source).toContain('autoUpdater.autoInstallOnAppQuit = false');
  });
});

async function startFixtureServer(routes) {
  const server = createServer((request, response) => {
    const body = routes[request.url];
    if (body == null) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server;
}

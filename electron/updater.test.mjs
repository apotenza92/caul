import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  automaticInstallSupported,
  compareVersions,
  configureUpdaterDownloadMode,
  configureUpdaterFeed,
  findTargetRelease,
  isUpdateSmokeDisabled,
  isLocalDevChannel,
  normaliseUpdaterReleaseNotes,
  normaliseReleaseVersion,
  normaliseUpdateFrequency,
  resolveTufTestRepository,
  resolveUpdateTestFeed,
  selectUpdateAsset,
  shouldCheckForUpdates,
  usesTufUpdater,
  validatePackagedTufMetadata,
  writeUpdaterTestEvent
} = require('./updater.cjs');

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
    expect(resolveTufTestRepository({
      CAUL_TUF_TEST_REPOSITORY_URL: 'http://127.0.0.1:1234/tuf'
    })).toBe('');
    expect(resolveTufTestRepository({
      CAUL_UPDATE_TEST_MODE: '1',
      CAUL_TUF_TEST_REPOSITORY_URL: 'http://127.0.0.1:1234/tuf'
    })).toBe('http://127.0.0.1:1234/tuf');
  });

  it('uses reliable full-package downloads on Windows', () => {
    const windowsUpdater = {};
    expect(configureUpdaterDownloadMode(windowsUpdater, {
      env: {},
      platform: 'win32'
    })).toBe(true);
    expect(windowsUpdater.disableDifferentialDownload).toBe(true);
  });

  it('allows a full download test override only inside explicit updater test mode', () => {
    const normalUpdater = {};
    expect(configureUpdaterDownloadMode(normalUpdater, {
      env: { CAUL_UPDATER_DISABLE_DIFFERENTIAL_DOWNLOAD: '1' },
      platform: 'linux'
    })).toBe(false);
    expect(normalUpdater).not.toHaveProperty('disableDifferentialDownload');

    const testUpdater = {};
    expect(configureUpdaterDownloadMode(testUpdater, {
      env: {
        CAUL_UPDATE_TEST_MODE: '1',
        CAUL_UPDATER_DISABLE_DIFFERENTIAL_DOWNLOAD: '1'
      },
      platform: 'linux'
    })).toBe(true);
    expect(testUpdater.disableDifferentialDownload).toBe(true);
  });

  it('selects the stable or beta metadata file explicitly for generic updater feeds', () => {
    const configurations = [];
    const autoUpdater = { setFeedURL: (configuration) => configurations.push(configuration) };

    configureUpdaterFeed(autoUpdater, { appChannel: 'stable', testFeedUrl: 'http://127.0.0.1:1234/' });
    configureUpdaterFeed(autoUpdater, { appChannel: 'beta', testFeedUrl: 'http://127.0.0.1:1234/' });

    expect(configurations).toEqual([
      {
        provider: 'generic',
        url: 'http://127.0.0.1:1234/',
        channel: 'latest',
        useMultipleRangeRequest: false
      },
      {
        provider: 'generic',
        url: 'http://127.0.0.1:1234/',
        channel: 'beta',
        useMultipleRangeRequest: false
      }
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
    expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'arm64', platform: 'darwin' })).toBeNull();
  });

  it('allows native automatic installation only where a maintained transition exists', () => {
    expect(automaticInstallSupported('darwin', {})).toBe(true);
    expect(automaticInstallSupported('win32', {})).toBe(true);
    expect(automaticInstallSupported('linux', { APPIMAGE: '/opt/Caul.AppImage' })).toBe(true);
    expect(automaticInstallSupported('linux', {})).toBe(false);
    expect(usesTufUpdater('win32', {})).toBe(true);
    expect(usesTufUpdater('linux', { APPIMAGE: '/opt/Caul.AppImage' })).toBe(true);
    expect(usesTufUpdater('linux', {})).toBe(false);
    expect(usesTufUpdater('darwin', {})).toBe(false);
  });

  it('requires the packaged channel and TUF target to match the running product', () => {
    expect(validatePackagedTufMetadata({
      caulReleaseChannel: 'stable',
      caulTufRepositoryUrl: 'https://updates.example/caul/stable/win32/x64/tuf',
      caulUpdateTargetName: 'latest.yml'
    }, {
      appChannel: 'stable'
    })).toEqual({
      channel: 'stable',
      repositoryUrl: 'https://updates.example/caul/stable/win32/x64/tuf',
      targetName: 'latest.yml'
    });
    expect(validatePackagedTufMetadata({
      caulReleaseChannel: 'beta',
      caulTufRepositoryUrl: 'https://production.invalid',
      caulUpdateTargetName: 'beta.yml'
    }, {
      appChannel: 'beta',
      testRepositoryUrl: 'http://127.0.0.1:43124/tuf'
    })).toMatchObject({
      repositoryUrl: 'http://127.0.0.1:43124/tuf'
    });
    expect(() => validatePackagedTufMetadata({
      caulReleaseChannel: 'beta',
      caulTufRepositoryUrl: 'https://updates.example/caul/beta/win32/x64/tuf',
      caulUpdateTargetName: 'beta.yml'
    }, {
      appChannel: 'stable'
    })).toThrow(/invalid/);
  });

  it('normalises release notes without interpreting markup', () => {
    expect(normaliseUpdaterReleaseNotes('  Fixed updates.  ')).toBe('Fixed updates.');
    expect(normaliseUpdaterReleaseNotes([
      { version: '0.1.44', note: 'Fixed TUF refresh.' },
      'Improved restart handling.'
    ])).toBe('Fixed TUF refresh.\n\nImproved restart handling.');
    expect(normaliseUpdaterReleaseNotes(undefined)).toBe('');
  });

  it('writes updater audit events atomically only when a test path is provided', () => {
    const directory = mkdtempSync(join(tmpdir(), 'caul-updater-events-'));
    try {
      const eventPath = join(directory, 'events', 'updater.json');
      writeUpdaterTestEvent('', 'ignored');
      writeUpdaterTestEvent(eventPath, 'update-downloaded', {
        currentVersion: '0.1.43',
        version: '0.1.44'
      });
      expect(JSON.parse(readFileSync(eventPath, 'utf8'))).toEqual({
        name: 'update-downloaded',
        currentVersion: '0.1.43',
        version: '0.1.44'
      });
      expect(readFileSync(`${eventPath}.jsonl`, 'utf8')).toContain('"update-downloaded"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('removes the unauthenticated checksum-download path', () => {
    const source = readFileSync(require.resolve('./updater.cjs'), 'utf8');
    expect(source).toContain('createTufVerifiedUpdateFeed');
    expect(source).toContain("path.join(app.getPath('userData'), 'update-trust')");
    expect(source).toContain('await closeVerifiedFeed()');
    expect(source).toContain("return recordError(error, 'Update download failed.')");
    expect(source).toContain("return recordError(error, 'Update installation could not start.')");
    expect(source).not.toContain('downloadAndVerifyAsset');
    expect(source).not.toContain('parseReleaseChecksums');
    expect(source).not.toContain('showItemInFolder');
    expect(source).toContain('autoUpdater.autoDownload = false');
    expect(source).toContain('autoUpdater.autoInstallOnAppQuit = false');
  });

  it('closes the authenticated feed before handing process shutdown to Electron Updater', () => {
    const source = readFileSync(require.resolve('./updater.cjs'), 'utf8');
    const installStart = source.indexOf('async function installDownloadedUpdate()');
    const closeFeed = source.indexOf('await closeVerifiedFeed()', installStart);
    const prepareRuntime = source.indexOf('onBeforeInstallDownloadedUpdate?.()', installStart);
    const quitAndInstall = source.indexOf('autoUpdater.quitAndInstall(', installStart);

    expect(installStart).toBeGreaterThanOrEqual(0);
    expect(closeFeed).toBeGreaterThan(installStart);
    expect(prepareRuntime).toBeGreaterThan(closeFeed);
    expect(quitAndInstall).toBeGreaterThan(prepareRuntime);
  });
});

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  compareVersions,
  findTargetRelease,
  isUpdateSmokeDisabled,
  isLocalDevChannel,
  normaliseUpdateFrequency,
  selectUpdateAsset,
  shouldCheckForUpdates
} = require('./updater.cjs');

describe('updater helpers', () => {
  it('defaults invalid update frequencies to weekly', () => {
    expect(normaliseUpdateFrequency('daily')).toBe('daily');
    expect(normaliseUpdateFrequency('nonsense')).toBe('weekly');
    expect(normaliseUpdateFrequency(undefined)).toBe('weekly');
  });

  it('honours the smoke-only update disable flag', () => {
    expect(isUpdateSmokeDisabled({ SUSURA_DISABLE_UPDATE_CHECKS: '1' })).toBe(true);
    expect(isUpdateSmokeDisabled({ SUSURA_DISABLE_UPDATE_CHECKS: '0' })).toBe(false);
    expect(isUpdateSmokeDisabled({})).toBe(false);
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
  });

  it('keeps stable users on stable releases only', () => {
    const releases = [
      { draft: false, prerelease: true, tag_name: 'v0.3.0-beta.1', html_url: 'beta' },
      { draft: false, prerelease: false, tag_name: 'v0.2.0', html_url: 'stable' },
      { draft: true, prerelease: false, tag_name: 'v9.0.0', html_url: 'draft' }
    ];

    expect(findTargetRelease(releases, false)).toMatchObject({
      htmlUrl: 'stable',
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

  it('orders stable releases above prereleases of the same version', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.1-beta.1', '1.0.0')).toBe(1);
  });

  it('selects matching platform assets without crossing stable and beta channels', () => {
    const assets = [
      { name: 'Susura-windows-arm64-setup.exe', url: 'stable-win' },
      { name: 'Susura-Beta-windows-arm64-setup.exe', url: 'beta-win' },
      { name: 'susura-linux-arm64.deb', url: 'stable-linux' },
      { name: 'susura-beta-linux-arm64.deb', url: 'beta-linux' }
    ];

    expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'arm64', platform: 'win32' })).toMatchObject({
      url: 'stable-win'
    });
    expect(selectUpdateAsset(assets, { appChannel: 'beta', arch: 'arm64', platform: 'win32' })).toMatchObject({
      url: 'beta-win'
    });
    expect(selectUpdateAsset(assets, { appChannel: 'stable', arch: 'arm64', platform: 'linux' })).toMatchObject({
      url: 'stable-linux'
    });
  });
});

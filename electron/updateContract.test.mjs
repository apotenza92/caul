import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalisePlatform,
  updateContract,
  updateMetadataFileName
} = require('./updateContract.cjs');

describe('update contract', () => {
  it('keeps stable and beta in distinct immutable feed projections', () => {
    expect(updateContract({
      arch: 'x64',
      channel: 'stable',
      platform: 'win'
    })).toMatchObject({
      channel: 'stable',
      feedUrl: 'https://raw.githubusercontent.com/apotenza92/caul/updates/stable/win32/x64',
      metadataFileName: 'latest.yml',
      platform: 'win32',
      tufRepositoryUrl: 'https://raw.githubusercontent.com/apotenza92/caul/updates/stable/win32/x64/tuf'
    });
    expect(updateContract({
      arch: 'arm64',
      channel: 'beta',
      platform: 'linux'
    })).toMatchObject({
      channel: 'beta',
      metadataFileName: 'beta-linux-arm64.yml'
    });
  });

  it('uses Electron Builder metadata names for every supported package', () => {
    expect(updateMetadataFileName('darwin', 'arm64', 'stable')).toBe('latest-mac.yml');
    expect(updateMetadataFileName('darwin', 'arm64', 'beta')).toBe('beta-mac.yml');
    expect(updateMetadataFileName('win32', 'x64', 'stable')).toBe('latest.yml');
    expect(updateMetadataFileName('win32', 'arm64', 'beta')).toBe('beta.yml');
    expect(updateMetadataFileName('linux', 'x64', 'stable')).toBe('latest-linux.yml');
    expect(updateMetadataFileName('linux', 'arm64', 'beta')).toBe('beta-linux-arm64.yml');
  });

  it('rejects unsupported identities instead of silently changing package scope', () => {
    expect(normalisePlatform('mac')).toBe('darwin');
    expect(normalisePlatform('win')).toBe('win32');
    expect(() => updateContract({ arch: 'x64', channel: 'stable', platform: 'darwin' }))
      .toThrow(/only macOS ARM64/);
    expect(() => updateContract({ arch: 'ia32', channel: 'stable', platform: 'win32' }))
      .toThrow(/architecture/);
    expect(() => updateContract({ arch: 'x64', channel: 'nightly', platform: 'linux' }))
      .toThrow(/channel/);
  });
});

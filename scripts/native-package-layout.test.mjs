import { describe, expect, it } from 'vitest';
import { unpackedDirectoryName } from './native-package-layout.mjs';

describe('native unpacked package layout', () => {
  it.each([
    ['windows', 'x64', 'win-unpacked'],
    ['windows', 'arm64', 'win-arm64-unpacked'],
    ['linux', 'x64', 'linux-unpacked'],
    ['linux', 'arm64', 'linux-arm64-unpacked']
  ])('maps %s/%s to Electron Builder output', (platform, arch, expected) => {
    expect(unpackedDirectoryName(platform, arch)).toBe(expected);
  });

  it('rejects unsupported platforms', () => {
    expect(() => unpackedDirectoryName('macos', 'arm64')).toThrow('Unsupported native package platform');
  });
});

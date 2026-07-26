import { describe, expect, it } from 'vitest';
import { resolveCargoTarget } from './build-desktop-backend.mjs';

describe('desktop backend build target', () => {
  it.each([
    ['linux', 'arm64', 'aarch64-unknown-linux-gnu'],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu'],
    ['win', 'arm64', 'aarch64-pc-windows-msvc'],
    ['win', 'x64', 'x86_64-pc-windows-msvc']
  ])('uses an explicit %s/%s target directory', (platform, arch, expected) => {
    expect(resolveCargoTarget({
      CAUL_PACKAGE_ARCH: arch,
      CAUL_PACKAGE_PLATFORM: platform
    })).toBe(expected);
  });

  it('honours an explicit backend target override', () => {
    expect(resolveCargoTarget({
      CAUL_DESKTOP_BACKEND_TARGET: 'custom-target'
    })).toBe('custom-target');
  });

  it('uses Cargo’s host output when no package platform is selected', () => {
    expect(resolveCargoTarget({})).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const helperInfoPlistPath = join(
  process.cwd(),
  'native',
  'macos-audio-helper',
  'Sources',
  'SusuraAudioHelper',
  'Info.plist'
);
const helperEntitlementsPath = join(
  process.cwd(),
  'native',
  'macos-audio-helper',
  'SusuraAudioHelper.entitlements'
);

describe('macOS audio helper Info.plist', () => {
  it('keeps the helper out of the Dock while preserving app-style TCC metadata', () => {
    const plist = readFileSync(helperInfoPlistPath, 'utf8');

    expect(plist).toMatch(/<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
    expect(plist).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/);
    expect(plist).toContain('<key>NSAudioCaptureUsageDescription</key>');
    expect(plist).not.toContain('<key>NSMicrophoneUsageDescription</key>');
  });

  it('keeps the helper entitlement scoped to system audio capture', () => {
    const entitlements = readFileSync(helperEntitlementsPath, 'utf8');

    expect(entitlements).toContain('<key>com.apple.security.system-audio-capture</key>');
    expect(entitlements).not.toContain('<key>com.apple.security.device.audio-input</key>');
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_SUPPORTED_GLIBC_VERSION,
  assertDesktopEntryContract,
  assertGlibcVersionsWithinContract,
  parseDesktopEntry,
  parseGlibcVersions
} from './linux-package-contract.mjs';

const stableDesktopEntry = `[Desktop Entry]
Name=Caul
Exec="/opt/Caul/caul" %U
Terminal=false
Type=Application
Icon=caul
Categories=Utility;
`;

describe('Linux package contract', () => {
  it('extracts and orders distinct GLIBC requirements', () => {
    expect(parseGlibcVersions(
      'Name: GLIBC_2.34\nName: GLIBC_2.2.5\nName: GLIBC_2.34\nName: GLIBC_2.39'
    )).toEqual(['2.2.5', '2.34', '2.39']);
  });

  it('enforces the reviewed Ubuntu 24.04 GLIBC ceiling', () => {
    expect(MAX_SUPPORTED_GLIBC_VERSION).toBe('2.39');
    expect(() => assertGlibcVersionsWithinContract(['2.2.5', '2.39'])).not.toThrow();
    expect(() => assertGlibcVersionsWithinContract(['2.40'])).toThrow('reviewed ceiling');
  });

  it('parses only the Desktop Entry section', () => {
    const fields = parseDesktopEntry(`${stableDesktopEntry}
[Desktop Action New]
Name=Ignored
`);
    expect(fields.get('Name')).toBe('Caul');
    expect(fields.get('Exec')).toContain('/opt/Caul/caul');
  });

  it('accepts stable package-manager integration and AppRun AppImage integration', () => {
    expect(() => assertDesktopEntryContract(stableDesktopEntry, {
      channel: 'stable',
      format: 'deb'
    })).not.toThrow();
    expect(() => assertDesktopEntryContract(stableDesktopEntry.replace(
      'Exec="/opt/Caul/caul" %U',
      'Exec=AppRun --no-sandbox %U'
    ), {
      channel: 'stable',
      format: 'appimage'
    })).not.toThrow();
  });

  it('rejects a mismatched channel identity or missing category', () => {
    expect(() => assertDesktopEntryContract(stableDesktopEntry, {
      channel: 'beta',
      format: 'deb'
    })).toThrow('Name');
    expect(() => assertDesktopEntryContract(
      stableDesktopEntry.replace('Categories=Utility;', 'Categories=Office;'),
      { channel: 'stable', format: 'deb' }
    )).toThrow('Utility category');
  });
});

import { describe, expect, it } from 'vitest';
import { extractReleaseNotes } from './extract-release-notes.mjs';

describe('release-note extraction', () => {
  it('extracts only the requested changelog section', () => {
    const changelog = `# Changelog

## [0.1.43]

- Shows release notes in Caul.
- Keeps updates user controlled.

## [0.1.42]

- Previous release.
`;

    expect(extractReleaseNotes(changelog, '0.1.43')).toBe(
      '- Shows release notes in Caul.\n- Keeps updates user controlled.'
    );
  });

  it('rejects a release without a matching changelog section', () => {
    expect(() => extractReleaseNotes('# Changelog\n', '0.1.43')).toThrow(
      /does not contain release notes for 0\.1\.43/
    );
  });
});

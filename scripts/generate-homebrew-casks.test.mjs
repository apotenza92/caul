import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateHomebrewCasks,
  parseChecksums,
  renderBetaCask,
  renderStableCask
} from './generate-homebrew-casks.mjs';

describe('Homebrew cask generation', () => {
  it('renders current stable and beta cask conventions', () => {
    const stable = renderStableCask('1.2.3', 'a'.repeat(64));
    const beta = renderBetaCask('1.2.3-beta.4', 'b'.repeat(64));
    for (const cask of [stable, beta]) {
      expect(cask).toContain('depends_on macos: :sonoma');
      expect(cask.indexOf('sha256')).toBeLessThan(cask.indexOf('url "https://'));
    }
    expect(stable).toContain('v#{version}/Caul-macos-arm64.zip');
    expect(beta).toContain('release["tag_name"].delete_prefix("v")');
  });

  it('rejects malformed and duplicate checksum records', () => {
    expect(() => parseChecksums('not-a-checksum')).toThrow(/Invalid SHA256SUMS/);
    const line = `${'a'.repeat(64)}  Caul-macos-arm64.zip`;
    expect(() => parseChecksums(`${line}\n${line}\n`)).toThrow(/Duplicate checksum/);
  });

  it('generates only the channel-owned casks from reviewed checksums', () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-homebrew-generator-'));
    try {
      const checksums = join(root, 'SHA256SUMS');
      writeFileSync(checksums, [
        `${'a'.repeat(64)}  Caul-macos-arm64.zip`,
        `${'b'.repeat(64)}  Caul-Beta-macos-arm64.zip`
      ].join('\n') + '\n');
      const stableOutput = join(root, 'stable');
      expect(generateHomebrewCasks({
        channel: 'stable', checksumsPath: checksums, outputDirectory: stableOutput, version: '1.2.3'
      })).toHaveLength(2);
      expect(readFileSync(join(stableOutput, 'caul.rb'), 'utf8')).toContain('sha256 "' + 'a'.repeat(64));
      expect(readFileSync(join(stableOutput, 'caul@beta.rb'), 'utf8')).toContain('sha256 "' + 'b'.repeat(64));

      const betaOutput = join(root, 'beta');
      expect(generateHomebrewCasks({
        channel: 'beta', checksumsPath: checksums, outputDirectory: betaOutput, version: '1.2.3-beta.4'
      })).toHaveLength(1);
      expect(() => readFileSync(join(betaOutput, 'caul.rb'), 'utf8')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

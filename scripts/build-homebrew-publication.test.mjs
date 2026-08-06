import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHomebrewPublication } from './build-homebrew-publication.mjs';

describe('standard Homebrew publication', () => {
  it('seals the ARM64 stable and beta identities with run provenance', () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-homebrew-'));
    try {
      const assets = join(root, 'assets'); const casks = join(root, 'casks'); const output = join(root, 'output');
      mkdirSync(assets); mkdirSync(casks);
      for (const [channel, name] of [['stable', 'Caul-macos-arm64.zip'], ['beta', 'Caul-Beta-macos-arm64.zip']]) writeFileSync(join(assets, name), channel);
      writeFileSync(join(casks, 'caul.rb'), 'cask "caul" do\n  version "1.2.3"\nend\n');
      writeFileSync(join(casks, 'caul@beta.rb'), 'cask "caul@beta" do\n  version "1.2.3"\nend\n');
      const manifest = buildHomebrewPublication({channel: 'stable', version: '1.2.3', assetsDirectory: assets, casksDirectory: casks, outputDirectory: output, repository: 'apotenza92/caul', commit: 'a'.repeat(40), runId: '7', runAttempt: '2'});
      expect(manifest.casks).toEqual(['caul.rb', 'caul@beta.rb']);
      expect(manifest.architectures).toEqual(['arm64']);
      expect(manifest.native_validation.workflow_run_id).toBe(7);
      expect(manifest.artifacts[0].sha256).toBe(createHash('sha256').update('stable').digest('hex'));
      expect(readFileSync(join(output, 'manifest.json'), 'utf8')).toContain('dev.caul.app.beta');
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
});

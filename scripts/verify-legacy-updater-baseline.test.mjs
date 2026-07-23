import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyLegacyUpdaterBaseline } from './verify-legacy-updater-baseline.mjs';

describe('legacy updater baseline', () => {
  it('fails closed for unapproved tags, assets and bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-legacy-updater-'));
    try {
      const filePath = join(root, 'candidate.zip');
      writeFileSync(filePath, 'not-the-approved-package');
      expect(() => verifyLegacyUpdaterBaseline({
        asset: 'Caul-macos-arm64.zip', filePath, tag: 'v9.9.9'
      })).toThrow(/No approved legacy updater baseline/);
      expect(() => verifyLegacyUpdaterBaseline({
        asset: 'unknown.zip', filePath, tag: 'v0.1.21'
      })).toThrow(/No approved legacy updater baseline/);
      expect(() => verifyLegacyUpdaterBaseline({
        asset: 'Caul-macos-arm64.zip', filePath, tag: 'v0.1.21'
      })).toThrow(/digest mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

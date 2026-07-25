import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleReleaseAssets, expectedReleaseAssetNames } from './assemble-release-assets.mjs';

describe('release asset assembly', () => {
  it('rejects basename collisions before publication', () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-release-assets-'));
    try {
      for (const directory of ['one', 'two']) mkdirSync(join(root, directory));
      writeFileSync(join(root, 'one', 'same.zip'), 'one');
      writeFileSync(join(root, 'two', 'same.zip'), 'two');
      expect(() => assembleReleaseAssets({
        channel: 'beta', inputDirectory: root, outputDirectory: join(root, 'out')
      })).toThrow(/collision/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('defines a complete stable superset of beta assets', () => {
    const beta = expectedReleaseAssetNames('beta');
    const stable = expectedReleaseAssetNames('stable');
    expect(beta.every((name) => stable.includes(name))).toBe(true);
    expect(new Set(stable).size).toBe(stable.length);
  });
});

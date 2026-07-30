import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { normaliseLinuxAppImageMetadata } from './normalise-linux-appimage-metadata.mjs';

describe('Linux AppImage metadata normalisation', () => {
  it('rewrites the Electron Builder x64 name without changing package integrity fields', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'caul-linux-metadata-'));
    try {
      const metadataPath = path.join(directory, 'latest-linux.yml');
      writeFileSync(metadataPath, yaml.dump({
        version: '0.1.50',
        files: [{
          url: 'caul-x86_64.AppImage',
          sha512: 'unchanged-sha512',
          size: 123
        }],
        path: 'caul-x86_64.AppImage',
        sha512: 'unchanged-sha512'
      }));

      normaliseLinuxAppImageMetadata({
        metadataPath,
        sourceArtifactName: 'caul-x86_64.AppImage',
        targetArtifactName: 'caul-x64.AppImage'
      });

      const normalised = yaml.load(readFileSync(metadataPath, 'utf8'));
      expect(normalised.files).toEqual([{
        url: 'caul-x64.AppImage',
        sha512: 'unchanged-sha512',
        size: 123
      }]);
      expect(normalised.path).toBe('caul-x64.AppImage');
      expect(normalised.sha512).toBe('unchanged-sha512');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when the expected AppImage entry is absent', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'caul-linux-metadata-'));
    try {
      const metadataPath = path.join(directory, 'latest-linux.yml');
      writeFileSync(metadataPath, yaml.dump({
        version: '0.1.50',
        files: [{ url: 'unexpected.AppImage', sha512: 'value' }]
      }));
      expect(() => normaliseLinuxAppImageMetadata({
        metadataPath,
        sourceArtifactName: 'caul-x86_64.AppImage',
        targetArtifactName: 'caul-x64.AppImage'
      })).toThrow(/Expected one/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

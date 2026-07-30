import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  artifactNameFromUrl,
  assembleUpdateMetadata,
  requireTagForChannel
} from './assemble-update-metadata.mjs';

async function fixture({
  arch = 'x64',
  channel = 'stable',
  platform = 'win32',
  tag = 'v0.1.44'
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'caul-update-metadata-'));
  const artifacts = path.join(root, 'artifacts');
  const output = path.join(root, 'feed');
  await mkdir(artifacts);
  const artifactName = channel === 'beta'
    ? `Caul-Beta-windows-${arch}-setup.exe`
    : `Caul-windows-${arch}-setup.exe`;
  const artifact = Buffer.from(`${channel} ${tag} ${platform}/${arch} package`);
  await writeFile(path.join(artifacts, artifactName), artifact);
  const input = path.join(root, 'builder.yml');
  await writeFile(input, yaml.dump({
    version: tag.slice(1),
    files: [{
      url: artifactName,
      sha512: createHash('sha512').update(artifact).digest('base64'),
      size: artifact.length
    }],
    path: artifactName,
    sha512: createHash('sha512').update(artifact).digest('base64'),
    releaseName: `Caul ${tag.slice(1)}`,
    releaseNotes: 'Authenticated updater metadata.'
  }));
  return { arch, artifact, artifactName, artifacts, channel, input, output, platform, root, tag };
}

describe('update metadata assembly', () => {
  it.each([
    { channel: 'stable', tag: 'v0.1.44', expectedName: 'latest.yml' },
    { channel: 'beta', tag: 'v0.1.44', expectedName: 'beta.yml' },
    { channel: 'beta', tag: 'v0.1.45-beta.1', expectedName: 'beta.yml' }
  ])('seals $channel metadata for $tag to immutable release URLs', async ({
    channel,
    expectedName,
    tag
  }) => {
    const value = await fixture({ channel, tag });
    try {
      const auditOutput = path.join(value.root, `update-${channel}-win32-x64.yml`);
      const result = await assembleUpdateMetadata({
        arch: value.arch,
        artifactDir: value.artifacts,
        auditOutput,
        channel,
        input: value.input,
        outputRoot: value.output,
        platform: value.platform,
        repository: 'apotenza92/caul',
        tag
      });
      expect(path.basename(result.output)).toBe(expectedName);
      expect(await readFile(auditOutput)).toEqual(await readFile(result.output));
      const parsed = yaml.load(await readFile(result.output, 'utf8'));
      expect(parsed.version).toBe(tag.slice(1));
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0].url).toBe(
        `https://github.com/apotenza92/caul/releases/download/${tag}/${value.artifactName}`
      );
      expect(parsed.files[0].size).toBe(value.artifact.length);
      expect(parsed.path).toBe(parsed.files[0].url);
      expect(parsed.sha512).toBe(parsed.files[0].sha512);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  it('rejects channel/tag mismatches and unsafe names', () => {
    expect(() => requireTagForChannel('v0.1.44', 'stable')).not.toThrow();
    expect(() => requireTagForChannel('v0.1.44-beta.1', 'beta')).not.toThrow();
    expect(() => requireTagForChannel('v0.1.44-beta.1', 'stable')).toThrow(/invalid/);
    expect(artifactNameFromUrl('https://example.invalid/Caul.AppImage')).toBe('Caul.AppImage');
    expect(() => artifactNameFromUrl('%2F')).toThrow(/Unsafe/);
    expect(() => artifactNameFromUrl('nested%5Cevil.exe')).toThrow(/Unsafe/);
  });

  it.each([
    {
      label: 'tampered artifact',
      mutate: async (value) => writeFile(
        path.join(value.artifacts, value.artifactName),
        'tampered package'
      ),
      expected: /SHA-512 mismatch/
    },
    {
      label: 'missing artifact',
      mutate: async (value) => rm(path.join(value.artifacts, value.artifactName)),
      expected: /missing/
    }
  ])('fails closed for a $label', async ({ expected, mutate }) => {
    const value = await fixture();
    try {
      await mutate(value);
      await expect(assembleUpdateMetadata({
        arch: value.arch,
        artifactDir: value.artifacts,
        auditOutput: path.join(value.root, 'audit.yml'),
        channel: value.channel,
        input: value.input,
        outputRoot: value.output,
        platform: value.platform,
        repository: 'apotenza92/caul',
        tag: value.tag
      })).rejects.toThrow(expected);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
});

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

function artifactName(value) {
  if (typeof value !== 'string' || !value) {
    throw new Error('Linux AppImage metadata contains an invalid artifact URL.');
  }
  const candidate = /^https?:\/\//.test(value) ? new URL(value).pathname : value;
  return path.posix.basename(candidate);
}

export function normaliseLinuxAppImageMetadata({
  metadataPath,
  sourceArtifactName,
  targetArtifactName
}) {
  const metadata = yaml.load(readFileSync(metadataPath, 'utf8'));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Linux AppImage metadata must be a mapping.');
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error('Linux AppImage metadata contains no files.');
  }

  let replacements = 0;
  metadata.files = metadata.files.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error('Linux AppImage metadata contains an invalid file entry.');
    }
    if (artifactName(file.url) !== sourceArtifactName) return file;
    replacements += 1;
    return { ...file, url: targetArtifactName };
  });
  if (replacements !== 1) {
    throw new Error(
      `Expected one ${sourceArtifactName} metadata entry, found ${replacements}.`
    );
  }

  if (metadata.path !== undefined) {
    if (artifactName(metadata.path) !== sourceArtifactName) {
      throw new Error('Legacy Linux AppImage metadata path does not match its file entry.');
    }
    metadata.path = targetArtifactName;
  }

  writeFileSync(metadataPath, `${yaml.dump(metadata, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  }).trimEnd()}\n`);
}

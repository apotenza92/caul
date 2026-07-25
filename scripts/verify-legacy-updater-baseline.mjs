import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const LEGACY_BASELINES = Object.freeze({
  'v0.1.21': Object.freeze({
    'Caul-Beta-macos-arm64.zip': '6b12c70d8386fe1bbcdc26aa0ac35bc8172b0304379a0409bdbc5429d1806c40',
    'Caul-macos-arm64.zip': '75af4b23c1db2ecd4deae361bd36480f94047519ec78041e158723ffd154a740'
  })
});

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

export function verifyLegacyUpdaterBaseline({ asset, filePath, tag }) {
  const expected = LEGACY_BASELINES[tag]?.[asset];
  if (!expected) throw new Error(`No approved legacy updater baseline for ${tag}/${asset}`);
  const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  if (actual !== expected) throw new Error(`Legacy updater baseline digest mismatch for ${tag}/${asset}`);
  return actual;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  verifyLegacyUpdaterBaseline({
    asset: option('--asset'),
    filePath: resolve(option('--file')),
    tag: option('--tag')
  });
}

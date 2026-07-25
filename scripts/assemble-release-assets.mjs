import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
export function expectedReleaseAssetNames(channel) {
  const beta = [
    'Caul-Beta-macos-arm64.zip',
    'Caul-Beta-macos-arm64.zip.blockmap',
    'Caul-Beta-macos-arm64.zip.sha256',
    'beta-mac.yml',
    'notarization-beta-macos-arm64.json',
    ...['arm64', 'x64'].flatMap((arch) => [
      `Caul-Beta-windows-${arch}-setup.exe`,
      `Caul-Beta-windows-${arch}-setup.exe.blockmap`,
      `caul-beta-${arch}.AppImage`,
      `caul-beta-${arch}.deb`
    ]),
    'caul-beta-x64.rpm'
  ];
  if (channel === 'beta') return beta.sort();
  if (channel !== 'stable') throw new Error(`Unsupported release channel ${channel}`);
  return [
    ...beta,
    'Caul-macos-arm64.zip',
    'Caul-macos-arm64.zip.blockmap',
    'Caul-macos-arm64.zip.sha256',
    'latest-mac.yml',
    'notarization-stable-macos-arm64.json',
    ...['arm64', 'x64'].flatMap((arch) => [
      `Caul-windows-${arch}-setup.exe`,
      `Caul-windows-${arch}-setup.exe.blockmap`,
      `caul-${arch}.AppImage`,
      `caul-${arch}.deb`
    ]),
    'caul-x64.rpm'
  ].sort();
}

export function assembleReleaseAssets({ inputDirectory, outputDirectory, channel }) {
  const sources = new Map();
  for (const artifact of readdirSync(inputDirectory, { withFileTypes: true })) {
    if (!artifact.isDirectory()) throw new Error(`Unexpected non-directory artifact input ${artifact.name}`);
    for (const entry of readdirSync(join(inputDirectory, artifact.name), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const source = join(inputDirectory, artifact.name, entry.name);
      if (sources.has(entry.name)) {
        throw new Error(`Release asset collision for ${entry.name}: ${sources.get(entry.name)} and ${source}`);
      }
      sources.set(entry.name, source);
    }
  }
  const expected = expectedReleaseAssetNames(channel);
  const actual = [...sources.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Release asset set mismatch.\nExpected: ${expected.join(', ')}\nActual: ${actual.join(', ')}`);
  }
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  for (const name of expected) copyFileSync(sources.get(name), join(outputDirectory, name));
  const sums = expected.map((name) => {
    const target = join(outputDirectory, name);
    if (!existsSync(target) || statSync(target).size === 0) throw new Error(`Release asset is empty: ${name}`);
    return `${createHash('sha256').update(readFileSync(target)).digest('hex')}  ${basename(target)}`;
  });
  writeFileSync(join(outputDirectory, 'SHA256SUMS'), `${sums.join('\n')}\n`, { mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  assembleReleaseAssets({
    channel: option('--channel', process.env.CAUL_RELEASE_CHANNEL),
    inputDirectory: resolve(option('--input', 'downloaded-artifacts')),
    outputDirectory: resolve(option('--output', 'release-assets'))
  });
}

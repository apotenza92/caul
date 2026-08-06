import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

export function buildHomebrewPublication({ channel, version, assetsDirectory, casksDirectory, outputDirectory, repository, commit, runId, runAttempt }) {
  if (!['stable', 'beta'].includes(channel) || !/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(version)) throw new Error('Invalid release identity');
  const channels = channel === 'stable' ? ['stable', 'beta'] : ['beta'];
  const casks = channel === 'stable' ? ['caul.rb', 'caul@beta.rb'] : ['caul@beta.rb'];
  mkdirSync(join(outputDirectory, 'Casks'), { recursive: true });
  for (const cask of casks) writeFileSync(join(outputDirectory, 'Casks', cask), readFileSync(join(casksDirectory, cask)));
  const artifacts = channels.map(publicationChannel => {
    const name = publicationChannel === 'stable' ? 'Caul-macos-arm64.zip' : 'Caul-Beta-macos-arm64.zip';
    const path = join(assetsDirectory, name);
    return {name, url: `https://github.com/${repository}/releases/download/v${version}/${name}`, size: statSync(path).size, sha256: sha256(path), channel: publicationChannel, architecture: 'arm64'};
  });
  const manifest = {
    schema_version: 1,
    product: 'caul',
    source_repository: repository,
    release_tag: `v${version}`,
    release_commit: commit,
    channel,
    casks,
    artifacts,
    applications: Object.fromEntries(channels.map(value => [value, value === 'stable' ? 'Caul.app' : 'Caul Beta.app'])),
    bundle_identifiers: Object.fromEntries(channels.map(value => [value, value === 'stable' ? 'dev.caul.app' : 'dev.caul.app.beta'])),
    architectures: ['arm64'],
    minimum_macos: '14.0',
    native_validation: {workflow_run_id: Number(runId), workflow_run_attempt: Number(runAttempt), jobs: [channel === 'stable' ? 'Prepare Homebrew publication (Stable)' : 'Prepare Homebrew publication (Beta)']},
  };
  writeFileSync(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  buildHomebrewPublication({channel: option('--channel'), version: option('--version'), assetsDirectory: resolve(option('--assets')), casksDirectory: resolve(option('--casks')), outputDirectory: resolve(option('--output')), repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT});
}

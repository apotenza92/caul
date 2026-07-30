const path = require('node:path');

const channels = new Set(['stable', 'beta']);
const platforms = new Set(['darwin', 'win32', 'linux']);
const architectures = new Set(['arm64', 'x64']);
const defaultFeedBaseUrl = 'https://raw.githubusercontent.com/apotenza92/caul/updates';

function requireChoice(label, value, choices) {
  if (!choices.has(value)) {
    throw new Error(`${label} must be one of ${[...choices].join(', ')}; received ${value}.`);
  }
}

function normalisePlatform(value) {
  if (value === 'mac') return 'darwin';
  if (value === 'win') return 'win32';
  return value;
}

function updateMetadataFileName(platform, arch, channel) {
  const resolvedPlatform = normalisePlatform(platform);
  requireChoice('Update platform', resolvedPlatform, platforms);
  requireChoice('Update architecture', arch, architectures);
  requireChoice('Update channel', channel, channels);

  const prefix = channel === 'beta' ? 'beta' : 'latest';
  if (resolvedPlatform === 'darwin') return `${prefix}-mac.yml`;
  if (resolvedPlatform === 'win32') return `${prefix}.yml`;
  return arch === 'arm64' ? `${prefix}-linux-arm64.yml` : `${prefix}-linux.yml`;
}

function updateContract({
  arch = process.env.CAUL_PACKAGE_ARCH || process.arch,
  channel = process.env.FORCE_BETA_BUILD === 'true' ? 'beta' : 'stable',
  feedBaseUrl = process.env.CAUL_UPDATE_FEED_BASE_URL || defaultFeedBaseUrl,
  platform = process.env.CAUL_PACKAGE_PLATFORM || process.platform
} = {}) {
  const resolvedPlatform = normalisePlatform(platform);
  requireChoice('Update channel', channel, channels);
  requireChoice('Update platform', resolvedPlatform, platforms);
  requireChoice('Update architecture', arch, architectures);
  if (resolvedPlatform === 'darwin' && arch !== 'arm64') {
    throw new Error('Caul currently supports only macOS ARM64 packages.');
  }

  const normalisedBaseUrl = String(feedBaseUrl).replace(/\/$/, '');
  const feedUrl = `${normalisedBaseUrl}/${channel}/${resolvedPlatform}/${arch}`;
  return {
    arch,
    channel,
    feedUrl,
    metadataFileName: updateMetadataFileName(resolvedPlatform, arch, channel),
    platform: resolvedPlatform,
    tufRepositoryUrl: `${feedUrl}/tuf`
  };
}

function embeddedTufRootPath(repositoryRoot = path.resolve(__dirname, '..')) {
  return path.join(repositoryRoot, 'build', 'update-trust', 'root.json');
}

module.exports = {
  architectures,
  channels,
  defaultFeedBaseUrl,
  embeddedTufRootPath,
  normalisePlatform,
  platforms,
  updateContract,
  updateMetadataFileName
};

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

export function parseChecksums(contents) {
  const checksums = new Map();
  for (const line of String(contents).split(/\r?\n/).filter(Boolean)) {
    const match = /^([a-f0-9]{64})  ([^/]+)$/.exec(line);
    if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
    if (checksums.has(match[2])) throw new Error(`Duplicate checksum for ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

function requireChecksum(checksums, assetName) {
  const checksum = checksums.get(assetName);
  if (!SHA256_PATTERN.test(checksum ?? '')) {
    throw new Error(`Missing valid checksum for ${assetName}`);
  }
  return checksum;
}

export function renderStableCask(version, sha256) {
  return `cask "caul" do
  version "${version}"

  on_arm do
    sha256 "${sha256}"

    url "https://github.com/apotenza92/caul/releases/download/v#{version}/Caul-macos-arm64.zip"
  end

  name "Caul"
  desc "Private desktop assistant for live calls and screen work"
  homepage "https://github.com/apotenza92/caul"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :sonoma

  app "Caul.app"

  zap trash: [
    "~/Library/Application Support/Caul",
    "~/Library/Caches/dev.caul.app",
    "~/Library/Caches/dev.caul.app.ShipIt",
    "~/Library/Preferences/dev.caul.app.plist",
    "~/Library/Saved Application State/dev.caul.app.savedState",
  ]
end
`;
}

export function renderBetaCask(version, sha256) {
  return `cask "caul@beta" do
  version "${version}"

  on_arm do
    sha256 "${sha256}"

    url "https://github.com/apotenza92/caul/releases/download/v#{version}/Caul-Beta-macos-arm64.zip"
  end

  name "Caul Beta"
  desc "Beta channel for Caul"
  homepage "https://github.com/apotenza92/caul"

  livecheck do
    url "https://api.github.com/repos/apotenza92/caul/releases"
    strategy :json do |json|
      json
        .reject { |release| release["draft"] }
        .map { |release| release["tag_name"].delete_prefix("v") }
    end
  end

  depends_on macos: :sonoma

  app "Caul Beta.app"

  zap trash: [
    "~/Library/Application Support/Caul Beta",
    "~/Library/Caches/dev.caul.app.beta",
    "~/Library/Caches/dev.caul.app.beta.ShipIt",
    "~/Library/Preferences/dev.caul.app.beta.plist",
    "~/Library/Saved Application State/dev.caul.app.beta.savedState",
  ]
end
`;
}

export function generateHomebrewCasks({ channel, checksumsPath, outputDirectory, version }) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[1-9]\d*)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  if (!['stable', 'beta'].includes(channel)) throw new Error(`Invalid release channel: ${channel}`);
  if ((channel === 'beta') !== version.includes('-beta.')) {
    throw new Error(`Channel ${channel} does not match version ${version}`);
  }
  const checksums = parseChecksums(readFileSync(checksumsPath, 'utf8'));
  mkdirSync(outputDirectory, { recursive: true });
  const generated = [];
  if (channel === 'stable') {
    const stablePath = resolve(outputDirectory, 'caul.rb');
    writeFileSync(stablePath, renderStableCask(version, requireChecksum(checksums, 'Caul-macos-arm64.zip')));
    generated.push(stablePath);
  }
  const betaPath = resolve(outputDirectory, 'caul@beta.rb');
  writeFileSync(betaPath, renderBetaCask(version, requireChecksum(checksums, 'Caul-Beta-macos-arm64.zip')));
  generated.push(betaPath);
  return generated;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  generateHomebrewCasks({
    channel: option('--channel'),
    checksumsPath: resolve(option('--sha256sums')),
    outputDirectory: resolve(option('--output')),
    version: option('--version')
  });
}

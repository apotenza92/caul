import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import YAML from 'js-yaml';
import {
  CAUL_MAC_ARCH,
  CAUL_MAC_MINIMUM_KERNEL_VERSION,
  CAUL_TEAM_ID,
  normaliseFingerprint,
  resolveMacReleaseContract,
  validateNotarisationRecord
} from './macos-release-contract.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const channelArgument = process.argv.indexOf('--channel');
const channel = channelArgument >= 0 ? process.argv[channelArgument + 1] : process.env.CAUL_RELEASE_CHANNEL ?? 'stable';
const contract = resolveMacReleaseContract(channel);
const skipPrepare = process.argv.includes('--skip-prepare');

if (process.platform !== 'darwin' || process.arch !== CAUL_MAC_ARCH) {
  throw new Error('Signed Caul releases require a native Apple Silicon macOS runner.');
}

const requiredEnvironment = [
  'APPLE_NOTARYTOOL_ISSUER_ID',
  'APPLE_NOTARYTOOL_KEY_ID',
  'APPLE_NOTARYTOOL_KEY_P8_BASE64',
  'APPLE_SIGNING_CERTIFICATE_P12_BASE64',
  'APPLE_SIGNING_CERTIFICATE_PASSWORD',
  'APPLE_SIGNING_CERTIFICATE_SHA256',
  'APPLE_SIGNING_IDENTITY',
  'APPLE_TEAM_ID'
];
const credentials = Object.fromEntries(requiredEnvironment.map((name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required release environment variable is missing: ${name}`);
  }
  return [name, value];
}));
const expectedFingerprint = normaliseFingerprint(credentials.APPLE_SIGNING_CERTIFICATE_SHA256);
if (credentials.APPLE_TEAM_ID !== CAUL_TEAM_ID) {
  throw new Error(`APPLE_TEAM_ID must be the configured Caul team ${CAUL_TEAM_ID}.`);
}
if (!credentials.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application: ')
  || !credentials.APPLE_SIGNING_IDENTITY.endsWith(`(${credentials.APPLE_TEAM_ID})`)) {
  throw new Error('APPLE_SIGNING_IDENTITY must be the exact Developer ID Application identity for APPLE_TEAM_ID.');
}

for (const name of [
  'APPLE_NOTARYTOOL_KEY_P8_BASE64',
  'APPLE_SIGNING_CERTIFICATE_P12_BASE64',
  'APPLE_SIGNING_CERTIFICATE_PASSWORD'
]) {
  delete process.env[name];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'inherit', 'inherit'],
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = options.capture ? `\n${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()}` : '';
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})${output}`);
  }
  return result;
}

function decodeBase64(value, label) {
  let encoded = value.trim();
  if (encoded.startsWith("'") && encoded.endsWith("'")) {
    encoded = encoded.slice(1, -1);
  }
  const dataUrlSeparator = encoded.indexOf(';base64,');
  if (dataUrlSeparator >= 0) {
    encoded = encoded.slice(dataUrlSeparator + ';base64,'.length);
  }
  const decoded = Buffer.from(encoded.replace(/\s+/g, ''), 'base64');
  if (decoded.length === 0) {
    throw new Error(`${label} did not decode to any data.`);
  }
  return decoded;
}

function parseKeychainList(output) {
  return output
    .split('\n')
    .map((line) => line.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function resolveDeveloperDirectory() {
  const configured = process.env.DEVELOPER_DIR?.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`Configured Xcode developer directory does not exist: ${configured}`);
    }
    return configured;
  }
  const candidate = [
    '/Applications/Xcode.app/Contents/Developer',
    '/Applications/Xcode-beta.app/Contents/Developer'
  ].find(existsSync);
  if (!candidate) {
    throw new Error('A complete Xcode installation is required for notarisation.');
  }
  return candidate;
}

function validateImportedCertificate(keychainPath) {
  const identityResult = run('security', [
    'find-identity', '-v', '-p', 'codesigning', keychainPath
  ], { capture: true });
  if (!identityResult.stdout.includes(`"${credentials.APPLE_SIGNING_IDENTITY}"`)) {
    throw new Error(`Expected signing identity is unavailable: ${credentials.APPLE_SIGNING_IDENTITY}`);
  }

  const certificateResult = run('security', [
    'find-certificate', '-a', '-c', credentials.APPLE_SIGNING_IDENTITY, '-Z', keychainPath
  ], { capture: true });
  const fingerprints = [...certificateResult.stdout.matchAll(/SHA-256 hash:\s*([A-Fa-f0-9]+)/g)]
    .map((match) => normaliseFingerprint(match[1]));
  if (!fingerprints.includes(expectedFingerprint)) {
    throw new Error(
      `Imported certificate fingerprints ${fingerprints.join(', ') || 'missing'} do not include ${expectedFingerprint}`
    );
  }
}

function writeChecksum(filePath) {
  const result = run('shasum', ['-a', '256', filePath], { capture: true });
  const hash = result.stdout.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`Unable to calculate SHA-256 for ${filePath}`);
  }
  writeFileSync(`${filePath}.sha256`, `${hash}  ${basename(filePath)}\n`, { mode: 0o644 });
}

function parseNotaryJson(result, label) {
  for (const value of [result.stdout, result.stderr]) {
    if (!value?.trim()) continue;
    try {
      return JSON.parse(value);
    } catch {
      // notarytool can write non-JSON diagnostics to either stream.
    }
  }
  throw new Error(`${label} did not return valid JSON.`);
}

function notariseDistributable(artifactPath, builderEnvironment) {
  const authorisation = [
    '--key', builderEnvironment.APPLE_API_KEY,
    '--key-id', builderEnvironment.APPLE_API_KEY_ID,
    '--issuer', builderEnvironment.APPLE_API_ISSUER
  ];
  const submission = parseNotaryJson(run('xcrun', [
    'notarytool', 'submit', artifactPath,
    ...authorisation,
    '--wait',
    '--output-format', 'json'
  ], {
    capture: true,
    env: builderEnvironment
  }), 'Distributable notarisation submission');
  if (typeof submission.id !== 'string') {
    throw new Error(`Distributable notarisation did not return an ID: ${JSON.stringify(submission)}`);
  }
  const log = parseNotaryJson(run('xcrun', [
    'notarytool', 'log', submission.id,
    ...authorisation,
    '--output-format', 'json'
  ], {
    capture: true,
    env: builderEnvironment
  }), `Distributable notarisation log ${submission.id}`);
  const record = validateNotarisationRecord({ submission, log });
  const evidencePath = join(
    repositoryRoot,
    'release',
    `notarization-${contract.channel}-macos-arm64-distributable.json`
  );
  writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
}

function stampUpdaterMinimumSystemVersion(metadataPath) {
  const metadata = YAML.load(readFileSync(metadataPath, 'utf8'));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`Updater metadata is not an object: ${metadataPath}`);
  }
  metadata.minimumSystemVersion = CAUL_MAC_MINIMUM_KERNEL_VERSION;
  writeFileSync(metadataPath, YAML.dump(metadata, { lineWidth: -1, noRefs: true }), { mode: 0o644 });
}

if (!skipPrepare) {
  // Secret values have already been removed from process.env. Preparation does
  // not need access to a signing keychain or the decoded App Store Connect key.
  run('npm', ['run', 'package:prepare:mac']);
}

const signingDirectory = mkdtempSync(join(tmpdir(), 'caul-signing-'));
chmodSync(signingDirectory, 0o700);
const keychainPath = join(signingDirectory, 'signing.keychain-db');
const originalP12Path = join(signingDirectory, 'original.p12');
const passwordPath = join(signingDirectory, 'p12-password');
const combinedPemPath = join(signingDirectory, 'combined.pem');
const importP12Path = join(signingDirectory, 'import.p12');
const apiKeyPath = join(signingDirectory, 'AuthKey.p8');
const keychainPassword = randomBytes(24).toString('hex');
const importPassword = randomBytes(24).toString('hex');
let originalKeychains = [];
let keychainCreated = false;
let cleaningUp = false;

function cleanup() {
  if (cleaningUp) {
    return;
  }
  cleaningUp = true;
  if (originalKeychains.length > 0) {
    spawnSync('security', ['list-keychains', '-d', 'user', '-s', ...originalKeychains], { stdio: 'ignore' });
  }
  if (keychainCreated) {
    spawnSync('security', ['delete-keychain', keychainPath], { stdio: 'ignore' });
  }
  rmSync(signingDirectory, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  writeFileSync(
    originalP12Path,
    decodeBase64(credentials.APPLE_SIGNING_CERTIFICATE_P12_BASE64, 'Signing certificate'),
    { mode: 0o600 }
  );
  writeFileSync(passwordPath, credentials.APPLE_SIGNING_CERTIFICATE_PASSWORD, { mode: 0o600 });
  const p8Value = credentials.APPLE_NOTARYTOOL_KEY_P8_BASE64;
  writeFileSync(
    apiKeyPath,
    p8Value.includes('BEGIN PRIVATE KEY') ? p8Value : decodeBase64(p8Value, 'App Store Connect private key'),
    { mode: 0o600 }
  );

  run('openssl', [
    'pkcs12', '-legacy',
    '-in', originalP12Path,
    '-passin', `file:${passwordPath}`,
    '-nodes',
    '-out', combinedPemPath
  ]);
  run('openssl', [
    'pkcs12', '-legacy', '-export',
    '-in', combinedPemPath,
    '-passout', `pass:${importPassword}`,
    '-out', importP12Path,
    '-name', 'Caul Developer ID'
  ]);

  originalKeychains = parseKeychainList(
    run('security', ['list-keychains', '-d', 'user'], { capture: true }).stdout
  );
  run('security', ['create-keychain', '-p', keychainPassword, keychainPath]);
  keychainCreated = true;
  run('security', ['set-keychain-settings', '-lut', '21600', keychainPath]);
  run('security', ['unlock-keychain', '-p', keychainPassword, keychainPath]);
  run('security', [
    'import', importP12Path,
    '-k', keychainPath,
    '-P', importPassword,
    '-T', '/usr/bin/codesign'
  ]);
  run('security', [
    'set-key-partition-list',
    '-S', 'apple-tool:,apple:,codesign:',
    '-s',
    '-k', keychainPassword,
    keychainPath
  ]);
  run('security', ['list-keychains', '-d', 'user', '-s', keychainPath, ...originalKeychains]);
  validateImportedCertificate(keychainPath);

  const xcodeDeveloperDirectory = resolveDeveloperDirectory();
  const builderEnvironment = {
    ...process.env,
    APPLE_API_ISSUER: credentials.APPLE_NOTARYTOOL_ISSUER_ID,
    APPLE_API_KEY: apiKeyPath,
    APPLE_API_KEY_ID: credentials.APPLE_NOTARYTOOL_KEY_ID,
    APPLE_SIGNING_CERTIFICATE_SHA256: expectedFingerprint,
    APPLE_SIGNING_IDENTITY: credentials.APPLE_SIGNING_IDENTITY,
    APPLE_TEAM_ID: credentials.APPLE_TEAM_ID,
    CAUL_PACKAGE_ARCH: CAUL_MAC_ARCH,
    CAUL_PACKAGE_PLATFORM: 'mac',
    CAUL_RELEASE_CHANNEL: contract.channel,
    CAUL_REQUIRE_RELEASE_SIGNING: 'true',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    CSC_KEYCHAIN: keychainPath,
    CSC_NAME: credentials.APPLE_SIGNING_IDENTITY.replace(/^Developer ID Application:\s*/, ''),
    DEVELOPER_DIR: xcodeDeveloperDirectory,
    FORCE_BETA_BUILD: contract.channel === 'beta' ? 'true' : 'false'
  };

  run('npx', [
    '--no-install',
    'electron-builder',
    '--config', 'electron-builder.config.cjs',
    '--mac', 'zip',
    '--arm64',
    '--publish=never'
  ], { env: builderEnvironment });

  const artifactPath = join(repositoryRoot, 'release', contract.artifactName);
  notariseDistributable(artifactPath, builderEnvironment);
  stampUpdaterMinimumSystemVersion(join(repositoryRoot, 'release', contract.metadataName));
  writeChecksum(artifactPath);
  run('node', [
    'scripts/verify-macos-package.mjs',
    '--channel', contract.channel,
    '--release-dir', join(repositoryRoot, 'release'),
    '--require-checksum',
    '--skip-launch'
  ], { env: builderEnvironment });
} finally {
  cleanup();
}

export const CAUL_MAC_ARCH = 'arm64';
export const CAUL_MAC_MINIMUM_KERNEL_VERSION = '23.0.0';
export const CAUL_MAC_MINIMUM_SYSTEM_VERSION = '14.0';
export const CAUL_TEAM_ID = '27JL2VERNC';

const CHANNELS = new Set(['stable', 'beta']);

export function resolveMacReleaseContract(channel) {
  if (!CHANNELS.has(channel)) {
    throw new Error(`Expected release channel stable or beta, received: ${channel}`);
  }

  const beta = channel === 'beta';
  const productName = beta ? 'Caul Beta' : 'Caul';
  return {
    appName: `${productName}.app`,
    artifactName: `${beta ? 'Caul-Beta' : 'Caul'}-macos-arm64.zip`,
    blockmapName: `${beta ? 'Caul-Beta' : 'Caul'}-macos-arm64.zip.blockmap`,
    bundleId: beta ? 'dev.caul.app.beta' : 'dev.caul.app',
    channel,
    executableName: productName,
    iconFileName: 'icon.icns',
    metadataName: beta ? 'beta-mac.yml' : 'latest-mac.yml',
    packageName: beta ? 'caul-beta' : 'caul',
    productName,
    sourceIconPath: beta ? 'assets/icons/beta/icon.icns' : 'assets/icons/icon.icns',
    updaterChannel: beta ? 'beta' : 'latest'
  };
}

export function normaliseFingerprint(value) {
  const fingerprint = String(value ?? '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(fingerprint)) {
    throw new Error(`Expected a SHA-256 certificate fingerprint, received: ${value}`);
  }
  return fingerprint;
}

export function resolvePriorSigningFingerprints(currentValue, priorValue) {
  const fingerprints = [normaliseFingerprint(currentValue)];
  if (String(priorValue ?? '').trim()) {
    const prior = normaliseFingerprint(priorValue);
    if (!fingerprints.includes(prior)) fingerprints.push(prior);
  }
  return fingerprints;
}

export function parseCodesignMetadata(output) {
  const values = new Map();
  const authorities = [];
  for (const line of String(output).split(/\r?\n/)) {
    if (line.startsWith('CodeDirectory ')) {
      values.set('CodeDirectory', line);
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'Authority') {
      authorities.push(value);
    } else if (!values.has(key)) {
      values.set(key, value);
    }
  }
  return {
    authorities,
    flags: values.get('CodeDirectory') ?? '',
    identifier: values.get('Identifier') ?? null,
    teamIdentifier: values.get('TeamIdentifier') ?? null,
    timestamp: values.get('Timestamp') ?? null,
    ticket: values.get('Notarization Ticket') ?? null
  };
}

export function validateSignatureMetadata(metadata, expectations, label) {
  if (metadata.authorities[0] !== expectations.identity) {
    throw new Error(`${label} signer ${metadata.authorities[0] ?? 'missing'} does not match ${expectations.identity}`);
  }
  if (metadata.teamIdentifier !== expectations.teamId) {
    throw new Error(`${label} team ${metadata.teamIdentifier ?? 'missing'} does not match ${expectations.teamId}`);
  }
  if (!metadata.flags.includes('runtime')) {
    throw new Error(`${label} does not have the hardened-runtime signature flag`);
  }
  if (!metadata.timestamp) {
    throw new Error(`${label} does not have a secure signing timestamp`);
  }
}

export function validateNotarisationRecord(record) {
  if (!record || record.submission?.status !== 'Accepted' || typeof record.submission?.id !== 'string') {
    throw new Error('Notarisation submission was not accepted');
  }
  if (!record.log || record.log.status !== 'Accepted') {
    throw new Error('Notarisation log does not report Accepted status');
  }
  if (record.log.jobId && record.log.jobId !== record.submission.id) {
    throw new Error('Notarisation log job ID does not match its submission');
  }
  const issues = Array.isArray(record.log.issues) ? record.log.issues : [];
  if (issues.some((issue) => String(issue?.severity ?? '').toLowerCase() === 'error')) {
    throw new Error('Notarisation log contains error issues');
  }
  return record;
}

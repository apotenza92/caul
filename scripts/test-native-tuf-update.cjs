#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const {
  onlineRoles,
  signUpdateRepository
} = require('./sign-tuf-update-repository.cjs');

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function requiredOption(argv, name) {
  const value = option(argv, name);
  if (!value) throw new Error(`Missing required updater audit option ${name}.`);
  return value;
}

function run(command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}.`);
}

function windowsSilentInstallArguments(installDirectory) {
  if (!installDirectory) throw new Error('Windows silent installation requires a destination.');
  return ['/S', `/D=${installDirectory}`];
}

function digest(filePath, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(fs.readFileSync(filePath)).digest(encoding);
}

const auditScenarios = Object.freeze([
  'valid',
  'corrupt-payload',
  'wrong-signature'
]);

function requireAuditScenario(value) {
  if (!auditScenarios.includes(value)) {
    throw new Error(`Updater audit scenario must be one of: ${auditScenarios.join(', ')}.`);
  }
  return value;
}

function artifactName(value) {
  if (typeof value !== 'string' || !value) {
    throw new Error('Updater metadata contains an invalid artifact URL.');
  }
  const candidate = /^https?:\/\//.test(value) ? new URL(value).pathname : value;
  let decoded;
  try {
    decoded = decodeURIComponent(path.posix.basename(candidate));
  } catch {
    throw new Error(`Unsafe updater artifact name: ${value}`);
  }
  if (
    !decoded
    || decoded !== path.posix.basename(decoded)
    || decoded.includes('\\')
    || decoded.includes('\0')
  ) {
    throw new Error(`Unsafe updater artifact name: ${value}`);
  }
  return decoded;
}

function candidatePackageRequestPaths(artifactNames, version) {
  return new Set([...artifactNames].map(
    (name) => `/assets/${version}/${artifactName(name)}`
  ));
}

function resolveAuditAssetPath({
  candidateDirectory,
  candidateVersion,
  previousBlockmap,
  requestedName,
  requestedVersion
}) {
  if (requestedVersion === candidateVersion) {
    return path.join(candidateDirectory, requestedName);
  }
  if (
    requestedVersion === '0.0.1'
    && requestedName.endsWith('.blockmap')
    && previousBlockmap
  ) {
    return previousBlockmap;
  }
  return null;
}

function prepareSignedTarget({ baseUrl, candidateDirectory, candidateMetadata }) {
  const metadata = yaml.load(fs.readFileSync(candidateMetadata, 'utf8'));
  if (!metadata?.version || !Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error('Candidate updater metadata is incomplete.');
  }
  const names = new Set();
  metadata.files = metadata.files.map((file) => {
    const name = artifactName(file.url);
    if (names.has(name)) throw new Error(`Duplicate updater artifact: ${name}`);
    names.add(name);
    const candidate = path.join(candidateDirectory, name);
    if (!fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Candidate updater artifact is missing: ${name}`);
    }
    if (digest(candidate, 'sha512', 'base64') !== file.sha512) {
      throw new Error(`Candidate updater SHA-512 does not match: ${name}`);
    }
    if (file.size !== undefined && fs.statSync(candidate).size !== file.size) {
      throw new Error(`Candidate updater size does not match: ${name}`);
    }
    return {
      ...file,
      url: `${baseUrl}/assets/${encodeURIComponent(metadata.version)}/${encodeURIComponent(name)}`
    };
  });
  if (metadata.path) {
    const name = artifactName(metadata.path);
    if (!names.has(name)) throw new Error('Legacy updater path does not match a files entry.');
    const matchingFile = metadata.files.find((file) => artifactName(file.url) === name);
    metadata.path = matchingFile.url;
    metadata.sha512 = matchingFile.sha512;
  }
  return {
    artifactNames: names,
    bytes: Buffer.from(`${yaml.dump(metadata, { lineWidth: -1, noRefs: true }).trimEnd()}\n`),
    version: metadata.version
  };
}

function serveBytes(request, response, bytes) {
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) {
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': bytes.length
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return;
  }
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= bytes.length) {
    response.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` }).end();
    return;
  }
  response.writeHead(206, {
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${bytes.length}`
  });
  response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
}

function serveFile(request, response, filePath) {
  serveBytes(request, response, fs.readFileSync(filePath));
}

function corruptedPayload(filePath, maxBytes = 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Corrupt updater payload limit must be a positive integer.');
  }
  const bytes = Buffer.from(fs.readFileSync(filePath));
  if (bytes.length < 2) throw new Error(`Cannot truncate updater payload: ${filePath}`);
  return Buffer.from(bytes.subarray(0, Math.min(bytes.length - 1, maxBytes)));
}

function updaterEventTimeoutMs(platform) {
  return platform === 'win32' ? 15 * 60_000 : 5 * 60_000;
}

function invalidateTimestampSignature(repositoryDirectory) {
  const timestampPath = path.join(repositoryDirectory, 'metadata', 'timestamp.json');
  const timestamp = JSON.parse(fs.readFileSync(timestampPath, 'utf8'));
  if (!Array.isArray(timestamp.signatures) || timestamp.signatures.length !== 1) {
    throw new Error('Native updater audit expected exactly one timestamp signature.');
  }
  timestamp.signatures[0].sig = '0'.repeat(128);
  fs.writeFileSync(timestampPath, JSON.stringify(timestamp));
}

async function createUpdateServer({
  candidateDirectory,
  candidateMetadata,
  privateKeyBundlePath,
  previousBlockmap,
  rootPath,
  scenario,
  targetName,
  temporaryRoot
}) {
  const requests = [];
  let repositoryDirectory;
  let signedTarget;
  const corruptedAssets = new Map();
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    requests.push(pathname);
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const metadataMatch = pathname.match(/^\/tuf\/metadata\/([^/]+)$/);
    if (metadataMatch) {
      const metadataPath = path.join(repositoryDirectory, 'metadata', metadataMatch[1]);
      if (!fs.statSync(metadataPath, { throwIfNoEntry: false })?.isFile()) {
        response.writeHead(404).end();
        return;
      }
      serveFile(request, response, metadataPath);
      return;
    }
    if (pathname === `/tuf/targets/${encodeURIComponent(targetName)}`) {
      serveFile(request, response, path.join(repositoryDirectory, 'targets', targetName));
      return;
    }
    const assetMatch = pathname.match(/^\/assets\/([^/]+)\/([^/]+)$/);
    if (assetMatch) {
      const requestedVersion = assetMatch[1];
      const requestedName = assetMatch[2];
      const packageName = requestedName.endsWith('.blockmap')
        ? requestedName.slice(0, -'.blockmap'.length)
        : requestedName;
      const isCandidateVersion = requestedVersion === signedTarget.version;
      const assetPath = resolveAuditAssetPath({
        candidateDirectory,
        candidateVersion: signedTarget.version,
        previousBlockmap,
        requestedName,
        requestedVersion
      });
      if (
        assetPath
        && signedTarget.artifactNames.has(packageName)
        && fs.statSync(assetPath, { throwIfNoEntry: false })?.isFile()
      ) {
        const corrupted = isCandidateVersion
          ? corruptedAssets.get(requestedName)
          : null;
        if (corrupted) {
          serveBytes(request, response, corrupted);
        } else {
          serveFile(request, response, assetPath);
        }
        return;
      }
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  signedTarget = prepareSignedTarget({ baseUrl, candidateDirectory, candidateMetadata });
  if (scenario === 'corrupt-payload') {
    for (const name of signedTarget.artifactNames) {
      corruptedAssets.set(name, corruptedPayload(path.join(candidateDirectory, name)));
    }
  }
  const targetPath = path.join(temporaryRoot, targetName);
  fs.writeFileSync(targetPath, signedTarget.bytes);
  const privateBundle = JSON.parse(fs.readFileSync(privateKeyBundlePath, 'utf8'));
  repositoryDirectory = path.join(temporaryRoot, 'repository');
  signUpdateRepository({
    now: new Date(),
    outputDirectory: repositoryDirectory,
    previousMetadataDirectory: null,
    privateKeys: Object.fromEntries(onlineRoles.map((role) => [
      role,
      privateBundle.roles[role].private_key_pem
    ])),
    rootPath,
    targetName,
    targetPath
  });
  if (scenario === 'wrong-signature') {
    invalidateTimestampSignature(repositoryDirectory);
  }
  return {
    artifactNames: new Set(signedTarget.artifactNames),
    baseUrl,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
    requests,
    targetBytes: signedTarget.bytes,
    version: signedTarget.version
  };
}

function readEvents(eventPath) {
  const history = `${eventPath}.jsonl`;
  if (!fs.existsSync(history)) return [];
  return fs.readFileSync(history, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
}

async function waitForEvent(eventPath, accepted, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readEvents(eventPath).find((candidate) => accepted.has(candidate.name));
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for updater event: ${[...accepted].join(', ')}.`);
}

function installedPackageVersion(executable) {
  const archivePath = path.join(path.dirname(executable), 'resources', 'app.asar');
  asar.uncache(archivePath);
  return JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8')).version;
}

function installedPackageDigest(executable) {
  return digest(path.join(path.dirname(executable), 'resources', 'app.asar'));
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function stopPid(pid) {
  if (!isPidAlive(pid)) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8'
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && isPidAlive(pid)) {
      throw new Error(`Could not stop updater process ${pid}: ${result.stderr.trim()}`);
    }
  } else {
    process.kill(pid);
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && isPidAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isPidAlive(pid)) throw new Error(`Updater process ${pid} did not stop.`);
}

function windowsProcessIdsWithin(directory) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        '$root = $env:CAUL_AUDIT_DIRECTORY;',
        '$processes = @(Get-CimInstance Win32_Process |',
        'Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } |',
        'Select-Object -ExpandProperty ProcessId);',
        'ConvertTo-Json -Compress -InputObject $processes'
      ].join(' ')
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CAUL_AUDIT_DIRECTORY: `${path.resolve(directory)}${path.sep}`
      }
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not inspect Windows updater processes: ${result.stderr.trim()}`);
  }
  const parsed = JSON.parse(result.stdout.trim() || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function findExactlyOne(root, predicate, label) {
  const matches = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && predicate(candidate)) matches.push(candidate);
    }
  };
  walk(root);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
  return matches[0];
}

function waitForPathRemoval(target, { intervalMs = 250, timeoutMs = 90_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (fs.existsSync(target)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for the native uninstaller to remove ${target}.`);
    }
    Atomics.wait(waitBuffer, 0, 0, Math.min(intervalMs, remaining));
  }
}

function windowsDocumentsDirectory() {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath("MyDocuments")'],
    { encoding: 'utf8' }
  );
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error('Could not resolve the Windows Documents directory.');
  }
  return result.stdout.trim();
}

function documentsDirectory() {
  if (process.platform === 'win32') return windowsDocumentsDirectory();
  const xdg = spawnSync('xdg-user-dir', ['DOCUMENTS'], { encoding: 'utf8' });
  return xdg.status === 0 && xdg.stdout.trim()
    ? xdg.stdout.trim()
    : path.join(os.homedir(), 'Documents');
}

function restrictedEnvironment(overrides) {
  const allowed = process.platform === 'win32'
    ? [
      'ALLUSERSPROFILE', 'APPDATA', 'CommonProgramFiles', 'CommonProgramW6432',
      'ComSpec', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS',
      'OS', 'Path', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'ProgramData',
      'ProgramFiles', 'ProgramW6432', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP',
      'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'windir'
    ]
    : [
      'DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'HOME', 'LANG', 'LC_ALL', 'PATH',
      'SHELL', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'XAUTHORITY'
    ];
  return Object.fromEntries([
    ...allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []),
    ...Object.entries(overrides).filter(([, value]) => value !== undefined)
  ]);
}

function windowsAuditProfileDirectories(temporaryRoot) {
  return {
    appData: path.join(temporaryRoot, 'windows-profile', 'roaming'),
    localAppData: path.join(temporaryRoot, 'windows-profile', 'local')
  };
}

async function waitForInstalledCandidate({
  candidateAsar,
  eventPath,
  executable,
  version,
  timeoutMs = 240_000
}) {
  const expectedDigest = candidateAsar ? digest(candidateAsar) : null;
  const deadline = Date.now() + timeoutMs;
  let lastVersion = '<unreadable>';
  let lastDigest = '<unreadable>';
  while (Date.now() < deadline) {
    const error = readEvents(eventPath).find((event) => event.name === 'error');
    if (error) throw new Error(`Native updater failed: ${error.message || '<missing error>'}`);
    try {
      lastVersion = installedPackageVersion(executable);
      lastDigest = installedPackageDigest(executable);
      if (lastVersion === version && (!expectedDigest || lastDigest === expectedDigest)) {
        return { digest: lastDigest, version: lastVersion };
      }
    } catch {
      // The installer may be replacing app.asar while this check runs.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for installed candidate ${version}; `
    + `last version ${lastVersion}, last app.asar SHA-256 ${lastDigest}.`
  );
}

function writeEvidence({
  arch,
  candidateDirectory,
  candidateMetadata,
  channel,
  credentialBytes,
  credentialPath,
  documentsMarkerBytes,
  documentsMarkerPath,
  eventPath,
  evidenceDirectory,
  failure,
  installed,
  platform,
  previousArtifact,
  rootPath,
  scenario,
  server,
  settingsBytes,
  settingsPath
}) {
  const staging = path.join(path.dirname(evidenceDirectory), `.caul-updater-evidence-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(
    path.join(staging, failure ? 'FAILURE.txt' : 'RESULT.txt'),
    failure
      ? `Native updater audit failed closed: ${failure.message || failure}\n`
      : scenario === 'valid'
        ? 'Native updater installed and relaunched the candidate while preserving Caul data and trust.\n'
        : `Native updater rejected ${scenario} while preserving the installed app, Caul data and trust.\n`
  );
  fs.writeFileSync(path.join(staging, 'ENVIRONMENT.txt'), [
    `Platform: ${platform}`,
    `Architecture: ${arch}`,
    `Channel: ${channel}`,
    `Scenario: ${scenario}`,
    `Previous artifact: ${path.basename(previousArtifact)}`,
    `Candidate metadata: ${path.basename(candidateMetadata)}`,
    `Candidate version: ${server?.version || '<not reached>'}`,
    'Trust: ephemeral loopback-only TUF test root',
    ''
  ].join('\n'));
  fs.copyFileSync(rootPath, path.join(staging, 'root.json'));
  fs.copyFileSync(candidateMetadata, path.join(staging, path.basename(candidateMetadata)));
  if (fs.existsSync(`${eventPath}.jsonl`)) {
    fs.copyFileSync(`${eventPath}.jsonl`, path.join(staging, 'updater-events.jsonl'));
  }
  if (server) {
    fs.writeFileSync(path.join(staging, 'REQUESTS.txt'), `${server.requests.join('\n')}\n`);
    fs.writeFileSync(path.join(staging, 'signed-update-target.yml'), server.targetBytes);
  }
  fs.writeFileSync(path.join(staging, 'MIGRATION.txt'), [
    `Verified installed version: ${installed?.version || '<not verified>'}`,
    `Verified installed package SHA-256: ${installed?.digest || '<not verified>'}`,
    `Settings before: ${createHash('sha256').update(settingsBytes).digest('hex')}`,
    `Settings after: ${fs.existsSync(settingsPath) ? digest(settingsPath) : '<missing>'}`,
    `Credential state before: ${createHash('sha256').update(credentialBytes).digest('hex')}`,
    `Credential state after: ${fs.existsSync(credentialPath) ? digest(credentialPath) : '<missing>'}`,
    `Documents project before: ${createHash('sha256').update(documentsMarkerBytes).digest('hex')}`,
    `Documents project after: ${fs.existsSync(documentsMarkerPath) ? digest(documentsMarkerPath) : '<missing>'}`,
    ''
  ].join('\n'));
  const packagePaths = [
    previousArtifact,
    ...fs.readdirSync(candidateDirectory)
      .map((name) => path.join(candidateDirectory, name))
      .filter((candidate) => fs.statSync(candidate).isFile())
  ];
  fs.writeFileSync(path.join(staging, 'PACKAGE_SHA256SUMS'), `${packagePaths
    .map((filePath) => `${digest(filePath)}  ${path.basename(filePath)}`)
    .sort()
    .join('\n')}\n`);
  const evidenceFiles = fs.readdirSync(staging).sort();
  fs.writeFileSync(path.join(staging, 'EVIDENCE_SHA256SUMS'), `${evidenceFiles
    .map((name) => `${digest(path.join(staging, name))}  ${name}`)
    .join('\n')}\n`);
  fs.renameSync(staging, evidenceDirectory);
}

async function main(argv = process.argv.slice(2)) {
  if (!['win32', 'linux'].includes(process.platform)) {
    throw new Error('Caul native updater tests require a matching Windows or Linux runner.');
  }
  const arch = option(argv, '--arch') || process.arch;
  const channel = option(argv, '--channel');
  const scenario = requireAuditScenario(option(argv, '--scenario') || 'valid');
  if (arch !== process.arch) {
    throw new Error(`Updater audit requires native ${arch}; current Node is ${process.arch}.`);
  }
  if (!['stable', 'beta'].includes(channel)) throw new Error('Updater audit channel must be stable or beta.');
  const candidateAsarArgument = option(argv, '--candidate-asar');
  const candidateAsar = candidateAsarArgument ? path.resolve(candidateAsarArgument) : null;
  const candidateDirectory = path.resolve(requiredOption(argv, '--candidate-directory'));
  const candidateMetadata = path.resolve(requiredOption(argv, '--candidate-metadata'));
  const evidenceDirectory = path.resolve(requiredOption(argv, '--evidence'));
  const previousArtifact = path.resolve(requiredOption(argv, '--previous-artifact'));
  const previousBlockmap = process.platform === 'win32'
    ? `${previousArtifact}.blockmap`
    : null;
  const privateKeyBundlePath = path.resolve(requiredOption(argv, '--private-key-bundle'));
  const rootPath = path.resolve(requiredOption(argv, '--root'));
  const targetName = requiredOption(argv, '--target-name');
  if (fs.existsSync(evidenceDirectory)) {
    throw new Error('Updater evidence directory must not already exist.');
  }
  for (const required of [
    candidateDirectory,
    candidateMetadata,
    previousArtifact,
    ...(previousBlockmap ? [previousBlockmap] : []),
    privateKeyBundlePath,
    rootPath,
    ...(candidateAsar ? [candidateAsar] : [])
  ]) {
    if (!fs.existsSync(required)) throw new Error(`Updater audit input is missing: ${required}`);
  }
  artifactName(targetName);

  const productName = channel === 'beta' ? 'Caul Beta' : 'Caul';
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caul-native-updater-'));
  const windowsProfile = process.platform === 'win32'
    ? windowsAuditProfileDirectories(temporaryRoot)
    : null;
  const userData = path.join(temporaryRoot, 'user-data');
  if (fs.existsSync(userData)) {
    throw new Error(`Native updater audit requires an unused user-data directory: ${userData}`);
  }
  const settingsPath = path.join(userData, 'settings', 'preservation-marker.json');
  const credentialPath = path.join(userData, 'credentials', 'preservation-marker.bin');
  const documentsMarkerPath = path.join(
    documentsDirectory(),
    'Caul',
    `updater-preservation-${process.pid}.caul-project.json`
  );
  const eventPath = path.join(temporaryRoot, 'events', 'updater.json');
  const settingsBytes = Buffer.from('{"schemaVersion":1,"updateAudit":"preserved"}\n');
  const credentialBytes = Buffer.from([0x43, 0x41, 0x55, 0x4c]);
  const documentsMarkerBytes = Buffer.from('{"schemaVersion":1,"name":"Preserved Caul project"}\n');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
  fs.mkdirSync(path.dirname(documentsMarkerPath), { recursive: true });
  fs.writeFileSync(settingsPath, settingsBytes);
  fs.writeFileSync(credentialPath, credentialBytes);
  fs.writeFileSync(documentsMarkerPath, documentsMarkerBytes);

  let child;
  let failure;
  let installed;
  let installedAppImage;
  let installedExecutable;
  let previousInstalledDigest;
  let server;
  try {
    if (process.platform === 'win32') {
      const installDirectory = path.join(temporaryRoot, 'install');
      if (fs.existsSync(installDirectory)) {
        throw new Error(`Native updater audit requires an unused install directory: ${installDirectory}`);
      }
      fs.mkdirSync(windowsProfile.appData, { recursive: true });
      fs.mkdirSync(windowsProfile.localAppData, { recursive: true });
      run(previousArtifact, windowsSilentInstallArguments(installDirectory), {
        env: restrictedEnvironment({
          APPDATA: windowsProfile.appData,
          LOCALAPPDATA: windowsProfile.localAppData
        })
      });
      installedExecutable = path.join(installDirectory, `${productName}.exe`);
      if (!fs.existsSync(installedExecutable)) {
        throw new Error(`The previous Windows package did not install ${productName}.`);
      }
      if (installedPackageVersion(installedExecutable) !== '0.0.1') {
        throw new Error('The synthetic previous Windows package has the wrong version.');
      }
      previousInstalledDigest = installedPackageDigest(installedExecutable);
    } else {
      installedAppImage = path.join(temporaryRoot, path.basename(previousArtifact));
      fs.copyFileSync(previousArtifact, installedAppImage);
      fs.chmodSync(installedAppImage, 0o755);
      installedExecutable = installedAppImage;
      previousInstalledDigest = digest(installedAppImage);
    }

    server = await createUpdateServer({
      candidateDirectory,
      candidateMetadata,
      privateKeyBundlePath,
      previousBlockmap,
      rootPath,
      scenario,
      targetName,
      temporaryRoot
    });
    const environment = restrictedEnvironment({
      APPIMAGE_EXTRACT_AND_RUN: process.platform === 'linux' ? '1' : undefined,
      CAUL_DISABLE_MODEL_AUTO_DOWNLOAD: '1',
      CAUL_E2E_EXPECT_VERSION: server.version,
      CAUL_E2E_INSTALL_UPDATE: '1',
      CAUL_TUF_TEST_REPOSITORY_URL: `${server.baseUrl}/tuf`,
      CAUL_UPDATE_TEST_MODE: '1',
      CAUL_UPDATER_DISABLE_DIFFERENTIAL_DOWNLOAD:
        process.platform === 'win32' && scenario === 'corrupt-payload' ? '1' : undefined,
      CAUL_UPDATER_EVENT_PATH: eventPath,
      CAUL_USER_DATA_DIR: userData,
      ...(windowsProfile ? {
        APPDATA: windowsProfile.appData,
        LOCALAPPDATA: windowsProfile.localAppData
      } : {})
    });
    child = spawn(installedExecutable, process.platform === 'linux' ? ['--no-sandbox'] : [], {
      env: environment,
      stdio: 'inherit'
    });
    const outcome = await waitForEvent(
      eventPath,
      new Set(['updated-runtime-launched', 'error']),
      updaterEventTimeoutMs(process.platform)
    );
    if (scenario === 'valid') {
      if (outcome.name === 'error') {
        throw new Error(`Native updater failed: ${outcome.message || '<missing error>'}`);
      }
      if (outcome.currentVersion !== server.version) {
        throw new Error(`Updated runtime reported ${outcome.currentVersion}, expected ${server.version}.`);
      }

      if (process.platform === 'win32') {
        installed = await waitForInstalledCandidate({
          candidateAsar,
          eventPath,
          executable: installedExecutable,
          version: server.version
        });
      } else {
        installed = {
          digest: digest(installedAppImage),
          version: server.version
        };
        const metadata = yaml.load(fs.readFileSync(candidateMetadata, 'utf8'));
        const candidateName = artifactName(metadata.files[0].url);
        if (installed.digest !== digest(path.join(candidateDirectory, candidateName))) {
          throw new Error('AppImage updater did not replace the installed bytes.');
        }
      }
    } else {
      if (outcome.name !== 'error') {
        throw new Error(`Native updater accepted ${scenario}.`);
      }
      const retainedDigest = process.platform === 'win32'
        ? installedPackageDigest(installedExecutable)
        : digest(installedAppImage);
      const retainedVersion = process.platform === 'win32'
        ? installedPackageVersion(installedExecutable)
        : '0.0.1';
      if (retainedVersion !== '0.0.1' || retainedDigest !== previousInstalledDigest) {
        throw new Error(`Native updater changed the installed app after rejecting ${scenario}.`);
      }
      installed = { digest: retainedDigest, version: retainedVersion };
    }

    if (!fs.readFileSync(settingsPath).equals(settingsBytes)) {
      throw new Error('Updater changed existing Caul settings.');
    }
    if (!fs.readFileSync(credentialPath).equals(credentialBytes)) {
      throw new Error('Updater changed existing Caul credential state.');
    }
    if (!fs.readFileSync(documentsMarkerPath).equals(documentsMarkerBytes)) {
      throw new Error('Updater changed an existing Caul project.');
    }
    const persistedRoot = path.join(userData, 'update-trust', 'metadata', 'root.json');
    if (!fs.readFileSync(persistedRoot).equals(fs.readFileSync(rootPath))) {
      throw new Error('Updated runtime did not retain its established TUF root trust.');
    }
    const eventNames = readEvents(eventPath).map((event) => event.name);
    const targetRequested = server.requests.includes(
      `/tuf/targets/${encodeURIComponent(targetName)}`
    );
    const assetRequested = server.requests.some((request) => request.startsWith('/assets/'));
    const packageRequestPaths = candidatePackageRequestPaths(
      server.artifactNames,
      server.version
    );
    const packageRequested = server.requests.some((request) => packageRequestPaths.has(request));
    if (scenario === 'wrong-signature') {
      if (targetRequested || assetRequested || eventNames.includes('update-available')) {
        throw new Error('Wrong-signature metadata progressed past TUF authentication.');
      }
    } else {
      if (!targetRequested) {
        throw new Error('Updater did not request the TUF-authenticated update metadata.');
      }
      if (!packageRequested) {
        throw new Error('Updater did not request a candidate package.');
      }
    }
    if (scenario === 'valid') {
      const expectedEvents = [
        'update-available',
        'update-downloaded',
        'updated-runtime-launched'
      ];
      let previousIndex = -1;
      for (const expectedEvent of expectedEvents) {
        const eventIndex = eventNames.indexOf(expectedEvent);
        if (eventIndex <= previousIndex) {
          throw new Error(
            `Updater lifecycle event ${expectedEvent} was missing or out of order: `
            + `${eventNames.join(', ')}.`
          );
        }
        previousIndex = eventIndex;
      }
    } else {
      if (eventNames.includes('update-downloaded') || eventNames.includes('updated-runtime-launched')) {
        throw new Error(`${scenario} reached an install or relaunch event.`);
      }
    }

    await stopPid(child?.pid);
    child = null;
    const smokeOutputPath = path.join(temporaryRoot, 'normal-launch-smoke.log');
    fs.rmSync(smokeOutputPath, { force: true });
    const smokeEnvironment = restrictedEnvironment({
      APPIMAGE_EXTRACT_AND_RUN: process.platform === 'linux' ? '1' : undefined,
      CAUL_DISABLE_MODEL_AUTO_DOWNLOAD: '1',
      CAUL_DISABLE_UPDATE_CHECKS: '1',
      CAUL_PACKAGED_LAUNCH_SMOKE_MS: '250',
      CAUL_SMOKE_OUTPUT_FILE: smokeOutputPath,
      CAUL_USER_DATA_DIR: userData
    });
    const smoke = spawnSync(
      installedExecutable,
      process.platform === 'linux' ? ['--no-sandbox'] : [],
      { encoding: 'utf8', env: smokeEnvironment, timeout: 30_000 }
    );
    const smokeFileOutput = fs.existsSync(smokeOutputPath)
      ? fs.readFileSync(smokeOutputPath, 'utf8')
      : '';
    const combinedSmoke = {
      ...smoke,
      stdout: [smoke.stdout, smokeFileOutput].filter(Boolean).join('\n')
    };
    const { validatePackagedLaunchProcessResult } = await import(
      './native-package-smoke-output.mjs'
    );
    try {
      validatePackagedLaunchProcessResult(
        process.platform === 'win32' ? 'windows' : 'linux',
        combinedSmoke
      );
    } catch (error) {
      throw new Error(
        `Updated package did not pass a normal packaged launch: `
        + `${error.message}`
      );
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    let cleanupFailure;
    try {
      await stopPid(child?.pid);
      if (server) await server.close();
      if (process.platform === 'win32' && installedExecutable) {
        const installDirectory = path.dirname(installedExecutable);
        if (fs.existsSync(installDirectory)) {
          for (const pid of windowsProcessIdsWithin(installDirectory)) await stopPid(pid);
          const uninstaller = findExactlyOne(
            installDirectory,
            (candidate) => /^uninstall.*\.exe$/i.test(path.basename(candidate)),
            'NSIS uninstaller'
          );
          run(uninstaller, ['/S']);
          waitForPathRemoval(installDirectory);
        }
      }
    } catch (error) {
      cleanupFailure = error;
      process.stderr.write(`Native updater cleanup failed: ${error.stack || error}\n`);
    }
    writeEvidence({
      arch,
      candidateDirectory,
      candidateMetadata,
      channel,
      credentialBytes,
      credentialPath,
      documentsMarkerBytes,
      documentsMarkerPath,
      eventPath,
      evidenceDirectory,
      failure: failure || cleanupFailure,
      installed,
      platform: process.platform,
      previousArtifact,
      rootPath,
      scenario,
      server,
      settingsBytes,
      settingsPath
    });
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250
    });
    fs.rmSync(documentsMarkerPath, { force: true });
    if (!failure && cleanupFailure) throw cleanupFailure;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  artifactName,
  candidatePackageRequestPaths,
  corruptedPayload,
  installedPackageDigest,
  installedPackageVersion,
  prepareSignedTarget,
  requireAuditScenario,
  resolveAuditAssetPath,
  updaterEventTimeoutMs,
  waitForInstalledCandidate,
  waitForPathRemoval,
  windowsAuditProfileDirectories,
  windowsSilentInstallArguments
};

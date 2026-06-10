#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { resolveVmProfile, listVmProfiles } from './vm/profiles.mjs';
import { createPowerShellEncodedArgs, getSshArgs, macGuestShellArgs, runCommand, runInteractive, runPrlctl, shellQuote } from './vm/commands.mjs';

const profileName = process.argv[2];
const expectedVersion = JSON.parse(await readText('package.json')).version;

if (process.argv.includes('--help') || !profileName) {
  console.log(`Usage: node scripts/vm-stage.mjs <${listVmProfiles().join('|')}>`);
  console.log('Stages an already-built package into the disposable VM release path and verifies its version.');
  process.exit(profileName ? 0 : 1);
}

const profile = resolveVmProfile(profileName);

if (profile.platform === 'macos') {
  await stageMacos(profile);
} else if (profile.platform === 'linux') {
  await stageLinux(profile);
} else if (profile.platform === 'win') {
  await stageWindows(profile);
} else {
  throw new Error(`Unsupported VM stage profile: ${profile.platform}`);
}

console.log(`caul-vm-stage ${JSON.stringify({
  ok: true,
  packagePath: profile.stagedPackagePath,
  packageVersion: expectedVersion,
  profile: profile.platform,
  vmName: profile.vmName
})}`);

async function stageMacos(profile) {
  await stat(profile.localPackagePath);
  await rm('/tmp/Caul.app.zip', { force: true });
  const zip = await runInteractive('ditto', ['-c', '-k', '--keepParent', profile.localPackagePath, '/tmp/Caul.app.zip']);
  if (!zip.ok) process.exit(zip.code ?? 1);

  const server = await startStaticFileServer('/tmp', 8765);
  try {
    const guestScript = [
      `mkdir -p ${shellQuote(path.posix.dirname(profile.stagedPackagePath))}`,
      `rm -rf ${shellQuote(profile.stagedPackagePath)} /tmp/Caul.app.zip`,
      'curl -fsSL http://10.211.55.2:8765/Caul.app.zip -o /tmp/Caul.app.zip',
      `ditto -x -k /tmp/Caul.app.zip ${shellQuote(path.posix.dirname(profile.stagedPackagePath))}`,
      `test -x ${shellQuote(`${profile.stagedPackagePath}/Contents/MacOS/Caul`)}`,
      `test -x ${shellQuote(profile.backendPath)}`
    ].join('\n');
    const staged = await runPrlctl(['exec', profile.vmName, ...macGuestShellArgs(guestScript)], {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024
    });

    if (!staged.ok) {
      console.error(staged.text);
      process.exit(1);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const version = await readMacosGuestVersion(profile);
  assertVersion(version, expectedVersion, profile);
}

async function stageLinux(profile) {
  const existingVersion = await tryReadLinuxGuestDebVersion(profile);

  if (existingVersion === expectedVersion) {
    return;
  }

  await runCommand('ssh', getSshArgs(profile, `mkdir -p ${shellQuote(profile.releaseDir)}`), { timeout: 15_000 });
  const vmBuiltPackage = `${profile.repoPath}/release/caul-arm64.deb`;
  const vmCopy = await runCommand('ssh', getSshArgs(profile, [
    `test -f ${shellQuote(vmBuiltPackage)}`,
    `cp ${shellQuote(vmBuiltPackage)} ${shellQuote(profile.stagedPackagePath)}`
  ].join(' && ')), { timeout: 60_000 });

  if (vmCopy.ok) {
    const version = await readLinuxGuestDebVersion(profile);
    assertVersion(version, expectedVersion, profile);
    return;
  }

  const copy = await runInteractive('scp', [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    `UserKnownHostsFile=${profile.knownHosts}`,
    profile.localPackagePath,
    `${profile.user}@${profile.host}:${profile.stagedPackagePath}`
  ]);
  if (!copy.ok) process.exit(copy.code ?? 1);
  const version = await readLinuxGuestDebVersion(profile);
  assertVersion(version, expectedVersion, profile);
}

async function stageWindows(profile) {
  const script = [
    `$release=${JSON.stringify(profile.releaseDir)}`,
    'if (!(Test-Path $release)) { New-Item -ItemType Directory -Force -Path $release | Out-Null }',
    `$src='\\\\Mac\\Home\\code\\caul\\${profile.localPackagePath.replaceAll('/', '\\')}'`,
    `$dst=${JSON.stringify(profile.stagedPackagePath)}`,
    'Copy-Item -Force $src $dst',
    `${JSON.stringify(expectedVersion)} | Set-Content -NoNewline "$dst.version"`
  ].join('\n');
  const staged = await runPrlctl(['exec', profile.vmName, ...createPowerShellEncodedArgs(script)], {
    timeout: 90_000,
    maxBuffer: 20 * 1024 * 1024
  });

  if (!staged.ok) {
    console.error(staged.text);
    process.exit(1);
  }

  const version = await readWindowsGuestVersion(profile);
  assertVersion(version, expectedVersion, profile);
}

async function readMacosGuestVersion(profile) {
  const result = await runPrlctl([
    'exec',
    profile.vmName,
    ...macGuestShellArgs(`/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' ${shellQuote(`${profile.stagedPackagePath}/Contents/Info.plist`)}`)
  ], { timeout: 15_000 });
  if (!result.ok) throw new Error(result.text);
  return result.stdout.trim();
}

async function readLinuxGuestDebVersion(profile) {
  const result = await runCommand('ssh', getSshArgs(profile, `dpkg-deb -f ${shellQuote(profile.stagedPackagePath)} Version`), { timeout: 15_000 });
  if (!result.ok) throw new Error(result.text);
  return result.stdout.trim();
}

async function tryReadLinuxGuestDebVersion(profile) {
  try {
    return await readLinuxGuestDebVersion(profile);
  } catch {
    return null;
  }
}

async function readWindowsGuestVersion(profile) {
  const result = await runPrlctl(['exec', profile.vmName, 'powershell.exe', '-NoProfile', '-Command', `Get-Content ${JSON.stringify(`${profile.stagedPackagePath}.version`)}`], { timeout: 15_000 });
  if (!result.ok) throw new Error(result.text);
  return result.stdout.trim();
}

function assertVersion(actual, expected, profile) {
  if (actual !== expected) {
    throw new Error(`${profile.platform} staged package version mismatch: expected ${expected}, got ${actual}`);
  }
}

async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

async function startStaticFileServer(directory, port) {
  const server = http.createServer(async (request, response) => {
    if (request.url !== '/Caul.app.zip') {
      response.writeHead(404);
      response.end();
      return;
    }
    createReadStream(path.join(directory, 'Caul.app.zip')).pipe(response);
  });
  await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
  return server;
}

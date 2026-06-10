#!/usr/bin/env node
import { resolveVmProfile, listVmProfiles } from './vm/profiles.mjs';
import { createPowerShellEncodedArgs, getSshArgs, runCommand, runInteractive, runPrlctl, shellQuote } from './vm/commands.mjs';

const profileName = process.argv[2];

if (process.argv.includes('--help') || !profileName) {
  console.log(`Usage: node scripts/vm-package.mjs <${listVmProfiles().join('|')}>`);
  console.log('Builds the platform package explicitly. Windows and Linux build inside disposable VM repos.');
  process.exit(profileName ? 0 : 1);
}

const profile = resolveVmProfile(profileName);

if (profile.platform === 'macos') {
  const build = await runInteractive('npm', ['run', 'dist:mac:arm']);
  process.exit(build.ok ? 0 : build.code ?? 1);
}

if (profile.platform === 'linux') {
  await syncLinuxSource(profile);
  const build = await runCommand('ssh', getSshArgs(profile, [
    `cd ${shellQuote(profile.repoPath)}`,
    'npm ci',
    profile.buildCommand,
    `mkdir -p ${shellQuote(profile.releaseDir)}`,
    `cp release/caul-arm64.deb ${shellQuote(profile.stagedPackagePath)}`
  ].join(' && ')), { timeout: 20 * 60_000, maxBuffer: 40 * 1024 * 1024 });

  if (!build.ok) {
    console.error(build.text);
    process.exit(1);
  }

  console.log('caul-vm-package linux');
  process.exit(0);
}

if (profile.platform === 'win') {
  await syncWindowsSource(profile);
  const buildScript = [
    '@echo off',
    'call "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat"',
    'set PATH=C:\\Users\\alex\\.cargo\\bin;%PATH%',
    `cd /d ${profile.repoPath}`,
    'npm ci',
    profile.buildCommand,
    `if not exist "${profile.releaseDir}" mkdir "${profile.releaseDir}"`,
    `copy /Y release\\Caul-windows-arm64-setup.exe "${profile.stagedPackagePath}"`,
    `powershell.exe -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version | Set-Content -NoNewline '${profile.stagedPackagePath}.version'"`
  ].join(' && ');
  const build = await runPrlctl(['exec', profile.vmName, 'cmd.exe', '/d', '/s', '/c', buildScript], {
    timeout: 25 * 60_000,
    maxBuffer: 40 * 1024 * 1024
  });

  if (!build.ok) {
    console.error(build.text);
    process.exit(1);
  }

  console.log('caul-vm-package win');
  process.exit(0);
}

throw new Error(`Unsupported VM package profile: ${profile.platform}`);

async function syncLinuxSource(profile) {
  await runCommand('ssh', getSshArgs(profile, `mkdir -p ${shellQuote(profile.repoPath)}`), { timeout: 15_000 });
  const result = await runInteractive('rsync', [
    '-a',
    '--delete',
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=target',
    '--exclude=release',
    '--exclude=release-dev',
    '--exclude=release-dev-private',
    '--exclude=dist',
    '--exclude=artifacts',
    '--exclude=.vite',
    '--exclude=.cache',
    '--exclude=native/macos-audio-helper/.build',
    '-e',
    `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=${profile.knownHosts}`,
    './',
    `${profile.user}@${profile.host}:${profile.repoPath}/`
  ]);

  if (!result.ok) {
    process.exit(result.code ?? 1);
  }
}

async function syncWindowsSource(profile) {
  const script = [
    "$src='\\\\Mac\\Home\\code\\caul'",
    `$dst=${JSON.stringify(profile.repoPath)}`,
    'if (!(Test-Path (Split-Path $dst))) { New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null }',
    'if (Test-Path $dst) { Remove-Item -Recurse -Force $dst -ErrorAction SilentlyContinue }',
    'robocopy $src $dst /MIR /XD .git node_modules target release release-dev release-dev-private dist artifacts .vite .cache ".build" /XF .DS_Store',
    'if ($LASTEXITCODE -le 7) { exit 0 } else { exit $LASTEXITCODE }'
  ].join('\n');
  const result = await runPrlctl(['exec', profile.vmName, ...createPowerShellEncodedArgs(script)], {
    timeout: 10 * 60_000,
    maxBuffer: 40 * 1024 * 1024
  });

  if (!result.ok) {
    console.error(result.text);
    process.exit(1);
  }
}

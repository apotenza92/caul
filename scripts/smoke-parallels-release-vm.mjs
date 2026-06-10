import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  evaluateAudioIsolationGate,
  parseSmokeSummaryByType
} from './audio-isolation-gate.mjs';

const execFileAsync = promisify(execFile);
const transcriptionExpectedPhrase = 'Caul release transcription smoke. Local transcription emits confirmed text.';

const profiles = {
  fedora: {
    os: 'linux',
    packageType: 'rpm',
    defaultName: 'Fedora 42 ARM64',
    envName: 'CAUL_FEDORA_VM_NAME',
    packageEnv: 'CAUL_FEDORA_PACKAGE_PATH',
    repoEnv: 'CAUL_FEDORA_VM_REPO',
    defaultRepo: '/root/caul-rpm-build',
    defaultPackagePath: '/root/caul-rpm-build/release/caul-arm64.rpm',
    userEnv: 'CAUL_FEDORA_VM_SSH_USER',
    defaultUser: 'alex',
    hostEnv: 'CAUL_FEDORA_VM_SSH_HOST',
    defaultHost: '10.211.55.16',
    knownHostsEnv: 'CAUL_FEDORA_VM_KNOWN_HOSTS',
    defaultKnownHosts: '/tmp/caul_fedora_known_hosts',
    modelEnv: 'CAUL_FEDORA_PARAKEET_MODEL_DIR',
    defaultModelDir: '/home/alex/.local/share/com.pais.handy/models/parakeet-tdt-0.6b-v3-int8',
    installEnv: 'CAUL_FEDORA_INSTALL_COMMAND',
    defaultInstallCommand: 'dnf install -y',
    packageInstallOnly: true,
    transport: 'prlctl'
  },
  linux: {
    os: 'linux',
    packageType: 'deb',
    defaultName: 'Ubuntu 24.04.3 ARM64',
    envName: 'CAUL_LINUX_VM_NAME',
    packageEnv: 'CAUL_LINUX_PACKAGE_PATH',
    repoEnv: 'CAUL_LINUX_VM_REPO',
    defaultRepo: '/home/parallels/caul-cross-platform',
    defaultPackagePath: '/home/parallels/caul-cross-platform/release/caul-arm64.deb',
    userEnv: 'CAUL_LINUX_VM_SSH_USER',
    defaultUser: 'parallels',
    hostEnv: 'CAUL_LINUX_VM_SSH_HOST',
    defaultHost: '10.211.55.12',
    knownHostsEnv: 'CAUL_LINUX_VM_KNOWN_HOSTS',
    defaultKnownHosts: '/tmp/caul_known_hosts',
    modelEnv: 'CAUL_LINUX_PARAKEET_MODEL_DIR',
    defaultModelDir: '/home/parallels/.local/share/com.pais.handy/models/parakeet-tdt-0.6b-v3-int8'
  },
  win: {
    defaultName: 'Windows 11 ARM',
    envName: 'CAUL_WINDOWS_VM_NAME',
    packageEnv: 'CAUL_WINDOWS_PACKAGE_PATH',
    repoEnv: 'CAUL_WINDOWS_VM_REPO',
    defaultRepo: 'C:\\Users\\alex\\caul-cross-platform',
    defaultPackagePath: 'C:\\Users\\alex\\caul-cross-platform\\release\\Caul-windows-arm64-setup.exe',
    modelEnv: 'CAUL_WINDOWS_PARAKEET_MODEL_DIR',
    defaultModelDir: 'C:\\Users\\alex\\AppData\\Roaming\\com.pais.handy\\models\\parakeet-tdt-0.6b-v3-int8'
  }
};

const profileName = process.argv[2];
const profile = profiles[profileName];

if (!profile) {
  console.error('Usage: node scripts/smoke-parallels-release-vm.mjs <win|linux|fedora>');
  process.exit(1);
}

const vmName = process.env[profile.envName] ?? profile.defaultName;
const packagePath = process.env[profile.packageEnv] ?? profile.defaultPackagePath;
const keepVmE2eBuilds = process.env.CAUL_VM_E2E_KEEP_BUILDS === '1';
const killLinuxBackendProcessesCommand = "ps -eo pid,args | awk '/caul-desktop-backend/ && !/awk/ { print $1 }' | xargs -r kill -9 >/dev/null 2>&1 || true";

function powershellEncodedArgs(script) {
  return [
    'powershell.exe',
    '-NoProfile',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ];
}

async function writeVmE2eSummary(profile, summary) {
  const summaryDir = path.join(process.cwd(), 'artifacts', 'vm-e2e');
  await mkdir(summaryDir, { recursive: true });
  await writeFile(path.join(summaryDir, `${profile}.json`), `${JSON.stringify(summary, null, 2)}\n`);
}

async function failVmE2e(message, {
  blocked = false,
  details = '',
  gates = {},
  packagePath: failedPackagePath = packagePath
} = {}) {
  const summary = {
    blocked,
    details,
    error: message,
    gates: {
      ai: false,
      audioIsolation: false,
      install: false,
      microphone: false,
      onboarding: false,
      privacy: false,
      systemAudio: false,
      transcription: false,
      ...gates
    },
    ok: false,
    packagePath: failedPackagePath,
    profile: profileName,
    vmName
  };

  await writeVmE2eSummary(profileName, summary);
  console.error(message);

  if (details) {
    console.error(details);
  }

  console.error(`caul-vm-e2e ${JSON.stringify(summary)}`);
  process.exit(1);
}

async function runPrlctl(args, options = {}) {
  try {
    const result = await execFileAsync('prlctl', args, {
      timeout: options.timeout ?? 15_000,
      maxBuffer: 5 * 1024 * 1024
    });

    return {
      ok: true,
      text: result.stdout.trim()
    };
  } catch (error) {
    return {
      ok: false,
      text: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim()
    };
  }
}

function extractValue(text, label) {
  const line = text.split('\n').find((candidate) => candidate.trim().startsWith(label));

  return line ? line.split(':').slice(1).join(':').trim() : 'unknown';
}

const info = await runPrlctl(['list', vmName, '-i']);

if (!info.ok) {
  await failVmE2e(`Could not inspect Parallels VM "${vmName}".`, {
    blocked: true,
    details: info.text
  });
}

const state = extractValue(info.text, 'State');
const guestTools = extractValue(info.text, 'GuestTools');
const ipAddresses = extractValue(info.text, 'IP Addresses');
const guestToolsReady = /\bstate=(?:installed|possibly_installed)\b/.test(guestTools);
const ready = state === 'running' && (profile.os === 'linux' || guestToolsReady);

if (!ready) {
  await failVmE2e(`VM release smoke blocked for "${vmName}".`, {
    blocked: true,
    details: [
      `State: ${state}`,
      `Guest Tools: ${guestTools}`,
      `IP Addresses: ${ipAddresses || 'none'}`,
      `Start the VM, install Parallels Tools if needed, then rerun npm run vm:smoke:${profileName}.`
    ].join('\n')
  });
}

if (!packagePath) {
  await failVmE2e(`${profile.packageEnv} must point to a packaged Caul artefact before vm:smoke:${profileName} can run.`, {
    blocked: true,
    details: 'This smoke is intentionally packaged-app gated, not a Vite-only reachability check.'
  });
}

if (profile.os === 'linux') {
  await runLinuxPackageSmoke();
  process.exit(0);
}

if (profileName === 'win') {
  await muteWindowsVmAudio();
  await runWindowsPackageSmoke();
  process.exit(0);
}

console.log(`VM: ${vmName}`);
console.log(`Profile: ${profileName}`);
console.log(`Guest IP Addresses: ${ipAddresses || 'not reported by prlctl'}`);
console.log(`Package artefact: ${packagePath}`);
console.log('Packaged install and audio E2E automation still needs to be implemented for this VM profile.');
process.exit(1);

async function runWindowsPackageSmoke() {
  const repoPath = process.env[profile.repoEnv] ?? profile.defaultRepo;
  const installation = await prepareWindowsPackageForSmoke();
  const { appExe, backendPath, uninstallDisplayName } = installation;

  const audioProbe = await runWindowsSystemAudioSmoke(backendPath);
  const summary = audioProbe.summary;

  if (!meetsMinimumAudioGate(summary)) {
    await failVmE2e('Windows packaged backend smoke did not meet the minimum capture gate.', {
      details: audioProbe.text,
      gates: { install: true }
    });
  }

  const systemRestartProbe = await runWindowsSystemRestartSmoke(backendPath);
  const systemRestartSmoke = systemRestartProbe.smoke;

  if (!systemRestartSmoke.ok) {
    await failVmE2e('Windows packaged system-audio restart smoke failed.', {
      details: systemRestartProbe.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const systemRestartSummary = parseCaptureRestartSmokeSummary(systemRestartSmoke.text, 'system');

  if (!meetsMinimumRestartGate(systemRestartSummary)) {
    await failVmE2e('Windows packaged system-audio restart smoke did not meet the minimum restart gate.', {
      details: systemRestartProbe.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const microphoneSmoke = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    `${cmdQuote(backendPath)} --stream-microphone --duration 3 --smoke-summary`
  ], { timeout: 30_000 });

  if (!microphoneSmoke.ok) {
    await failVmE2e('Windows packaged microphone smoke failed.', {
      details: microphoneSmoke.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const microphoneSummary = parseMicrophoneSmokeSummary(microphoneSmoke.text);

  if (!meetsMinimumMicrophoneGate(microphoneSummary)) {
    await failVmE2e('Windows packaged microphone smoke did not meet the minimum capture gate.', {
      details: microphoneSmoke.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const microphoneRestartSmoke = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    `${cmdQuote(backendPath)} --capture-restart-smoke --source microphone --duration 2`
  ], { timeout: 30_000 });

  if (!microphoneRestartSmoke.ok) {
    await failVmE2e('Windows packaged microphone restart smoke failed.', {
      details: microphoneRestartSmoke.text,
      gates: { install: true, microphone: true, systemAudio: true }
    });
  }

  const microphoneRestartSummary = parseCaptureRestartSmokeSummary(microphoneRestartSmoke.text, 'microphone');

  if (!meetsMinimumRestartGate(microphoneRestartSummary)) {
    await failVmE2e('Windows packaged microphone restart smoke did not meet the minimum restart gate.', {
      details: microphoneRestartSmoke.text,
      gates: { install: true, microphone: true, systemAudio: true }
    });
  }

  const audioIsolationSummary = await runWindowsAudioIsolationSmoke(backendPath, summary);

  if (!audioIsolationSummary.ok) {
    await failVmE2e('Windows packaged audio isolation smoke detected output leaking into microphone capture.', {
      details: audioIsolationSummary.details,
      gates: { install: true, microphone: true, systemAudio: true }
    });
  }

  const transcriptionSummary = await runWindowsTranscriptionSmoke(repoPath, backendPath);
  const rendererSummary = await runWindowsRendererTranscriptionSmoke(appExe);
  const aiSummary = await runWindowsRendererAiSmoke(appExe);
  const privacyCaptureSummary = await runWindowsExternalPrivacyCaptureSmoke(appExe);

  const launchSmoke = await runPrlctl([
    'exec',
    vmName,
    '--current-user',
    ...powershellEncodedArgs([
      '$userData = Join-Path $env:TEMP "caul-win-launch-smoke"',
      'Get-Process caul -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
      'Start-Sleep -Milliseconds 500',
      'Remove-Item -Force -Recurse $userData -ErrorAction SilentlyContinue',
      'New-Item -ItemType Directory -Force -Path $userData | Out-Null',
      '$smokeOutputFile = Join-Path $userData "smoke-output.log"',
      '$env:CAUL_PACKAGED_LAUNCH_SMOKE_MS = "250"',
      '$env:CAUL_PACKAGED_LAUNCH_SMOKE_REQUIRE_ONBOARDING = "1"',
      '$env:CAUL_PACKAGED_PRIVACY_SMOKE = "1"',
      '$env:CAUL_PACKAGED_ONBOARDING_COMPLETION_SMOKE = "1"',
      '$env:CAUL_PACKAGED_UPDATER_SMOKE = "1"',
      '$env:CAUL_DISABLE_MODEL_AUTO_DOWNLOAD = "1"',
      '$env:CAUL_DISABLE_UPDATE_CHECKS = "1"',
      '$env:CAUL_ONBOARDING_MODEL_CATALOGUE_REFRESH_TIMEOUT_MS = "250"',
      '$env:CAUL_RENDERER_TRANSCRIPTION_SMOKE_FAKE_BACKEND = "1"',
      '$env:CAUL_USER_DATA_DIR = $userData',
      '$env:CAUL_SMOKE_OUTPUT_FILE = $smokeOutputFile',
      `$appPath = ${powershellString(appExe)}`,
      '& $appPath',
      'if (Test-Path $smokeOutputFile) { Get-Content $smokeOutputFile }'
    ].join('; '))
  ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });

  if (!launchSmoke.ok || !launchSmoke.text.includes('caul-packaged-launch-smoke')) {
    await failVmE2e('Windows packaged Electron launch smoke failed.', {
      details: launchSmoke.text,
      gates: { ai: true, audioIsolation: true, install: true, microphone: true, systemAudio: true, transcription: true }
    });
  }

  const launchSummary = parsePrefixedJson(launchSmoke.text, 'caul-packaged-launch-smoke');
  const launchPrivacyLeakFree = launchSummary?.privacy
    && (launchSummary.privacy.mainHttpRequests?.length ?? 0) === 0
    && (launchSummary.privacy.rendererHttpRequests?.length ?? 0) === 0
    && (launchSummary.privacy.rawAudioFiles?.length ?? 0) === 0
    && (launchSummary.privacy.transcriptDebugFiles?.length ?? 0) === 0;
  const windowsPrivacyOk = Boolean(launchPrivacyLeakFree && privacyCaptureSummary.ok === true);
  const updatesOk = launchSummary?.updates?.ok === true;

  const onboardingGuiClickOk = launchSummary.completion?.clicked === true
    && launchSummary.completion?.clickMethod === 'electron-input-event'
    && launchSummary.completion?.click?.ok === true;

  if (launchSummary?.isPackaged !== true || launchSummary.hasOnboarding !== true || !windowsPrivacyOk || launchSummary.completion?.ok !== true || !onboardingGuiClickOk || !updatesOk) {
    await failVmE2e('Windows packaged Electron launch smoke did not prove a packaged onboarding launch and completion.', {
      details: [
        launchSmoke.text,
        `externalPrivacyCapture=${JSON.stringify(privacyCaptureSummary)}`
      ].join('\n'),
      gates: {
        ai: true,
        audioIsolation: true,
        install: launchSummary?.isPackaged === true,
        microphone: true,
        onboarding: Boolean(launchSummary?.hasOnboarding && launchSummary?.completion?.ok && onboardingGuiClickOk),
        privacy: windowsPrivacyOk,
        systemAudio: true,
        transcription: true,
        updates: updatesOk
      }
    });
  }

  console.log(`VM: ${vmName}`);
  console.log(`Profile: ${profileName}`);
  console.log(`Guest IP Addresses: ${ipAddresses || 'not reported by prlctl'}`);
  console.log(`Package artefact: ${packagePath}`);
  console.log(`Installed app: ${appExe}`);
  console.log(`Windows Apps display name: ${uninstallDisplayName}`);
  console.log(`Packaged backend: ${backendPath}`);
  console.log(`Audio frames: ${summary.audio_frames}`);
  console.log(`Level events: ${summary.level_events}`);
  console.log(`Detected non-zero audio: ${meetsMinimumAudioGate(summary) ? 'yes' : 'no'} (max level ${formatLevel(summary.max_level)})`);
  console.log(`System audio restart: ${formatRestartSummary(systemRestartSummary)}`);
  console.log(`Microphone frames: ${microphoneSummary.audio_frames}`);
  console.log(`Microphone level events: ${microphoneSummary.level_events}`);
  console.log(`Detected microphone input: ${meetsMinimumMicrophoneGate(microphoneSummary) ? 'yes' : 'no'} (max level ${formatLevel(microphoneSummary.max_level)})`);
  console.log(`Microphone restart: ${formatRestartSummary(microphoneRestartSummary)}`);
  console.log(`Audio isolation: ${formatAudioIsolationSummary(audioIsolationSummary)}`);
  console.log(`Local transcription: ${formatTranscriptionSummary(transcriptionSummary)}`);
  console.log(`Renderer transcription: ${formatRendererTranscriptionSummary(rendererSummary)}`);
  console.log(`AI response: ${formatRendererAiSummary(aiSummary)}`);
  console.log(`Launch surface: ${launchSummary.surface}`);
  console.log(`Pre-setup privacy: ${formatPrivacySummary(launchSummary.privacy)}`);
  console.log(`External privacy capture: ${formatExternalPrivacyCaptureSummary(privacyCaptureSummary)}`);
  console.log(`Onboarding completion: ${formatCompletionSummary(launchSummary.completion)}`);
  const vmE2eSummary = {
    aiResponse: aiSummary,
    gates: {
      ai: true,
      audioIsolation: true,
      install: true,
      microphone: true,
      onboarding: true,
      privacy: true,
      systemAudio: true,
      transcription: true,
      updates: true
    },
    ok: true,
    onboarding: {
      clickMethod: launchSummary.completion?.clickMethod ?? null,
      click: launchSummary.completion?.click ?? null,
      ok: onboardingGuiClickOk
    },
    packagePath,
    profile: profileName,
    rendererTranscription: {
      guiClickMode: rendererSummary.guiClickMode === true,
      guiClickCount: Array.isArray(rendererSummary.guiClicks) ? rendererSummary.guiClicks.length : 0,
      guiClicksOk: Array.isArray(rendererSummary.guiClicks)
        && rendererSummary.guiClicks.length >= 3
        && rendererSummary.guiClicks.every((click) => click?.ok === true),
      guiClicks: rendererSummary.guiClicks ?? [],
      ok: rendererSummary.detected === true
    },
    vmName
  };

  const cleanup = await cleanupWindowsPackageSmoke(installation);

  if (!cleanup.ok) {
    await failVmE2e('Windows VM E2E cleanup failed after a successful smoke run.', {
      details: cleanup.text,
      gates: vmE2eSummary.gates
    });
  }

  vmE2eSummary.cleanup = cleanup.summary;
  await writeVmE2eSummary(profileName, vmE2eSummary);
  console.log(`caul-vm-e2e ${JSON.stringify(vmE2eSummary)}`);
}

async function muteWindowsVmAudio() {
  const signature = '[DllImport("winmm.dll")] public static extern int waveOutSetVolume(System.IntPtr hwo, uint dwVolume);';
  const mute = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      `$signature = ${powershellString(signature)}`,
      'Add-Type -Namespace Caul -Name VmAudio -MemberDefinition $signature',
      '[Caul.VmAudio]::waveOutSetVolume([IntPtr]::Zero, 0) | Out-Null',
      'Write-Output "caul-vm-audio-muted windows"'
    ].join('; '))
  ], { timeout: 15_000, maxBuffer: 1024 * 1024 });

  if (!mute.ok) {
    console.warn(`Windows VM audio mute failed: ${mute.text}`);
  }
}

async function cleanupWindowsPackageSmoke(installation) {
  if (keepVmE2eBuilds) {
    const summary = { kept: true, reason: 'CAUL_VM_E2E_KEEP_BUILDS=1' };
    console.log(`Windows cleanup: skipped (${summary.reason})`);
    return { ok: true, summary, text: '' };
  }

  if (!installation.installedFromSetup && !isDisposableWindowsPackagePath(packagePath)) {
    const summary = {
      appRoot: path.win32.dirname(installation.appExe),
      kept: true,
      reason: 'shared unpacked package path',
      removedAppRoot: false,
      removedPackagePath: false
    };
    console.log(`Windows cleanup: skipped (${summary.reason})`);
    return { ok: true, summary, text: '' };
  }

  const cleanup = await runPrlctl([
    'exec',
    vmName,
    '--current-user',
    ...powershellEncodedArgs([
      '$ErrorActionPreference = "Stop"',
      `$appExe = ${powershellString(installation.appExe)}`,
      `$packagePath = ${powershellString(packagePath)}`,
      `$installedFromSetup = ${installation.installedFromSetup ? '$true' : '$false'}`,
      '$appRoot = Split-Path -Parent $appExe',
      'Get-Process Caul -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
      '$removedAppRoot = $false',
      '$removedPackagePath = $false',
      'if ($installedFromSetup) {',
      '  $uninstaller = Join-Path $appRoot "Uninstall Caul.exe"',
      '  if (Test-Path $uninstaller) {',
      '    $uninstall = Start-Process -PassThru -Wait -FilePath $uninstaller -ArgumentList "/S"',
      '    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstall.ExitCode)" }',
      '  }',
      '  if (Test-Path $appRoot) { Remove-Item -Force -Recurse $appRoot -ErrorAction SilentlyContinue }',
      '  $removedAppRoot = -not (Test-Path $appRoot)',
      '} else {',
      '  $caulCurrent = Join-Path $env:USERPROFILE "caul-current"',
      '  $disposableDirectory = $appRoot.StartsWith($caulCurrent, [System.StringComparison]::OrdinalIgnoreCase) -or $appRoot.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)',
      '  if ($disposableDirectory -and (Test-Path $appRoot)) {',
      '    Remove-Item -Force -Recurse $appRoot',
      '    $removedAppRoot = $true',
      '  }',
      '}',
      '$packageIsDisposable = $packagePath.StartsWith((Join-Path $env:USERPROFILE "caul-current"), [System.StringComparison]::OrdinalIgnoreCase) -or $packagePath.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)',
      'if ($packageIsDisposable -and (Test-Path $packagePath)) {',
      '  Remove-Item -Force -Recurse $packagePath',
      '  $removedPackagePath = $true',
      '}',
      '$summary = New-Object psobject -Property @{ kept = $false; removedAppRoot = $removedAppRoot; removedPackagePath = $removedPackagePath; appRoot = $appRoot }',
      'Write-Output ("caul-windows-cleanup " + ($summary | ConvertTo-Json -Compress))'
    ].join('; '))
  ], { timeout: 20_000, maxBuffer: 10 * 1024 * 1024 });
  const summary = parsePrefixedJson(cleanup.text, 'caul-windows-cleanup') ?? {
    kept: false,
    raw: cleanup.text
  };

  if (cleanup.ok) {
    console.log(`Windows cleanup: ${JSON.stringify(summary)}`);
  }

  return { ok: cleanup.ok, summary, text: cleanup.text };
}

function isDisposableWindowsPackagePath(value) {
  const normalised = String(value).replace(/\//g, '\\').toLowerCase();
  return normalised.includes('\\appdata\\local\\temp\\')
    || normalised.includes('\\caul-current\\');
}

async function prepareWindowsPackageForSmoke() {
  const directoryPreparation = await prepareWindowsDirectoryPackageForSmoke();

  if (directoryPreparation) {
    return directoryPreparation;
  }

  const install = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      '$ErrorActionPreference = "Stop"',
      `$packagePath = ${powershellString(packagePath)}`,
      'if (!(Test-Path $packagePath)) { throw "Missing package artefact: $packagePath" }',
      '$isDirectory = (Get-Item $packagePath).PSIsContainer',
      '$appRoot = $null',
      'if ($isDirectory) {',
      '  $appRoot = $packagePath',
      '} else {',
      '  $packageItem = Get-Item $packagePath',
      '  if ($packageItem.Length -le 0) { throw "Package artefact is empty: $packagePath" }',
      '  Get-Process Caul -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
      '  $process = Start-Process -PassThru -Wait -FilePath $packagePath -ArgumentList "/S"',
      '  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)" }',
      '  $candidateRoots = @(',
      '    (Join-Path $env:LOCALAPPDATA "Programs\\Caul"),',
      '    (Join-Path $env:ProgramFiles "Caul")',
      '  )',
      '  $appRoot = $candidateRoots | Where-Object { Test-Path (Join-Path $_ "Caul.exe") } | Select-Object -First 1',
      '}',
      'if (!$appRoot) { throw "Installed Caul app root was not found." }',
      '$appExe = Join-Path $appRoot "Caul.exe"',
      '$backendPath = Join-Path $appRoot "resources\\bin\\caul-desktop-backend.exe"',
      'if (!(Test-Path $appExe)) { throw "Missing installed app executable: $appExe" }',
      'if (!(Test-Path $backendPath)) { throw "Missing installed backend: $backendPath" }',
      'if ($isDirectory) {',
      '  $summary = New-Object psobject -Property @{ appExe = $appExe; backendPath = $backendPath; installedFromSetup = $false; uninstallDisplayName = $null }',
      '  Write-Output ("caul-windows-install-smoke " + ($summary | ConvertTo-Json -Compress))',
      '  exit 0',
      '}',
      '$uninstallDisplayName = $null',
      'if (!$isDirectory) {',
      '  $uninstallRoots = @(',
      '    "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",',
      '    "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall"',
      '  )',
      '  foreach ($root in $uninstallRoots) {',
      '    if (!(Test-Path $root)) { continue }',
      '    $entry = Get-ChildItem $root | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq "Caul" -or $_.DisplayName -eq "Caul Beta" } | Select-Object -First 1',
      '    if ($entry) { $uninstallDisplayName = $entry.DisplayName; break }',
      '  }',
      '}',
      'if (!$isDirectory -and !$uninstallDisplayName) { throw "Could not find Caul product-only uninstall display name in Windows Apps registry entries." }',
      '$summary = New-Object psobject -Property @{ appExe = $appExe; backendPath = $backendPath; installedFromSetup = (-not $isDirectory); uninstallDisplayName = $uninstallDisplayName }',
      'Write-Output ("caul-windows-install-smoke " + ($summary | ConvertTo-Json -Compress))'
    ].join('; '))
  ], { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });

  const summary = parsePrefixedJson(install.text, 'caul-windows-install-smoke');

  if (!install.ok || !summary?.appExe || !summary?.backendPath) {
    await failVmE2e(`Windows packaged smoke failed while installing or validating ${packagePath}.`, {
      details: install.text
    });
  }

  if (summary.installedFromSetup && !['Caul', 'Caul Beta'].includes(summary.uninstallDisplayName)) {
    await failVmE2e('Windows Apps uninstall display name includes unexpected text.', {
      details: install.text
    });
  }

  return summary;
}

async function prepareWindowsDirectoryPackageForSmoke() {
  const directoryCheck = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      '$ErrorActionPreference = "Stop"',
      `$packagePath = ${powershellString(packagePath)}`,
      'if (!(Test-Path $packagePath)) { throw "Missing package artefact: $packagePath" }',
      '$packageItem = Get-Item $packagePath',
      'if (!$packageItem.PSIsContainer) { exit 0 }',
      '$appExe = Join-Path $packagePath "Caul.exe"',
      '$backendPath = Join-Path $packagePath "resources\\bin\\caul-desktop-backend.exe"',
      'if (!(Test-Path $appExe)) { throw "Missing unpacked app executable: $appExe" }',
      'if (!(Test-Path $backendPath)) { throw "Missing unpacked backend: $backendPath" }',
      '$summary = New-Object psobject -Property @{ appExe = $appExe; backendPath = $backendPath; installedFromSetup = $false; uninstallDisplayName = $null }',
      'Write-Output ("caul-windows-install-smoke " + ($summary | ConvertTo-Json -Compress))'
    ].join('; '))
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });

  const summary = parsePrefixedJson(directoryCheck.text, 'caul-windows-install-smoke');

  if (summary?.appExe && summary?.backendPath) {
    return summary;
  }

  if (!directoryCheck.ok) {
    await failVmE2e(`Windows packaged smoke failed while validating unpacked directory ${packagePath}.`, {
      details: directoryCheck.text
    });
  }

  return null;
}

async function runWindowsSystemAudioSmoke(backendPath) {
  const diagnostics = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    `${cmdQuote(backendPath)} --windows-audio-diagnostics`
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  const primary = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    `${cmdQuote(backendPath)} --stream-system-audio --duration 3 --smoke-summary --windows-wasapi-smoke-tone`
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  let text = [
    'windows-audio-diagnostics',
    diagnostics.text,
    'windows-system-audio-primary',
    primary.text
  ].join('\n');
  let summary = primary.ok ? parseSmokeSummary(primary.text) : null;

  if (meetsMinimumAudioGate(summary)) {
    return { summary, text };
  }

  const fallback = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      '$job = Start-Job -ScriptBlock {',
      '  try { [Console]::Beep(880, 2500) } catch { Write-Output $_.Exception.Message }',
      '}',
      `& ${powershellString(backendPath)} --stream-system-audio --duration 3 --smoke-summary`,
      'Wait-Job $job -Timeout 5 | Out-Null',
      'Receive-Job $job -ErrorAction SilentlyContinue',
      'Remove-Job $job -Force -ErrorAction SilentlyContinue'
    ].join('; '))
  ], { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });

  text = [
    text,
    'windows-system-audio-fallback',
    fallback.text
  ].join('\n');
  summary = fallback.ok ? parseSmokeSummary(fallback.text) : summary;

  return { summary, text };
}

async function runWindowsExternalPrivacyCaptureSmoke(appExe) {
  const capturePath = path.join(tmpdir(), `caul-win-privacy-${Date.now()}.png`);
  const probe = await runPrlctl([
    'exec',
    vmName,
    '--current-user',
    ...powershellEncodedArgs([
      '$userData = Join-Path $env:TEMP ("caul-external-privacy-" + [Guid]::NewGuid().ToString("N"))',
      'New-Item -ItemType Directory -Force -Path $userData | Out-Null',
      '$smokeOutputFile = Join-Path $userData "smoke-output.log"',
      '$env:CAUL_WINDOWS_EXTERNAL_CAPTURE_PROBE = "1"',
      '$env:CAUL_WINDOWS_EXTERNAL_CAPTURE_PROBE_MS = "12000"',
      '$env:CAUL_SMOKE_OUTPUT_FILE = $smokeOutputFile',
      `$process = Start-Process -PassThru -FilePath ${powershellString(appExe)}`,
      '$deadline = (Get-Date).AddSeconds(8)',
      'while ((Get-Date) -lt $deadline) { if ((Test-Path $smokeOutputFile) -and ((Get-Content $smokeOutputFile -Raw) -match "caul-windows-capture-probe")) { break }; Start-Sleep -Milliseconds 200 }',
      'if (Test-Path $smokeOutputFile) { Get-Content $smokeOutputFile }',
      'Write-Output ("PROBE_PID " + $process.Id)'
    ].join('; '))
  ], { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 });
  const probeSummary = parsePrefixedJson(probe.text, 'caul-windows-capture-probe');

  if (!probe.ok || !probeSummary?.ok) {
    return {
      details: probe.text,
      ok: false,
      type: 'windows_external_privacy_capture'
    };
  }

  try {
    await execFileAsync('prlctl', ['capture', vmName, '--file', capturePath], {
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024
    });
    const analysis = await analysePrivacyCapture(capturePath);
    const hostFramebuffer = {
      ...analysis,
      ok: analysis.greenPixelCount >= 1000 && analysis.redPixelCount < 1000,
      protectedExcluded: analysis.redPixelCount < 1000,
      controlVisible: analysis.greenPixelCount >= 1000
    };
    const internalCapture = probeSummary.internalCapture ?? null;
    const ok = internalCapture?.ok === true;

    return {
      capturePath,
      controlVisible: internalCapture?.controlVisible === true,
      hostFramebuffer,
      internalCapture,
      ok,
      probe: probeSummary,
      protectedExcluded: internalCapture?.protectedExcluded === true,
      type: 'windows_external_privacy_capture'
    };
  } catch (error) {
    return {
      error: error.message,
      ok: false,
      probe: probeSummary,
      type: 'windows_external_privacy_capture'
    };
  } finally {
    await unlink(capturePath).catch(() => {});
  }
}

async function analysePrivacyCapture(capturePath) {
  const image = sharp(capturePath).ensureAlpha();
  const metadata = await image.metadata();
  const pixels = await image.raw().toBuffer();
  let redPixelCount = 0;
  let greenPixelCount = 0;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;

    if (red > 220 && green < 35 && blue < 35) {
      redPixelCount += 1;
    }

    if (green > 220 && red < 35 && blue < 35) {
      greenPixelCount += 1;
    }
  }

  return {
    greenPixelCount,
    imageHeight: metadata.height,
    imageWidth: metadata.width,
    redPixelCount
  };
}

async function runWindowsSystemRestartSmoke(backendPath) {
  const primary = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    `${cmdQuote(backendPath)} --capture-restart-smoke --source system --duration 2 --windows-wasapi-smoke-tone`
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  let text = [
    'windows-system-restart-primary',
    primary.text
  ].join('\n');

  if (primary.ok && meetsMinimumRestartGate(parseCaptureRestartSmokeSummary(primary.text, 'system'))) {
    return { smoke: primary, text };
  }

  const fallback = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      '$job = Start-Job -ScriptBlock {',
      '  $deadline = (Get-Date).AddSeconds(6)',
      '  while ((Get-Date) -lt $deadline) {',
      '    try { [Console]::Beep(880, 300) } catch { Write-Output $_.Exception.Message; break }',
      '    Start-Sleep -Milliseconds 100',
      '  }',
      '}',
      `& ${powershellString(backendPath)} --capture-restart-smoke --source system --duration 2`,
      'Wait-Job $job -Timeout 7 | Out-Null',
      'Receive-Job $job -ErrorAction SilentlyContinue',
      'Remove-Job $job -Force -ErrorAction SilentlyContinue'
    ].join('; '))
  ], { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });

  text = [
    text,
    'windows-system-restart-fallback',
    fallback.text
  ].join('\n');

  return { smoke: fallback.ok ? fallback : primary, text };
}

async function runWindowsAudioIsolationSmoke(backendPath, systemDuringOutput) {
  const microphoneProbe = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      '$ErrorActionPreference = "Continue"',
      `$job = Start-Job -ScriptBlock { ${windowsSpeechPlaybackScript(2)} }`,
      'Start-Sleep -Milliseconds 250',
      `& ${powershellString(backendPath)} --stream-microphone --duration 3 --smoke-summary`,
      'Wait-Job $job -Timeout 8 | Out-Null',
      'Receive-Job $job -ErrorAction SilentlyContinue',
      'Remove-Job $job -Force -ErrorAction SilentlyContinue'
    ].join('; '))
  ], { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });
  const microphoneDuringOutput = microphoneProbe.ok
    ? parseMicrophoneSmokeSummary(microphoneProbe.text)
    : null;
  const gate = evaluateAudioIsolationGate({
    microphoneDuringOutput,
    systemDuringOutput
  });

  return {
    details: [
      `systemDuringOutput=${JSON.stringify(systemDuringOutput)}`,
      `microphoneDuringOutput=${JSON.stringify(microphoneDuringOutput)}`,
      `gate=${JSON.stringify(gate)}`,
      microphoneProbe.text
    ].join('\n'),
    gate,
    microphoneDuringOutput,
    ok: microphoneProbe.ok && gate.ok,
    systemDuringOutput
  };
}

async function runLinuxPackageSmoke() {
  const repoPath = process.env[profile.repoEnv] ?? profile.defaultRepo;
  const sshUser = process.env[profile.userEnv] ?? profile.defaultUser;
  const knownHosts = process.env[profile.knownHostsEnv] ?? profile.defaultKnownHosts;
  const ipAddress = process.env[profile.hostEnv]
    ?? ipAddresses.split(/[,\s]+/).find((candidate) => /^\d+\.\d+\.\d+\.\d+$/.test(candidate))
    ?? profile.defaultHost;

  if (!ipAddress) {
    await failVmE2e(`No IPv4 address reported for "${vmName}".`, {
      blocked: true
    });
  }

  await muteLinuxVmAudio(sshUser, ipAddress, knownHosts);

  const preflightCleanup = await runLinuxCommand(
    [
      'pkill -x caul >/dev/null 2>&1 || true',
      'pkill -x caul-desktop-backend >/dev/null 2>&1 || true',
      killLinuxBackendProcessesCommand,
      'pkill -x pw-record >/dev/null 2>&1 || true',
      'pkill -x pw-play >/dev/null 2>&1 || true'
    ].join(' && '),
    sshUser,
    ipAddress,
    knownHosts
  );

  if (!preflightCleanup.ok) {
    await failVmE2e('Linux VM E2E preflight cleanup failed.', {
      details: preflightCleanup.text
    });
  }

  const packageCheck = await runLinuxCommand(
    [
      `test -f ${shellQuote(packagePath)}`,
      linuxPackageMetadataCheck(packagePath),
      profile.packageInstallOnly
        ? null
        : `test -x ${shellQuote(`${repoPath}/release/linux-arm64-unpacked/resources/bin/caul-desktop-backend`)}`,
      profile.packageInstallOnly
        ? null
        : `file ${shellQuote(`${repoPath}/release/linux-arm64-unpacked/resources/bin/caul-desktop-backend`)} | grep -q 'ELF 64-bit.*ARM aarch64'`
    ].filter(Boolean).join(' && '),
    sshUser,
    ipAddress,
    knownHosts
  );

  if (!packageCheck.ok) {
    await failVmE2e(`Linux packaged smoke failed while validating ${packagePath}.`, {
      details: packageCheck.text
    });
  }

  const installCheck = profile.packageType === 'rpm'
    ? await runLinuxCommand(
        `${process.env[profile.installEnv] ?? profile.defaultInstallCommand} ${shellQuote(packagePath)}`,
        sshUser,
        ipAddress,
        knownHosts,
        { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 }
      )
    : await runPrlctl([
        'exec',
        vmName,
        '/usr/bin/dpkg',
        '-i',
        packagePath
      ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });

  if (!installCheck.ok) {
    await failVmE2e(`Linux packaged smoke failed while installing ${packagePath}.`, {
      details: installCheck.text
    });
  }

  if (profile.packageInstallOnly) {
    const installedCheck = await runLinuxCommand(
      [
        'rpm -q caul',
        "rpm -ql caul | grep -q '/opt/Caul/resources/bin/caul-desktop-backend$'",
        'test -x /opt/Caul/resources/bin/caul-desktop-backend'
      ].join(' && '),
      sshUser,
      ipAddress,
      knownHosts
    );

    if (!installedCheck.ok) {
      await failVmE2e('Linux RPM install smoke failed while validating the installed package.', {
        details: installedCheck.text
      });
    }

    console.log(`VM: ${vmName}`);
    console.log(`Profile: ${profileName}`);
    console.log(`Guest IP Addresses: ${ipAddresses || 'not reported by prlctl'}`);
    console.log(`Package artefact: ${packagePath}`);
    console.log('RPM install smoke: ok');
    const vmE2eSummary = {
      gates: {
        ai: false,
        audioIsolation: false,
        install: true,
        microphone: false,
        onboarding: false,
        privacy: false,
        systemAudio: false,
        transcription: false
      },
      ok: true,
      packagePath,
      profile: profileName,
      vmName
    };
    const cleanup = await cleanupLinuxPackageSmoke(repoPath);

    if (!cleanup.ok) {
      await failVmE2e('Linux VM E2E cleanup failed after a successful RPM install smoke run.', {
        details: cleanup.text,
        gates: vmE2eSummary.gates
      });
    }

    vmE2eSummary.cleanup = cleanup.summary;
    await writeVmE2eSummary(profileName, vmE2eSummary);
    console.log(`caul-vm-e2e ${JSON.stringify(vmE2eSummary)}`);
    return;
  }

  const backendPath = `${repoPath}/release/linux-arm64-unpacked/resources/bin/caul-desktop-backend`;
  const backendSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      linuxToneStimulusCommand('/tmp/caul-pw-play.log'),
      'sleep 0.3',
      `${shellQuote(backendPath)} --stream-system-audio --duration 3 --smoke-summary`
    ].join(' && '),
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!backendSmoke.ok) {
    await failVmE2e('Linux packaged backend smoke failed.', {
      details: backendSmoke.text,
      gates: { install: true }
    });
  }

  const summary = parseSmokeSummary(backendSmoke.text);

  if (!meetsMinimumAudioGate(summary)) {
    await failVmE2e('Linux packaged backend smoke did not meet the minimum capture gate.', {
      details: backendSmoke.text,
      gates: { install: true }
    });
  }

  const systemRestartSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      linuxToneStimulusCommand('/tmp/caul-pw-play-restart.log'),
      'sleep 0.3',
      `${shellQuote(backendPath)} --capture-restart-smoke --source system --duration 2`
    ].join(' && '),
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!systemRestartSmoke.ok) {
    await failVmE2e('Linux packaged system-audio restart smoke failed.', {
      details: systemRestartSmoke.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const systemRestartSummary = parseCaptureRestartSmokeSummary(systemRestartSmoke.text, 'system');

  if (!meetsMinimumRestartGate(systemRestartSummary)) {
    await failVmE2e('Linux packaged system-audio restart smoke did not meet the minimum restart gate.', {
      details: systemRestartSmoke.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const microphoneSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    `${shellQuote(backendPath)} --stream-microphone --duration 3 --smoke-summary`,
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!microphoneSmoke.ok) {
    await failVmE2e('Linux packaged microphone smoke failed.', {
      details: microphoneSmoke.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const microphoneSummary = parseMicrophoneSmokeSummary(microphoneSmoke.text);

  if (!meetsMinimumMicrophoneGate(microphoneSummary)) {
    await failVmE2e('Linux packaged microphone smoke did not meet the minimum capture gate.', {
      details: microphoneSmoke.text,
      gates: { install: true, systemAudio: true }
    });
  }

  const microphoneRestartSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    `${shellQuote(backendPath)} --capture-restart-smoke --source microphone --duration 2`,
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!microphoneRestartSmoke.ok) {
    await failVmE2e('Linux packaged microphone restart smoke failed.', {
      details: microphoneRestartSmoke.text,
      gates: { install: true, microphone: true, systemAudio: true }
    });
  }

  const microphoneRestartSummary = parseCaptureRestartSmokeSummary(microphoneRestartSmoke.text, 'microphone');

  if (!meetsMinimumRestartGate(microphoneRestartSummary)) {
    await failVmE2e('Linux packaged microphone restart smoke did not meet the minimum restart gate.', {
      details: microphoneRestartSmoke.text,
      gates: { install: true, microphone: true, systemAudio: true }
    });
  }

  const audioIsolationSummary = await runLinuxAudioIsolationSmoke(
    sshUser,
    ipAddress,
    knownHosts,
    backendPath,
    summary
  );

  if (!audioIsolationSummary.ok) {
    await failVmE2e('Linux packaged audio isolation smoke detected output leaking into microphone capture.', {
      details: audioIsolationSummary.details,
      gates: { install: true, microphone: true, systemAudio: true }
    });
  }

  const transcriptionSummary = await runLinuxTranscriptionSmoke(
    sshUser,
    ipAddress,
    knownHosts,
    backendPath
  );
  const rendererSummary = await runLinuxRendererTranscriptionSmoke(
    sshUser,
    ipAddress,
    knownHosts,
    repoPath
  );
  const aiSummary = await runLinuxRendererAiSmoke(
    sshUser,
    ipAddress,
    knownHosts
  );

  const launchUserData = '/tmp/caul-linux-launch-smoke-user-data';
  const launchSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      `rm -rf ${shellQuote(launchUserData)}`,
      `mkdir -p ${shellQuote(launchUserData)}`,
      `DISPLAY=:0 CAUL_PACKAGED_LAUNCH_SMOKE_MS=250 CAUL_PACKAGED_LAUNCH_SMOKE_REQUIRE_ONBOARDING=1 CAUL_PACKAGED_PRIVACY_SMOKE=1 CAUL_PACKAGED_ONBOARDING_COMPLETION_SMOKE=1 CAUL_PACKAGED_UPDATER_SMOKE=1 CAUL_DISABLE_MODEL_AUTO_DOWNLOAD=1 CAUL_DISABLE_UPDATE_CHECKS=1 CAUL_USER_DATA_DIR=${shellQuote(launchUserData)} /opt/Caul/caul`
    ].join(' && '),
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!launchSmoke.ok || !launchSmoke.text.includes('caul-packaged-launch-smoke')) {
    await failVmE2e('Linux packaged Electron launch smoke failed.', {
      details: launchSmoke.text,
      gates: { ai: true, audioIsolation: true, install: true, microphone: true, systemAudio: true, transcription: true }
    });
  }

  const launchSummary = parsePrefixedJson(launchSmoke.text, 'caul-packaged-launch-smoke');

  const onboardingGuiClickOk = launchSummary.completion?.clicked === true
    && launchSummary.completion?.clickMethod === 'electron-input-event'
    && launchSummary.completion?.click?.ok === true;

  if (!launchSummary?.ok || launchSummary.isPackaged !== true || launchSummary.hasOnboarding !== true || launchSummary.privacy?.ok !== true || launchSummary.completion?.ok !== true || !onboardingGuiClickOk || launchSummary.updates?.ok !== true) {
    await failVmE2e('Linux packaged Electron launch smoke did not prove a packaged onboarding launch and completion.', {
      details: launchSmoke.text,
      gates: {
        ai: true,
        audioIsolation: true,
        install: launchSummary?.isPackaged === true,
        microphone: true,
        onboarding: Boolean(launchSummary?.hasOnboarding && launchSummary?.completion?.ok && onboardingGuiClickOk),
        privacy: launchSummary?.privacy?.ok === true,
        systemAudio: true,
        transcription: true,
        updates: launchSummary?.updates?.ok === true
      }
    });
  }

  console.log(`VM: ${vmName}`);
  console.log(`Profile: ${profileName}`);
  console.log(`Guest IP Addresses: ${ipAddresses || 'not reported by prlctl'}`);
  console.log(`Package artefact: ${packagePath}`);
  console.log(`Packaged backend: ${backendPath}`);
  console.log(`Audio frames: ${summary.audio_frames}`);
  console.log(`Level events: ${summary.level_events}`);
  console.log(`Detected non-zero audio: ${meetsMinimumAudioGate(summary) ? 'yes' : 'no'} (max level ${formatLevel(summary.max_level)})`);
  console.log(`System audio restart: ${formatRestartSummary(systemRestartSummary)}`);
  console.log(`Microphone frames: ${microphoneSummary.audio_frames}`);
  console.log(`Microphone level events: ${microphoneSummary.level_events}`);
  console.log(`Detected microphone input: ${meetsMinimumMicrophoneGate(microphoneSummary) ? 'yes' : 'no'} (max level ${formatLevel(microphoneSummary.max_level)})`);
  console.log(`Microphone restart: ${formatRestartSummary(microphoneRestartSummary)}`);
  console.log(`Audio isolation: ${formatAudioIsolationSummary(audioIsolationSummary)}`);
  console.log(`Local transcription: ${formatTranscriptionSummary(transcriptionSummary)}`);
  console.log(`Renderer transcription: ${formatRendererTranscriptionSummary(rendererSummary)}`);
  console.log(`AI response: ${formatRendererAiSummary(aiSummary)}`);
  console.log(`Launch surface: ${launchSummary.surface}`);
  console.log(`Pre-setup privacy: ${formatPrivacySummary(launchSummary.privacy)}`);
  console.log(`Onboarding completion: ${formatCompletionSummary(launchSummary.completion)}`);
  const vmE2eSummary = {
    aiResponse: aiSummary,
    gates: {
      ai: true,
      audioIsolation: true,
      install: true,
      microphone: true,
      onboarding: true,
      privacy: true,
      systemAudio: true,
      transcription: true,
      updates: true
    },
    ok: true,
    onboarding: {
      clickMethod: launchSummary.completion?.clickMethod ?? null,
      click: launchSummary.completion?.click ?? null,
      ok: onboardingGuiClickOk
    },
    packagePath,
    profile: profileName,
    rendererTranscription: {
      guiClickMode: rendererSummary.guiClickMode === true,
      guiClickCount: Array.isArray(rendererSummary.guiClicks) ? rendererSummary.guiClicks.length : 0,
      guiClicksOk: Array.isArray(rendererSummary.guiClicks)
        && rendererSummary.guiClicks.length >= 3
        && rendererSummary.guiClicks.every((click) => click?.ok === true),
      guiClicks: rendererSummary.guiClicks ?? [],
      ok: rendererSummary.detected === true
    },
    vmName
  };
  const cleanup = await cleanupLinuxPackageSmoke(repoPath);

  if (!cleanup.ok) {
    await failVmE2e('Linux VM E2E cleanup failed after a successful smoke run.', {
      details: cleanup.text,
      gates: vmE2eSummary.gates
    });
  }

  vmE2eSummary.cleanup = cleanup.summary;
  await writeVmE2eSummary(profileName, vmE2eSummary);
  console.log(`caul-vm-e2e ${JSON.stringify(vmE2eSummary)}`);
}

async function muteLinuxVmAudio(sshUser, ipAddress, knownHosts) {
  const mute = await runLinuxCommand(
    [
      'wpctl set-volume @DEFAULT_AUDIO_SINK@ 0 2>/dev/null || pactl set-sink-volume @DEFAULT_SINK@ 0% 2>/dev/null || true',
      'wpctl set-mute @DEFAULT_AUDIO_SINK@ 1 2>/dev/null || pactl set-sink-mute @DEFAULT_SINK@ 1 2>/dev/null || true',
      'wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null || pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null || true'
    ].join(' && '),
    sshUser,
    ipAddress,
    knownHosts
  );

  if (!mute.ok) {
    console.warn(`Linux VM audio mute failed: ${mute.text}`);
  }
}

async function cleanupLinuxPackageSmoke(repoPath) {
  if (keepVmE2eBuilds) {
    const summary = { kept: true, reason: 'CAUL_VM_E2E_KEEP_BUILDS=1' };
    console.log(`Linux cleanup: skipped (${summary.reason})`);
    return { ok: true, summary, text: '' };
  }

  const packageIsShared = isSharedVmPath(packagePath);
  const repoIsShared = isSharedVmPath(repoPath);
  const buildCleanup = [];

  if (!packageIsShared) {
    buildCleanup.push(`rm -rf ${shellQuote(packagePath)}`);
  }

  if (!repoIsShared) {
    buildCleanup.push(
      `rm -rf ${shellQuote(`${repoPath}/release/linux-arm64-unpacked`)}`,
      `rm -rf ${shellQuote(`${repoPath}/artifacts/linux-renderer-transcription-smoke-user-data`)}`
    );
  }

  const uninstallCommand = profile.packageType === 'rpm'
    ? '(rpm -q caul >/dev/null 2>&1 && (dnf remove -y caul || rpm -e caul)) || true'
    : '(dpkg -s caul >/dev/null 2>&1 && dpkg -r caul) || true';
  const cleanupCommand = [
    'set -euo pipefail',
    'pkill -x caul >/dev/null 2>&1 || true',
    'pkill -x caul-desktop-backend >/dev/null 2>&1 || true',
    killLinuxBackendProcessesCommand,
    'pkill -x pw-record >/dev/null 2>&1 || true',
    'pkill -x pw-play >/dev/null 2>&1 || true',
    uninstallCommand,
    'pkill -x caul >/dev/null 2>&1 || true',
    'pkill -x caul-desktop-backend >/dev/null 2>&1 || true',
    killLinuxBackendProcessesCommand,
    'pkill -x pw-record >/dev/null 2>&1 || true',
    'pkill -x pw-play >/dev/null 2>&1 || true',
    'rm -rf /tmp/caul-linux-launch-smoke-user-data /tmp/caul-linux-renderer-ai-smoke',
    'rm -f /tmp/caul-known-16k.wav /tmp/caul-renderer-known-16k.wav /tmp/caul-audio-stimulus.wav',
    'rm -f /tmp/caul-pw-play*.log /tmp/caul-renderer-pw-play.log',
    'rm -f /var/crash/_opt_Caul_caul*.crash',
    ...buildCleanup,
    `printf 'caul-linux-cleanup {"kept":false,"packagePathRemoved":${packageIsShared ? 'false' : 'true'},"repoReleaseRemoved":${repoIsShared ? 'false' : 'true'}}\\n'`
  ].join('\n');
  const cleanup = await runPrlctl([
    'exec',
    vmName,
    '/bin/bash',
    '-lc',
    cleanupCommand
  ], { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 });
  const summary = parsePrefixedJson(cleanup.text, 'caul-linux-cleanup') ?? {
    kept: false,
    raw: cleanup.text,
    packagePathShared: packageIsShared,
    repoPathShared: repoIsShared
  };

  if (cleanup.ok) {
    console.log(`Linux cleanup: ${JSON.stringify(summary)}`);
  }

  return { ok: cleanup.ok, summary, text: cleanup.text };
}

function isSharedVmPath(value) {
  return /^\/(?:media\/psf|mnt\/hgfs)\//.test(String(value));
}

async function runLinuxCommand(command, sshUser, ipAddress, knownHosts, options = {}) {
  if (profile.transport === 'prlctl') {
    return runPrlctlShell(command, options);
  }

  return runSsh(sshUser, ipAddress, knownHosts, command, options);
}

async function runPrlctlShell(command, options = {}) {
  const scriptName = `.caul-prlctl-${process.pid}-${Date.now()}.sh`;
  const hostScriptPath = path.join(process.cwd(), scriptName);
  const guestScriptPath = `/media/psf/caul/${scriptName}`;

  await writeFile(hostScriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n${command}\n`);

  try {
    return await runPrlctl([
      'exec',
      vmName,
      '/bin/bash',
      guestScriptPath
    ], options);
  } finally {
    await unlink(hostScriptPath).catch(() => {});
  }
}

function linuxPackageMetadataCheck(packagePath) {
  if (profile.packageType === 'rpm') {
    return [
      `rpm -qp --queryformat '%{NAME}\\n' ${shellQuote(packagePath)} | grep -qx caul`,
      `rpm -qp --queryformat '%{ARCH}\\n' ${shellQuote(packagePath)} | grep -Eq '^(aarch64|x86_64)$'`,
      `rpm -qpl ${shellQuote(packagePath)} | grep -q '/opt/Caul/resources/bin/caul-desktop-backend$'`
    ].join(' && ');
  }

  return [
    `dpkg-deb -f ${shellQuote(packagePath)} Package | grep -qx caul`,
    `dpkg-deb -f ${shellQuote(packagePath)} Architecture | grep -qx arm64`,
    `dpkg-deb -c ${shellQuote(packagePath)} | awk '/\\/opt\\/Caul\\/resources\\/bin\\/caul-desktop-backend$/ { found = 1 } END { exit found ? 0 : 1 }'`
  ].join(' && ');
}

async function runSsh(user, host, knownHosts, command, options = {}) {
  try {
    const result = await execFileAsync('ssh', ['-o', `UserKnownHostsFile=${knownHosts}`, `${user}@${host}`, command], {
      timeout: options.timeout ?? 15_000,
      maxBuffer: options.maxBuffer ?? 5 * 1024 * 1024
    });

    return {
      ok: true,
      text: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    };
  } catch (error) {
    return {
      ok: false,
      text: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim()
    };
  }
}

async function runWindowsTranscriptionSmoke(repoPath, backendPath) {
  const modelDir = process.env[profile.modelEnv] ?? profile.defaultModelDir;
  const fixturePath = '%TEMP%\\caul-known-16k.wav';
  const smoke = await runPrlctl([
    'exec',
    vmName,
    'powershell.exe',
    '-NoProfile',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      '$wav = Join-Path $env:TEMP "caul-known-16k.wav"',
      'Add-Type -AssemblyName System.Speech',
      '$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
      '$voice.SetOutputToWaveFile($wav, $format)',
      `$voice.Speak(${powershellString(transcriptionExpectedPhrase)})`,
      '$voice.Dispose()',
      `$env:CAUL_PARAKEET_MODEL_DIR = ${powershellString(modelDir)}`,
      `& ${powershellString(backendPath)} --transcribe-parakeet-wav $wav`
    ].join('; ')
  ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });

  if (!smoke.ok) {
    console.error('Windows packaged local transcription smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  return assertTranscriptionSmoke(smoke.text, 'Windows');
}

async function runWindowsRendererTranscriptionSmoke(appExe) {
  const modelDir = process.env[profile.modelEnv] ?? profile.defaultModelDir;
  const userData = '$env:TEMP\\caul-win-renderer-transcription-smoke';
  const prepScript = [
    '$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop',
    `$userData = ${powershellString('$env:TEMP\\caul-win-renderer-transcription-smoke')}`,
    '$userData = $ExecutionContext.InvokeCommand.ExpandString($userData)',
    'Remove-Item -Force -Recurse $userData -ErrorAction SilentlyContinue',
    'New-Item -ItemType Directory -Force -Path (Join-Path $userData "models") | Out-Null',
    '$profileFolder = Join-Path $userData "Caul"',
    'New-Item -ItemType Directory -Force -Path $profileFolder | Out-Null',
    `$modelDir = ${powershellString(modelDir)}`,
    'New-Item -ItemType Junction -Path (Join-Path $userData "models\\parakeet-tdt-0.6b-v3-int8") -Target $modelDir | Out-Null',
    `$setupState = ${powershellString(JSON.stringify(setupStateSeed('$profileFolder', 'local')))}`,
    '$setupState = $ExecutionContext.InvokeCommand.ExpandString($setupState)',
    '[System.IO.File]::WriteAllText((Join-Path $userData "setup-state.json"), $setupState, [System.Text.UTF8Encoding]::new($false))',
    `$settings = ${powershellString(JSON.stringify(profileSettingsSeed('local')))}`,
    '[System.IO.File]::WriteAllText((Join-Path $profileFolder "settings.json"), $settings, [System.Text.UTF8Encoding]::new($false))'
  ].join('; ');

  const prep = await runPrlctl([
    'exec',
    vmName,
    '--current-user',
    ...powershellEncodedArgs(prepScript)
  ], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 });

  if (!prep.ok) {
    console.error('Windows packaged renderer transcription smoke failed while preparing user data.');
    console.error(prep.text);
    process.exit(1);
  }

  const smoke = await runPrlctl([
    'exec',
    vmName,
    '--current-user',
    ...powershellEncodedArgs([
      '$userData = Join-Path $env:TEMP "caul-win-renderer-transcription-smoke"',
      '$smokeOutputFile = Join-Path $userData "smoke-output.log"',
      '$env:CAUL_RENDERER_TRANSCRIPTION_SMOKE_MS = "26000"',
      '$env:CAUL_DISABLE_MODEL_AUTO_DOWNLOAD = "1"',
      '$env:CAUL_LLM_DISABLE_PERSISTENT_PI = "1"',
      '$env:CAUL_RENDERER_TRANSCRIPTION_SMOKE_NO_LLM = "1"',
      '$env:CAUL_RENDERER_TRANSCRIPTION_SMOKE_GUI_CLICKS = "1"',
      '$env:CAUL_RENDERER_TRANSCRIPTION_SMOKE_FAKE_BACKEND = "1"',
      `$env:CAUL_RENDERER_TRANSCRIPTION_SMOKE_INJECT_TEXT = ${powershellString(transcriptionExpectedPhrase)}`,
      '$env:CAUL_USER_DATA_DIR = $userData',
      '$env:CAUL_SMOKE_OUTPUT_FILE = $smokeOutputFile',
      `& ${powershellString(appExe)}`,
      'if (Test-Path $smokeOutputFile) { Get-Content $smokeOutputFile }'
    ].join('; '))
  ], { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 });

  if (!smoke.ok || !smoke.text.includes('caul-renderer-transcription-smoke')) {
    console.error('Windows packaged renderer transcription smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  return assertRendererTranscriptionSmoke(smoke.text, 'Windows');
}

async function runWindowsRendererAiSmoke(appExe) {
  const smoke = await runPrlctl([
    'exec',
    vmName,
    '--current-user',
    ...powershellEncodedArgs([
      '$userData = Join-Path $env:TEMP "caul-win-renderer-ai-smoke"',
      'Remove-Item -Force -Recurse $userData -ErrorAction SilentlyContinue',
      'New-Item -ItemType Directory -Force -Path $userData | Out-Null',
      '$profileFolder = Join-Path $userData "Caul"',
      'New-Item -ItemType Directory -Force -Path $profileFolder | Out-Null',
      `$setupState = ${powershellString(JSON.stringify(setupStateSeed('$profileFolder')))}`,
      '$setupState = $ExecutionContext.InvokeCommand.ExpandString($setupState)',
      '[System.IO.File]::WriteAllText((Join-Path $userData "setup-state.json"), $setupState, [System.Text.UTF8Encoding]::new($false))',
      `$settings = ${powershellString(JSON.stringify(profileSettingsSeed()))}`,
      '[System.IO.File]::WriteAllText((Join-Path $profileFolder "settings.json"), $settings, [System.Text.UTF8Encoding]::new($false))',
      '$env:CAUL_RENDERER_LLM_SMOKE = "1"',
      '$env:CAUL_LLM_SMOKE_MODE = "speculative"',
      '$env:CAUL_LLM_DISABLE_PERSISTENT_PI = "1"',
      '$env:CAUL_PI_LLM_BRIDGE = "1"',
      '$env:CAUL_USER_DATA_DIR = $userData',
      `& ${powershellString(appExe)}`
    ].join('; '))
  ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });

  if (!smoke.text.includes('caul-renderer-llm-smoke')) {
    console.error('Windows packaged renderer AI smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  return assertRendererAiSmoke(smoke.text, 'Windows');
}

async function runLinuxTranscriptionSmoke(sshUser, ipAddress, knownHosts, backendPath) {
  const modelDir = process.env[profile.modelEnv] ?? profile.defaultModelDir;
  const fixturePath = '/tmp/caul-known-16k.wav';
  const localFixture = await createLocalTranscriptionFixture();
  const copy = await execFileAsync('scp', [
    '-o',
    `UserKnownHostsFile=${knownHosts}`,
    localFixture.wavPath,
    `${sshUser}@${ipAddress}:${fixturePath}`
  ], {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024
  }).then(
    () => ({ ok: true, text: '' }),
    (error) => ({ ok: false, text: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim() })
  );

  if (!copy.ok) {
    await localFixture.cleanup();
    console.error('Linux packaged local transcription smoke failed while copying the fixture.');
    console.error(copy.text);
    process.exit(1);
  }

  const smoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      `test -d ${shellQuote(modelDir)}`,
      `CAUL_PARAKEET_MODEL_DIR=${shellQuote(modelDir)} ${shellQuote(backendPath)} --transcribe-parakeet-wav ${shellQuote(fixturePath)}`
    ].join(' && '),
    { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!smoke.ok) {
    await localFixture.cleanup();
    console.error('Linux packaged local transcription smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  try {
    return assertTranscriptionSmoke(smoke.text, 'Linux');
  } finally {
    await localFixture.cleanup();
  }
}

async function runLinuxRendererTranscriptionSmoke(sshUser, ipAddress, knownHosts, repoPath) {
  const modelDir = process.env[profile.modelEnv] ?? profile.defaultModelDir;
  const userData = `${repoPath}/artifacts/linux-renderer-transcription-smoke-user-data`;
  const localFixture = await createLocalTranscriptionFixture(1);
  const fixturePath = '/tmp/caul-renderer-known-16k.wav';

  const copy = await execFileAsync('scp', [
    '-o',
    `UserKnownHostsFile=${knownHosts}`,
    localFixture.wavPath,
    `${sshUser}@${ipAddress}:${fixturePath}`
  ], {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024
  }).then(
    () => ({ ok: true, text: '' }),
    (error) => ({ ok: false, text: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim() })
  );

  if (!copy.ok) {
    await localFixture.cleanup();
    console.error('Linux packaged renderer transcription smoke failed while copying the fixture.');
    console.error(copy.text);
    process.exit(1);
  }

  const smoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      `rm -rf ${shellQuote(userData)}`,
      `mkdir -p ${shellQuote(`${userData}/models`)}`,
      `mkdir -p ${shellQuote(`${userData}/Caul`)}`,
      `ln -s ${shellQuote(modelDir)} ${shellQuote(`${userData}/models/parakeet-tdt-0.6b-v3-int8`)}`,
      `printf '%s\\n' ${shellQuote(JSON.stringify(setupStateSeed(`${userData}/Caul`, 'local')))} > ${shellQuote(`${userData}/setup-state.json`)}`,
      `printf '%s\\n' ${shellQuote(JSON.stringify(profileSettingsSeed('local')))} > ${shellQuote(`${userData}/Caul/settings.json`)}`,
      `((sleep 8; wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 >/tmp/caul-renderer-pw-play.log 2>&1 || true; wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.70 >>/tmp/caul-renderer-pw-play.log 2>&1 || true; deadline=$((SECONDS + 55)); while [ "$SECONDS" -lt "$deadline" ]; do timeout 18 pw-play ${shellQuote(fixturePath)} >>/tmp/caul-renderer-pw-play.log 2>&1 || true; sleep 1; done) &)`,
      [
        'DISPLAY=:0',
        'CAUL_RENDERER_TRANSCRIPTION_SMOKE_MS=65000',
        'CAUL_DISABLE_MODEL_AUTO_DOWNLOAD=1',
        'CAUL_LLM_DISABLE_PERSISTENT_PI=1',
        'CAUL_RENDERER_TRANSCRIPTION_SMOKE_NO_LLM=1',
        'CAUL_RENDERER_TRANSCRIPTION_SMOKE_GUI_CLICKS=1',
        'CAUL_RENDERER_TRANSCRIPTION_SMOKE_FAKE_BACKEND=1',
        'CAUL_PIPELINE_METRICS=1',
        'CAUL_ENDPOINT_ENERGY_THRESHOLD=0.0001',
        `CAUL_USER_DATA_DIR=${shellQuote(userData)}`,
        `CAUL_RENDERER_TRANSCRIPTION_SMOKE_INJECT_TEXT=${shellQuote(transcriptionExpectedPhrase)}`,
        `CAUL_RENDERER_TRANSCRIPTION_EXPECTED=${shellQuote(transcriptionExpectedPhrase)}`,
        '/opt/Caul/caul'
      ].join(' ')
    ].join(' && '),
    { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 }
  );

  await localFixture.cleanup();

  if (!smoke.ok || !smoke.text.includes('caul-renderer-transcription-smoke')) {
    console.error('Linux packaged renderer transcription smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  return assertRendererTranscriptionSmoke(smoke.text, 'Linux');
}

async function runLinuxRendererAiSmoke(sshUser, ipAddress, knownHosts) {
  const userData = '/tmp/caul-linux-renderer-ai-smoke';
  const smokeOutputFile = `${userData}/smoke-output.log`;
  const smoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      `rm -rf ${shellQuote(userData)}`,
      `mkdir -p ${shellQuote(userData)} ${shellQuote(`${userData}/Caul`)}`,
      `printf '%s\\n' ${shellQuote(JSON.stringify(setupStateSeed(`${userData}/Caul`)))} > ${shellQuote(`${userData}/setup-state.json`)}`,
      `printf '%s\\n' ${shellQuote(JSON.stringify(profileSettingsSeed()))} > ${shellQuote(`${userData}/Caul/settings.json`)}`,
      `DISPLAY=:0 CAUL_RENDERER_LLM_SMOKE=1 CAUL_LLM_SMOKE_MODE=speculative CAUL_LLM_DISABLE_PERSISTENT_PI=1 CAUL_USER_DATA_DIR=${shellQuote(userData)} CAUL_SMOKE_OUTPUT_FILE=${shellQuote(smokeOutputFile)} /opt/Caul/caul`,
      `cat ${shellQuote(smokeOutputFile)} 2>/dev/null || true`
    ].join(' && '),
    { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!smoke.text.includes('caul-renderer-llm-smoke')) {
    console.error('Linux packaged renderer AI smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  return assertRendererAiSmoke(smoke.text, 'Linux');
}

async function runLinuxAudioIsolationSmoke(
  sshUser,
  ipAddress,
  knownHosts,
  backendPath,
  systemDuringOutput
) {
  const microphoneBaselineProbe = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    `${shellQuote(backendPath)} --stream-microphone --duration 3 --smoke-summary`,
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );
  const microphoneBaseline = microphoneBaselineProbe.ok
    ? parseMicrophoneSmokeSummary(microphoneBaselineProbe.text)
    : null;
  const microphoneProbe = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      linuxToneStimulusCommand('/tmp/caul-pw-play-mic-isolation.log'),
      'sleep 0.3',
      `${shellQuote(backendPath)} --stream-microphone --duration 3 --smoke-summary`
    ].join(' && '),
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );
  const microphoneDuringOutput = microphoneProbe.ok
    ? parseMicrophoneSmokeSummary(microphoneProbe.text)
    : null;
  const gate = evaluateAudioIsolationGate({
    microphoneBaseline,
    microphoneDuringOutput,
    systemDuringOutput,
    microphoneLeakAbsoluteThreshold: 0.003
  });

  return {
    details: [
      `systemDuringOutput=${JSON.stringify(systemDuringOutput)}`,
      `microphoneBaseline=${JSON.stringify(microphoneBaseline)}`,
      `microphoneDuringOutput=${JSON.stringify(microphoneDuringOutput)}`,
      `gate=${JSON.stringify(gate)}`,
      microphoneBaselineProbe.text,
      microphoneProbe.text
    ].join('\n'),
    gate,
    microphoneBaseline,
    microphoneDuringOutput,
    ok: microphoneBaselineProbe.ok && microphoneProbe.ok && gate.ok,
    systemDuringOutput
  };
}

async function createLocalTranscriptionFixture(repetitions = 1) {
  const directory = await mkdtemp(path.join(tmpdir(), 'caul-transcription-fixture-'));
  const aiffPath = path.join(directory, 'known.aiff');
  const wavPath = path.join(directory, 'known-16k.wav');
  const phrase = Array.from({ length: repetitions }, () => transcriptionExpectedPhrase).join(' ');

  await execFileAsync('say', ['-o', aiffPath, phrase], {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024
  });
  await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiffPath, wavPath], {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024
  });
  await execFileAsync('python3', ['-c', [
    'import struct, sys, wave',
    'path = sys.argv[1]',
    'with wave.open(path, "rb") as source:',
    '    params = source.getparams()',
    '    frames = source.readframes(source.getnframes())',
    'samples = struct.unpack("<" + "h" * (len(frames) // 2), frames)',
    'scaled = bytearray()',
    'for sample in samples:',
    '    value = max(-32768, min(32767, int(sample * 4)))',
    '    scaled.extend(struct.pack("<h", value))',
    'with wave.open(path, "wb") as output:',
    '    output.setparams(params)',
    '    output.writeframes(bytes(scaled))'
  ].join('\n'), wavPath], {
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024
  });

  return {
    wavPath,
    cleanup: () => rm(directory, { force: true, recursive: true })
  };
}

function setupStateSeed(historyFolder = null, selectedAiProvider = 'cloud') {
  return {
    ...(historyFolder ? { historyFolder } : {}),
    onboardingCompletedAt: new Date().toISOString(),
    selectedAiProvider,
    selectedLocalTranscriptionModel: 'parakeet',
    selectedPiModel: 'openai-codex/gpt-5.5'
  };
}

function profileSettingsSeed(selectedAiProvider = 'cloud') {
  return {
    selectedAiProvider,
    selectedLocalTranscriptionModel: 'parakeet',
    selectedPiModel: 'openai-codex/gpt-5.5',
    version: 1
  };
}

function windowsSpeechPlaybackScript(repetitions = 1) {
  const phrase = Array.from({ length: repetitions }, () => transcriptionExpectedPhrase).join(' ');

  return [
    '$ErrorActionPreference = "Stop"',
    '$wav = Join-Path $env:TEMP "caul-renderer-known-16k.wav"',
    'Add-Type -AssemblyName System.Speech',
    '$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    '$voice.SetOutputToWaveFile($wav, $format)',
    `$voice.Speak(${powershellString(phrase)})`,
    '$voice.Dispose()',
    '$player = New-Object System.Media.SoundPlayer $wav',
    '$player.PlaySync()'
  ].join('; ');
}

function windowsSpeechPrepareAndPlayScript(repetitions = 1, options = {}) {
  const phrase = Array.from({ length: repetitions }, () => transcriptionExpectedPhrase).join(' ');
  const prepareOnly = options.prepareOnly === true;
  const delaySeconds = Number(options.delaySeconds ?? 0);
  const playCommand = prepareOnly
    ? []
    : delaySeconds > 0
    ? [
        `$delaySeconds = ${delaySeconds}`,
        'Start-Job -ArgumentList $wav,$delaySeconds -ScriptBlock { param($path,$delay) Start-Sleep -Seconds $delay; $player = New-Object System.Media.SoundPlayer $path; $player.PlaySync() } | Out-Null'
      ]
    : [
        '$player = New-Object System.Media.SoundPlayer $wav',
        '$player.Play()'
      ];

  return [
    '$wav = Join-Path $env:TEMP "caul-renderer-known-16k.wav"',
    'Add-Type -AssemblyName System.Speech',
    '$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    '$voice.SetOutputToWaveFile($wav, $format)',
    `$voice.Speak(${powershellString(phrase)})`,
    '$voice.Dispose()',
    ...playCommand
  ].join('; ');
}

function assertTranscriptionSmoke(text, label) {
  const summary = parseParakeetDirectBench(text);
  const wordOverlap = scoreTranscript(transcriptionExpectedPhrase, summary?.transcript ?? '');

  if (!summary?.transcript || wordOverlap < 0.5) {
    console.error(`${label} packaged local transcription smoke did not emit enough confirmed known text.`);
    console.error(text);
    process.exit(1);
  }

  return {
    ...summary,
    expected: transcriptionExpectedPhrase,
    wordOverlap
  };
}

function assertRendererTranscriptionSmoke(text, label) {
  const summary = parsePrefixedJson(text, 'caul-renderer-transcription-smoke');
  const eventTranscript = [
    ...(summary?.completed ?? []),
    ...(summary?.partial ?? [])
  ].join('\n');
  const transcript = eventTranscript || summary?.longestOutput || summary?.renderedOutput || '';
  const wordOverlap = scoreTranscript(transcriptionExpectedPhrase, transcript);
  const transcriptWords = normaliseWords(transcript);

  if (
    !summary?.detected
    || summary.errors?.length > 0
    || !summary.autoSendButtonFound
    || !summary.autoSendDisabled
    || summary.guiClickMode !== true
    || !Array.isArray(summary.guiClicks)
    || summary.guiClicks.length < 3
    || summary.guiClicks.some((click) => click?.ok !== true)
    || !summary.restartAttempted
    || !summary.restartStartButtonFound
    || summary.restartStartButtonDisabled
    || (Number(summary.completedCount ?? 0) + Number(summary.partialCount ?? 0)) < 1
    || transcriptWords.length < 1
  ) {
    console.error(`${label} packaged renderer transcription smoke did not prove transcript text and UI restart in the app.`);
    console.error(text);
    process.exit(1);
  }

  return {
    ...summary,
    transcript,
    wordOverlap
  };
}

function assertRendererAiSmoke(text, label) {
  const summary = parsePrefixedJson(text, 'caul-renderer-llm-smoke');
  const speculativeText = summary?.speculativeResult?.ok === true
    ? summary.speculativeResult.text
    : '';
  const finalValue = speculativeText
    || (summary?.finalValue && summary.finalValue.trim() !== 'No response yet.'
      ? summary.finalValue
      : '');

  if (!finalValue) {
    console.error(`${label} packaged renderer AI smoke did not prove a visible AI response.`);
    console.error(text);
    process.exit(1);
  }

  return {
    ...summary,
    finalValue
  };
}

function formatRendererTranscriptionSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  return `ok overlap ${Number(summary.wordOverlap).toFixed(2)} transcript "${summary.transcript}"`;
}

function formatRendererAiSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  return `ok first text ${summary.stopToFirstResponseTextMs ?? 'unknown'}ms final "${summary.finalValue}"`;
}

function formatAudioIsolationSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  return summary.ok
    ? `ok system=${formatLevel(summary.gate?.systemMaxLevel)} microphone=${formatLevel(summary.gate?.microphoneMaxLevel)} limit=${formatLevel(summary.gate?.microphoneLeakLimit)}`
    : `failed system=${formatLevel(summary.gate?.systemMaxLevel)} microphone=${formatLevel(summary.gate?.microphoneMaxLevel)} limit=${formatLevel(summary.gate?.microphoneLeakLimit)}`;
}

function parseParakeetDirectBench(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);

      if (parsed?.type === 'parakeet_direct_bench') {
        return parsed;
      }
    } catch {
      // Ignore non-JSON build output.
    }
  }

  return null;
}

function scoreTranscript(expected, actual) {
  const actualWords = new Set(normaliseWords(actual));
  const expectedWords = [...new Set(normaliseWords(expected).filter((word) => word.length > 3))];

  if (expectedWords.length === 0) {
    return 0;
  }

  const hits = expectedWords.filter((word) => actualWords.has(word)).length;
  return hits / expectedWords.length;
}

function normaliseWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function cmdQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function powershellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function linuxToneStimulusCommand(logPath) {
  const script = [
    'import math, struct, wave',
    "path = '/tmp/caul-audio-stimulus.wav'",
    'rate = 48000',
    'seconds = 6',
    'chords = [',
    '    (261.63, 329.63, 392.00),',
    '    (293.66, 369.99, 440.00),',
    '    (246.94, 329.63, 392.00),',
    '    (220.00, 277.18, 329.63),',
    ']',
    'step = int(rate * 0.5)',
    "with wave.open(path, 'wb') as audio:",
    '    audio.setnchannels(1)',
    '    audio.setsampwidth(2)',
    '    audio.setframerate(rate)',
    '    for n in range(rate * seconds):',
    '        chord = chords[(n // step) % len(chords)]',
    '        position = (n % step) / step',
    '        attack = min(1.0, position / 0.08)',
    '        release = min(1.0, (1.0 - position) / 0.18)',
    '        envelope = max(0.0, min(attack, release))',
    '        mixed = 0.0',
    '        for index, frequency in enumerate(chord):',
    '            mixed += math.sin(2 * math.pi * frequency * n / rate) * (1.0 - index * 0.15)',
    '        sample = int(mixed / len(chord) * envelope * 9000)',
    "        audio.writeframesraw(struct.pack('<h', sample))"
  ].join('\n');

  return [
    `python3 -c ${shellQuote(script)}`,
    `(timeout 7 pw-play /tmp/caul-audio-stimulus.wav >${shellQuote(logPath)} 2>&1 &)`
  ].join(' && ');
}

function parseSmokeSummary(text) {
  return parseSmokeSummaryByType(text, 'system_audio_smoke');
}

function parseMicrophoneSmokeSummary(text) {
  return parseSmokeSummaryByType(text, 'microphone_smoke');
}

function parseCaptureRestartSmokeSummary(text, source) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);

      if (parsed?.type === 'capture_restart_smoke' && parsed.source === source) {
        return parsed;
      }
    } catch {
      // Ignore non-JSON build output.
    }
  }

  return null;
}

function meetsMinimumAudioGate(summary) {
  return summary?.capture_started === true
    && summary.audio_frames > 0
    && summary.level_events > 0
    && Number(summary.max_level) > 0.000001;
}

function meetsMinimumMicrophoneGate(summary) {
  return summary?.capture_started === true
    && summary.audio_frames > 0
    && summary.level_events > 0
    && Number(summary.max_level) > 0;
}

function meetsMinimumRestartGate(summary) {
  return summary?.ok === true
    && Array.isArray(summary.cycles)
    && summary.cycles.length === 2
    && summary.cycles.every((cycle) => (
      cycle.capture_started === true
      && cycle.audio_frames > 0
      && cycle.level_events > 0
      && Number(cycle.max_level) > 0
    ));
}

function formatLevel(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(6) : 'unknown';
}

function formatPrivacySummary(privacy) {
  if (!privacy) {
    return 'not checked';
  }

  return privacy.ok
    ? 'ok'
    : `failed mainHttp=${privacy.mainHttpRequests?.length ?? 0} rendererHttp=${privacy.rendererHttpRequests?.length ?? 0} rawAudio=${privacy.rawAudioFiles?.length ?? 0} transcriptDebug=${privacy.transcriptDebugFiles?.length ?? 0}`;
}

function formatExternalPrivacyCaptureSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  if (summary.ok) {
    return `ok green=${summary.internalCapture?.controlPixelCount ?? summary.greenPixelCount} red=${summary.internalCapture?.protectedPixelCount ?? summary.redPixelCount}`;
  }

  if (summary.error) {
    return `failed ${summary.error}`;
  }

  return `failed green=${summary.internalCapture?.controlPixelCount ?? summary.greenPixelCount ?? 'unknown'} red=${summary.internalCapture?.protectedPixelCount ?? summary.redPixelCount ?? 'unknown'}`;
}

function formatRestartSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  if (!meetsMinimumRestartGate(summary)) {
    return 'failed';
  }

  return summary.cycles
    .map((cycle, index) => `cycle ${index + 1} ${cycle.audio_frames} frames max ${formatLevel(cycle.max_level)}`)
    .join('; ');
}

function formatTranscriptionSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  return `ok overlap ${Number(summary.wordOverlap).toFixed(2)} transcript "${summary.transcript}"`;
}

function formatCompletionSummary(completion) {
  if (!completion) {
    return 'not checked';
  }

  return completion.ok
    ? `ok (${completion.hasHandle ? 'handle' : 'home'} shown)`
    : `failed completedAt=${completion.completedAt ?? 'none'} handle=${completion.hasHandle ? 'yes' : 'no'} home=${completion.hasHomeLayout ? 'yes' : 'no'}`;
}

function parsePrefixedJson(text, prefix) {
  let parsed = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith(`${prefix} `)) {
      continue;
    }

    try {
      parsed = JSON.parse(trimmed.slice(prefix.length + 1));
    } catch {
      return null;
    }
  }

  return parsed;
}

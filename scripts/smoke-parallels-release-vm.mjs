import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const transcriptionExpectedPhrase = 'Susura release transcription smoke. Local transcription emits confirmed text.';

const profiles = {
  linux: {
    defaultName: 'Ubuntu 24.04.3 ARM64',
    envName: 'SUSURA_LINUX_VM_NAME',
    packageEnv: 'SUSURA_LINUX_PACKAGE_PATH',
    repoEnv: 'SUSURA_LINUX_VM_REPO',
    defaultRepo: '/home/parallels/susura-cross-platform',
    defaultPackagePath: '/home/parallels/susura-cross-platform/release/susura-arm64.deb',
    userEnv: 'SUSURA_LINUX_VM_SSH_USER',
    defaultUser: 'parallels',
    hostEnv: 'SUSURA_LINUX_VM_SSH_HOST',
    defaultHost: '10.211.55.12',
    knownHostsEnv: 'SUSURA_LINUX_VM_KNOWN_HOSTS',
    defaultKnownHosts: '/tmp/susura_known_hosts',
    modelEnv: 'SUSURA_LINUX_PARAKEET_MODEL_DIR',
    defaultModelDir: '/home/parallels/.local/share/com.pais.handy/models/parakeet-tdt-0.6b-v3-int8'
  },
  win: {
    defaultName: 'Windows 11 ARM',
    envName: 'SUSURA_WINDOWS_VM_NAME',
    packageEnv: 'SUSURA_WINDOWS_PACKAGE_PATH',
    repoEnv: 'SUSURA_WINDOWS_VM_REPO',
    defaultRepo: 'C:\\Users\\alex\\susura-cross-platform',
    defaultPackagePath: 'C:\\Users\\alex\\susura-cross-platform\\release\\win-arm64-unpacked',
    modelEnv: 'SUSURA_WINDOWS_PARAKEET_MODEL_DIR',
    defaultModelDir: 'C:\\Users\\alex\\AppData\\Roaming\\com.pais.handy\\models\\parakeet-tdt-0.6b-v3-int8'
  }
};

const profileName = process.argv[2];
const profile = profiles[profileName];

if (!profile) {
  console.error('Usage: node scripts/smoke-parallels-release-vm.mjs <win|linux>');
  process.exit(1);
}

const vmName = process.env[profile.envName] ?? profile.defaultName;
const packagePath = process.env[profile.packageEnv] ?? profile.defaultPackagePath;

function powershellEncodedArgs(script) {
  return [
    'powershell.exe',
    '-NoProfile',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ];
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
  console.error(`Could not inspect Parallels VM "${vmName}".`);
  console.error(info.text);
  process.exit(1);
}

const state = extractValue(info.text, 'State');
const guestTools = extractValue(info.text, 'GuestTools');
const ipAddresses = extractValue(info.text, 'IP Addresses');
const guestToolsReady = /\bstate=(?:installed|possibly_installed)\b/.test(guestTools);
const ready = state === 'running' && (profileName === 'linux' || guestToolsReady);

if (!ready) {
  console.error(`VM release smoke blocked for "${vmName}".`);
  console.error(`State: ${state}`);
  console.error(`Guest Tools: ${guestTools}`);
  console.error(`IP Addresses: ${ipAddresses || 'none'}`);
  console.error(`Start the VM, install Parallels Tools if needed, then rerun npm run vm:smoke:${profileName}.`);
  process.exit(1);
}

if (!packagePath) {
  console.error(`${profile.packageEnv} must point to a packaged Susura artefact before vm:smoke:${profileName} can run.`);
  console.error('This smoke is intentionally packaged-app gated, not a Vite-only reachability check.');
  process.exit(1);
}

if (profileName === 'linux') {
  await runLinuxPackageSmoke();
  process.exit(0);
}

if (profileName === 'win') {
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
  const backendPath = `${repoPath}\\release\\win-arm64-unpacked\\resources\\bin\\susura-desktop-backend.exe`;
  const stimulusScript = `${repoPath}\\scripts\\windows-audio-stimulus.ps1`;
  const packageCheck = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    [
      `if not exist ${cmdQuote(packagePath)} (echo missing ${packagePath} && exit /b 2)`,
      `if not exist ${cmdQuote(backendPath)} (echo missing ${backendPath} && exit /b 2)`,
      `if not exist ${cmdQuote(stimulusScript)} (echo missing ${stimulusScript} && exit /b 2)`,
      `if exist ${cmdQuote(packagePath)}\\Susura.exe (echo unpacked package ready) else (for %F in (${cmdQuote(packagePath)}) do @if %~zF LEQ 0 (echo empty ${packagePath} && exit /b 2))`
    ].join(' && ')
  ]);

  if (!packageCheck.ok) {
    console.error(`Windows packaged smoke failed while validating ${packagePath}.`);
    console.error(packageCheck.text);
    process.exit(1);
  }

  const backendSmoke = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    [
      `start "Susura audio stimulus" /MIN powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${cmdQuote(stimulusScript)}`,
      'powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"',
      `${cmdQuote(backendPath)} --stream-system-audio --duration 3 --smoke-summary`
    ].join(' && ')
  ], { timeout: 30_000 });

  if (!backendSmoke.ok) {
    console.error('Windows packaged backend smoke failed.');
    console.error(backendSmoke.text);
    process.exit(1);
  }

  const summary = parseSmokeSummary(backendSmoke.text);

  if (!meetsMinimumAudioGate(summary)) {
    console.error('Windows packaged backend smoke did not meet the minimum capture gate.');
    console.error(backendSmoke.text);
    process.exit(1);
  }

  const systemRestartSmoke = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    [
      `start "Susura audio restart stimulus" /MIN powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${cmdQuote(stimulusScript)}`,
      'powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"',
      `${cmdQuote(backendPath)} --capture-restart-smoke --source system --duration 2`
    ].join(' && ')
  ], { timeout: 30_000 });

  if (!systemRestartSmoke.ok) {
    console.error('Windows packaged system-audio restart smoke failed.');
    console.error(systemRestartSmoke.text);
    process.exit(1);
  }

  const systemRestartSummary = parseCaptureRestartSmokeSummary(systemRestartSmoke.text, 'system');

  if (!meetsMinimumRestartGate(systemRestartSummary)) {
    console.error('Windows packaged system-audio restart smoke did not meet the minimum restart gate.');
    console.error(systemRestartSmoke.text);
    process.exit(1);
  }

  const microphoneSmoke = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    `${cmdQuote(backendPath)} --stream-microphone --duration 3 --smoke-summary`
  ], { timeout: 30_000 });

  if (!microphoneSmoke.ok) {
    console.error('Windows packaged microphone smoke failed.');
    console.error(microphoneSmoke.text);
    process.exit(1);
  }

  const microphoneSummary = parseMicrophoneSmokeSummary(microphoneSmoke.text);

  if (!meetsMinimumMicrophoneGate(microphoneSummary)) {
    console.error('Windows packaged microphone smoke did not meet the minimum capture gate.');
    console.error(microphoneSmoke.text);
    process.exit(1);
  }

  const microphoneRestartSmoke = await runPrlctl([
    'exec',
    vmName,
    'cmd.exe',
    '/c',
    `${cmdQuote(backendPath)} --capture-restart-smoke --source microphone --duration 2`
  ], { timeout: 30_000 });

  if (!microphoneRestartSmoke.ok) {
    console.error('Windows packaged microphone restart smoke failed.');
    console.error(microphoneRestartSmoke.text);
    process.exit(1);
  }

  const microphoneRestartSummary = parseCaptureRestartSmokeSummary(microphoneRestartSmoke.text, 'microphone');

  if (!meetsMinimumRestartGate(microphoneRestartSummary)) {
    console.error('Windows packaged microphone restart smoke did not meet the minimum restart gate.');
    console.error(microphoneRestartSmoke.text);
    process.exit(1);
  }

  const transcriptionSummary = await runWindowsTranscriptionSmoke(repoPath, backendPath);
  const rendererSummary = await runWindowsRendererTranscriptionSmoke(repoPath);

  const launchSmoke = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      '$userData = Join-Path $env:TEMP "susura-win-launch-smoke"',
      'Remove-Item -Force -Recurse $userData -ErrorAction SilentlyContinue',
      'New-Item -ItemType Directory -Force -Path $userData | Out-Null',
      '$smokeOutputFile = Join-Path $userData "smoke-output.log"',
      '$env:SUSURA_PACKAGED_LAUNCH_SMOKE_MS = "250"',
      '$env:SUSURA_PACKAGED_LAUNCH_SMOKE_REQUIRE_ONBOARDING = "1"',
      '$env:SUSURA_PACKAGED_PRIVACY_SMOKE = "1"',
      '$env:SUSURA_PACKAGED_ONBOARDING_COMPLETION_SMOKE = "1"',
      '$env:SUSURA_DISABLE_MODEL_AUTO_DOWNLOAD = "1"',
      '$env:SUSURA_USER_DATA_DIR = $userData',
      '$env:SUSURA_SMOKE_OUTPUT_FILE = $smokeOutputFile',
      `$process = Start-Process -PassThru -FilePath ${powershellString(`${repoPath}\\release\\win-arm64-unpacked\\Susura.exe`)}`,
      '$deadline = (Get-Date).AddSeconds(20)',
      'while ((Get-Date) -lt $deadline) { if ((Test-Path $smokeOutputFile) -and ((Get-Content $smokeOutputFile -Raw) -match "susura-packaged-launch-smoke")) { break }; Start-Sleep -Milliseconds 250 }',
      'if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }',
      'if (Test-Path $smokeOutputFile) { Get-Content $smokeOutputFile }'
    ].join('; '))
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });

  if (!launchSmoke.ok || !launchSmoke.text.includes('susura-packaged-launch-smoke')) {
    console.error('Windows packaged Electron launch smoke failed.');
    console.error(launchSmoke.text);
    process.exit(1);
  }

  const launchSummary = parsePrefixedJson(launchSmoke.text, 'susura-packaged-launch-smoke');

  if (!launchSummary?.ok || launchSummary.isPackaged !== true || launchSummary.hasOnboarding !== true || launchSummary.privacy?.ok !== true || launchSummary.completion?.ok !== true) {
    console.error('Windows packaged Electron launch smoke did not prove a packaged onboarding launch and completion.');
    console.error(launchSmoke.text);
    process.exit(1);
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
  console.log(`Local transcription: ${formatTranscriptionSummary(transcriptionSummary)}`);
  console.log(`Renderer transcription: ${formatRendererTranscriptionSummary(rendererSummary)}`);
  console.log(`Launch surface: ${launchSummary.surface}`);
  console.log(`Pre-setup privacy: ${formatPrivacySummary(launchSummary.privacy)}`);
  console.log(`Onboarding completion: ${formatCompletionSummary(launchSummary.completion)}`);
}

async function runLinuxPackageSmoke() {
  const repoPath = process.env[profile.repoEnv] ?? profile.defaultRepo;
  const sshUser = process.env[profile.userEnv] ?? profile.defaultUser;
  const knownHosts = process.env[profile.knownHostsEnv] ?? profile.defaultKnownHosts;
  const ipAddress = process.env[profile.hostEnv]
    ?? ipAddresses.split(/[,\s]+/).find((candidate) => /^\d+\.\d+\.\d+\.\d+$/.test(candidate))
    ?? profile.defaultHost;

  if (!ipAddress) {
    console.error(`No IPv4 address reported for "${vmName}".`);
    process.exit(1);
  }

  const packageCheck = await runSsh(sshUser, ipAddress, knownHosts, [
    `test -f ${shellQuote(packagePath)}`,
    `dpkg-deb -f ${shellQuote(packagePath)} Package | grep -qx susura`,
    `dpkg-deb -f ${shellQuote(packagePath)} Architecture | grep -qx arm64`,
    `dpkg-deb -c ${shellQuote(packagePath)} | grep -q '/opt/Susura/resources/bin/susura-desktop-backend$'`,
    `test -x ${shellQuote(`${repoPath}/release/linux-arm64-unpacked/resources/bin/susura-desktop-backend`)}`
  ].join(' && '));

  if (!packageCheck.ok) {
    console.error(`Linux packaged smoke failed while validating ${packagePath}.`);
    console.error(packageCheck.text);
    process.exit(1);
  }

  const installCheck = await runPrlctl([
    'exec',
    vmName,
    '/usr/bin/dpkg',
    '-i',
    packagePath
  ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });

  if (!installCheck.ok) {
    console.error(`Linux packaged smoke failed while installing ${packagePath}.`);
    console.error(installCheck.text);
    process.exit(1);
  }

  const backendPath = `${repoPath}/release/linux-arm64-unpacked/resources/bin/susura-desktop-backend`;
  const backendSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      linuxToneStimulusCommand('/tmp/susura-pw-play.log'),
      'sleep 0.3',
      `${shellQuote(backendPath)} --stream-system-audio --duration 3 --smoke-summary`
    ].join(' && '),
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!backendSmoke.ok) {
    console.error('Linux packaged backend smoke failed.');
    console.error(backendSmoke.text);
    process.exit(1);
  }

  const summary = parseSmokeSummary(backendSmoke.text);

  if (!meetsMinimumAudioGate(summary)) {
    console.error('Linux packaged backend smoke did not meet the minimum capture gate.');
    console.error(backendSmoke.text);
    process.exit(1);
  }

  const systemRestartSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      linuxToneStimulusCommand('/tmp/susura-pw-play-restart.log'),
      'sleep 0.3',
      `${shellQuote(backendPath)} --capture-restart-smoke --source system --duration 2`
    ].join(' && '),
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!systemRestartSmoke.ok) {
    console.error('Linux packaged system-audio restart smoke failed.');
    console.error(systemRestartSmoke.text);
    process.exit(1);
  }

  const systemRestartSummary = parseCaptureRestartSmokeSummary(systemRestartSmoke.text, 'system');

  if (!meetsMinimumRestartGate(systemRestartSummary)) {
    console.error('Linux packaged system-audio restart smoke did not meet the minimum restart gate.');
    console.error(systemRestartSmoke.text);
    process.exit(1);
  }

  const microphoneSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    `${shellQuote(backendPath)} --stream-microphone --duration 3 --smoke-summary`,
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!microphoneSmoke.ok) {
    console.error('Linux packaged microphone smoke failed.');
    console.error(microphoneSmoke.text);
    process.exit(1);
  }

  const microphoneSummary = parseMicrophoneSmokeSummary(microphoneSmoke.text);

  if (!meetsMinimumMicrophoneGate(microphoneSummary)) {
    console.error('Linux packaged microphone smoke did not meet the minimum capture gate.');
    console.error(microphoneSmoke.text);
    process.exit(1);
  }

  const microphoneRestartSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    `${shellQuote(backendPath)} --capture-restart-smoke --source microphone --duration 2`,
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!microphoneRestartSmoke.ok) {
    console.error('Linux packaged microphone restart smoke failed.');
    console.error(microphoneRestartSmoke.text);
    process.exit(1);
  }

  const microphoneRestartSummary = parseCaptureRestartSmokeSummary(microphoneRestartSmoke.text, 'microphone');

  if (!meetsMinimumRestartGate(microphoneRestartSummary)) {
    console.error('Linux packaged microphone restart smoke did not meet the minimum restart gate.');
    console.error(microphoneRestartSmoke.text);
    process.exit(1);
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

  const launchUserData = `${repoPath}/artifacts/linux-launch-smoke-user-data`;
  const launchSmoke = await runSsh(
    sshUser,
    ipAddress,
    knownHosts,
    [
      `rm -rf ${shellQuote(launchUserData)}`,
      `mkdir -p ${shellQuote(launchUserData)}`,
      `DISPLAY=:0 SUSURA_PACKAGED_LAUNCH_SMOKE_MS=250 SUSURA_PACKAGED_LAUNCH_SMOKE_REQUIRE_ONBOARDING=1 SUSURA_PACKAGED_PRIVACY_SMOKE=1 SUSURA_PACKAGED_ONBOARDING_COMPLETION_SMOKE=1 SUSURA_DISABLE_MODEL_AUTO_DOWNLOAD=1 SUSURA_USER_DATA_DIR=${shellQuote(launchUserData)} /opt/Susura/susura`
    ].join(' && '),
    { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (!launchSmoke.ok || !launchSmoke.text.includes('susura-packaged-launch-smoke')) {
    console.error('Linux packaged Electron launch smoke failed.');
    console.error(launchSmoke.text);
    process.exit(1);
  }

  const launchSummary = parsePrefixedJson(launchSmoke.text, 'susura-packaged-launch-smoke');

  if (!launchSummary?.ok || launchSummary.isPackaged !== true || launchSummary.hasOnboarding !== true || launchSummary.privacy?.ok !== true || launchSummary.completion?.ok !== true) {
    console.error('Linux packaged Electron launch smoke did not prove a packaged onboarding launch and completion.');
    console.error(launchSmoke.text);
    process.exit(1);
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
  console.log(`Local transcription: ${formatTranscriptionSummary(transcriptionSummary)}`);
  console.log(`Renderer transcription: ${formatRendererTranscriptionSummary(rendererSummary)}`);
  console.log(`Launch surface: ${launchSummary.surface}`);
  console.log(`Pre-setup privacy: ${formatPrivacySummary(launchSummary.privacy)}`);
  console.log(`Onboarding completion: ${formatCompletionSummary(launchSummary.completion)}`);
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
  const fixturePath = '%TEMP%\\susura-known-16k.wav';
  const smoke = await runPrlctl([
    'exec',
    vmName,
    'powershell.exe',
    '-NoProfile',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      '$wav = Join-Path $env:TEMP "susura-known-16k.wav"',
      'Add-Type -AssemblyName System.Speech',
      '$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
      '$voice.SetOutputToWaveFile($wav, $format)',
      `$voice.Speak(${powershellString(transcriptionExpectedPhrase)})`,
      '$voice.Dispose()',
      `$env:SUSURA_PARAKEET_MODEL_DIR = ${powershellString(modelDir)}`,
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

async function runWindowsRendererTranscriptionSmoke(repoPath) {
  const modelDir = process.env[profile.modelEnv] ?? profile.defaultModelDir;
  const userData = '$env:TEMP\\susura-win-renderer-transcription-smoke';
  const appPath = `${repoPath}\\release\\win-arm64-unpacked\\Susura.exe`;
  const prepScript = [
    '$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop',
    `$userData = ${powershellString('$env:TEMP\\susura-win-renderer-transcription-smoke')}`,
    '$userData = $ExecutionContext.InvokeCommand.ExpandString($userData)',
    'Remove-Item -Force -Recurse $userData -ErrorAction SilentlyContinue',
    'New-Item -ItemType Directory -Force -Path (Join-Path $userData "models") | Out-Null',
    `$modelDir = ${powershellString(modelDir)}`,
    'New-Item -ItemType Junction -Path (Join-Path $userData "models\\parakeet-tdt-0.6b-v3-int8") -Target $modelDir | Out-Null',
    `$setupState = ${powershellString(JSON.stringify(setupStateSeed()))}`,
    '[System.IO.File]::WriteAllText((Join-Path $userData "setup-state.json"), $setupState, [System.Text.UTF8Encoding]::new($false))',
    windowsSpeechPrepareAndPlayScript(2, { prepareOnly: true })
  ].join('; ');

  const prep = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs(prepScript)
  ], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 });

  if (!prep.ok) {
    console.error('Windows packaged renderer transcription smoke failed while preparing user data.');
    console.error(prep.text);
    process.exit(1);
  }

  const playPromise = execFileAsync('prlctl', [
    'exec',
    vmName,
    ...powershellEncodedArgs([
      'Start-Sleep -Seconds 8',
      '$wav = Join-Path $env:TEMP "susura-renderer-known-16k.wav"',
      '$player = New-Object System.Media.SoundPlayer $wav',
      '$player.PlaySync()'
    ].join('; '))
  ], {
    timeout: 60_000,
    maxBuffer: 5 * 1024 * 1024
  }).catch((error) => ({
    stdout: '',
    stderr: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim()
  }));

  const smoke = await runPrlctl([
    'exec',
    vmName,
    ...powershellEncodedArgs([
      '$userData = Join-Path $env:TEMP "susura-win-renderer-transcription-smoke"',
      '$smokeOutputFile = Join-Path $userData "smoke-output.log"',
      '$env:SUSURA_RENDERER_TRANSCRIPTION_SMOKE_MS = "26000"',
      '$env:SUSURA_DISABLE_MODEL_AUTO_DOWNLOAD = "1"',
      '$env:SUSURA_LLM_DISABLE_PERSISTENT_PI = "1"',
      '$env:SUSURA_RENDERER_TRANSCRIPTION_SMOKE_NO_LLM = "1"',
      '$env:SUSURA_USER_DATA_DIR = $userData',
      '$env:SUSURA_SMOKE_OUTPUT_FILE = $smokeOutputFile',
      `$process = Start-Process -PassThru -FilePath ${powershellString(appPath)}`,
      '$deadline = (Get-Date).AddSeconds(70)',
      'while ((Get-Date) -lt $deadline) { if ((Test-Path $smokeOutputFile) -and ((Get-Content $smokeOutputFile -Raw).Contains("susura-renderer-transcription-smoke "))) { break }; Start-Sleep -Milliseconds 500 }',
      'if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }',
      'if (Test-Path $smokeOutputFile) { Get-Content $smokeOutputFile }'
    ].join('; '))
  ], { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 });

  await playPromise;

  if (!smoke.ok || !smoke.text.includes('susura-renderer-transcription-smoke')) {
    console.error('Windows packaged renderer transcription smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  return assertRendererTranscriptionSmoke(smoke.text, 'Windows');
}

async function runLinuxTranscriptionSmoke(sshUser, ipAddress, knownHosts, backendPath) {
  const modelDir = process.env[profile.modelEnv] ?? profile.defaultModelDir;
  const fixturePath = '/tmp/susura-known-16k.wav';
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
      `SUSURA_PARAKEET_MODEL_DIR=${shellQuote(modelDir)} ${shellQuote(backendPath)} --transcribe-parakeet-wav ${shellQuote(fixturePath)}`
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
  const localFixture = await createLocalTranscriptionFixture(5);
  const fixturePath = '/tmp/susura-renderer-known-16k.wav';

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
      `ln -s ${shellQuote(modelDir)} ${shellQuote(`${userData}/models/parakeet-tdt-0.6b-v3-int8`)}`,
      `printf '%s\\n' ${shellQuote(JSON.stringify(setupStateSeed()))} > ${shellQuote(`${userData}/setup-state.json`)}`,
      `((sleep 8; wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 >/tmp/susura-renderer-pw-play.log 2>&1 || true; wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.70 >>/tmp/susura-renderer-pw-play.log 2>&1 || true; timeout 30 pw-play ${shellQuote(fixturePath)} >>/tmp/susura-renderer-pw-play.log 2>&1) &)`,
      [
        'DISPLAY=:0',
        'SUSURA_RENDERER_TRANSCRIPTION_SMOKE_MS=45000',
        'SUSURA_DISABLE_MODEL_AUTO_DOWNLOAD=1',
        'SUSURA_LLM_DISABLE_PERSISTENT_PI=1',
        'SUSURA_RENDERER_TRANSCRIPTION_SMOKE_NO_LLM=1',
        `SUSURA_USER_DATA_DIR=${shellQuote(userData)}`,
        `SUSURA_RENDERER_TRANSCRIPTION_EXPECTED=${shellQuote(transcriptionExpectedPhrase)}`,
        '/opt/Susura/susura'
      ].join(' ')
    ].join(' && '),
    { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 }
  );

  await localFixture.cleanup();

  if (!smoke.ok || !smoke.text.includes('susura-renderer-transcription-smoke')) {
    console.error('Linux packaged renderer transcription smoke failed.');
    console.error(smoke.text);
    process.exit(1);
  }

  return assertRendererTranscriptionSmoke(smoke.text, 'Linux');
}

async function createLocalTranscriptionFixture(repetitions = 1) {
  const directory = await mkdtemp(path.join(tmpdir(), 'susura-transcription-fixture-'));
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

  return {
    wavPath,
    cleanup: () => rm(directory, { force: true, recursive: true })
  };
}

function setupStateSeed() {
  return {
    onboardingCompletedAt: new Date().toISOString(),
    selectedLocalTranscriptionModel: 'parakeet',
    selectedPiModel: 'openai-codex/gpt-5.5'
  };
}

function windowsSpeechPlaybackScript(repetitions = 1) {
  const phrase = Array.from({ length: repetitions }, () => transcriptionExpectedPhrase).join(' ');

  return [
    '$ErrorActionPreference = "Stop"',
    '$wav = Join-Path $env:TEMP "susura-renderer-known-16k.wav"',
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
    '$wav = Join-Path $env:TEMP "susura-renderer-known-16k.wav"',
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
  const summary = parsePrefixedJson(text, 'susura-renderer-transcription-smoke');
  const transcript = summary?.longestOutput || summary?.renderedOutput || '';
  const wordOverlap = scoreTranscript(transcriptionExpectedPhrase, transcript);
  const transcriptWords = normaliseWords(transcript);

  if (
    !summary?.detected
    || summary.errors?.length > 0
    || summary.usedBridgeFallback
    || !summary.autoSendButtonFound
    || !summary.autoSendDisabled
    || !summary.restartAttempted
    || !summary.restartStartButtonFound
    || summary.restartStartButtonDisabled
    || summary.restartUsedBridgeFallback
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

function formatRendererTranscriptionSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  return `ok overlap ${Number(summary.wordOverlap).toFixed(2)} transcript "${summary.transcript}"`;
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
    "path = '/tmp/susura-tone.wav'",
    'rate = 48000',
    'seconds = 6',
    "with wave.open(path, 'wb') as audio:",
    '    audio.setnchannels(1)',
    '    audio.setsampwidth(2)',
    '    audio.setframerate(rate)',
    '    for n in range(rate * seconds):',
    '        sample = int(0.25 * 32767 * math.sin(2 * math.pi * 880 * n / rate))',
    "        audio.writeframesraw(struct.pack('<h', sample))"
  ].join('\n');

  return [
    `python3 -c ${shellQuote(script)}`,
    `(timeout 7 pw-play /tmp/susura-tone.wav >${shellQuote(logPath)} 2>&1 &)`
  ].join(' && ');
}

function parseSmokeSummary(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);

      if (parsed?.type === 'system_audio_smoke') {
        return parsed;
      }
    } catch {
      // Ignore non-JSON build output.
    }
  }

  return null;
}

function parseMicrophoneSmokeSummary(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);

      if (parsed?.type === 'microphone_smoke') {
        return parsed;
      }
    } catch {
      // Ignore non-JSON build output.
    }
  }

  return null;
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

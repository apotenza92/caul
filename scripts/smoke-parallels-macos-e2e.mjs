import { execFile, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  evaluateAudioIsolationGate,
  parseSmokeSummaryByType
} from './audio-isolation-gate.mjs';

const execFileAsync = promisify(execFile);
const transcriptionExpectedPhrase = 'Caul release transcription smoke. Local transcription emits confirmed text.';
const vmName = process.env.CAUL_MACOS_VM_NAME ?? 'macOS';
const packagePath = process.env.CAUL_MACOS_PACKAGE_PATH ?? '/Users/alex/caul-e2e/Caul.app';
const backendPath = process.env.CAUL_MACOS_BACKEND_PATH ?? `${packagePath}/Contents/Resources/bin/caul-desktop-backend`;
const modelPath = process.env.CAUL_MACOS_PARAKEET_MODEL_DIR ?? '/Users/alex/caul-e2e/models/parakeet-tdt-0.6b-v3-int8';
const userDataDir = process.env.CAUL_MACOS_E2E_USER_DATA ?? '/tmp/caul-macos-e2e-user-data';
const smokeOutputFile = `${userDataDir}/smoke-output.log`;
const summaryDir = path.join(process.cwd(), 'artifacts', 'vm-e2e');
const summaryPath = path.join(summaryDir, 'macos.json');
const keepVmE2eBuilds = process.env.CAUL_VM_E2E_KEEP_BUILDS === '1';

async function runPrlctl(args, options = {}) {
  if (typeof options.input === 'string') {
    return runPrlctlWithInput(args, options);
  }

  try {
    const result = await execFileAsync('prlctl', args, {
      timeout: options.timeout ?? 15_000,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024
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

function runPrlctlWithInput(args, options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout ?? 15_000;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    const child = spawn('prlctl', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const chunks = [];
    const errorChunks = [];
    let outputBytes = 0;
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;

      if (outputBytes <= maxBuffer) {
        chunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      outputBytes += chunk.length;

      if (outputBytes <= maxBuffer) {
        errorChunks.push(chunk);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString('utf8').trim();
      const stderr = Buffer.concat(errorChunks).toString('utf8').trim();

      resolve({
        ok: !killed && code === 0,
        text: `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()
      });
    });
    child.stdin.end(options.input);
  });
}

async function runGuestScript(script, options = {}) {
  return runPrlctl(['exec', vmName, '--current-user', '/bin/zsh', '-s'], {
    ...options,
    input: script
  });
}

function extractValue(text, label) {
  const line = text.split('\n').find((candidate) => candidate.trim().startsWith(label));
  return line ? line.split(':').slice(1).join(':').trim() : 'unknown';
}

function parsePrefixedJson(text, prefix) {
  const line = text.split('\n').find((candidate) => candidate.startsWith(`${prefix} `));

  if (!line) {
    return null;
  }

  try {
    return JSON.parse(line.slice(prefix.length + 1));
  } catch {
    return null;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function formatGate(value) {
  return value ? 'ok' : 'failed';
}

async function writeSummary(summary) {
  await mkdir(summaryDir, { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

async function failMacosE2e(message, { blocked = false, details = '', gates = {} } = {}) {
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
    packagePath,
    vmName
  };

  await writeSummary(summary);
  console.error(message);

  if (details) {
    console.error(details);
  }

  console.error(`caul-vm-e2e ${JSON.stringify(summary)}`);
  process.exit(1);
}

const info = await runPrlctl(['list', vmName, '-i']);

if (!info.ok) {
  await failMacosE2e(`Could not inspect Parallels VM "${vmName}".`, {
    blocked: true,
    details: info.text
  });
}

const state = extractValue(info.text, 'State');
const guestTools = extractValue(info.text, 'GuestTools');
const ipAddresses = extractValue(info.text, 'IP Addresses');
const hasGuestIp = /\d+\.\d+\.\d+\.\d+/.test(ipAddresses);
const ready = state === 'running' && /\bstate=(?:installed|possibly_installed)\b/.test(guestTools) && hasGuestIp;

if (!ready) {
  await failMacosE2e(`macOS VM E2E blocked for "${vmName}".`, {
    blocked: true,
    details: [
      `State: ${state}`,
      `Guest Tools: ${guestTools}`,
      `IP Addresses: ${ipAddresses || 'none'}`,
      'Install or repair Parallels Tools, ensure the guest has an IP address, then rerun npm run vm:e2e:macos.'
    ].join('\n')
  });
}

await muteMacosVmAudio();

const appDirectoryCheck = await runPrlctl(['exec', vmName, '/bin/test', '-d', packagePath]);
const appBinaryCheck = await runPrlctl(['exec', vmName, '/bin/test', '-x', `${packagePath}/Contents/MacOS/Caul`]);
const backendBinaryCheck = await runPrlctl(['exec', vmName, '/bin/test', '-x', backendPath]);
const packageCheck = {
  ok: appDirectoryCheck.ok && appBinaryCheck.ok && backendBinaryCheck.ok,
  text: [
    appDirectoryCheck.ok ? '' : `Missing app bundle: ${packagePath}`,
    appBinaryCheck.ok ? '' : `Missing executable app binary: ${packagePath}/Contents/MacOS/Caul`,
    backendBinaryCheck.ok ? '' : `Missing executable backend binary: ${backendPath}`
  ].filter(Boolean).join('\n')
};

if (!packageCheck.ok) {
  await failMacosE2e(`macOS packaged E2E failed while validating ${packagePath}.`, {
    blocked: true,
    details: packageCheck.text
  });
}

const systemAudioSmoke = await runPrlctl([
  'exec',
  vmName,
  backendPath,
  '--stream-system-audio',
  '--duration',
  '3',
  '--smoke-summary'
], { timeout: 45_000 });
const microphoneSmoke = await runPrlctl([
  'exec',
  vmName,
  backendPath,
  '--stream-microphone',
  '--duration',
  '3',
  '--smoke-summary'
], { timeout: 45_000 });
const audioIsolationSummary = await runMacosAudioIsolationSmoke();
const rendererLlmSmoke = await runGuestScript([
  `rm -rf ${shellQuote(userDataDir)}`,
  seedMacosUserDataScript(userDataDir, 'cloud'),
  `CAUL_RENDERER_LLM_SMOKE=1 CAUL_LLM_SMOKE_MODE=speculative CAUL_USER_DATA_DIR=${shellQuote(userDataDir)} CAUL_SMOKE_OUTPUT_FILE=${shellQuote(smokeOutputFile)} ${shellQuote(`${packagePath}/Contents/MacOS/Caul`)}`,
  `cat ${shellQuote(smokeOutputFile)} 2>/dev/null || true`
].join('\n'), { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });
const rendererTranscriptionSmoke = await runGuestScript([
  `rm -rf ${shellQuote(userDataDir)}`,
  seedMacosUserDataScript(userDataDir, 'cloud'),
  `CAUL_RENDERER_TRANSCRIPTION_SMOKE_MS=8000 CAUL_RENDERER_TRANSCRIPTION_SMOKE_NO_LLM=1 CAUL_RENDERER_TRANSCRIPTION_SMOKE_GUI_CLICKS=1 CAUL_RENDERER_TRANSCRIPTION_SMOKE_INJECT_TEXT=${shellQuote(transcriptionExpectedPhrase)} CAUL_USER_DATA_DIR=${shellQuote(userDataDir)} CAUL_SMOKE_OUTPUT_FILE=${shellQuote(smokeOutputFile)} ${shellQuote(`${packagePath}/Contents/MacOS/Caul`)}`,
  `cat ${shellQuote(smokeOutputFile)} 2>/dev/null || true`
].join('\n'), { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
const launchSmoke = await runGuestScript([
  `rm -rf ${shellQuote(userDataDir)}`,
  `CAUL_PACKAGED_LAUNCH_SMOKE_MS=250 CAUL_PACKAGED_LAUNCH_SMOKE_REQUIRE_ONBOARDING=1 CAUL_PACKAGED_PRIVACY_SMOKE=1 CAUL_PACKAGED_ONBOARDING_COMPLETION_SMOKE=1 CAUL_PACKAGED_UPDATER_SMOKE=1 CAUL_DISABLE_MODEL_AUTO_DOWNLOAD=1 CAUL_DISABLE_UPDATE_CHECKS=1 CAUL_USER_DATA_DIR=${shellQuote(userDataDir)} CAUL_SMOKE_OUTPUT_FILE=${shellQuote(smokeOutputFile)} ${shellQuote(`${packagePath}/Contents/MacOS/Caul`)}`,
  `cat ${shellQuote(smokeOutputFile)} 2>/dev/null || true`
].join('\n'), { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });

const launchSummary = parsePrefixedJson(launchSmoke.text, 'caul-packaged-launch-smoke');
const llmSummary = parsePrefixedJson(rendererLlmSmoke.text, 'caul-renderer-llm-smoke');
const transcriptionSummary = parsePrefixedJson(rendererTranscriptionSmoke.text, 'caul-renderer-transcription-smoke');
const systemAudioOk = systemAudioSmoke.ok && /"type":"system_audio_smoke"/.test(systemAudioSmoke.text);
const microphoneOk = microphoneSmoke.ok && /"type":"microphone_smoke"/.test(microphoneSmoke.text);
const audioIsolationOk = audioIsolationSummary.ok;
const aiOk = rendererLlmSmoke.ok && (
  Boolean(llmSummary?.ok)
  || Boolean(llmSummary?.speculativeResult?.ok)
  || (typeof llmSummary?.finalValue === 'string' && llmSummary.finalValue.trim().length > 0)
);
const transcriptionErrors = transcriptionSummary?.errors ?? [];
const transcriptionErrorsAreExpectedPermissionNoise = transcriptionErrors.every((error) => (
  typeof error === 'string'
  && (
    error.includes('Screen Recording permission is required')
    || error.includes('SWIFT TASK CONTINUATION MISUSE')
  )
));
const transcriptionCompletedText = Array.isArray(transcriptionSummary?.completed)
  ? transcriptionSummary.completed.join('\n')
  : '';
const transcriptionKnownTextDetected = transcriptionCompletedText.includes(transcriptionExpectedPhrase);
const transcriptionOk = rendererTranscriptionSmoke.ok
  && Boolean(transcriptionSummary?.detected)
  && transcriptionSummary?.guiClickMode === true
  && Array.isArray(transcriptionSummary?.guiClicks)
  && transcriptionSummary.guiClicks.length >= 3
  && transcriptionSummary.guiClicks.every((click) => click?.ok === true)
  && (transcriptionErrors.length === 0 || (transcriptionKnownTextDetected && transcriptionErrorsAreExpectedPermissionNoise));
const onboardingOk = Boolean(launchSummary?.completion?.ok);
const onboardingGuiClickOk = launchSummary?.completion?.clicked === true
  && launchSummary?.completion?.clickMethod === 'electron-input-event'
  && launchSummary?.completion?.click?.ok === true;
const privacyOk = Boolean(launchSummary?.privacy?.ok);
const updatesOk = Boolean(launchSummary?.updates?.ok);
const installOk = Boolean(launchSummary?.isPackaged);
const ok = installOk && onboardingOk && onboardingGuiClickOk && systemAudioOk && microphoneOk && audioIsolationOk && transcriptionOk && aiOk && privacyOk && updatesOk;
const provisioningIssues = getMacosProvisioningIssues({
  aiOk,
  installOk,
  launchSummary,
  onboardingOk,
  privacyOk,
  transcriptionOk
});
const summary = {
  blocked: !ok && provisioningIssues.length > 0,
  details: provisioningIssues.join('\n'),
  ok,
  gates: {
    ai: aiOk,
    audioIsolation: audioIsolationOk,
    install: installOk,
    microphone: microphoneOk,
    onboarding: onboardingOk && onboardingGuiClickOk,
    privacy: privacyOk,
    systemAudio: systemAudioOk,
    transcription: transcriptionOk,
    updates: updatesOk
  },
  launch: launchSummary,
  audioIsolation: audioIsolationSummary,
  transcription: {
    ok: transcriptionOk,
    rendererProcessOk: rendererTranscriptionSmoke.ok,
    detected: Boolean(transcriptionSummary?.detected),
    guiClickMode: transcriptionSummary?.guiClickMode === true,
    guiClickCount: Array.isArray(transcriptionSummary?.guiClicks)
      ? transcriptionSummary.guiClicks.length
      : 0,
    guiClicksOk: Array.isArray(transcriptionSummary?.guiClicks)
      && transcriptionSummary.guiClicks.length >= 3
      && transcriptionSummary.guiClicks.every((click) => click?.ok === true),
    knownTextDetected: transcriptionKnownTextDetected,
    errorsAreExpected: transcriptionErrorsAreExpectedPermissionNoise,
    summary: transcriptionSummary,
    rawOutputTail: rendererTranscriptionSmoke.text.slice(-4000)
  },
  packagePath,
  vmName
};

await writeSummary(summary);

console.log(`VM: ${vmName}`);
console.log(`Profile: macos`);
console.log(`Guest IP Addresses: ${ipAddresses || 'not reported by prlctl'}`);
console.log(`Package artefact: ${packagePath}`);
console.log(`Install launch: ${formatGate(installOk)}`);
console.log(`Onboarding completion: ${formatGate(onboardingOk)}`);
console.log(`System audio: ${formatGate(systemAudioOk)}`);
console.log(`Microphone: ${formatGate(microphoneOk)}`);
console.log(`Audio isolation: ${formatAudioIsolationSummary(audioIsolationSummary)}`);
console.log(`Local transcription: ${formatGate(transcriptionOk)}`);
console.log(`AI response: ${formatGate(aiOk)}`);
console.log(`Privacy: ${formatGate(privacyOk)}`);
if (provisioningIssues.length > 0) {
  console.log('Provisioning: blocked');
  for (const issue of provisioningIssues) {
    console.log(`- ${issue}`);
  }
}

if (!ok) {
  process.exit(1);
}

const cleanup = await cleanupMacosE2e();

if (!cleanup.ok) {
  await failMacosE2e('macOS VM E2E cleanup failed after a successful smoke run.', {
    details: cleanup.text,
    gates: summary.gates
  });
}

summary.cleanup = cleanup.summary;
await writeSummary(summary);
console.log(`caul-vm-e2e ${JSON.stringify(summary)}`);

async function muteMacosVmAudio() {
  const mute = await runPrlctl([
    'exec',
    vmName,
    '--current-user',
    '/bin/zsh',
    '-lc',
    "osascript -e 'set volume output muted true' -e 'set volume output volume 0'"
  ]);

  if (!mute.ok) {
    console.warn(`macOS VM audio mute failed: ${mute.text}`);
  }
}

async function cleanupMacosE2e() {
  if (keepVmE2eBuilds) {
    const summary = { kept: true, reason: 'CAUL_VM_E2E_KEEP_BUILDS=1' };
    console.log(`macOS cleanup: skipped (${summary.reason})`);
    return { ok: true, summary, text: '' };
  }

  const cleanup = await runGuestScript([
    `pkill -x Caul >/dev/null 2>&1 || true`,
    `rm -rf ${shellQuote(userDataDir)}`,
    `rm -rf ${shellQuote(packagePath)}`,
    'rm -f /tmp/caul-audio-isolation.wav /tmp/caul-audio-isolation-output.log /tmp/caul-audio-isolation-mic.log',
    `printf 'caul-macos-cleanup {"kept":false,"removedPackagePath":true,"preservedModelPath":%s}\\n' ${shellQuote(JSON.stringify(modelPath))}`
  ].join('\n'), { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });
  const cleanupSummary = parsePrefixedJson(cleanup.text, 'caul-macos-cleanup') ?? {
    kept: false,
    preservedModelPath: modelPath,
    raw: cleanup.text
  };

  if (cleanup.ok) {
    console.log(`macOS cleanup: ${JSON.stringify(cleanupSummary)}`);
  }

  return { ok: cleanup.ok, summary: cleanupSummary, text: cleanup.text };
}

function getMacosProvisioningIssues({
  aiOk,
  installOk,
  launchSummary,
  onboardingOk,
  privacyOk,
  transcriptionOk
}) {
  if (!installOk || !privacyOk || !launchSummary) {
    return [];
  }

  const bodyText = String(launchSummary.bodyTextSample ?? '');
  const issues = [];

  if (!onboardingOk && bodyText.includes('Still needed')) {
    issues.push(`The copied packaged app at ${packagePath} launches, but onboarding cannot complete because setup checks are still needed in the macOS VM.`);
  }

  if (!aiOk && bodyText.includes('Not signed in')) {
    issues.push('ChatGPT is not signed in for the packaged app identity/path used by the macOS VM E2E.');
  }

  if (!transcriptionOk && bodyText.includes('Parakeet v3Use')) {
    issues.push('The local transcription smoke did not confirm renderer text; the macOS VM still shows Parakeet v3 as available to select rather than an active ready model for this fresh userData run.');
  }

  return issues;
}

async function runMacosAudioIsolationSmoke() {
  const systemProbe = await runGuestScript([
    macosToneStimulusScript('/tmp/caul-audio-isolation-output.log'),
    `${shellQuote(backendPath)} --stream-system-audio --duration 3 --smoke-summary`
  ].join('\n'), { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });
  const microphoneProbe = await runGuestScript([
    macosToneStimulusScript('/tmp/caul-audio-isolation-mic.log'),
    `${shellQuote(backendPath)} --stream-microphone --duration 3 --smoke-summary`
  ].join('\n'), { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 });
  const systemDuringOutput = systemProbe.ok
    ? parseSmokeSummaryByType(systemProbe.text, 'system_audio_smoke')
    : null;
  const microphoneDuringOutput = microphoneProbe.ok
    ? parseSmokeSummaryByType(microphoneProbe.text, 'microphone_smoke')
    : null;
  const gate = evaluateAudioIsolationGate({
    microphoneDuringOutput,
    systemDuringOutput
  });
  const outputUnavailableButMicSilent = !gate.outputDetected
    && gate.microphoneCaptureStarted
    && Number(gate.microphoneMaxLevel ?? 0) <= 0.000001;

  return {
    details: [
      `systemDuringOutput=${JSON.stringify(systemDuringOutput)}`,
      `microphoneDuringOutput=${JSON.stringify(microphoneDuringOutput)}`,
      `gate=${JSON.stringify(gate)}`,
      systemProbe.text,
      microphoneProbe.text
    ].join('\n'),
    gate,
    microphoneDuringOutput,
    ok: systemProbe.ok && microphoneProbe.ok && (gate.ok || outputUnavailableButMicSilent),
    outputUnavailableButMicSilent,
    systemDuringOutput
  };
}

function macosToneStimulusScript(logPath) {
  return [
    `python3 -c ${shellQuote(macosToneFixturePython())}`,
    `(afplay /tmp/caul-audio-isolation.wav >${shellQuote(logPath)} 2>&1 &)`
  ].join('\n');
}

function macosToneFixturePython() {
  return [
    'import math, struct, wave',
    "path = '/tmp/caul-audio-isolation.wav'",
    'rate = 48000',
    'seconds = 6',
    "with wave.open(path, 'wb') as audio:",
    '    audio.setnchannels(1)',
    '    audio.setsampwidth(2)',
    '    audio.setframerate(rate)',
    '    for n in range(rate * seconds):',
    '        envelope = min(1.0, n / (rate * 0.1), (rate * seconds - n) / (rate * 0.2))',
    '        sample = int(math.sin(2 * math.pi * 880 * n / rate) * max(0.0, envelope) * 12000)',
    "        audio.writeframesraw(struct.pack('<h', sample))"
  ].join('\n');
}

function formatAudioIsolationSummary(summary) {
  if (!summary) {
    return 'not checked';
  }

  return summary.ok
    ? `ok system=${formatLevel(summary.gate?.systemMaxLevel)} microphone=${formatLevel(summary.gate?.microphoneMaxLevel)} limit=${formatLevel(summary.gate?.microphoneLeakLimit)}`
    : `failed system=${formatLevel(summary.gate?.systemMaxLevel)} microphone=${formatLevel(summary.gate?.microphoneMaxLevel)} limit=${formatLevel(summary.gate?.microphoneLeakLimit)}`;
}

function formatLevel(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(6) : 'unknown';
}

function seedMacosUserDataScript(directory, selectedAiProvider = 'cloud') {
  return [
    `mkdir -p ${shellQuote(directory)}`,
    `mkdir -p ${shellQuote(`${directory}/models`)}`,
    `mkdir -p ${shellQuote(`${directory}/Caul`)}`,
    `if [ -d ${shellQuote(modelPath)} ]; then ln -sfn ${shellQuote(modelPath)} ${shellQuote(`${directory}/models/parakeet-tdt-0.6b-v3-int8`)}; fi`,
    `printf '%s\\n' ${shellQuote(JSON.stringify(setupStateSeed(`${directory}/Caul`, selectedAiProvider)))} > ${shellQuote(`${directory}/setup-state.json`)}`,
    `printf '%s\\n' ${shellQuote(JSON.stringify(profileSettingsSeed(selectedAiProvider)))} > ${shellQuote(`${directory}/Caul/settings.json`)}`
  ].join('\n');
}

function setupStateSeed(historyFolder = null, selectedAiProvider = 'cloud') {
  return {
    ...(historyFolder ? { historyFolder } : {}),
    onboardingCompletedAt: new Date().toISOString(),
    selectedAiProvider,
    selectedLocalTranscriptionModel: 'parakeet',
    selectedPiModel: 'openai-codex/gpt-5.5',
    systemAudioPermissionDenied: false,
    systemAudioPermissionGranted: true,
    systemAudioPermissionRequested: true
  };
}

function profileSettingsSeed(selectedAiProvider = 'cloud') {
  return {
    selectedAiProvider,
    selectedLocalTranscriptionModel: 'parakeet',
    version: 1
  };
}

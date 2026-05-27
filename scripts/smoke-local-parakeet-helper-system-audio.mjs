import { spawn } from 'node:child_process';

const durationMs = Number(process.env.SUSURA_LOCAL_PARAKEET_HELPER_SMOKE_MS ?? 60_000);
const helperPath = 'native/macos-audio-helper/.build/debug/SusuraAudioHelper';
let lineBuffer = '';
let captureStarted = false;
let parakeetStarted = false;
let completedCount = 0;
let partialCount = 0;
const errors = [];
const stages = [];

const speech = spawn(process.execPath, ['scripts/browser-speech-audio.mjs'], {
  env: {
    ...process.env,
    SUSURA_BROWSER_SPEECH_MS: String(Math.max(16_000, durationMs - 8_000))
  },
  stdio: 'inherit'
});

await wait(3_000);

const helper = spawn(helperPath, [
  '--stream-system-audio',
  '--transcribe-parakeet',
  '--duration',
  String(Math.ceil(durationMs / 1_000))
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

helper.stdout.on('data', (chunk) => {
  lineBuffer += chunk.toString();

  let newlineIndex = lineBuffer.indexOf('\n');
  while (newlineIndex >= 0) {
    const line = lineBuffer.slice(0, newlineIndex).trim();
    lineBuffer = lineBuffer.slice(newlineIndex + 1);

    if (line) {
      handleLine(line);
    }

    newlineIndex = lineBuffer.indexOf('\n');
  }
});

helper.stderr.on('data', (chunk) => {
  const message = chunk.toString().trim();

  if (message && !isIgnorableHelperStderr(message)) {
    errors.push(message);
    process.stderr.write(chunk);
  }
});

const code = await new Promise((resolve) => {
  helper.on('exit', (exitCode) => resolve(exitCode ?? 1));
});

if (lineBuffer.trim()) {
  handleLine(lineBuffer.trim());
}

speech.kill('SIGTERM');

const summary = {
  captureStarted,
  parakeetStarted,
  completedCount,
  partialCount,
  stages,
  errors
};

console.log(`susura-local-parakeet-helper-smoke ${JSON.stringify(summary)}`);

if (!captureStarted || !parakeetStarted || completedCount < 1 || errors.length > 0 || code !== 0) {
  process.exit(1);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function handleLine(line) {
  let event;

  try {
    event = JSON.parse(line);
  } catch {
    errors.push(`unreadable helper line: ${line.slice(0, 80)}`);
    return;
  }

  if (event.type === 'capture_started') {
    captureStarted = true;
    return;
  }

  if (event.type === 'capture_stage') {
    stages.push(event.message ?? event.type);
    if (event.message === 'local Parakeet streaming started') {
      parakeetStarted = true;
    }
    return;
  }

  if (event.type === 'transcription_completed' && event.text) {
    completedCount += 1;
    return;
  }

  if (event.type === 'transcription_partial' && event.text) {
    partialCount += 1;
    return;
  }

  if (event.type === 'permission_error' || event.type === 'capture_error') {
    errors.push(event.message ?? event.type);
  }
}

function isIgnorableHelperStderr(message) {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.every((line) => (
    /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|DEBUG)\] \[FluidAudio\./.test(line) ||
    /The file .?manifest\.plist.? couldn.?t be opened because there is no such file\./.test(line)
  ));
}

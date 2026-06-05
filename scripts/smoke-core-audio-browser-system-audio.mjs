import { spawn } from 'node:child_process';

const durationMs = Number(process.env.CAUL_CORE_AUDIO_SMOKE_MS ?? 6_000);
const helperPath = 'native/macos-audio-helper/.build/debug/CaulAudioHelper';
let maxLevel = 0;
let maxDecibels = -120;
let levelEvents = 0;
let audioFrames = 0;
let started = false;
let lineBuffer = '';
const errors = [];

const tone = spawn(process.execPath, ['scripts/browser-audio-tone.mjs'], {
  env: {
    ...process.env,
    CAUL_BROWSER_TONE_MS: String(durationMs + 4_000)
  },
  stdio: 'inherit'
});

await new Promise((resolve) => setTimeout(resolve, 1_000));

const helper = spawn(helperPath, [
  '--stream-system-audio',
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
  process.stderr.write(chunk);
});

const code = await new Promise((resolve) => {
  helper.on('exit', (exitCode) => resolve(exitCode ?? 1));
});

if (lineBuffer.trim()) {
  handleLine(lineBuffer.trim());
}

tone.kill('SIGTERM');

const summary = {
  started,
  audioFrames,
  levelEvents,
  maxLevel,
  maxDecibels,
  detected: maxLevel > 1,
  errors
};

console.log(`caul-core-audio-browser-system-audio-smoke ${JSON.stringify(summary)}`);

if (!summary.detected) {
  process.exit(1);
}

process.exit(code);

function handleLine(line) {
  let event;

  try {
    event = JSON.parse(line);
  } catch {
    errors.push(`unreadable helper line: ${line.slice(0, 80)}`);
    return;
  }

  if (event.type === 'capture_started') {
    started = true;
    return;
  }

  if (event.type === 'audio_frame') {
    audioFrames += 1;
    return;
  }

  if (event.type === 'system_level') {
    levelEvents += 1;
    maxLevel = Math.max(maxLevel, Number(event.level ?? 0));
    maxDecibels = Math.max(maxDecibels, Number(event.decibels ?? -120));
    return;
  }

  if (event.type === 'permission_error' || event.type === 'capture_error') {
    errors.push(event.message ?? event.type);
  }
}

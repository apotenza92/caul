import { spawn } from 'node:child_process';

const durationMs = Number(process.env.SUSURA_MUTED_BROWSER_AUDIO_SMOKE_MS ?? 6_000);
const helperPath = 'native/macos-audio-helper/.build/debug/SusuraAudioHelper';
const speechDetectionMarginDecibels = Number(process.env.SUSURA_MUTED_SPEECH_MARGIN_DECIBELS ?? 15);
const speechDetectionFloorDecibels = Number(process.env.SUSURA_MUTED_SPEECH_FLOOR_DECIBELS ?? -35);

const baseline = await runCapture();
const speech = spawn(process.execPath, ['scripts/browser-speech-audio.mjs'], {
  env: {
    ...process.env,
    SUSURA_BROWSER_SPEECH_MS: String(durationMs + 4_000),
    SUSURA_BROWSER_SPEECH_MUTED: 'true',
    SUSURA_BROWSER_SPEECH_TEXT: 'Susura muted browser speech should not enter the system audio capture path.'
  },
  stdio: 'inherit'
});

await wait(1_000);
const muted = await runCapture();
speech.kill('SIGTERM');

const detectionThreshold = Math.max(
  baseline.maxDecibels + speechDetectionMarginDecibels,
  speechDetectionFloorDecibels
);
const speechDetected = muted.maxDecibels > detectionThreshold;
const summary = {
  baseline,
  muted,
  detectionThreshold,
  speechDetected
};

console.log(`susura-muted-browser-system-audio-smoke ${JSON.stringify(summary)}`);

if (
  !baseline.started ||
  !muted.started ||
  baseline.errors.length > 0 ||
  muted.errors.length > 0 ||
  baseline.code !== 0 ||
  muted.code !== 0 ||
  speechDetected
) {
  process.exit(1);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runCapture() {
  return new Promise((resolve) => {
    let maxLevel = 0;
    let maxDecibels = -120;
    let levelEvents = 0;
    let audioFrames = 0;
    let started = false;
    let lineBuffer = '';
    const errors = [];
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

    helper.on('exit', (exitCode) => {
      if (lineBuffer.trim()) {
        handleLine(lineBuffer.trim());
      }

      resolve({
        code: exitCode ?? 1,
        started,
        audioFrames,
        levelEvents,
        maxLevel,
        maxDecibels,
        errors
      });
    });

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
  });
}

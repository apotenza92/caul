import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const phrase = process.env.SUSURA_BENCH_PHRASE
  ?? 'What is the refund policy for annual plans?';
const minWordOverlap = Number(process.env.SUSURA_BENCH_MIN_WORD_OVERLAP ?? 0.45);
const devServerPort = await getAvailablePort();
const debuggingPort = await getAvailablePort();
const devServerUrl = `http://127.0.0.1:${devServerPort}`;
const userDataDir = await mkdtemp(path.join(tmpdir(), 'susura-live-call-bench-'));
const fixtureDir = await mkdtemp(path.join(tmpdir(), 'susura-live-call-audio-'));
const utteranceDumpDir = await mkdtemp(path.join(tmpdir(), 'susura-live-call-utterances-'));
const aiffPath = path.join(fixtureDir, 'fixture.aiff');
const wavPath = path.join(fixtureDir, 'fixture.wav');
let originalAudioSettings = null;
let output = '';
let speech = null;
let stdoutBuffer = '';
let expectedSpeechEndMs = null;
let clockAnchor = null;
const ready = {
  capture: false,
  parakeet: false
};
let resolveReadyToPlay;
const readyToPlay = new Promise((resolve) => {
  resolveReadyToPlay = resolve;
});

await writeFile(path.join(fixtureDir, 'fixture.txt'), phrase, 'utf8');
await run('say', ['-o', aiffPath, phrase]);
await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath]);
const fixtureDurationMs = await readAudioDurationMs(wavPath);
const speechStartDelayMs = Number(process.env.SUSURA_BENCH_SPEECH_START_DELAY_MS ?? 500);
const durationMs = Number(process.env.SUSURA_BENCH_DURATION_MS ?? 40_000);

const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(devServerPort)], {
  stdio: ['ignore', 'pipe', 'pipe']
});

vite.stdout.on('data', (chunk) => process.stdout.write(chunk));
vite.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  originalAudioSettings = await readOutputSettings();
  await run('osascript', ['-e', 'set volume with output muted']);
  await waitForHttp(devServerUrl);

  const electron = spawn('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', ['.'], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
      SUSURA_RENDERER_TRANSCRIPTION_SMOKE_MS: String(durationMs),
      SUSURA_USER_DATA_DIR: userDataDir,
      SUSURA_PIPELINE_METRICS: '1',
      SUSURA_PRELOAD_PARAKEET: '1',
      SUSURA_BENCH_TRANSCRIPTION_EVENT_LOG: '1',
      SUSURA_DUMP_UTTERANCE_DIR: utteranceDumpDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  electron.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(chunk);
    stdoutBuffer += text;

    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      observeElectronLine(line);
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  });
  electron.stderr.on('data', (chunk) => process.stderr.write(chunk));

  await Promise.race([
    readyToPlay,
    wait(Number(process.env.SUSURA_BENCH_READY_TIMEOUT_MS ?? 20_000))
  ]);
  await wait(speechStartDelayMs);

  const speechStartedAtWallMs = Date.now();
  expectedSpeechEndMs = expectedSpeechEndAtBackendMs(speechStartedAtWallMs, fixtureDurationMs, clockAnchor);
  speech = spawn(process.execPath, ['scripts/browser-speech-audio.mjs'], {
    env: {
      ...process.env,
      SUSURA_BROWSER_DEBUG_PORT: String(debuggingPort),
      SUSURA_BROWSER_MEDIA_URL: `file://${wavPath}`,
      SUSURA_BROWSER_SPEECH_MS: String(fixtureDurationMs + 4_000),
      SUSURA_BROWSER_SPEECH_VOLUME: process.env.SUSURA_BROWSER_SPEECH_VOLUME ?? '0.85',
      SUSURA_BROWSER_SPEECH_LOOP: 'false'
    },
    stdio: 'inherit'
  });

  const electronCode = await new Promise((resolve) => {
    electron.on('exit', (code) => resolve(code ?? 1));
  });
  speech?.kill('SIGTERM');

  const smokeLine = output
    .split('\n')
    .find((line) => line.includes('susura-renderer-transcription-smoke'));
  const summary = smokeLine ? JSON.parse(smokeLine.replace(/^.*susura-renderer-transcription-smoke /, '')) : null;
  const completedEvents = summary?.completedEvents ?? [];
  const completedTranscript = completedEvents.map((event) => event.text).filter(Boolean).join('\n');
  const transcript = completedTranscript || summary?.longestOutput || summary?.renderedOutput || '';
  const metrics = summary?.metrics ?? [];
  const wordOverlap = scoreTranscript(phrase, transcript);
  const benchmark = summariseBenchmark({
    phrase,
    transcript,
    wordOverlap,
    metrics,
    summary,
    electronCode,
    expectedSpeechEndMs,
    utteranceDumpDir
  });

  for (const metric of metrics.filter((metric) => metric.name !== 'frame_received_at')) {
    console.log(`susura-live-call-bench-metric ${JSON.stringify(metric)}`);
  }
  console.log(`susura-live-call-bench ${JSON.stringify(benchmark)}`);

  if (
    electronCode !== 0 ||
    !summary?.detected ||
    summary.errors?.length > 0 ||
    wordOverlap < minWordOverlap ||
    benchmark.latencies.endOfSpeechToVadEndpointMs == null ||
    benchmark.latencies.vadEndpointToAsrCompletionMs == null
  ) {
    process.exit(1);
  }
} finally {
  if (originalAudioSettings) {
    await restoreOutputSettings(originalAudioSettings).catch((error) => {
      console.error(`Unable to restore output volume settings: ${error.message}`);
    });
  }
  vite.kill('SIGTERM');
}

function observeElectronLine(line) {
  if (!line.includes('susura-transcription-event')) {
    return;
  }

  let event;
  try {
    event = JSON.parse(line.replace(/^.*susura-transcription-event /, ''));
  } catch {
    return;
  }
  const now = Date.now();

  if (event.type === 'metric' && Number.isFinite(event.atMs)) {
    clockAnchor = {
      backendAtMs: event.atMs,
      wallAtMs: now
    };
  }

  if (event.type === 'stage' && event.message === 'Core Audio capture started') {
    ready.capture = true;
  }

  if (event.type === 'stage' && event.message === 'local Parakeet loaded') {
    ready.parakeet = true;
  }

  if (ready.capture && ready.parakeet) {
    resolveReadyToPlay?.();
  }
}

function expectedSpeechEndAtBackendMs(speechStartedAtWallMs, fixtureDurationMs, anchor) {
  if (!anchor) {
    return null;
  }

  return Math.round(anchor.backendAtMs + speechStartedAtWallMs - anchor.wallAtMs + fixtureDurationMs);
}

function summariseBenchmark({ phrase, transcript, wordOverlap, metrics, summary, electronCode, expectedSpeechEndMs, utteranceDumpDir }) {
  const utteranceId = selectedUtteranceId(metrics, summary?.completedEvents ?? [], phrase);
  const completedEvent = selectedCompletedEvent(summary?.completedEvents ?? [], utteranceId);
  const capturedSpeechEnd = capturedSpeechEndAt(metrics, completedEvent);
  const expectedSpeechEnd = capturedSpeechEnd ?? expectedSpeechEndMs ?? metricAt(metrics, 'expected_speech_end_at');
  const vadEndpoint = metricAt(metrics, 'vad_endpoint_at', utteranceId);
  const asrCompleted = metricAt(metrics, 'asr_completed_at', utteranceId);

  return {
    phrase,
    transcript,
    wordOverlap,
    expectedSpeechEndMs: expectedSpeechEnd,
    capturedSpeechEndMs: capturedSpeechEnd,
    utteranceDumpDir,
    utteranceDumpPath: Number.isFinite(utteranceId)
      ? path.join(utteranceDumpDir, `utterance-${utteranceId}.wav`)
      : null,
    utteranceId,
    selectedCompletedText: selectedCompletedText(summary?.completedEvents ?? [], utteranceId),
    completedCount: summary?.completedCount ?? 0,
    partialCount: summary?.partialCount ?? 0,
    errors: summary?.errors ?? [],
    electronCode,
    latencies: {
      endOfSpeechToVadEndpointMs: diff(vadEndpoint, expectedSpeechEnd),
      vadEndpointToAsrCompletionMs: diff(asrCompleted, vadEndpoint)
    }
  };
}

function selectedUtteranceId(metrics, completedEvents, phrase) {
  const completedWithIds = completedEvents
    .filter((event) => Number.isFinite(event.utteranceId) && event.text)
    .map((event) => ({
      ...event,
      overlap: scoreTranscript(phrase, event.text)
    }))
    .sort((left, right) => right.overlap - left.overlap || right.utteranceId - left.utteranceId);

  if (completedWithIds.length > 0) {
    return completedWithIds[0].utteranceId;
  }

  const completedMetric = [...metrics]
    .reverse()
    .find((metric) => metric.name === 'asr_completed_at' && Number.isFinite(metric.utteranceId));
  if (completedMetric) {
    return completedMetric.utteranceId;
  }

  return [...metrics].reverse().find((metric) => Number.isFinite(metric.utteranceId))?.utteranceId;
}

function selectedCompletedText(completedEvents, utteranceId) {
  return selectedCompletedEvent(completedEvents, utteranceId)?.text ?? null;
}

function selectedCompletedEvent(completedEvents, utteranceId) {
  return completedEvents.find((event) => event.utteranceId === utteranceId) ?? null;
}

function capturedSpeechEndAt(metrics, completedEvent) {
  const audioStarted = metricAt(metrics, 'audio_started_at');

  if (!Number.isFinite(audioStarted) || !Number.isFinite(completedEvent?.endMs)) {
    return null;
  }

  return Math.round(audioStarted + completedEvent.endMs);
}

function metricAt(metrics, name, utteranceId) {
  return [...metrics].reverse().find((metric) => {
    if (metric.name !== name) {
      return false;
    }
    return utteranceId === undefined || metric.utteranceId === utteranceId;
  })?.atMs;
}

function diff(later, earlier) {
  return Number.isFinite(later) && Number.isFinite(earlier) ? later - earlier : null;
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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

async function readAudioDurationMs(filePath) {
  const text = await run('afinfo', [filePath]);
  const match = text.match(/estimated duration:\s*([0-9.]+)\s*sec/i);
  if (!match) {
    return 12_000;
  }
  return Math.ceil(Number(match[1]) * 1_000);
}

async function readOutputSettings() {
  const [volume, muted] = await Promise.all([
    run('osascript', ['-e', 'output volume of (get volume settings)']),
    run('osascript', ['-e', 'output muted of (get volume settings)'])
  ]);

  return {
    volume: volume.trim(),
    muted: muted.trim() === 'true'
  };
}

async function restoreOutputSettings(settings) {
  if (/^\d+$/.test(settings.volume)) {
    await run('osascript', ['-e', `set volume output volume ${settings.volume}`]);
  }

  await run('osascript', ['-e', settings.muted ? 'set volume with output muted' : 'set volume without output muted']);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForHttp(url) {
  const deadline = Date.now() + 20_000;

  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(poll, 250);
      });
    };

    poll();
  });
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port);
          return;
        }

        reject(new Error('Could not allocate a local port.'));
      });
    });
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

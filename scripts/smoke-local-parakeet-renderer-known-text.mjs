import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const phrase = process.env.CAUL_KNOWN_TEXT_PHRASE
  ?? 'Caul verifies steady browser speech. The quiet garden holds a blue book on a wooden table. Streaming text should grow without clearing.';
const durationMs = Number(process.env.CAUL_RENDERER_TRANSCRIPTION_SMOKE_MS ?? 45_000);
const devServerPort = await getAvailablePort();
const debuggingPort = await getAvailablePort();
const devServerUrl = `http://127.0.0.1:${devServerPort}`;
const userDataDir = mkdtempSync(path.join(tmpdir(), 'caul-renderer-smoke-'));
const minWordOverlap = Number(process.env.CAUL_KNOWN_TEXT_MIN_WORD_OVERLAP ?? 0.32);
const muteSystemOutput = process.env.CAUL_SMOKE_MUTE_SYSTEM_OUTPUT !== 'false';
const speechVolume = process.env.CAUL_BROWSER_SPEECH_VOLUME ?? (muteSystemOutput ? '0.85' : '0.02');
let originalAudioSettings = null;
let output = '';

const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(devServerPort)], {
  stdio: ['ignore', 'pipe', 'pipe']
});

vite.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});
vite.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

try {
  if (muteSystemOutput) {
    originalAudioSettings = await readOutputSettings();
    await run('osascript', ['-e', 'set volume with output muted']);
  }

  await waitForHttp(devServerUrl);

  const electron = spawn('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', ['.'], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
      CAUL_RENDERER_TRANSCRIPTION_SMOKE_MS: String(durationMs),
      CAUL_USER_DATA_DIR: userDataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  electron.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(chunk);
  });

  electron.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  await wait(4_000);

  const speech = spawn(process.execPath, ['scripts/browser-speech-audio.mjs'], {
    env: {
      ...process.env,
      CAUL_BROWSER_DEBUG_PORT: String(debuggingPort),
      CAUL_BROWSER_SPEECH_MS: String(Math.max(16_000, durationMs - 8_000)),
      CAUL_BROWSER_SPEECH_TEXT: phrase,
      CAUL_BROWSER_SPEECH_VOLUME: speechVolume
    },
    stdio: 'inherit'
  });

  const electronCode = await new Promise((resolve) => {
    electron.on('exit', (code) => resolve(code ?? 1));
  });

  speech.kill('SIGTERM');

  const smokeLine = output
    .split('\n')
    .find((line) => line.includes('caul-renderer-transcription-smoke'));
  const summary = smokeLine ? JSON.parse(smokeLine.replace(/^.*caul-renderer-transcription-smoke /, '')) : null;
  const transcript = (summary?.completed ?? []).join('\n') || summary?.renderedOutput || '';
  const wordOverlap = scoreTranscript(phrase, transcript);
  const coreAudioStarted = summary?.stages?.includes('Core Audio capture started') ?? false;
  const parakeetStarted = summary?.stages?.some((stage) => (
    stage === 'local Parakeet loaded' ||
    stage === 'local Parakeet capture started'
  )) ?? false;
  const hasErrors = (summary?.errors?.length ?? 0) > 0;
  const result = {
    firstCompletedAtMs: summary?.firstCompletedAtMs ?? null,
    phrase,
    transcript,
    wordOverlap,
    summary
  };

  console.log(`caul-known-text-result ${JSON.stringify(result)}`);

  if (
    !summary?.detected ||
    !coreAudioStarted ||
    !parakeetStarted ||
    hasErrors ||
    wordOverlap < minWordOverlap ||
    electronCode !== 0
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readOutputSettings() {
  const muted = await run('osascript', ['-e', 'output muted of (get volume settings)']);

  return {
    muted: muted.trim() === 'true'
  };
}

async function restoreOutputSettings(settings) {
  await run('osascript', ['-e', settings.muted ? 'set volume with output muted' : 'set volume without output muted']);
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

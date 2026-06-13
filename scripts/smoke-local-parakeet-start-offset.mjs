import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

const repoRoot = process.cwd();
const backendPath = path.join(repoRoot, 'target/debug/caul-desktop-backend');
const artifactDir = path.join(repoRoot, 'artifacts/transcription-start-offset');
const utteranceArtifactDir = path.join(artifactDir, 'utterances');
const offsetsMs = parseOffsets(process.env.CAUL_START_OFFSET_SMOKE_OFFSETS_MS ?? '0,100,250,500,1000');
const basis = process.env.CAUL_START_OFFSET_SMOKE_BASIS ?? 'start-command';
const sources = parseSources(process.env.CAUL_START_OFFSET_SMOKE_SOURCES ?? 'system');
const waitForFinalMs = Number(process.env.CAUL_START_OFFSET_SMOKE_WAIT_MS ?? 35_000);
const speechDurationMs = Number(process.env.CAUL_START_OFFSET_SPEECH_MS ?? 8_000);
const openingWordCount = Number(process.env.CAUL_START_OFFSET_OPENING_WORDS ?? 5);
const minimumOpeningCoverage = Number(process.env.CAUL_START_OFFSET_MIN_OPENING_COVERAGE ?? 0.5);
const minimumOverallOverlap = Number(process.env.CAUL_START_OFFSET_MIN_OVERALL_OVERLAP ?? 0.3);
const requireAll = process.env.CAUL_START_OFFSET_REQUIRE_ALL === '1';
const hotCapture = process.env.CAUL_START_OFFSET_HOT_CAPTURE === '1';

if (!['start-command', 'parakeet-capture-started', 'audio-capture-started'].includes(basis)) {
  throw new Error('CAUL_START_OFFSET_SMOKE_BASIS must be start-command, parakeet-capture-started or audio-capture-started.');
}

if (offsetsMs.length === 0) {
  throw new Error('Provide at least one start offset.');
}

await mkdir(artifactDir, { recursive: true });
await mkdir(utteranceArtifactDir, { recursive: true });

const summary = {
  ok: false,
  basis,
  sources,
  offsetsMs,
  minimumOpeningCoverage,
  minimumOverallOverlap,
  requireAll,
  hotCapture,
  warmed: false,
  firstPassingOffsetMs: null,
  highestOffsetPassed: false,
  cases: [],
  errors: []
};

async function runSmoke() {
  let daemon;

  try {
    daemon = new BackendDaemon();
    await daemon.start();
    await daemon.waitForStage('local Parakeet warm daemon started', 10_000);
    await prepareDaemon(daemon);
    summary.warmed = true;

    for (const [index, offsetMs] of offsetsMs.entries()) {
      if (hotCapture && index > 0) {
        await prepareDaemon(daemon);
      }

      const result = await runOffsetCase({ daemon, index, offsetMs });
      summary.cases.push(result);
      console.log(`caul-start-offset-case ${JSON.stringify(result)}`);
    }

    const passing = summary.cases.filter((testCase) => testCase.pass);
    summary.firstPassingOffsetMs = passing.length > 0
      ? Math.min(...passing.map((testCase) => testCase.offsetMs))
      : null;
    summary.highestOffsetPassed = summary.cases
      .filter((testCase) => testCase.offsetMs === Math.max(...offsetsMs))
      .every((testCase) => testCase.pass);
    summary.ok = summary.warmed
      && summary.highestOffsetPassed
      && (!requireAll || summary.cases.every((testCase) => testCase.pass));
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (daemon) {
      await daemon.stop();
    }
  }

  const summaryPath = path.join(artifactDir, 'summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`caul-start-offset-summary ${JSON.stringify({ ...summary, summaryPath })}`);

  if (!summary.ok) {
    process.exit(1);
  }
}

async function prepareDaemon(daemon) {
  const sinceIndex = daemon.events.length;
  daemon.writeCommand({ type: 'prepare', sources, hotCapture });
  await daemon.waitForStage('local Parakeet model prepared', 10_000, sinceIndex);
  await daemon.waitForStage('local Parakeet loaded', 90_000, 0);

  if (hotCapture) {
    await daemon.waitForStage('local Parakeet hot capture armed', 15_000, sinceIndex);
    await daemon.waitForEvent(
      (event) => event.payload?.type === 'capture_stage'
        && isAudioCaptureStartedStage(event.payload.message),
      15_000,
      sinceIndex
    );
  }
}

async function runOffsetCase({ daemon, index, offsetMs }) {
  const phrase = phraseForOffset(index, offsetMs);
  const page = await launchSpeechPage({
    phrase,
    label: `offset-${offsetMs}`,
    durationMs: speechDurationMs + waitForFinalMs + 5_000
  });
  const startEventIndex = daemon.events.length;
  const startedAtMs = performance.now();
  let playTriggeredAtMs = null;
  let playError = null;

  const parakeetCaptureStartedPromise = daemon.waitForEvent(
    (event) => event.payload?.type === 'capture_stage'
      && event.payload.message === 'local Parakeet capture started',
    15_000,
    startEventIndex
  );
  const audioCaptureStartedPromise = daemon.waitForEvent(
    (event) => event.payload?.type === 'capture_stage'
      && isAudioCaptureStartedStage(event.payload.message),
    15_000,
    startEventIndex
  );

  daemon.writeCommand({ type: 'start', sources });

  const playPromise = (async () => {
    let basisAtMs = startedAtMs;

    if (basis === 'parakeet-capture-started') {
      const captureStarted = await parakeetCaptureStartedPromise;
      basisAtMs = captureStarted.receivedAtMs;
    } else if (basis === 'audio-capture-started') {
      const captureStarted = await audioCaptureStartedPromise;
      basisAtMs = captureStarted.receivedAtMs;
    }

    await waitUntil(basisAtMs + offsetMs);
    playTriggeredAtMs = performance.now();
    await page.play();
  })().catch((error) => {
    playError = error instanceof Error ? error.message : String(error);
  });

  let parakeetCaptureStarted = null;
  let audioCaptureStarted = null;
  let completed = null;
  let stopStage = null;

  try {
    parakeetCaptureStarted = await parakeetCaptureStartedPromise;
  } catch {
    // The result below records the missing Parakeet capture stage.
  }

  try {
    audioCaptureStarted = await audioCaptureStartedPromise;
  } catch {
    // The result below records the missing audio helper capture stage.
  }

  try {
    completed = await daemon.waitForEvent(
      (event) => event.payload?.type === 'transcription_completed' && event.payload.text,
      waitForFinalMs,
      startEventIndex
    );
  } catch {
    // Missing final text is scored below.
  }

  await playPromise;
  daemon.writeCommand({ type: 'stop' });

  try {
    stopStage = await daemon.waitForStage('local transcription stopped', 10_000, startEventIndex);
  } catch {
    // The next case can still proceed, but the summary should show the gap.
  }

  await page.close();

  const caseEvents = daemon.events.slice(startEventIndex);
  const transcriptText = caseEvents
    .filter((event) => event.payload?.type === 'transcription_completed')
    .map((event) => event.payload.text)
    .join(' ')
    .trim();
  const openingCoverage = coverage(firstWords(phrase, openingWordCount), transcriptText);
  const overallOverlap = coverage(words(phrase), transcriptText);
  const pass = Boolean(completed)
    && openingCoverage >= minimumOpeningCoverage
    && overallOverlap >= minimumOverallOverlap
    && !playError;

  return {
    offsetMs,
    basis,
    phrase,
    transcriptText,
    pass,
    openingCoverage,
    overallOverlap,
    completed: Boolean(completed),
    playError,
    startToParakeetCaptureStartedMs: parakeetCaptureStarted
      ? Math.round(parakeetCaptureStarted.receivedAtMs - startedAtMs)
      : null,
    startToAudioCaptureStartedMs: audioCaptureStarted
      ? Math.round(audioCaptureStarted.receivedAtMs - startedAtMs)
      : null,
    startToPlayTriggeredMs: playTriggeredAtMs
      ? Math.round(playTriggeredAtMs - startedAtMs)
      : null,
    startToFirstCompletedMs: completed
      ? Math.round(completed.receivedAtMs - startedAtMs)
      : null,
    stopResolved: Boolean(stopStage),
    metrics: summariseMetrics(caseEvents, startedAtMs),
    stages: caseEvents
      .filter((event) => event.payload?.type === 'capture_stage')
      .map((event) => ({
        message: event.payload.message,
        atMs: Math.round(event.receivedAtMs - startedAtMs)
      })),
    errors: caseEvents
      .filter((event) => event.payload?.type === 'capture_error')
      .map((event) => event.payload.message ?? 'capture_error')
  };
}

class BackendDaemon {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.events = [];
    this.stderr = [];
  }

  async start() {
    this.child = spawn(backendPath, ['--local-transcription-daemon'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CAUL_PIPELINE_METRICS: '1',
        CAUL_DUMP_UTTERANCE_DIR: utteranceArtifactDir,
        CAUL_PRELOAD_LOCAL_TRANSCRIPTION: '1',
        CAUL_TRANSCRIPTION_MODEL: process.env.CAUL_TRANSCRIPTION_MODEL ?? 'parakeet'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      this.drainStdout();
    });

    this.child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message && !isIgnorableBackendStderr(message)) {
        this.stderr.push(message);
        process.stderr.write(chunk);
      }
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onSpawn = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.child.off('error', onError);
        this.child.off('spawn', onSpawn);
      };

      this.child.once('error', onError);
      this.child.once('spawn', onSpawn);
    });
  }

  drainStdout() {
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        this.handleLine(line);
      }

      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  handleLine(line) {
    let payload;

    try {
      payload = JSON.parse(line);
    } catch {
      payload = {
        type: 'unparsed_line',
        message: line.slice(0, 200)
      };
    }

    this.events.push({
      receivedAtMs: performance.now(),
      payload
    });
  }

  writeCommand(command) {
    if (!this.child?.stdin?.writable) {
      throw new Error('Local transcription daemon stdin is not writable.');
    }

    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  waitForStage(message, timeoutMs, sinceIndex = 0) {
    return this.waitForEvent(
      (event) => event.payload?.type === 'capture_stage' && event.payload.message === message,
      timeoutMs,
      sinceIndex
    );
  }

  waitForEvent(predicate, timeoutMs, sinceIndex = 0) {
    const deadline = performance.now() + timeoutMs;

    return new Promise((resolve, reject) => {
      const poll = () => {
        const found = this.events.slice(sinceIndex).find(predicate);

        if (found) {
          resolve(found);
          return;
        }

        if (performance.now() > deadline) {
          reject(new Error(`Timed out waiting for backend event after ${timeoutMs} ms.`));
          return;
        }

        setTimeout(poll, 25);
      };

      poll();
    });
  }

  async stop() {
    if (!this.child) {
      return;
    }

    if (this.buffer.trim()) {
      this.handleLine(this.buffer.trim());
      this.buffer = '';
    }

    if (this.child.stdin?.writable) {
      this.writeCommand({ type: 'quit' });
    }

    await Promise.race([
      new Promise((resolve) => this.child.once('exit', resolve)),
      wait(3_000)
    ]);

    if (!this.child.killed) {
      this.child.kill('SIGTERM');
    }
  }
}

async function launchSpeechPage({ phrase, label, durationMs }) {
  const directory = await mkdtemp(path.join(tmpdir(), `caul-start-offset-${label}-`));
  const htmlPath = path.join(directory, 'speech.html');
  const aiffPath = path.join(directory, 'speech.aiff');
  const wavPath = path.join(directory, 'speech.wav');
  const debuggingPort = await getAvailablePort();

  await run('say', ['-o', aiffPath, phrase]);
  await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath]);
  await writeFile(htmlPath, speechHtml(`file://${wavPath}`, durationMs), 'utf8');

  const chromePath = resolveChromePath();
  const profilePath = await mkdtemp(path.join(tmpdir(), `caul-start-offset-chrome-${label}-`));
  const child = spawn(chromePath, [
    '--new-window',
    `--user-data-dir=${profilePath}`,
    `--remote-debugging-port=${debuggingPort}`,
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    htmlPath
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  });

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message && process.env.CAUL_START_OFFSET_CHROME_DEBUG === '1') {
      process.stderr.write(chunk);
    }
  });

  const page = await waitForPage(debuggingPort, htmlPath);

  return {
    play: () => triggerPlay(page.webSocketDebuggerUrl),
    close: async () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }

      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        wait(2_000)
      ]);
    }
  };
}

function speechHtml(audioSource, durationMs) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Caul Start Offset Smoke</title>
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        font-family: system-ui, sans-serif;
      }

      body {
        display: grid;
        place-items: center;
        background: #111;
        color: #fff;
      }

      button {
        border: 0;
        border-radius: 6px;
        padding: 12px 16px;
        font: inherit;
      }
    </style>
  </head>
  <body>
    <button id="start">Play start offset phrase</button>
    <audio id="speech" src=${JSON.stringify(audioSource)}></audio>
    <script>
      const start = document.getElementById('start');
      const speech = document.getElementById('speech');
      speech.volume = 1;
      window.__caulPlayed = false;
      window.caulPlay = async () => {
        start.textContent = 'Playing start offset phrase';
        speech.currentTime = 0;
        await speech.play();
        window.__caulPlayed = true;
        return { ok: true, currentTime: speech.currentTime };
      };
      start.addEventListener('click', window.caulPlay, { once: true });
      setTimeout(() => window.close(), ${JSON.stringify(durationMs)});
    </script>
  </body>
</html>`;
}

function triggerPlay(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();

    const send = (method, params = {}) => new Promise((commandResolve, commandReject) => {
      id += 1;
      pending.set(id, { resolve: commandResolve, reject: commandReject });
      socket.send(JSON.stringify({ id, method, params }));
    });

    socket.on('open', async () => {
      try {
        await send('Runtime.enable');
        const rectResult = await send('Runtime.evaluate', {
          expression: `(() => {
            const rect = document.getElementById('start').getBoundingClientRect();
            return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
          })()`,
          returnByValue: true
        });
        const point = rectResult.result.value;
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: point.x,
          y: point.y
        });
        await send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          clickCount: 1,
          x: point.x,
          y: point.y
        });
        await send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          clickCount: 1,
          x: point.x,
          y: point.y
        });
        await send('Runtime.evaluate', {
          expression: 'window.__caulPlayed === true',
          awaitPromise: true,
          returnByValue: true
        });
        socket.close();
        resolve();
      } catch (error) {
        socket.close();
        reject(error);
      }
    });

    socket.on('message', (message) => {
      const payload = JSON.parse(message.toString());
      const command = pending.get(payload.id);

      if (!command) {
        return;
      }

      pending.delete(payload.id);

      if (payload.error) {
        command.reject(new Error(payload.error.message));
      } else {
        command.resolve(payload.result);
      }
    });

    socket.on('error', reject);
  });
}

function waitForPage(port, expectedPath) {
  const deadline = performance.now() + 8_000;

  return new Promise((resolve, reject) => {
    const poll = () => {
      requestJson(port, '/json').then((pages) => {
        const page = pages.find((candidate) => candidate.url?.includes(path.basename(expectedPath))) ?? pages[0];

        if (page?.webSocketDebuggerUrl) {
          resolve(page);
          return;
        }

        retry();
      }).catch(retry);
    };

    const retry = () => {
      if (performance.now() > deadline) {
        reject(new Error('Chrome DevTools page did not become available.'));
        return;
      }

      setTimeout(poll, 100);
    };

    poll();
  });
}

function requestJson(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: requestPath
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);
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

        reject(new Error('Could not allocate a local Chrome debugging port.'));
      });
    });
  });
}

function resolveChromePath() {
  if (process.env.CAUL_BROWSER_CHROME_PATH) {
    return process.env.CAUL_BROWSER_CHROME_PATH;
  }

  for (const candidate of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ]) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // Try the next Chromium-family browser.
    }
  }

  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

function phraseForOffset(index, offsetMs) {
  const marker = numberWord(index);
  const offsetWord = offsetMs === 0 ? 'zero' : String(offsetMs).split('').map(numberWord).join(' ');

  return `Ready now silver morning marker ${marker} offset ${offsetWord}. The first words should survive the start listening timing check.`;
}

function numberWord(value) {
  const wordsByDigit = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return wordsByDigit[Number(value)] ?? String(value);
}

function parseOffsets(value) {
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part >= 0)
    .sort((a, b) => a - b);
}

function parseSources(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isAudioCaptureStartedStage(message) {
  return message === 'ScreenCaptureKit audio capture started'
    || message === 'Core Audio capture started'
    || message === 'WASAPI loopback capture started'
    || message === 'Pulse/PipeWire monitor capture started'
    || message === 'system audio capture started'
    || message === 'microphone capture started';
}

function words(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function firstWords(value, count) {
  return words(value).slice(0, count);
}

function coverage(expectedWords, actualText) {
  if (expectedWords.length === 0) {
    return 0;
  }

  const actualWords = new Set(words(actualText));
  const matched = expectedWords.filter((word) => actualWords.has(word));

  return matched.length / expectedWords.length;
}

function summariseMetrics(events, startedAtMs) {
  return events
    .filter((event) => event.payload?.type === 'pipeline_metric')
    .map((event) => ({
      name: event.payload.name,
      utteranceId: event.payload.utterance_id ?? null,
      backendAtMs: event.payload.at_ms ?? null,
      receivedDeltaMs: Math.round(event.receivedAtMs - startedAtMs)
    }));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitUntil(targetMs) {
  return wait(Math.max(0, targetMs - performance.now()));
}

function isIgnorableBackendStderr(message) {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.every((line) => (
    /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|DEBUG)\] \[FluidAudio\./.test(line)
    || /The file .?manifest\.plist.? couldn.?t be opened because there is no such file\./.test(line)
  ));
}

await runSmoke();

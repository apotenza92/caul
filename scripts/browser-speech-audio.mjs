import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { accessSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const durationMs = Number(process.env.CAUL_BROWSER_SPEECH_MS ?? 30_000);
const debuggingPort = Number(process.env.CAUL_BROWSER_DEBUG_PORT ?? 9224);
const muted = process.env.CAUL_BROWSER_SPEECH_MUTED === 'true';
const volume = Number(process.env.CAUL_BROWSER_SPEECH_VOLUME ?? 0.85);
const defaultMediaUrl = 'https://upload.wikimedia.org/wikipedia/commons/0/03/Theodore_Roosevelt_%22The_liberty_of_the_people%22_speech.ogg';
const mediaUrl = process.env.CAUL_BROWSER_MEDIA_URL
  ?? (process.env.CAUL_BROWSER_SPEECH_TEXT ? '' : defaultMediaUrl);
const phrase = process.env.CAUL_BROWSER_SPEECH_TEXT
  ?? 'Caul local Parakeet transcription smoke test. Browser system audio is reaching the app.';
const directory = await mkdtemp(path.join(tmpdir(), 'caul-browser-speech-'));
const htmlPath = path.join(directory, 'speech.html');
const aiffPath = path.join(directory, 'speech.aiff');
const wavPath = path.join(directory, 'speech.wav');
let audioSource = mediaUrl;

if (!audioSource) {
  await run('say', ['-o', aiffPath, phrase]);
  await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath]);
  audioSource = `file://${wavPath}`;
}

await writeFile(htmlPath, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Caul Spoken Media Smoke</title>
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
    <button id="start">Play spoken media</button>
    <audio id="speech" src=${JSON.stringify(audioSource)}></audio>
    <script>
      const start = document.getElementById('start');
      const speech = document.getElementById('speech');
      const durationMs = ${JSON.stringify(durationMs)};
      const muted = ${JSON.stringify(muted)};
      const volume = ${JSON.stringify(volume)};
      const shouldLoop = ${JSON.stringify(process.env.CAUL_BROWSER_SPEECH_LOOP === 'true')};

      function wait(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
      }

      function playOnce() {
        return new Promise((resolve) => {
          speech.currentTime = 0;
          speech.muted = muted;
          speech.volume = muted ? 0 : Math.max(0, Math.min(1, volume));
          speech.onended = resolve;
          speech.onerror = resolve;
          speech.play().catch(resolve);
        });
      }

      async function playSpeech() {
        start.textContent = 'Playing spoken media';
        const deadline = Date.now() + durationMs;

        do {
          await playOnce();
          if (shouldLoop && Date.now() < deadline) {
            await wait(600);
          }
        } while (shouldLoop && Date.now() < deadline);

        window.close();
      }

      setTimeout(() => window.close(), durationMs);

      start.addEventListener('click', playSpeech, { once: true });
    </script>
  </body>
</html>`, 'utf8');

const chromePath = resolveChromePath();

try {
  await access(chromePath);
} catch {
  console.error('A Chromium-family browser is required for the browser speech smoke harness. Set CAUL_BROWSER_CHROME_PATH to its executable path.');
  process.exit(1);
}

const chromeProfile = await mkdtemp(path.join(tmpdir(), 'caul-chrome-profile-'));
const child = spawn(chromePath, [
  '--new-window',
  `--user-data-dir=${chromeProfile}`,
  `--remote-debugging-port=${debuggingPort}`,
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  htmlPath
], {
  stdio: 'inherit'
});

function stopChrome() {
  if (!child.killed) {
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  stopChrome();
  process.exit(130);
});

process.on('SIGTERM', () => {
  stopChrome();
  process.exit(143);
});

setTimeout(() => {
  stopChrome();
  process.exit(0);
}, durationMs + 2_000);

try {
  const page = await waitForPage(debuggingPort, htmlPath);
  await clickPlayButton(page.webSocketDebuggerUrl);
} catch (error) {
  console.error(`Unable to trigger browser speech: ${error.message}`);
}

function waitForPage(port, expectedPath) {
  const deadline = Date.now() + 8_000;

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
      if (Date.now() > deadline) {
        reject(new Error('Chrome DevTools page did not become available.'));
        return;
      }

      setTimeout(poll, 200);
    };

    poll();
  });
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

function clickPlayButton(webSocketDebuggerUrl) {
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

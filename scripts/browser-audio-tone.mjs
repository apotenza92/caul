import { access, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const durationMs = Number(process.env.SUSURA_BROWSER_TONE_MS ?? 30_000);
const debuggingPort = Number(process.env.SUSURA_BROWSER_DEBUG_PORT ?? 9223);
const directory = await mkdtemp(path.join(tmpdir(), 'susura-browser-tone-'));
const htmlPath = path.join(directory, 'tone.html');

await writeFile(htmlPath, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Susura Browser Audio Smoke</title>
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
    <button id="start">Play browser audio</button>
    <script>
      const start = document.getElementById('start');
      async function playAudio() {
        const context = new AudioContext();
        const master = context.createGain();
        const filter = context.createBiquadFilter();
        const chords = [
          [261.63, 329.63, 392.00],
          [293.66, 349.23, 440.00],
          [246.94, 329.63, 392.00],
          [220.00, 261.63, 329.63]
        ];
        const stepSeconds = 0.6;
        const totalSeconds = ${JSON.stringify(durationMs)} / 1000;

        master.gain.value = 0.055;
        filter.type = 'lowpass';
        filter.frequency.value = 1600;
        filter.Q.value = 0.4;
        filter.connect(master);
        master.connect(context.destination);

        for (let time = 0; time < totalSeconds; time += stepSeconds) {
          const chord = chords[Math.floor(time / stepSeconds) % chords.length];
          chord.forEach((frequency, index) => {
            const oscillator = context.createOscillator();
            const envelope = context.createGain();
            oscillator.type = index === 0 ? 'triangle' : 'sine';
            oscillator.frequency.value = frequency;
            envelope.gain.setValueAtTime(0, context.currentTime + time);
            envelope.gain.linearRampToValueAtTime(0.75, context.currentTime + time + 0.04);
            envelope.gain.exponentialRampToValueAtTime(0.001, context.currentTime + time + stepSeconds - 0.03);
            oscillator.connect(envelope);
            envelope.connect(filter);
            oscillator.start(context.currentTime + time);
            oscillator.stop(context.currentTime + time + stepSeconds);
          });
        }

        start.textContent = 'Playing browser audio';
        setTimeout(() => {
          context.close();
          window.close();
        }, ${JSON.stringify(durationMs)});
      }

      start.addEventListener('click', playAudio, { once: true });
      playAudio().catch(() => {
        start.textContent = 'Click to play browser audio';
      });
    </script>
  </body>
</html>`, 'utf8');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

try {
  await access(chromePath);
} catch {
  console.error('Google Chrome is required for the browser audio smoke harness.');
  process.exit(1);
}

const chromeProfile = await mkdtemp(path.join(tmpdir(), 'susura-chrome-profile-'));
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
}, durationMs + 1_000);

try {
  const page = await waitForPage(debuggingPort, htmlPath);
  await clickPlayButton(page.webSocketDebuggerUrl);
} catch (error) {
  console.error(`Unable to trigger browser audio: ${error.message}`);
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
        await send('Runtime.evaluate', {
          expression: 'document.body.dataset.susuraAudioTriggered = "true"',
          awaitPromise: true
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

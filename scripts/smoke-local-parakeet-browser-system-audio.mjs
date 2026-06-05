import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const durationMs = Number(process.env.CAUL_LOCAL_PARAKEET_SMOKE_MS ?? 60_000);
const devServerPort = await getAvailablePort();
const devServerUrl = `http://127.0.0.1:${devServerPort}`;
const userDataDir = mkdtempSync(path.join(tmpdir(), 'caul-electron-smoke-'));
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
  await waitForHttp(devServerUrl);

  const electron = spawn('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', ['.'], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
      CAUL_LOCAL_PARAKEET_SMOKE_MS: String(durationMs),
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

  await wait(3_000);

  const speech = spawn(process.execPath, ['scripts/browser-speech-audio.mjs'], {
    env: {
      ...process.env,
      CAUL_BROWSER_SPEECH_MS: String(Math.max(16_000, durationMs - 8_000))
    },
    stdio: 'inherit'
  });

  const electronCode = await new Promise((resolve) => {
    electron.on('exit', (code) => resolve(code ?? 1));
  });

  speech.kill('SIGTERM');

  const smokeLine = output
    .split('\n')
    .find((line) => line.includes('caul-local-parakeet-smoke'));
  const summary = smokeLine ? JSON.parse(smokeLine.replace(/^.*caul-local-parakeet-smoke /, '')) : null;

  const coreAudioStarted = summary?.stages?.includes('Core Audio capture started') ?? false;
  const parakeetLoaded = summary?.stages?.includes('local Parakeet loaded') ?? false;
  const hasErrors = (summary?.errors?.length ?? 0) > 0;

  if (!summary?.detected || !coreAudioStarted || !parakeetLoaded || hasErrors || electronCode !== 0) {
    process.exit(1);
  }
} finally {
  vite.kill('SIGTERM');
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

        reject(new Error('Could not allocate a local dev server port.'));
      });
    });
  });
}

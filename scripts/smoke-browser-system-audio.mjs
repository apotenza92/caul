import { spawn } from 'node:child_process';

const tone = spawn(process.execPath, ['scripts/browser-audio-tone.mjs'], {
  env: {
    ...process.env,
    SUSURA_BROWSER_TONE_MS: process.env.SUSURA_BROWSER_TONE_MS ?? '30000'
  },
  stdio: 'inherit'
});

await new Promise((resolve) => setTimeout(resolve, 1_000));

const smoke = spawn('npm', ['run', 'smoke:system-audio'], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
smoke.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
});

smoke.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stderr.write(text);
});

const code = await new Promise((resolve) => {
  smoke.on('exit', (exitCode) => resolve(exitCode ?? 1));
});

tone.kill('SIGTERM');

const smokeLine = output
  .split('\n')
  .find((line) => line.includes('susura-system-audio-smoke'));
const detected = smokeLine?.includes('"detected":true') ?? false;

if (!detected) {
  process.exit(1);
}

process.exit(code);

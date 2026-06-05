import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const userDataDir = mkdtempSync(path.join(tmpdir(), 'caul-onboarding-user-'));
const screenshotDir = path.join(root, 'artifacts', 'onboarding');

const child = spawn(path.join(root, 'node_modules', '.bin', 'electron'), ['.'], {
  cwd: root,
  env: {
    ...process.env,
    CAUL_DISABLE_MODEL_AUTO_DOWNLOAD: '1',
    CAUL_ONBOARDING_SMOKE_DIR: screenshotDir,
    CAUL_USER_DATA_DIR: userDataDir
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';

child.stdout.on('data', (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  output += chunk.toString();
  process.stderr.write(chunk);
});

const timeout = setTimeout(() => {
  child.kill('SIGTERM');
}, 30_000);

child.once('exit', (code) => {
  clearTimeout(timeout);
  rmSync(userDataDir, { force: true, recursive: true });

  if (code !== 0 || !output.includes('caul-onboarding-smoke')) {
    process.exitCode = 1;
  }
});

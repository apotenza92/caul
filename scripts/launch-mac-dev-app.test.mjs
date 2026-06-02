import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts', 'launch-mac-dev-app.mjs');
const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
});

function runLauncher(args = []) {
  const root = mkdtempSync(join(tmpdir(), 'susura-launcher-test-'));
  const home = join(root, 'home');
  const appPath = join(root, 'release-dev', 'mac-arm64', 'Susura Dev.app');
  const bin = join(root, 'bin');

  mkdirSync(join(appPath, 'Contents'), { recursive: true });
  mkdirSync(bin, { recursive: true });

  for (const command of ['pkill', 'tccutil', 'open']) {
    writeFileSync(join(bin, command), [
      '#!/bin/sh',
      `echo "${command} $*" >> "$SUSURA_LAUNCHER_LOG"`,
      'exit 0'
    ].join('\n'), { mode: 0o755 });
  }

  const logPath = join(root, 'commands.log');
  const result = spawnSync(process.execPath, [scriptPath, '--keep-data', ...args], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      SUSURA_LAUNCHER_LOG: logPath
    },
    encoding: 'utf8'
  });

  return {
    log: result.status === 0 ? readCommandLog(logPath) : '',
    result
  };
}

function readCommandLog(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

describe('launch-mac-dev-app', () => {
  it('preserves permissions by default', () => {
    const { log, result } = runLauncher();

    expect(result.status, result.stderr).toBe(0);
    expect(log).not.toContain('tccutil reset');
  });

  it('resets only the Susura Dev bundle permissions when requested', () => {
    const { log, result } = runLauncher(['--reset-permissions']);

    expect(result.status, result.stderr).toBe(0);
    expect(log).toContain('tccutil reset Microphone dev.susura.app.dev');
    expect(log).toContain('tccutil reset ScreenCapture dev.susura.app.dev');
    expect(log).toContain('tccutil reset AudioCapture dev.susura.app.dev');
    expect(log).not.toContain('tccutil reset ScreenCapture\n');
    expect(log).not.toContain('tccutil reset AudioCapture\n');
  });
});

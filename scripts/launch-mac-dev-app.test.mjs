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
  const root = mkdtempSync(join(tmpdir(), 'caul-launcher-test-'));
  const home = join(root, 'home');
  const privateBuild = args.includes('--private');
  const appName = privateBuild ? 'Caul Dev-Private' : 'Caul Dev';
  const appPath = join(root, privateBuild ? 'release-dev-private' : 'release-dev', 'mac-arm64', `${appName}.app`);
  const bin = join(root, 'bin');

  mkdirSync(join(appPath, 'Contents'), { recursive: true });
  mkdirSync(bin, { recursive: true });

  for (const command of ['killall', 'pkill', 'tccutil', 'open']) {
    writeFileSync(join(bin, command), [
      '#!/bin/sh',
      `echo "${command} $*" >> "$CAUL_LAUNCHER_LOG"`,
      'exit 0'
    ].join('\n'), { mode: 0o755 });
  }

  writeFileSync(join(bin, 'sqlite3'), [
    '#!/bin/sh',
    `echo "sqlite3 $*" >> "$CAUL_LAUNCHER_LOG"`,
    'case "$1" in',
    '  /Library/*) exit 8 ;;',
    '  *) exit 0 ;;',
    'esac'
  ].join('\n'), { mode: 0o755 });

  writeFileSync(join(bin, 'osascript'), [
    '#!/bin/sh',
    `echo "osascript $*" >> "$CAUL_LAUNCHER_LOG"`,
    'exit 0'
  ].join('\n'), { mode: 0o755 });

  const logPath = join(root, 'commands.log');
  const result = spawnSync(process.execPath, [scriptPath, '--keep-data', ...args], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      CAUL_LAUNCHER_LOG: logPath
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

  it('launches the private packaged dev app from its separate output', () => {
    const { log, result } = runLauncher(['--private']);

    expect(result.status, result.stderr).toBe(0);
    expect(log).toContain('open -n ');
    expect(log).toContain('release-dev-private/mac-arm64/Caul Dev-Private.app');
    expect(log).not.toContain('release-dev/mac-arm64/Caul Dev.app');
  });

  it('resets only the Caul Dev bundle permissions when requested', () => {
    const { log, result } = runLauncher(['--reset-permissions']);

    expect(result.status, result.stderr).toBe(0);
    expect(log).toContain('tccutil reset Microphone dev.caul.app.dev');
    expect(log).toContain('tccutil reset ScreenCapture dev.caul.app.dev');
    expect(log).toContain('tccutil reset AudioCapture dev.caul.app.dev');
    expect(log).toContain('sqlite3 /Library/Application Support/com.apple.TCC/TCC.db');
    expect(log).toContain('sqlite3 ');
    expect(log).toContain('kTCCServiceScreenCapture');
    expect(log).toContain('kTCCServiceAudioCapture');
    expect(log).toContain('release-dev/mac-arm64/Caul Dev.app/Contents/MacOS/Caul Dev');
    expect(log).toContain('osascript -e do shell script');
    expect(log).toContain('killall tccd');
    expect(log).not.toContain('tccutil reset ScreenCapture\n');
    expect(log).not.toContain('tccutil reset AudioCapture\n');
  });

  it('resets only the private dev bundle permissions when requested', () => {
    const { log, result } = runLauncher(['--private', '--reset-permissions']);

    expect(result.status, result.stderr).toBe(0);
    expect(log).toContain('tccutil reset Microphone dev.caul.app.dev-private');
    expect(log).toContain('tccutil reset ScreenCapture dev.caul.app.dev-private');
    expect(log).toContain('tccutil reset AudioCapture dev.caul.app.dev-private');
    expect(log).toContain('release-dev-private/mac-arm64/Caul Dev-Private.app/Contents/MacOS/Caul Dev-Private');
    expect(log).not.toContain('tccutil reset Microphone dev.caul.app.dev\n');
  });
});

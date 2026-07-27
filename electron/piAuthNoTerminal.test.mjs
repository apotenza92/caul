import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('Pi authentication shell integration', () => {
  it('does not automate Terminal for Pi setup from the Electron app', () => {
    const mainSource = readFileSync(resolve(root, 'electron/main.cjs'), 'utf8');

    expect(mainSource).not.toContain('tell application "Terminal"');
    expect(mainSource).not.toContain('tell process "Terminal"');
    expect(mainSource).not.toContain("spawn('osascript'");
    expect(mainSource).not.toContain('buildPiTerminalCommand');
  });

  it('does not expose the old Pi model terminal launcher in Settings', () => {
    const appSource = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');

    expect(appSource).not.toContain('Pi Model');
    expect(appSource).not.toContain('Open Pi model selector');
  });

  it('opens ChatGPT sign-in in the default browser, not an Electron auth window', () => {
    const mainSource = readFileSync(resolve(root, 'electron/main.cjs'), 'utf8');

    expect(mainSource).toContain('loginWithPiModelRuntime({');
    expect(mainSource).toContain('openExternal: openUrlInDefaultBrowser');
    expect(mainSource).toContain('importPiModelRuntime(cliPath)');
    expect(mainSource).not.toContain('AuthStorage.login');
    expect(mainSource).not.toContain('importPiAuthStorage');
    expect(mainSource).toContain("spawn('/usr/bin/open'");
    expect(mainSource).toContain('shell.openExternal(url)');
    expect(mainSource).not.toContain('ChatGPT sign in is currently available on macOS');
    expect(mainSource).not.toContain('createPiAuthWindow');
    expect(mainSource).not.toContain('piAuthWindow');
    expect(mainSource).not.toContain('onManualCodeInput');
  });

  it('runs Pi without tools, extensions, skills or inherited credentials', () => {
    const mainSource = readFileSync(resolve(root, 'electron/main.cjs'), 'utf8');

    expect(mainSource).toContain("require('./piEnvironment.cjs')");
    expect(mainSource).toContain("'--no-tools'");
    expect(mainSource).toContain("'--no-context-files'");
    expect(mainSource).toContain("'--no-extensions'");
    expect(mainSource).toContain("'--no-skills'");
    expect(mainSource).toContain("'--no-prompt-templates'");
  });
});

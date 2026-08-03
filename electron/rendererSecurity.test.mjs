import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createTrustedIpcRegistrar,
  createTrustedRendererUrlChecker,
  installRendererNavigationPolicy,
  isSafeExternalUrl,
  isTrustedIpcEvent
} = require('./rendererSecurity.cjs');

function createWebContents() {
  const listeners = new Map();
  return {
    listeners,
    on: vi.fn((name, listener) => listeners.set(name, listener)),
    setWindowOpenHandler: vi.fn((handler) => {
      listeners.set('window-open', handler);
    })
  };
}

describe('renderer navigation security', () => {
  it('keeps every renderer sandboxed behind a restrictive CSP and trusted IPC registrar', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const indexSource = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(mainSource).not.toContain('sandbox: false');
    expect(mainSource).toContain('sandbox: true');
    expect(mainSource).toContain('installRendererNavigationPolicy({');
    expect(mainSource).not.toMatch(/^ipcMain\.(?:handle|on)\(/m);
    expect(indexSource).toContain('http-equiv="Content-Security-Policy"');
    expect(indexSource).toContain("object-src 'none'");
    expect(indexSource).toContain("script-src 'self'");
  });

  it('trusts only the exact packaged renderer file', () => {
    const isTrusted = createTrustedRendererUrlChecker({
      isDev: false,
      rendererFilePath: '/Applications/Caul.app/Contents/Resources/app.asar/dist/index.html'
    });

    expect(isTrusted('file:///Applications/Caul.app/Contents/Resources/app.asar/dist/index.html?caul-surface=onboarding')).toBe(true);
    expect(isTrusted('file:///Applications/Caul.app/Contents/Resources/app.asar/dist/other.html')).toBe(false);
    expect(isTrusted('https://attacker.example/')).toBe(false);
  });

  it('trusts the configured development origin without trusting lookalike hosts', () => {
    const isTrusted = createTrustedRendererUrlChecker({
      devServerUrl: 'http://127.0.0.1:5173',
      isDev: true,
      rendererFilePath: '/unused/index.html'
    });

    expect(isTrusted('http://127.0.0.1:5173/?caul-surface=handle')).toBe(true);
    expect(isTrusted('http://127.0.0.1:5174/')).toBe(false);
    expect(isTrusted('http://127.0.0.1.attacker.example:5173/')).toBe(false);
  });

  it('opens only credential-free HTTPS links externally and denies renderer navigation', async () => {
    const webContents = createWebContents();
    const openExternal = vi.fn(async () => undefined);
    const isTrustedRendererUrl = (url) => url.startsWith('file:///trusted/index.html');
    installRendererNavigationPolicy({ webContents, isTrustedRendererUrl, openExternal });

    const externalEvent = { preventDefault: vi.fn() };
    webContents.listeners.get('will-navigate')(externalEvent, 'https://example.com/path');
    expect(externalEvent.preventDefault).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/path');

    const trustedEvent = { preventDefault: vi.fn() };
    webContents.listeners.get('will-navigate')(trustedEvent, 'file:///trusted/index.html?caul-surface=onboarding');
    expect(trustedEvent.preventDefault).not.toHaveBeenCalled();

    for (const candidate of ['http://example.com', 'file:///tmp/payload', 'https://user:secret@example.com']) {
      const event = { preventDefault: vi.fn() };
      webContents.listeners.get('will-navigate')(event, candidate);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(openExternal).toHaveBeenCalledTimes(1);

    expect(webContents.listeners.get('window-open')({ url: 'https://example.com/new' })).toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/new');
  });

  it('blocks redirects and webviews outside the trusted renderer', () => {
    const webContents = createWebContents();
    installRendererNavigationPolicy({
      webContents,
      isTrustedRendererUrl: (url) => url === 'file:///trusted/index.html',
      openExternal: vi.fn()
    });

    const redirectEvent = { preventDefault: vi.fn() };
    webContents.listeners.get('will-redirect')(redirectEvent, 'https://example.com');
    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce();

    const webviewEvent = { preventDefault: vi.fn() };
    webContents.listeners.get('will-attach-webview')(webviewEvent);
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('accepts IPC only from a known webContents and trusted top-level frame', () => {
    const knownSender = {};
    const isTrustedRendererUrl = (url) => url === 'file:///trusted/index.html';
    const options = {
      isKnownWebContents: (sender) => sender === knownSender,
      isTrustedRendererUrl
    };

    expect(isTrustedIpcEvent({ sender: knownSender, senderFrame: { url: 'file:///trusted/index.html' } }, options)).toBe(true);
    expect(isTrustedIpcEvent({ sender: knownSender, senderFrame: { url: 'https://attacker.example' } }, options)).toBe(false);
    expect(isTrustedIpcEvent({ sender: {}, senderFrame: { url: 'file:///trusted/index.html' } }, options)).toBe(false);
    expect(isTrustedIpcEvent({ sender: knownSender, senderFrame: null }, options)).toBe(false);
  });

  it('rejects untrusted invoke handlers and ignores untrusted fire-and-forget events', async () => {
    const handles = new Map();
    const listeners = new Map();
    const ipcMain = {
      handle: (channel, handler) => handles.set(channel, handler),
      on: (channel, handler) => listeners.set(channel, handler)
    };
    const reportBlocked = vi.fn();
    const registrar = createTrustedIpcRegistrar({
      ipcMain,
      isTrustedEvent: (event, channel) => event.trusted === true && channel !== 'caul:forbidden',
      reportBlocked
    });
    const handle = vi.fn(() => 'handled');
    const on = vi.fn();
    registrar.handle('caul:test-handle', handle);
    registrar.handle('caul:forbidden', handle);
    registrar.on('caul:test-on', on);

    expect(await handles.get('caul:test-handle')({ trusted: true }, 'value')).toBe('handled');
    expect(handle).toHaveBeenCalledWith({ trusted: true }, 'value');
    expect(() => handles.get('caul:test-handle')({ trusted: false })).toThrow(/Blocked untrusted IPC sender/);
    expect(() => handles.get('caul:forbidden')({ trusted: true })).toThrow(/Blocked untrusted IPC sender/);

    listeners.get('caul:test-on')({ trusted: false }, 'value');
    expect(on).not.toHaveBeenCalled();
    expect(reportBlocked).toHaveBeenCalledOnce();
  });

  it('allows only credential-free HTTPS external URLs', () => {
    expect(isSafeExternalUrl('https://example.com/path')).toBe(true);
    expect(isSafeExternalUrl('https://user:secret@example.com/path')).toBe(false);
    expect(isSafeExternalUrl('http://example.com/path')).toBe(false);
    expect(isSafeExternalUrl('file:///tmp/file')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});

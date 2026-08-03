import { describe, expect, it, vi } from 'vitest';
import {
  isMainElectronSurfaceUrl,
  requiresMainUpdaterSurface,
  waitForMainElectronSurface,
  waitForUpdaterElectronSurface
} from './playwright-electron-surface.mjs';

describe('Playwright Electron surface selection', () => {
  it('selects the updater surface from the installed version and scenario', () => {
    expect(requiresMainUpdaterSurface({ priorVersion: '0.1.43', scenario: 'valid' })).toBe(false);
    expect(requiresMainUpdaterSurface({ priorVersion: '0.1.72', scenario: 'valid' })).toBe(true);
    expect(requiresMainUpdaterSurface({ priorVersion: '0.1.74', scenario: 'corrupt' })).toBe(true);
    expect(requiresMainUpdaterSurface({ priorVersion: '0.1.43', scenario: 'signature' })).toBe(true);
  });

  it('recognises only the packaged main surface', () => {
    expect(isMainElectronSurfaceUrl('file:///Applications/Caul.app/Contents/Resources/app.asar/dist/index.html')).toBe(true);
    expect(isMainElectronSurfaceUrl('file:///Applications/Caul.app/Contents/Resources/app.asar/dist/index.html?caul-surface=onboarding')).toBe(false);
    expect(isMainElectronSurfaceUrl('file:///Applications/Caul.app/Contents/Resources/app.asar/dist/index.html?caul-surface=handle')).toBe(false);
    expect(isMainElectronSurfaceUrl('about:blank')).toBe(false);
    expect(isMainElectronSurfaceUrl('https://example.com/')).toBe(false);
  });

  it('selects the main surface instead of the first Electron window', async () => {
    const onboarding = {
      url: () => 'file:///tmp/Caul.app/Contents/Resources/app.asar/dist/index.html?caul-surface=onboarding'
    };
    const main = {
      url: () => 'file:///tmp/Caul.app/Contents/Resources/app.asar/dist/index.html',
      waitForFunction: vi.fn().mockResolvedValue(undefined)
    };
    const application = { windows: vi.fn(() => [onboarding, main]) };

    await expect(waitForMainElectronSurface(application, 1_000)).resolves.toBe(main);
    expect(main.waitForFunction).toHaveBeenCalledOnce();
  });

  it('retains the first-window updater surface for legacy public packages', async () => {
    const legacy = {
      waitForFunction: vi.fn().mockResolvedValue(undefined)
    };
    const application = {
      firstWindow: vi.fn().mockResolvedValue(legacy),
      windows: vi.fn(() => [])
    };

    await expect(waitForUpdaterElectronSurface(application, {
      mainSurfaceRequired: false,
      timeoutMs: 1_000
    })).resolves.toBe(legacy);
    expect(application.firstWindow).toHaveBeenCalledWith({ timeout: 1_000 });
    expect(legacy.waitForFunction).toHaveBeenCalledOnce();
  });

  it('requires the main updater surface for current packages', async () => {
    const main = {
      url: () => 'file:///tmp/Caul.app/Contents/Resources/app.asar/dist/index.html',
      waitForFunction: vi.fn().mockResolvedValue(undefined)
    };
    const application = {
      firstWindow: vi.fn(),
      windows: vi.fn(() => [main])
    };

    await expect(waitForUpdaterElectronSurface(application, {
      mainSurfaceRequired: true,
      timeoutMs: 1_000
    })).resolves.toBe(main);
    expect(application.firstWindow).not.toHaveBeenCalled();
  });
});

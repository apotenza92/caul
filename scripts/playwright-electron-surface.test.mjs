import { describe, expect, it, vi } from 'vitest';
import {
  isMainElectronSurfaceUrl,
  waitForMainElectronSurface
} from './playwright-electron-surface.mjs';

describe('Playwright Electron surface selection', () => {
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
});

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  prepareUpdateInstall,
  scheduleUpdateInstallExitFallback
} = require('./updateInstallPreparation.cjs');

describe('update install preparation', () => {
  it('disposes Pi subprocesses without racing Electron Updater by closing windows', () => {
    const events = [];
    const activeWindow = {
      close: vi.fn(() => events.push('window-closed')),
      isDestroyed: () => false
    };

    prepareUpdateInstall({
      disposePiBridges: () => events.push('pi-bridges-disposed'),
      windows: [activeWindow]
    });

    expect(events).toEqual(['pi-bridges-disposed']);
    expect(activeWindow.close).not.toHaveBeenCalled();
  });

  it('rejects incomplete shutdown dependencies', () => {
    expect(() => prepareUpdateInstall({
      disposePiBridges: null
    })).toThrow(/disposal function/);
  });

  it('forces a clean process exit if Electron Updater does not finish quitting', () => {
    const exitApp = vi.fn();
    const unref = vi.fn();
    let fallback;
    const schedule = vi.fn((callback, delayMs) => {
      fallback = callback;
      expect(delayMs).toBe(10_000);
      return { unref };
    });

    scheduleUpdateInstallExitFallback({ exitApp, schedule });

    expect(schedule).toHaveBeenCalledOnce();
    expect(unref).toHaveBeenCalledOnce();
    expect(exitApp).not.toHaveBeenCalled();
    fallback();
    expect(exitApp).toHaveBeenCalledWith(0);
  });

  it('rejects an incomplete exit fallback', () => {
    expect(() => scheduleUpdateInstallExitFallback({ exitApp: null }))
      .toThrow(/exit and scheduling functions/);
  });
});

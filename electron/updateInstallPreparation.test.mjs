import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAppShutdownPreparation,
  scheduleUpdateInstallExitFallback
} = require('./updateInstallPreparation.cjs');

describe('update install preparation', () => {
  it('runs every shutdown cleanup once without closing windows', () => {
    const events = [];
    const activeWindow = {
      close: vi.fn(() => events.push('window-closed')),
      isDestroyed: () => false
    };

    const prepare = createAppShutdownPreparation({
      cleanups: [
        () => events.push('schedules-stopped'),
        () => events.push('capture-stopped'),
        () => events.push('model-runtimes-stopped'),
        () => events.push('pi-bridges-disposed')
      ]
    });

    expect(prepare()).toBe(true);
    expect(prepare()).toBe(false);
    expect(events).toEqual([
      'schedules-stopped',
      'capture-stopped',
      'model-runtimes-stopped',
      'pi-bridges-disposed'
    ]);
    expect(activeWindow.close).not.toHaveBeenCalled();
  });

  it('finishes remaining cleanup, reports the first failure and allows a safe retry', () => {
    const events = [];
    const failure = new Error('capture cleanup failed');
    let captureFails = true;
    const prepare = createAppShutdownPreparation({
      cleanups: [
        () => events.push('schedule'),
        () => {
          events.push('capture');
          if (captureFails) throw failure;
        },
        () => events.push('runtime')
      ]
    });

    expect(() => prepare()).toThrow(failure);
    expect(events).toEqual(['schedule', 'capture', 'runtime']);
    captureFails = false;
    expect(prepare()).toBe(true);
    expect(events).toEqual([
      'schedule',
      'capture',
      'runtime',
      'schedule',
      'capture',
      'runtime'
    ]);
    expect(prepare()).toBe(false);
  });

  it('rejects incomplete shutdown dependencies', () => {
    expect(() => createAppShutdownPreparation({ cleanups: [] }))
      .toThrow(/cleanup functions/);
    expect(() => createAppShutdownPreparation({ cleanups: [null] }))
      .toThrow(/cleanup functions/);
  });

  it('prepares every application runtime before the updater handoff', () => {
    const source = readFileSync(require.resolve('./main.cjs'), 'utf8');
    const prepareInstall = source.indexOf('function prepareForDownloadedUpdateInstall()');
    const shutdownPreparation = source.indexOf('const prepareAppShutdown = createAppShutdownPreparation');

    expect(prepareInstall).toBeGreaterThanOrEqual(0);
    expect(source.slice(prepareInstall, prepareInstall + 140)).toContain('prepareAppShutdown();');
    expect(shutdownPreparation).toBeGreaterThan(prepareInstall);
    for (const expectedCleanup of [
      'globalShortcut.unregisterAll()',
      'updaterService?.stopSchedule()',
      'stopModelCatalogueRefreshSchedule',
      'performAppShutdownCleanup'
    ]) {
      expect(source.slice(shutdownPreparation, shutdownPreparation + 700))
        .toContain(expectedCleanup);
    }
    const runtimeCleanup = source.indexOf('function performAppShutdownCleanup()');
    for (const expectedRuntimeCleanup of [
      'stopLocalTranscriptionWarmDaemon(true)',
      'stopSystemAudioCapture()',
      'stopLocalParakeetDaemon({ force: true })',
      'cancelParakeetDownload()',
      'localLlmService?.cancelDownload()',
      'localLlmService?.stop()',
      'disposePiBridges()'
    ]) {
      expect(source.slice(runtimeCleanup, runtimeCleanup + 500))
        .toContain(expectedRuntimeCleanup);
    }
    expect(source.slice(prepareInstall, prepareInstall + 140))
      .not.toContain('BrowserWindow.getAllWindows');
  });

  it('keeps a referenced exit guard and forces one clean process exit', () => {
    const exitApp = vi.fn();
    const unref = vi.fn();
    const cancel = vi.fn();
    const timer = { unref };
    let fallback;
    const schedule = vi.fn((callback, delayMs) => {
      fallback = callback;
      expect(delayMs).toBe(10_000);
      return timer;
    });

    const cancelFallback = scheduleUpdateInstallExitFallback({ cancel, exitApp, schedule });

    expect(schedule).toHaveBeenCalledOnce();
    expect(unref).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
    fallback();
    fallback();
    expect(exitApp).toHaveBeenCalledWith(0);
    expect(exitApp).toHaveBeenCalledOnce();
    expect(cancelFallback()).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels a pending exit guard', () => {
    const exitApp = vi.fn();
    const cancel = vi.fn();
    const timer = {};
    let fallback;
    const cancelFallback = scheduleUpdateInstallExitFallback({
      cancel,
      exitApp,
      schedule: (callback) => {
        fallback = callback;
        return timer;
      }
    });

    expect(cancelFallback()).toBe(true);
    expect(cancelFallback()).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(timer);
    fallback();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('rejects an incomplete exit fallback', () => {
    expect(() => scheduleUpdateInstallExitFallback({ exitApp: null }))
      .toThrow(/exit, scheduling and cancellation functions/);
  });
});

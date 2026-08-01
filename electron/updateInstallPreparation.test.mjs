import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { prepareUpdateInstall } = require('./updateInstallPreparation.cjs');

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
});

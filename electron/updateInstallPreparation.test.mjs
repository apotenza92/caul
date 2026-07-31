import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { prepareUpdateInstall } = require('./updateInstallPreparation.cjs');

describe('update install preparation', () => {
  it('disposes Pi subprocesses before closing application windows', () => {
    const events = [];
    const activeWindow = {
      close: vi.fn(() => events.push('window-closed')),
      isDestroyed: () => false
    };
    const destroyedWindow = {
      close: vi.fn(),
      isDestroyed: () => true
    };

    prepareUpdateInstall({
      disposePiBridges: () => events.push('pi-bridges-disposed'),
      windows: [activeWindow, destroyedWindow]
    });

    expect(events).toEqual(['pi-bridges-disposed', 'window-closed']);
    expect(activeWindow.close).toHaveBeenCalledOnce();
    expect(destroyedWindow.close).not.toHaveBeenCalled();
  });

  it('rejects incomplete shutdown dependencies', () => {
    expect(() => prepareUpdateInstall({
      disposePiBridges: null,
      windows: []
    })).toThrow(/disposal function/);
    expect(() => prepareUpdateInstall({
      disposePiBridges: () => {},
      windows: null
    })).toThrow(/application windows/);
  });
});

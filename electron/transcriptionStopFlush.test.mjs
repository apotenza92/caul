import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createStopFlushController } = require('./transcriptionStopFlush.cjs');

describe('createStopFlushController', () => {
  it('resolves a pending stop wait when the backend reports stopped', async () => {
    const controller = createStopFlushController();
    const wait = controller.wait();

    controller.resolve();

    await expect(wait).resolves.toEqual({ reason: 'stopped' });
  });

  it('resolves through the timeout fallback when the backend does not report stopped', async () => {
    vi.useFakeTimers();

    const controller = createStopFlushController({ timeoutMs: 1000 });
    const wait = controller.wait();

    await vi.advanceTimersByTimeAsync(1000);

    await expect(wait).resolves.toEqual({ reason: 'timeout' });

    vi.useRealTimers();
  });

  it('reports a cancelled wait reason', async () => {
    const controller = createStopFlushController();
    const wait = controller.wait();

    controller.cancel('process-exit');

    await expect(wait).resolves.toEqual({ reason: 'process-exit' });
  });

  it('cancels stale pending waits when a new stop wait replaces them', async () => {
    const controller = createStopFlushController();
    const first = controller.wait();
    const second = controller.wait();

    controller.resolve();

    await expect(first).resolves.toEqual({ reason: 'replaced' });
    await expect(second).resolves.toEqual({ reason: 'stopped' });
  });
});

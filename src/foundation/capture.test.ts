import { describe, expect, it } from 'vitest';
import {
  getCaptureStatusText,
  initialCaptureStatus,
  nextMockLevels,
  reduceCaptureStatus
} from './capture';

describe('capture foundation', () => {
  it('moves through the capture test states', () => {
    const testing = reduceCaptureStatus(initialCaptureStatus, { type: 'start' });
    const paused = reduceCaptureStatus(testing, { type: 'pause' });
    const idle = reduceCaptureStatus(paused, { type: 'stop' });

    expect(testing.state).toBe('testing');
    expect(paused.state).toBe('paused');
    expect(idle.state).toBe('idle');
  });

  it('accepts a full status update from the desktop bridge', () => {
    const status = reduceCaptureStatus(initialCaptureStatus, {
      type: 'status',
      status: {
        ...initialCaptureStatus,
        state: 'paused'
      }
    });

    expect(status.state).toBe('paused');
  });

  it('clamps mock levels to the display range', () => {
    const levels = nextMockLevels(initialCaptureStatus, () => 20);

    expect(levels.microphone).toBe(96);
    expect(levels.system).toBe(96);
  });

  it('maps states to user-facing copy', () => {
    expect(getCaptureStatusText('idle')).toBe('Not listening');
    expect(getCaptureStatusText('testing')).toBe('Listening');
    expect(getCaptureStatusText('paused')).toBe('Paused');
  });
});

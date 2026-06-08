import { describe, expect, it } from 'vitest';

import {
  evaluateAudioIsolationGate,
  parseSmokeSummaryByType
} from './audio-isolation-gate.mjs';

describe('audio isolation VM gate', () => {
  it('passes when output stimulus reaches system capture without microphone leakage', () => {
    const result = evaluateAudioIsolationGate({
      microphoneDuringOutput: {
        audio_frames: 12,
        capture_started: true,
        detected: false,
        level_events: 12,
        max_level: 0.00005
      },
      systemDuringOutput: {
        audio_frames: 18,
        capture_started: true,
        detected: true,
        level_events: 18,
        max_level: 0.02
      }
    });

    expect(result.ok).toBe(true);
    expect(result.outputDetected).toBe(true);
    expect(result.microphoneLeakDetected).toBe(false);
  });

  it('fails when output stimulus is visible on microphone capture', () => {
    const result = evaluateAudioIsolationGate({
      microphoneDuringOutput: {
        audio_frames: 12,
        capture_started: true,
        detected: true,
        level_events: 12,
        max_level: 0.004
      },
      systemDuringOutput: {
        audio_frames: 18,
        capture_started: true,
        detected: true,
        level_events: 18,
        max_level: 0.02
      }
    });

    expect(result.ok).toBe(false);
    expect(result.microphoneLeakDetected).toBe(true);
  });

  it('parses the newest matching backend smoke summary', () => {
    const summary = parseSmokeSummaryByType([
      '{"type":"system_audio_smoke","max_level":0.001}',
      '{"type":"microphone_smoke","max_level":0.2}',
      '{"type":"system_audio_smoke","max_level":0.003}'
    ].join('\n'), 'system_audio_smoke');

    expect(summary).toEqual({
      type: 'system_audio_smoke',
      max_level: 0.003
    });
  });
});

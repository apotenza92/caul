import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getSystemAudioPermissionDeniedState,
  getSystemAudioPermissionGrantedState,
  getSystemAudioPermissionRequestedState,
  getSystemAudioPermissionStatusFromState,
  isSystemAudioPermissionProbeGrantedEvent
} = require('./permissions.cjs');

describe('permission helpers', () => {
  it('does not treat a requested system-audio prompt as granted', () => {
    expect(getSystemAudioPermissionStatusFromState({
      systemAudioPermissionRequested: true
    })).toBe('not-determined');
  });

  it('only reports system audio granted after a successful probe', () => {
    expect(getSystemAudioPermissionStatusFromState(getSystemAudioPermissionGrantedState())).toBe('granted');
  });

  it('keeps denied system audio ahead of stale granted or requested fields', () => {
    expect(getSystemAudioPermissionStatusFromState({
      systemAudioPermissionDenied: true,
      systemAudioPermissionGranted: true,
      systemAudioPermissionRequested: true
    })).toBe('denied');
  });

  it('writes explicit persisted state for requested, granted and denied outcomes', () => {
    expect(getSystemAudioPermissionRequestedState()).toMatchObject({
      systemAudioPermissionDenied: false,
      systemAudioPermissionGranted: false,
      systemAudioPermissionRequested: true
    });
    expect(getSystemAudioPermissionGrantedState()).toMatchObject({
      systemAudioPermissionDenied: false,
      systemAudioPermissionGranted: true,
      systemAudioPermissionRequested: true
    });
    expect(getSystemAudioPermissionDeniedState()).toMatchObject({
      systemAudioPermissionDenied: true,
      systemAudioPermissionGranted: false,
      systemAudioPermissionRequested: true
    });
  });

  it('does not grant system audio on helper startup alone', () => {
    expect(isSystemAudioPermissionProbeGrantedEvent({ type: 'capture_started' })).toBe(false);
    expect(isSystemAudioPermissionProbeGrantedEvent({ type: 'system_level' })).toBe(true);
    expect(isSystemAudioPermissionProbeGrantedEvent({ type: 'audio_frame' })).toBe(true);
  });
});

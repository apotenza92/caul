import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  showAndFocusOnboardingWindow,
  shouldLaunchOnboarding
} = require('./onboardingLaunch.cjs');

describe('onboarding launch decision', () => {
  it('keeps incomplete setup visible on later launches', () => {
    expect(shouldLaunchOnboarding({
      completedAt: null,
      setupRequired: true
    })).toBe(true);
  });

  it('does not reopen onboarding after setup is completed', () => {
    expect(shouldLaunchOnboarding({
      completedAt: '2026-07-28T02:00:00.000Z',
      setupRequired: true
    })).toBe(false);
  });

  it('does not open onboarding when setup is already ready', () => {
    expect(shouldLaunchOnboarding({
      completedAt: null,
      setupRequired: false
    })).toBe(false);
  });

  it('keeps onboarding visible above the launching Windows shell', () => {
    const calls = [];
    const window = {
      focus: () => calls.push('focus'),
      moveTop: () => calls.push('moveTop'),
      setAlwaysOnTop: (value) => calls.push(`alwaysOnTop:${value}`),
      show: () => calls.push('show')
    };

    showAndFocusOnboardingWindow(window, {
      platform: 'win32'
    });

    expect(calls).toEqual([
      'show',
      'alwaysOnTop:true',
      'moveTop',
      'focus'
    ]);
  });
});

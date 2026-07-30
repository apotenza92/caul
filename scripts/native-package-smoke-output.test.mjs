import { describe, expect, it } from 'vitest';
import {
  validatePackagedLaunchProcessResult,
  validatePackagedLaunchSmokeOutput
} from './native-package-smoke-output.mjs';

describe('native package launch smoke output', () => {
  it('accepts one or more successful packaged launch summaries', () => {
    const output = [
      'unrelated diagnostic',
      'caul-packaged-launch-smoke {"ok":true,"isPackaged":true,"surface":"onboarding"}',
      'caul-packaged-launch-smoke {"ok":true,"isPackaged":true,"surface":"main-process-window"}'
    ].join('\n');

    expect(validatePackagedLaunchSmokeOutput(output)).toHaveLength(2);
  });

  it('rejects missing, malformed, unsuccessful, or unpackaged summaries', () => {
    expect(() => validatePackagedLaunchSmokeOutput('')).toThrow('emitted no result');
    expect(() => validatePackagedLaunchSmokeOutput(
      'caul-packaged-launch-smoke {'
    )).toThrow('emitted invalid JSON');
    expect(() => validatePackagedLaunchSmokeOutput(
      'caul-packaged-launch-smoke {"ok":false,"isPackaged":true}'
    )).toThrow('did not report a successful packaged application');
    expect(() => validatePackagedLaunchSmokeOutput(
      'caul-packaged-launch-smoke {"ok":true,"isPackaged":false}'
    )).toThrow('did not report a successful packaged application');
  });
});

describe('native package launch process result', () => {
  const successfulSmoke = 'caul-packaged-launch-smoke {"ok":true,"isPackaged":true}';

  it('accepts a clean exit with successful packaged launch evidence', () => {
    expect(() => validatePackagedLaunchProcessResult('linux', {
      status: 0,
      stdout: successfulSmoke,
      stderr: ''
    })).not.toThrow();
  });

  it('accepts a native process timeout only after successful packaged launch evidence', () => {
    expect(() => validatePackagedLaunchProcessResult('windows', {
      status: null,
      error: { code: 'ETIMEDOUT', message: 'timed out' },
      stdout: successfulSmoke,
      stderr: ''
    })).not.toThrow();
    expect(() => validatePackagedLaunchProcessResult('linux', {
      status: null,
      error: { code: 'ETIMEDOUT', message: 'timed out' },
      stdout: successfulSmoke,
      stderr: ''
    })).not.toThrow();
  });

  it('rejects native process timeouts without successful packaged launch evidence', () => {
    for (const platform of ['windows', 'linux']) {
      expect(() => validatePackagedLaunchProcessResult(platform, {
        status: null,
        error: { code: 'ETIMEDOUT', message: 'timed out' },
        stdout: '',
        stderr: ''
      })).toThrow('Packaged launch smoke emitted no result');
    }
  });
});

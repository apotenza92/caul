import { describe, expect, it } from 'vitest';
import { validatePackagedLaunchSmokeOutput } from './native-package-smoke-output.mjs';

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

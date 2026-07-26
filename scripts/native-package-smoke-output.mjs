const smokePrefix = 'caul-packaged-launch-smoke ';

export function validatePackagedLaunchSmokeOutput(...outputs) {
  const summaries = outputs
    .flatMap((output) => String(output ?? '').split(/\r?\n/))
    .filter((line) => line.startsWith(smokePrefix))
    .map((line) => {
      try {
        return JSON.parse(line.slice(smokePrefix.length));
      } catch (error) {
        throw new Error(`Packaged launch smoke emitted invalid JSON: ${error.message}`);
      }
    });

  if (summaries.length === 0) {
    throw new Error('Packaged launch smoke emitted no result');
  }
  if (summaries.some((summary) => summary?.ok !== true || summary?.isPackaged !== true)) {
    throw new Error('Packaged launch smoke did not report a successful packaged application');
  }

  return summaries;
}

export function validatePackagedLaunchProcessResult(platform, result) {
  let smokeOutputError;
  try {
    validatePackagedLaunchSmokeOutput(result.stdout, result.stderr);
  } catch (error) {
    smokeOutputError = error;
  }

  const acceptedWindowsExitTimeout = platform === 'windows'
    && result.error?.code === 'ETIMEDOUT'
    && !smokeOutputError;
  if (smokeOutputError || (!acceptedWindowsExitTimeout && (result.error || result.status !== 0))) {
    const failureDetails = [
      smokeOutputError?.message,
      result.error?.message
    ].filter(Boolean).join('; ');
    throw new Error(
      `Packaged app launch failed (${result.status}): ${failureDetails}`
      + `\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    );
  }
}

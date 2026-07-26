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

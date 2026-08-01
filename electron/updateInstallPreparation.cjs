function createAppShutdownPreparation({ cleanups }) {
  if (!Array.isArray(cleanups) || cleanups.length === 0 || cleanups.some(
    (cleanup) => typeof cleanup !== 'function'
  )) {
    throw new Error('Application shutdown preparation requires cleanup functions.');
  }

  let state = 'idle';

  return () => {
    if (state !== 'idle') {
      return false;
    }

    state = 'preparing';
    let firstError = null;
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        firstError ||= error;
      }
    }

    if (firstError) {
      state = 'idle';
      throw firstError;
    }

    state = 'prepared';
    return true;
  };
}

function scheduleUpdateInstallExitFallback({
  cancel = clearTimeout,
  delayMs = 10_000,
  exitApp,
  schedule = setTimeout
}) {
  if (
    typeof cancel !== 'function'
    || typeof exitApp !== 'function'
    || typeof schedule !== 'function'
  ) {
    throw new Error('Update installation exit fallback requires exit, scheduling and cancellation functions.');
  }

  let active = true;
  const timer = schedule(() => {
    if (!active) {
      return;
    }

    active = false;
    exitApp(0);
  }, delayMs);

  return () => {
    if (!active) {
      return false;
    }

    active = false;
    cancel(timer);
    return true;
  };
}

module.exports = {
  createAppShutdownPreparation,
  scheduleUpdateInstallExitFallback
};

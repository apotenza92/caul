function prepareUpdateInstall({ disposePiBridges }) {
  if (typeof disposePiBridges !== 'function') {
    throw new Error('Update installation requires a Pi bridge disposal function.');
  }

  disposePiBridges();
}

function scheduleUpdateInstallExitFallback({
  delayMs = 10_000,
  exitApp,
  schedule = setTimeout
}) {
  if (typeof exitApp !== 'function' || typeof schedule !== 'function') {
    throw new Error('Update installation exit fallback requires exit and scheduling functions.');
  }

  const timer = schedule(() => exitApp(0), delayMs);
  timer?.unref?.();
  return timer;
}

module.exports = {
  prepareUpdateInstall,
  scheduleUpdateInstallExitFallback
};

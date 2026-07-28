function shouldLaunchOnboarding({ completedAt = null, setupRequired = false } = {}) {
  return typeof completedAt !== 'string' && setupRequired === true;
}

function showAndFocusOnboardingWindow(window, {
  platform = process.platform
} = {}) {
  window.show();

  if (platform !== 'win32') {
    window.focus();
    return;
  }

  window.setAlwaysOnTop(true);
  window.moveTop();
  window.focus();
}

module.exports = {
  showAndFocusOnboardingWindow,
  shouldLaunchOnboarding
};

function prepareUpdateInstall({ disposePiBridges, windows }) {
  if (typeof disposePiBridges !== 'function') {
    throw new Error('Update installation requires a Pi bridge disposal function.');
  }
  if (!Array.isArray(windows)) {
    throw new Error('Update installation requires the current application windows.');
  }

  disposePiBridges();
  windows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
}

module.exports = {
  prepareUpdateInstall
};

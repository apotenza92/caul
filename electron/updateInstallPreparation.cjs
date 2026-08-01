function prepareUpdateInstall({ disposePiBridges }) {
  if (typeof disposePiBridges !== 'function') {
    throw new Error('Update installation requires a Pi bridge disposal function.');
  }

  disposePiBridges();
}

module.exports = {
  prepareUpdateInstall
};

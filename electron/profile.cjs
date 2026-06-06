const fsSync = require('fs');
const path = require('path');

const profileSettingsFileName = 'settings.json';
const profilePromptsFileName = 'prompts.json';

function createProfileService({
  getDefaultFolder,
  readPointerState,
  writePointerState,
  readLegacySettings = () => ({}),
  readLegacyPrompts = () => null,
  normaliseSettings = defaultNormaliseSettings,
  normalisePrompts = defaultNormalisePrompts,
  fs = fsSync,
  pathModule = path
}) {
  function getFolder() {
    const state = readPointerState();
    const folder = typeof state.historyFolder === 'string' && state.historyFolder.trim()
      ? state.historyFolder.trim()
      : getDefaultFolder();

    return pathModule.resolve(folder);
  }

  function getSettingsPath(folder = getFolder()) {
    return pathModule.join(folder, profileSettingsFileName);
  }

  function getPromptsPath(folder = getFolder()) {
    return pathModule.join(folder, profilePromptsFileName);
  }

  function readSettings() {
    const folder = getFolder();
    const settingsPath = getSettingsPath(folder);

    if (!fs.existsSync(settingsPath)) {
      writeJsonFile(settingsPath, withVersion(normaliseSettings(readLegacySettings())));
    }

    return normaliseSettings(readJsonFile(settingsPath));
  }

  function updateSettings(update) {
    const folder = getFolder();
    const settingsPath = getSettingsPath(folder);
    const existing = readSettings();
    const next = normaliseSettings({
      ...existing,
      ...normaliseSettings(update)
    });

    writeJsonFile(settingsPath, withVersion(next));
    return next;
  }

  function readPrompts() {
    const folder = getFolder();
    const promptsPath = getPromptsPath(folder);

    if (!fs.existsSync(promptsPath)) {
      const legacyPrompts = readLegacyPrompts();
      writeJsonFile(promptsPath, withVersion(normalisePrompts(legacyPrompts)));
    }

    return normalisePrompts(readJsonFile(promptsPath));
  }

  function writePrompts(state) {
    const promptsPath = getPromptsPath();
    const next = normalisePrompts(state);

    writeJsonFile(promptsPath, withVersion(next));
    return next;
  }

  function movePortableFiles(fromFolder, toFolder) {
    const moved = new Map();
    let failed = 0;

    for (const fileName of [profileSettingsFileName, profilePromptsFileName]) {
      const source = pathModule.join(fromFolder, fileName);

      if (!fs.existsSync(source)) {
        continue;
      }

      const destination = getAvailableFilePath(toFolder, fileName);

      try {
        fs.mkdirSync(toFolder, { recursive: true });
        fs.renameSync(source, destination);
        moved.set(source, destination);
      } catch {
        failed += 1;
      }
    }

    return {
      moved,
      ...(failed > 0 ? { message: `Moved Caul folder, but ${failed} profile file${failed === 1 ? '' : 's'} could not be moved.` } : {})
    };
  }

  function setFolder(folder) {
    writePointerState({ historyFolder: pathModule.resolve(folder) });
  }

  function writeJsonFile(filePath, value) {
    fs.mkdirSync(pathModule.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  function readJsonFile(filePath) {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function getAvailableFilePath(folder, fileName) {
    const parsed = pathModule.parse(fileName);
    let candidate = pathModule.join(folder, fileName);
    let suffix = 2;

    while (fs.existsSync(candidate)) {
      candidate = pathModule.join(folder, `${parsed.name}-${suffix}${parsed.ext}`);
      suffix += 1;
    }

    return candidate;
  }

  return {
    getFolder,
    getPromptsPath,
    getSettingsPath,
    movePortableFiles,
    readPrompts,
    readSettings,
    setFolder,
    updateSettings,
    writePrompts
  };
}

function defaultNormaliseSettings(value) {
  return value && typeof value === 'object' ? value : {};
}

function defaultNormalisePrompts(value) {
  return value && typeof value === 'object' ? value : {};
}

function withVersion(value) {
  return {
    version: 1,
    ...value
  };
}

module.exports = {
  createProfileService,
  profilePromptsFileName,
  profileSettingsFileName
};

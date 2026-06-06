const fsSync = require('fs');
const path = require('path');

const historyFileNamePattern = /^\d{4}-\d{2}-\d{2}(?:-\d+)?\.html$/;
const legacyHistoryFileNamePattern = /^\d{4}-\d{2}-\d{2}(?:-\d+)?\.txt$/;
const historyMonthFolderPattern = /^\d{4}-\d{2}$/;
const historyYearFolderPattern = /^\d{4}$/;

function createHistoryService({
  dialog,
  getDocumentsPath,
  openPath,
  readState,
  moveProfileFiles = () => ({ moved: new Map() }),
  writeState,
  fs = fsSync,
  pathModule = path
}) {
  const sessionFiles = new Map();
  const sessions = new Map();
  const convertedFolders = new Set();
  const migratedDefaultFolders = new Set();

  function getDefaultFolder() {
    return pathModule.join(getDocumentsPath(), 'Caul');
  }

  function getLegacyDefaultFolder() {
    return pathModule.join(getDocumentsPath(), 'Caul', 'History');
  }

  function getStatus() {
    const state = readState();
    const enabled = state.historyEnabled !== false;
    const configuredFolder = normaliseFolder(state.historyFolder);
    const folder = configuredFolder || getDefaultFolder();
    const defaultMigration = configuredFolder ? {} : migrateLegacyDefaultFolder(folder);
    const conversion = convertLegacyTxtHistory(folder);
    const message = conversion.message
      ?? defaultMigration.message
      ?? (typeof state.historyMessage === 'string' ? state.historyMessage : undefined);

    if (conversion.message || defaultMigration.message) {
      writeState({ historyMessage: conversion.message ?? defaultMigration.message });
    }

    return {
      ok: true,
      enabled,
      folder,
      ...(message ? { message } : {})
    };
  }

  function setEnabled(enabled) {
    writeState({ historyEnabled: Boolean(enabled), historyMessage: null });
    return getStatus();
  }

  async function openFolder() {
    const status = getStatus();

    try {
      fs.mkdirSync(status.folder, { recursive: true });
      const result = await openPath(status.folder);
      if (result) {
        return { ok: false, message: result };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error) };
    }
  }

  async function chooseFolder(ownerWindow) {
    const current = getStatus();
    const result = await dialog.showOpenDialog(ownerWindow, {
      defaultPath: current.folder,
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return current;
    }

    return setFolder(result.filePaths[0]);
  }

  function setFolder(folder) {
    const previous = getStatus();
    const nextFolder = normaliseFolder(folder) || previous.folder;
    let message = null;

    try {
      fs.mkdirSync(nextFolder, { recursive: true });
      fs.accessSync(nextFolder, fs.constants.W_OK);
    } catch (error) {
      return {
        ...previous,
        ok: false,
        message: `Could not use that Caul folder: ${getErrorMessage(error)}`
      };
    }

    if (pathModule.resolve(previous.folder) !== pathModule.resolve(nextFolder)) {
      const moveResult = moveExistingHistoryFiles(previous.folder, nextFolder);
      const profileMoveResult = moveProfileFiles(previous.folder, nextFolder);
      message = moveResult.message ?? profileMoveResult.message ?? message;
      remapSessionFiles(previous.folder, nextFolder, moveResult.moved);
    }

    writeState({
      historyFolder: nextFolder,
      historyMessage: message
    });

    return getStatus();
  }

  function saveSession(update) {
    const status = getStatus();

    if (!status.enabled) {
      return { ok: true };
    }

    const session = normaliseSessionUpdate(update);

    if (!session) {
      return { ok: false, message: 'History session update is invalid.' };
    }

    const previous = sessions.get(session.sessionId) ?? {};
    const next = {
      ...previous,
      ...session,
      aiResponses: mergeAiResponses(previous.aiResponses, session.aiResponses)
    };

    sessions.set(session.sessionId, next);

    try {
      fs.mkdirSync(status.folder, { recursive: true });
      const filePath = getSessionFilePath(next, status.folder);
      fs.mkdirSync(pathModule.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, formatHistoryDay(filePath, sessions), 'utf8');
      return { ok: true, filePath };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error) };
    }
  }

  function getSessionFilePath(session, folder) {
    const existing = sessionFiles.get(session.sessionId);

    if (existing) {
      return existing;
    }

    const relativePath = getHistoryRelativePath(session.startedAt);
    const expectedFilePath = pathModule.join(folder, relativePath);
    const dayFolder = pathModule.dirname(expectedFilePath);
    fs.mkdirSync(dayFolder, { recursive: true });
    const filePath = fs.existsSync(expectedFilePath)
      ? expectedFilePath
      : getAvailableFilePath(dayFolder, pathModule.basename(relativePath));
    sessionFiles.set(session.sessionId, filePath);
    return filePath;
  }

  function moveExistingHistoryFiles(fromFolder, toFolder) {
    const moved = new Map();
    let failed = 0;

    if (!fromFolder || !toFolder || !fs.existsSync(fromFolder)) {
      return { moved };
    }

    try {
      fs.readdirSync(fromFolder, { withFileTypes: true });
    } catch (error) {
      return {
        moved,
        message: `Could not inspect old Caul folder: ${getErrorMessage(error)}`
      };
    }

    const conversion = convertLegacyTxtHistory(fromFolder, { force: true });
    const historyFiles = findHistoryFiles(fromFolder, { includeLegacyTxt: false });

    for (const source of historyFiles) {
      const relativePath = pathModule.relative(fromFolder, source);
      const destinationFolder = pathModule.dirname(pathModule.join(toFolder, relativePath));
      const destination = getAvailableFilePath(destinationFolder, pathModule.basename(source));

      try {
        fs.mkdirSync(destinationFolder, { recursive: true });
        fs.renameSync(source, destination);
        moved.set(source, destination);
      } catch {
        failed += 1;
      }
    }

    return {
      moved,
      ...(conversion.message
        ? { message: conversion.message }
        : failed > 0
          ? { message: `Moved Caul folder, but ${failed} HTML history file${failed === 1 ? '' : 's'} could not be moved.` }
          : {})
    };
  }

  function migrateLegacyDefaultFolder(defaultFolder) {
    const legacyFolder = getLegacyDefaultFolder();
    const defaultKey = pathModule.resolve(defaultFolder);

    if (
      migratedDefaultFolders.has(defaultKey)
      || pathModule.resolve(legacyFolder) === defaultKey
      || !fs.existsSync(legacyFolder)
    ) {
      return {};
    }

    migratedDefaultFolders.add(defaultKey);

    const moveResult = moveExistingHistoryFiles(legacyFolder, defaultFolder);

    if (moveResult.message) {
      return { message: moveResult.message };
    }

    return {};
  }

  function remapSessionFiles(fromFolder, toFolder, moved) {
    for (const [sessionId, filePath] of sessionFiles) {
      const movedPath = moved.get(filePath);
      if (movedPath) {
        sessionFiles.set(sessionId, movedPath);
        continue;
      }

      if (filePath.startsWith(`${fromFolder}${pathModule.sep}`)) {
        sessionFiles.set(sessionId, pathModule.join(toFolder, pathModule.relative(fromFolder, filePath)));
      }
    }
  }

  function findHistoryFiles(folder, options = {}) {
    if (!fs.existsSync(folder)) {
      return [];
    }

    const includeLegacyTxt = options.includeLegacyTxt !== false;

    return fs.readdirSync(folder, { withFileTypes: true })
      .flatMap((entry) => {
        const entryPath = pathModule.join(folder, entry.name);

        if (entry.isFile() && isHistoryFileName(entry.name, includeLegacyTxt)) {
          return [entryPath];
        }

        if (!entry.isDirectory()) {
          return [];
        }

        if (historyMonthFolderPattern.test(entry.name)) {
          return findHistoryFilesInMonthFolder(entryPath, { includeLegacyTxt });
        }

        if (historyYearFolderPattern.test(entry.name)) {
          return findHistoryFilesInYearFolder(entryPath, { includeLegacyTxt });
        }

        return [];
      });
  }

  function findHistoryFilesInYearFolder(yearFolder, options = {}) {
    const includeLegacyTxt = options.includeLegacyTxt !== false;

    return fs.readdirSync(yearFolder, { withFileTypes: true })
      .flatMap((entry) => {
        const entryPath = pathModule.join(yearFolder, entry.name);

        if (entry.isFile() && isHistoryFileName(entry.name, includeLegacyTxt)) {
          return [entryPath];
        }

        if (!entry.isDirectory() || !historyMonthFolderPattern.test(entry.name)) {
          return [];
        }

        return findHistoryFilesInMonthFolder(entryPath, { includeLegacyTxt });
      });
  }

  function findHistoryFilesInMonthFolder(monthFolder, options = {}) {
    const includeLegacyTxt = options.includeLegacyTxt !== false;

    return fs.readdirSync(monthFolder, { withFileTypes: true })
      .filter((file) => file.isFile() && isHistoryFileName(file.name, includeLegacyTxt))
      .map((file) => pathModule.join(monthFolder, file.name));
  }

  function isHistoryFileName(fileName, includeLegacyTxt) {
    return historyFileNamePattern.test(fileName) || (includeLegacyTxt && legacyHistoryFileNamePattern.test(fileName));
  }

  function convertLegacyTxtHistory(folder, options = {}) {
    if (!folder || !fs.existsSync(folder)) {
      return {};
    }

    const folderKey = pathModule.resolve(folder);
    if (!options.force && convertedFolders.has(folderKey)) {
      return {};
    }

    convertedFolders.add(folderKey);

    const legacyFiles = findHistoryFiles(folder, { includeLegacyTxt: true })
      .filter((filePath) => legacyHistoryFileNamePattern.test(pathModule.basename(filePath)));
    let failed = 0;

    for (const source of legacyFiles) {
      const destination = getAvailableFilePath(pathModule.dirname(source), `${pathModule.basename(source, '.txt')}.html`);

      try {
        const content = fs.readFileSync(source, 'utf8');
        fs.writeFileSync(destination, formatLegacyHistoryDay(source, content), 'utf8');
        fs.unlinkSync(source);
      } catch {
        failed += 1;
      }
    }

    if (failed > 0) {
      return {
        message: `${failed} TXT history file${failed === 1 ? '' : 's'} could not be converted to HTML.`
      };
    }

    return {};
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

  function normaliseFolder(folder) {
    return typeof folder === 'string' && folder.trim() ? pathModule.resolve(folder.trim()) : '';
  }

  return {
    chooseFolder,
    getStatus,
    openFolder,
    saveSession,
    setEnabled,
    setFolder
  };
}

function normaliseSessionUpdate(update) {
  if (!update || typeof update !== 'object') {
    return null;
  }

  const sessionId = typeof update.sessionId === 'string' ? update.sessionId.trim() : '';
  const startedAt = typeof update.startedAt === 'string' ? update.startedAt : '';

  if (!sessionId || !startedAt || Number.isNaN(Date.parse(startedAt))) {
    return null;
  }

  return {
    sessionId,
    startedAt,
    transcript: typeof update.transcript === 'string' ? update.transcript : '',
    aiResponses: Array.isArray(update.aiResponses)
      ? update.aiResponses.map(normaliseAiResponse).filter(Boolean)
      : undefined
  };
}

function normaliseAiResponse(response) {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const id = typeof response.id === 'string' ? response.id.trim() : '';

  if (!id) {
    return null;
  }

  return {
    id,
    request: typeof response.request === 'string' ? response.request : '',
    requestedAt: typeof response.requestedAt === 'string' ? response.requestedAt : null,
    response: typeof response.response === 'string' ? response.response : ''
  };
}

function mergeAiResponses(previous = [], next) {
  if (!next) {
    return previous;
  }

  const responsesById = new Map(previous.map((response) => [response.id, response]));

  for (const response of next) {
    responsesById.set(response.id, {
      ...responsesById.get(response.id),
      ...response
    });
  }

  return [...responsesById.values()];
}

function formatHistoryDay(filePath, sessions) {
  const dayName = getHistoryDayNameFromFilePath(filePath);
  const matchingSessions = [...sessions.values()]
    .filter((session) => getHistoryFileBaseName(session.startedAt) === dayName)
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const title = `Caul history ${dayName}`;
  const sessionGroups = groupSessionsByHour(matchingSessions);
  const tocItems = sessionGroups
    .map((group) => formatTocHourGroup(group))
    .join('\n');
  const sessionSections = sessionGroups
    .map((group) => formatHistoryHourGroup(group))
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      background: Canvas;
      color: CanvasText;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
    }
    h1, h2, h3 {
      line-height: 1.2;
    }
    nav {
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 24px 0;
    }
    a {
      color: LinkText;
    }
    section {
      border-top: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      padding-top: 24px;
      margin-top: 32px;
    }
    article {
      margin-top: 24px;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: anywhere;
      padding: 16px;
      border-radius: 8px;
      background: color-mix(in srgb, CanvasText 7%, transparent);
      border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    }
    .muted {
      color: color-mix(in srgb, CanvasText 68%, transparent);
    }
  </style>
</head>
<body>
  <main>
    <h1>Caul history</h1>
    <p class="muted">Date: <time datetime="${escapeHtml(dayName)}">${escapeHtml(dayName)}</time></p>
    <nav aria-label="Daily table of contents">
      <h2>Contents</h2>
      ${tocItems ? `<ol>\n${tocItems}\n      </ol>` : '<p class="muted">No history entries yet.</p>'}
    </nav>
${sessionSections || '    <p class="muted">No history entries yet.</p>'}
  </main>
</body>
</html>
`;
}

function getHistoryDayNameFromFilePath(filePath) {
  const baseName = path.basename(filePath).replace(/\.(?:html|txt)$/i, '');
  const match = baseName.match(/^\d{4}-\d{2}-\d{2}/);

  return match?.[0] ?? baseName;
}

function formatHistorySession(session) {
  const transcript = session.transcript?.trim() || 'No transcript captured yet.';
  const sessionId = getSessionAnchorId(session);
  const transcriptId = `transcript-${sessionId}`;
  const startedLabel = formatDisplayTime(session.startedAt);
  const aiSections = (session.aiResponses ?? []).map((response) => formatAiResponseSection(session, response)).join('\n');

  return `      <article id="session-${sessionId}" aria-labelledby="session-heading-${sessionId}">
        <h3 id="session-heading-${sessionId}">Listening run at <time datetime="${escapeHtml(session.startedAt)}">${escapeHtml(startedLabel)}</time></h3>
      <h4 id="${transcriptId}">Transcript</h4>
      <pre>${escapeHtml(transcript)}</pre>
${aiSections}
      </article>`;
}

function formatHistoryHourGroup(group) {
  const sessions = group.sessions
    .map((session) => formatHistorySession(session))
    .join('\n');

  return `    <section id="${group.id}" class="hour-group" aria-labelledby="${group.id}-heading">
      <h2 id="${group.id}-heading">${escapeHtml(group.label)}</h2>
${sessions}
    </section>`;
}

function formatTocHourGroup(group) {
  const sessionItems = group.sessions
    .map((session) => formatTocSession(session))
    .join('\n');

  return `        <li><a href="#${group.id}">${escapeHtml(group.label)}</a><ol>
${sessionItems}
        </ol></li>`;
}

function formatTocSession(session) {
  const sessionId = getSessionAnchorId(session);
  const transcriptId = `transcript-${sessionId}`;
  const startedLabel = formatDisplayTime(session.startedAt);
  const aiLinks = (session.aiResponses ?? [])
    .map((response) => {
      const responseId = getAiResponseAnchorId(session, response);
      const requestedLabel = response.requestedAt ? formatDisplayTime(response.requestedAt) : startedLabel;
      return `<li><a href="#${responseId}">AI response at ${escapeHtml(requestedLabel)}</a></li>`;
    })
    .join('');

  return `        <li><a href="#${transcriptId}">Transcript at ${escapeHtml(startedLabel)}</a>${aiLinks ? `<ol>${aiLinks}</ol>` : ''}</li>`;
}

function formatAiResponseSection(session, response) {
  const responseId = getAiResponseAnchorId(session, response);
  const requestId = responseId.replace(/^ai-response-/, 'ai-request-');
  const requestedLabel = response.requestedAt ? formatDisplayTime(response.requestedAt) : 'unknown time';

  return `      <h4 id="${requestId}">AI request${response.requestedAt ? ` at <time datetime="${escapeHtml(response.requestedAt)}">${escapeHtml(requestedLabel)}</time>` : ''}</h4>
      <pre>${escapeHtml(response.request?.trim() || 'No request recorded.')}</pre>
      <h4 id="${responseId}">AI response${response.requestedAt ? ` at <time datetime="${escapeHtml(response.requestedAt)}">${escapeHtml(requestedLabel)}</time>` : ''}</h4>
      <pre>${escapeHtml(response.response?.trim() || 'Waiting for response.')}</pre>`;
}

function formatLegacyHistoryDay(filePath, content) {
  const dayName = getHistoryDayNameFromFilePath(filePath);
  const title = `Caul legacy history ${dayName}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      background: Canvas;
      color: CanvasText;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: anywhere;
      padding: 16px;
      border-radius: 8px;
      background: color-mix(in srgb, CanvasText 7%, transparent);
      border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    }
  </style>
</head>
<body>
  <main>
    <h1>Caul history</h1>
    <p>Date: <time datetime="${escapeHtml(dayName)}">${escapeHtml(dayName)}</time></p>
    <section id="legacy-converted-history" aria-labelledby="legacy-converted-history-heading">
      <h2 id="legacy-converted-history-heading">Legacy converted TXT history</h2>
      <pre>${escapeHtml(content)}</pre>
    </section>
  </main>
</body>
</html>
`;
}

function getHistoryFileBaseName(startedAt) {
  const date = new Date(startedAt);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function getHistoryRelativePath(startedAt) {
  const baseName = getHistoryFileBaseName(startedAt);
  const month = baseName.slice(0, 7);

  return path.join(month, `${baseName}.html`);
}

function groupSessionsByHour(sessions) {
  const groupsByHour = new Map();

  for (const session of sessions) {
    const key = getHistoryHourKey(session.startedAt);
    const existing = groupsByHour.get(key);

    if (existing) {
      existing.sessions.push(session);
      continue;
    }

    groupsByHour.set(key, {
      id: `hour-${toHtmlId(key)}`,
      label: formatDisplayHour(session.startedAt),
      sessions: [session]
    });
  }

  return [...groupsByHour.values()];
}

function getHistoryHourKey(startedAt) {
  const date = new Date(startedAt);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0')
  ].join('-');
}

function getSessionAnchorId(session) {
  return toHtmlId(`${session.startedAt}-${session.sessionId}`);
}

function getAiResponseAnchorId(session, response) {
  return `ai-response-${toHtmlId(`${session.startedAt}-${response.id}`)}`;
}

function toHtmlId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDisplayTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatDisplayHour(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString(undefined, {
    hour: 'numeric'
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = {
  createHistoryService,
  formatHistoryDay,
  formatHistorySession,
  formatLegacyHistoryDay,
  getHistoryFileBaseName,
  getHistoryRelativePath,
  historyFileNamePattern
};

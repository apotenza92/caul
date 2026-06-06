import * as nodeFs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createHistoryService } = require('./history.cjs');

function mkdirpSync(folder) {
  mkdirSync(folder, { recursive: true });
}

function createTestService(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'caul-history-test-'));
  const documents = join(root, 'Documents');
  let state = {};
  const openedFolders = [];
  const service = createHistoryService({
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    },
    getDocumentsPath: () => documents,
    moveProfileFiles: overrides.moveProfileFiles,
    openPath: async (folder) => {
      openedFolders.push(folder);
      return '';
    },
    readState: () => state,
    writeState: (update) => {
      state = { ...state, ...update };
      return state;
    },
    fs: overrides.fs ?? nodeFs
  });

  return {
    documents,
    openedFolders,
    root,
    service,
    get state() {
      return state;
    },
    cleanup: () => rmSync(root, { force: true, recursive: true })
  };
}

describe('history service', () => {
  it('creates the default history folder and writes a daily HTML journal', () => {
    const test = createTestService();

    try {
      const result = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'Transcript started: 6 Jun 2026, 3:00:00 pm\n[3:00:01 pm]: hello'
      });

      expect(result.ok).toBe(true);
      expect(result.filePath).toBe(join(test.documents, 'Caul', '2026-06', '2026-06-06.html'));
      expect(readFileSync(result.filePath, 'utf8')).toContain('<time datetime="2026-06-06">2026-06-06</time>');
      expect(readFileSync(result.filePath, 'utf8')).toContain('<h4 id="transcript-2026-06-06t05-00-00-000z-transcript-1">Transcript</h4>');
    } finally {
      test.cleanup();
    }
  });

  it('does not write session files when disabled', () => {
    const test = createTestService();

    try {
      test.service.setEnabled(false);
      const result = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'hello'
      });

      expect(result).toEqual({ ok: true });
      expect(readdirSync(test.root, { recursive: true })).toEqual([]);
    } finally {
      test.cleanup();
    }
  });

  it('writes multiple sessions from the same day into the same daily file', () => {
    const test = createTestService();

    try {
      const first = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'first'
      });
      const second = test.service.saveSession({
        sessionId: 'transcript-2',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'second'
      });

      expect(first.filePath).toBe(second.filePath);
      const content = readFileSync(first.filePath, 'utf8');
      expect(content).toContain('first');
      expect(content).toContain('second');
    } finally {
      test.cleanup();
    }
  });

  it('groups daily history by hour so meetings are easier to identify', () => {
    const test = createTestService();

    try {
      const first = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'first hour'
      });
      test.service.saveSession({
        sessionId: 'transcript-2',
        startedAt: '2026-06-06T05:30:00.000Z',
        transcript: 'same hour'
      });
      test.service.saveSession({
        sessionId: 'transcript-3',
        startedAt: '2026-06-06T06:00:00.000Z',
        transcript: 'next hour'
      });

      const firstHourId = `hour-2026-06-06-${String(new Date('2026-06-06T05:00:00.000Z').getHours()).padStart(2, '0')}`;
      const nextHourId = `hour-2026-06-06-${String(new Date('2026-06-06T06:00:00.000Z').getHours()).padStart(2, '0')}`;
      const content = readFileSync(first.filePath, 'utf8');
      expect(content).toContain(`<section id="${firstHourId}" class="hour-group"`);
      expect(content).toContain(`<section id="${nextHourId}" class="hour-group"`);
      expect(content).toContain(`href="#${firstHourId}"`);
      expect(content.indexOf('first hour')).toBeLessThan(content.indexOf('same hour'));
      expect(content.indexOf('same hour')).toBeLessThan(content.indexOf('next hour'));
    } finally {
      test.cleanup();
    }
  });

  it('escapes transcript and AI content inside HTML pre blocks', () => {
    const test = createTestService();

    try {
      const result = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: '<script>alert("transcript")</script>',
        aiResponses: [{
          id: 'response-1',
          request: '<img src=x onerror=alert(1)>',
          requestedAt: '2026-06-06T05:01:00.000Z',
          response: '<a href="javascript:alert(1)">bad</a>'
        }]
      });

      const content = readFileSync(result.filePath, 'utf8');
      expect(content).toContain('&lt;script&gt;alert(&quot;transcript&quot;)&lt;/script&gt;');
      expect(content).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(content).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;bad&lt;/a&gt;');
      expect(content).not.toContain('<script>alert');
      expect(content).not.toContain('<img src=x');
    } finally {
      test.cleanup();
    }
  });

  it('adds table of contents links to transcript and AI response anchors', () => {
    const test = createTestService();

    try {
      const result = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'hello',
        aiResponses: [{
          id: 'response-1',
          request: 'summarise',
          requestedAt: '2026-06-06T05:01:00.000Z',
          response: 'summary'
        }]
      });

      const content = readFileSync(result.filePath, 'utf8');
      expect(content).toContain('href="#transcript-2026-06-06t05-00-00-000z-transcript-1"');
      expect(content).toContain('href="#ai-response-2026-06-06t05-00-00-000z-response-1"');
      expect(content).toContain('id="ai-response-2026-06-06t05-00-00-000z-response-1"');
    } finally {
      test.cleanup();
    }
  });

  it('converts existing TXT history to HTML and deletes the TXT after a successful write', () => {
    const test = createTestService();

    try {
      const historyFolder = join(test.root, 'custom-history');
      const legacyFolder = join(historyFolder, '2026-06');
      const legacyPath = join(legacyFolder, '2026-06-06.txt');
      const htmlPath = join(legacyFolder, '2026-06-06.html');
      mkdirpSync(legacyFolder);
      writeFileSync(legacyPath, 'Legacy <content>');

      const status = test.service.setFolder(historyFolder);

      expect(status.ok).toBe(true);
      expect(existsSync(legacyPath)).toBe(false);
      expect(readFileSync(htmlPath, 'utf8')).toContain('Legacy converted TXT history');
      expect(readFileSync(htmlPath, 'utf8')).toContain('Legacy &lt;content&gt;');
    } finally {
      test.cleanup();
    }
  });

  it('converts existing nested year/month TXT history from the previous layout', () => {
    const test = createTestService();

    try {
      const historyFolder = join(test.root, 'custom-history');
      const legacyFolder = join(historyFolder, '2026', '2026-06');
      const legacyPath = join(legacyFolder, '2026-06-06.txt');
      const htmlPath = join(legacyFolder, '2026-06-06.html');
      mkdirpSync(legacyFolder);
      writeFileSync(legacyPath, 'Nested legacy content');

      const status = test.service.setFolder(historyFolder);

      expect(status.ok).toBe(true);
      expect(existsSync(legacyPath)).toBe(false);
      expect(readFileSync(htmlPath, 'utf8')).toContain('Nested legacy content');
    } finally {
      test.cleanup();
    }
  });

  it('moves existing default history out of the old History subfolder', () => {
    const test = createTestService();

    try {
      const oldDefaultFolder = join(test.documents, 'Caul', 'History');
      const oldMonthFolder = join(oldDefaultFolder, '2026-06');
      const oldHistoryPath = join(oldMonthFolder, '2026-06-06.html');
      const unrelatedPath = join(oldDefaultFolder, 'notes.txt');
      mkdirpSync(oldMonthFolder);
      writeFileSync(oldHistoryPath, '<!doctype html><title>old history</title>');
      writeFileSync(unrelatedPath, 'leave me');

      const status = test.service.getStatus();
      const newHistoryPath = join(test.documents, 'Caul', '2026-06', '2026-06-06.html');

      expect(status.folder).toBe(join(test.documents, 'Caul'));
      expect(readFileSync(newHistoryPath, 'utf8')).toContain('old history');
      expect(existsSync(oldHistoryPath)).toBe(false);
      expect(readFileSync(unrelatedPath, 'utf8')).toBe('leave me');
    } finally {
      test.cleanup();
    }
  });

  it('leaves TXT history in place and surfaces a message when conversion cannot complete', () => {
    const fs = {
      ...nodeFs,
      unlinkSync: (filePath) => {
        if (String(filePath).endsWith('.txt')) {
          throw new Error('simulated delete failure');
        }
        nodeFs.unlinkSync(filePath);
      }
    };
    const test = createTestService({ fs });

    try {
      const historyFolder = join(test.root, 'custom-history');
      const legacyFolder = join(historyFolder, '2026-06');
      const legacyPath = join(legacyFolder, '2026-06-06.txt');
      mkdirpSync(legacyFolder);
      writeFileSync(legacyPath, 'Legacy content');

      const status = test.service.setFolder(historyFolder);

      expect(status.message).toBe('1 TXT history file could not be converted to HTML.');
      expect(existsSync(legacyPath)).toBe(true);
    } finally {
      test.cleanup();
    }
  });

  it('moves existing Caul history files and leaves unrelated files behind', () => {
    const test = createTestService();

    try {
      const oldFolder = join(test.root, 'old');
      const newFolder = join(test.root, 'new');
      test.service.setFolder(oldFolder);
      const saved = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'moved'
      });
      writeFileSync(join(oldFolder, 'notes.txt'), 'leave me');

      const status = test.service.setFolder(newFolder);

      expect(status.folder).toBe(newFolder);
      expect(readdirSync(newFolder, { recursive: true }).some((file) => String(file).endsWith('2026-06-06.html'))).toBe(true);
      expect(readFileSync(join(oldFolder, 'notes.txt'), 'utf8')).toBe('leave me');
      expect(() => readFileSync(saved.filePath, 'utf8')).toThrow();
    } finally {
      test.cleanup();
    }
  });

  it('moves portable profile files when the Caul folder changes', () => {
    const profileMoves = [];
    const test = createTestService({
      moveProfileFiles: (fromFolder, toFolder) => {
        profileMoves.push({ fromFolder, toFolder });
        return { moved: new Map() };
      }
    });

    try {
      const oldFolder = join(test.root, 'old');
      const newFolder = join(test.root, 'new');
      test.service.setFolder(oldFolder);

      test.service.setFolder(newFolder);

      expect(profileMoves.at(-1)).toEqual({
        fromFolder: oldFolder,
        toFolder: newFolder
      });
    } finally {
      test.cleanup();
    }
  });


  it('suffixes moved history files when the new folder has a filename collision', () => {
    const test = createTestService();

    try {
      const oldFolder = join(test.root, 'old');
      const newFolder = join(test.root, 'new');
      test.service.setFolder(oldFolder);
      const saved = test.service.saveSession({
        sessionId: 'transcript-1',
        startedAt: '2026-06-06T05:00:00.000Z',
        transcript: 'from old folder'
      });
      test.service.setFolder(newFolder);
      test.service.setFolder(oldFolder);
      const collisionFolder = join(newFolder, '2026-06');
      mkdirpSync(collisionFolder);
      writeFileSync(join(collisionFolder, basename(saved.filePath)), 'collision');

      test.service.setFolder(newFolder);

      const files = readdirSync(newFolder, { recursive: true }).filter((file) => String(file).endsWith('.html')).sort();
      expect(files).toHaveLength(2);
      expect(files.some((file) => /-2\.html$/.test(String(file)))).toBe(true);
    } finally {
      test.cleanup();
    }
  });

  it('opens the configured history folder', async () => {
    const test = createTestService();

    try {
      const result = await test.service.openFolder();

      expect(result).toEqual({ ok: true });
      expect(test.openedFolders).toEqual([join(test.documents, 'Caul')]);
    } finally {
      test.cleanup();
    }
  });
});

import * as nodeFs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createProfileService } = require('./profile.cjs');

function mkdirpSync(folder) {
  mkdirSync(folder, { recursive: true });
}

function createTestService(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'caul-profile-test-'));
  const documents = join(root, 'Documents');
  let pointerState = overrides.pointerState ?? {};
  const service = createProfileService({
    getDefaultFolder: () => join(documents, 'Caul'),
    readPointerState: () => pointerState,
    writePointerState: (update) => {
      pointerState = { ...pointerState, ...update };
      return pointerState;
    },
    readLegacySettings: overrides.readLegacySettings ?? (() => ({
      historyEnabled: false,
      selectedLocalTranscriptionModel: 'moonshine-tiny'
    })),
    readLegacyPrompts: overrides.readLegacyPrompts ?? (() => ({
      selectedTemplateIds: ['custom-template'],
      templates: [{
        attachments: [],
        createdAt: '2026-06-06T00:00:00.000Z',
        id: 'custom-template',
        name: 'Custom template',
        prompt: 'Legacy prompt.',
        updatedAt: '2026-06-06T00:00:00.000Z'
      }]
    })),
    normaliseSettings: overrides.normaliseSettings ?? ((value) => ({
      ...(typeof value?.historyEnabled === 'boolean' ? { historyEnabled: value.historyEnabled } : {}),
      ...(value?.selectedLocalTranscriptionModel === 'moonshine-tiny' || value?.selectedLocalTranscriptionModel === 'parakeet'
        ? { selectedLocalTranscriptionModel: value.selectedLocalTranscriptionModel }
        : {})
    })),
    normalisePrompts: overrides.normalisePrompts ?? ((value) => ({
      selectedTemplateIds: Array.isArray(value?.selectedTemplateIds) ? value.selectedTemplateIds : [],
      templates: Array.isArray(value?.templates) ? value.templates : []
    })),
    fs: nodeFs
  });

  return {
    documents,
    root,
    service,
    get pointerState() {
      return pointerState;
    },
    cleanup: () => rmSync(root, { force: true, recursive: true })
  };
}

describe('profile service', () => {
  it('creates portable settings from legacy settings when missing', () => {
    const test = createTestService();

    try {
      const settings = test.service.readSettings();
      const settingsPath = join(test.documents, 'Caul', 'settings.json');

      expect(settings).toEqual({
        historyEnabled: false,
        selectedLocalTranscriptionModel: 'moonshine-tiny'
      });
      expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
        version: 1,
        historyEnabled: false,
        selectedLocalTranscriptionModel: 'moonshine-tiny'
      });
    } finally {
      test.cleanup();
    }
  });

  it('creates portable prompts from legacy prompts when missing', () => {
    const test = createTestService();

    try {
      const prompts = test.service.readPrompts();
      const promptsPath = join(test.documents, 'Caul', 'prompts.json');

      expect(prompts.selectedTemplateIds).toEqual(['custom-template']);
      expect(prompts.templates).toEqual([
        expect.objectContaining({ id: 'custom-template', prompt: 'Legacy prompt.' })
      ]);
      expect(JSON.parse(readFileSync(promptsPath, 'utf8')).version).toBe(1);
    } finally {
      test.cleanup();
    }
  });

  it('prefers existing portable settings over legacy settings', () => {
    const test = createTestService();

    try {
      const settingsPath = join(test.documents, 'Caul', 'settings.json');
      mkdirpSync(join(test.documents, 'Caul'));
      writeFileSync(settingsPath, `${JSON.stringify({
        version: 1,
        historyEnabled: true,
        selectedLocalTranscriptionModel: 'parakeet'
      })}\n`);

      expect(test.service.readSettings()).toEqual({
        historyEnabled: true,
        selectedLocalTranscriptionModel: 'parakeet'
      });
    } finally {
      test.cleanup();
    }
  });

  it('prefers existing portable prompts over legacy prompts', () => {
    const test = createTestService();

    try {
      const promptsPath = join(test.documents, 'Caul', 'prompts.json');
      mkdirpSync(join(test.documents, 'Caul'));
      writeFileSync(promptsPath, `${JSON.stringify({
        version: 1,
        selectedTemplateIds: ['portable-template'],
        templates: [{
          attachments: [],
          createdAt: '2026-06-06T00:00:00.000Z',
          id: 'portable-template',
          name: 'Portable template',
          prompt: 'Portable prompt.',
          updatedAt: '2026-06-06T00:00:00.000Z'
        }]
      })}\n`);

      expect(test.service.readPrompts()).toEqual({
        selectedTemplateIds: ['portable-template'],
        templates: [
          expect.objectContaining({ id: 'portable-template', prompt: 'Portable prompt.' })
        ]
      });
    } finally {
      test.cleanup();
    }
  });

  it('moves portable JSON files and suffixes destination collisions', () => {
    const test = createTestService();

    try {
      const oldFolder = join(test.root, 'old');
      const newFolder = join(test.root, 'new');
      mkdirpSync(oldFolder);
      mkdirpSync(newFolder);
      writeFileSync(join(oldFolder, 'settings.json'), '{"version":1,"historyEnabled":true}\n');
      writeFileSync(join(oldFolder, 'prompts.json'), '{"version":1,"templates":[]}\n');
      writeFileSync(join(newFolder, 'settings.json'), '{"version":1,"historyEnabled":false}\n');
      writeFileSync(join(oldFolder, 'notes.txt'), 'leave me');

      const result = test.service.movePortableFiles(oldFolder, newFolder);

      expect(result.message).toBeUndefined();
      expect(readdirSync(newFolder).sort()).toEqual(['prompts.json', 'settings-2.json', 'settings.json']);
      expect(readFileSync(join(oldFolder, 'notes.txt'), 'utf8')).toBe('leave me');
      expect(existsSync(join(oldFolder, 'settings.json'))).toBe(false);
      expect(existsSync(join(oldFolder, 'prompts.json'))).toBe(false);
    } finally {
      test.cleanup();
    }
  });
});

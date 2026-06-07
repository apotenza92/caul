import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildLocalLlmPromptWithAttachments,
  clearLocalAttachmentTextCache,
  forgetLocalLlmAttachments,
  preloadLocalLlmAttachments,
  readPdfText
} = require('./llmAttachments.cjs');

describe('LLM attachments', () => {
  it('adds readable text attachment content to local prompts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'caul-llm-attachments-'));

    try {
      const cvPath = join(root, 'cv.txt');
      writeFileSync(cvPath, 'Led product work and shipped a desktop AI assistant.');

      const prompt = await buildLocalLlmPromptWithAttachments('Transcript:\nis my cv good', [
        {
          kind: 'text',
          name: 'Alex CV.txt',
          path: cvPath
        }
      ]);

      expect(prompt).toContain('Attached file context:');
      expect(prompt).toContain('Attachment: Alex CV.txt');
      expect(prompt).toContain('Led product work and shipped a desktop AI assistant.');
      expect(prompt).toContain('User request:');
      expect(prompt).toContain('is my cv good');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('warns local prompts when an attachment cannot be read', async () => {
    const prompt = await buildLocalLlmPromptWithAttachments('Transcript:\nreview my cv', [
      {
        kind: 'file',
        name: 'CV.pdf',
        path: '/tmp/does-not-exist.pdf'
      }
    ]);

    expect(prompt).toContain('Caul could not read this file locally: file is missing');
    expect(prompt).toContain('do not pretend to have reviewed it');
  });

  it('reuses attachment text that was pre-processed when the file was attached', async () => {
    clearLocalAttachmentTextCache();
    let reads = 0;
    const attachment = {
      kind: 'text',
      name: 'Alex CV.txt',
      path: '/tmp/caul-preloaded-cv.txt'
    };
    const fs = {
      existsSync: () => true,
      statSync: () => ({
        isFile: () => true,
        mtimeMs: 123,
        size: 42
      }),
      readFileSync: () => {
        reads += 1;
        return 'Preloaded attachment text.';
      }
    };

    await preloadLocalLlmAttachments([attachment], { fs });
    const prompt = await buildLocalLlmPromptWithAttachments('Transcript:\nreview my cv', [attachment], { fs });

    expect(reads).toBe(1);
    expect(prompt).toContain('Preloaded attachment text.');
    clearLocalAttachmentTextCache();
  });

  it('removes pre-processed attachment text when an attachment is deleted', async () => {
    clearLocalAttachmentTextCache();
    let reads = 0;
    const attachment = {
      kind: 'text',
      name: 'Alex CV.txt',
      path: '/tmp/caul-deleted-cv.txt'
    };
    const fs = {
      existsSync: () => true,
      statSync: () => ({
        isFile: () => true,
        mtimeMs: 123,
        size: 42
      }),
      readFileSync: () => {
        reads += 1;
        return `Attachment read ${reads}.`;
      }
    };

    await preloadLocalLlmAttachments([attachment], { fs });
    forgetLocalLlmAttachments([attachment]);
    const prompt = await buildLocalLlmPromptWithAttachments('Transcript:\nreview my cv', [attachment], { fs });

    expect(reads).toBe(2);
    expect(prompt).toContain('Attachment read 2.');
    clearLocalAttachmentTextCache();
  });

  it('builds a file-upload fallback prompt from pre-processed attachment text', async () => {
    clearLocalAttachmentTextCache();
    const attachment = {
      kind: 'text',
      name: 'Cloud fallback CV.txt',
      path: '/tmp/caul-cloud-fallback-cv.txt'
    };
    const fs = {
      existsSync: () => true,
      statSync: () => ({
        isFile: () => true,
        mtimeMs: 123,
        size: 42
      }),
      readFileSync: () => 'Cloud fallback attachment text.'
    };

    await preloadLocalLlmAttachments([attachment], { fs });
    const prompt = await buildLocalLlmPromptWithAttachments('Transcript:\nreview my cv', [attachment], { fs });

    expect(prompt).toContain('Attached file context:');
    expect(prompt).toContain('Attachment: Cloud fallback CV.txt');
    expect(prompt).toContain('Cloud fallback attachment text.');
    expect(prompt).toContain('User request:');
    clearLocalAttachmentTextCache();
  });

  it('extracts readable PDF text for local prompts when a PDF generator is available', async () => {
    const pandoc = '/opt/homebrew/bin/pandoc';

    if (!existsSync(pandoc)) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'caul-llm-pdf-attachments-'));

    try {
      const sourcePath = join(root, 'cv.md');
      const pdfPath = join(root, 'cv.pdf');
      writeFileSync(sourcePath, '# Alex CV\n\nBuilt Caul attachment support.\n');

      const result = spawnSync(pandoc, [sourcePath, '-o', pdfPath], { encoding: 'utf8' });
      expect(result.status).toBe(0);

      const text = await readPdfText(pdfPath, { fs: require('node:fs') });
      expect(text).toContain('Alex CV');
      expect(text).toContain('Built Caul attachment support.');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

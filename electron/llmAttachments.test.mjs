import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildLocalLlmPromptWithAttachments } = require('./llmAttachments.cjs');

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
});

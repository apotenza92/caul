const fsSync = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const localAttachmentTextLimit = 60_000;
const localAttachmentTextCacheLimit = 128;
const localAttachmentTextCache = new Map();

async function buildLocalLlmPromptWithAttachments(transcript, attachments, {
  fs = fsSync,
  platform = process.platform,
  spawnProcess = spawn
} = {}) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return transcript;
  }

  const results = await Promise.all(attachments.map((attachment) => (
    readAttachmentTextCached(attachment, { fs, platform, spawnProcess })
  )));
  const sections = results.map((result) => {
    if (result.text) {
      return [
        `Attachment: ${result.name}`,
        result.text
      ].join('\n');
    }

    return `Attachment: ${result.name}\nCaul could not read this file locally: ${result.reason}`;
  });

  return [
    'Attached file context:',
    'Use the readable attachment content below. If a requested file could not be read, say that clearly and do not pretend to have reviewed it.',
    '',
    sections.join('\n\n---\n\n'),
    '',
    'User request:',
    transcript
  ].join('\n');
}

function preloadLocalLlmAttachments(attachments, {
  fs = fsSync,
  platform = process.platform,
  spawnProcess = spawn
} = {}) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return Promise.resolve([]);
  }

  return Promise.all(attachments.map((attachment) => (
    readAttachmentTextCached(attachment, { fs, platform, spawnProcess })
  )));
}

async function readAttachmentTextCached(attachment, {
  fs = fsSync,
  platform = process.platform,
  spawnProcess = spawn
} = {}) {
  const cacheKey = getAttachmentCacheKey(attachment, { fs });

  if (!cacheKey) {
    return readAttachmentText(attachment, { fs, platform, spawnProcess });
  }

  const cached = localAttachmentTextCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = readAttachmentText(attachment, { fs, platform, spawnProcess });
  rememberAttachmentText(cacheKey, pending);

  return pending;
}

function getAttachmentCacheKey(attachment, { fs = fsSync } = {}) {
  const filePath = typeof attachment?.path === 'string' ? attachment.path : '';

  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  try {
    const stats = fs.statSync(filePath);

    if (typeof stats?.isFile === 'function' && !stats.isFile()) {
      return '';
    }

    return [filePath, stats.size ?? 0, stats.mtimeMs ?? 0].join('\0');
  } catch {
    return '';
  }
}

function rememberAttachmentText(cacheKey, pending) {
  localAttachmentTextCache.set(cacheKey, pending);

  if (localAttachmentTextCache.size <= localAttachmentTextCacheLimit) {
    return;
  }

  const oldestKey = localAttachmentTextCache.keys().next().value;

  if (oldestKey) {
    localAttachmentTextCache.delete(oldestKey);
  }
}

function clearLocalAttachmentTextCache() {
  localAttachmentTextCache.clear();
}

async function readAttachmentText(attachment, {
  fs = fsSync,
  platform = process.platform,
  spawnProcess = spawn
} = {}) {
  const name = attachment?.name || path.basename(attachment?.path || '') || 'attachment';
  const filePath = typeof attachment?.path === 'string' ? attachment.path : '';

  if (!filePath || !fs.existsSync(filePath)) {
    return { name, reason: 'file is missing', text: '' };
  }

  const extension = path.extname(filePath).toLowerCase();

  if (attachment?.kind === 'text' || isPlainTextExtension(extension)) {
    try {
      return {
        name,
        text: truncateAttachmentText(fs.readFileSync(filePath, 'utf8'))
      };
    } catch {
      return { name, reason: 'text could not be read', text: '' };
    }
  }

  if (extension === '.docx') {
    const text = await readDocxText(filePath, { spawnProcess });

    return text
      ? { name, text: truncateAttachmentText(text) }
      : { name, reason: 'DOCX text could not be extracted', text: '' };
  }

  if (extension === '.pdf') {
    const text = await readPdfText(filePath, { fs });

    return text
      ? { name, text: truncateAttachmentText(text) }
      : { name, reason: 'PDF text could not be extracted', text: '' };
  }

  if (platform === 'darwin' && ['.doc', '.rtf', '.rtfd'].includes(extension)) {
    const text = await runTextutil(filePath, { spawnProcess });

    return text
      ? { name, text: truncateAttachmentText(text) }
      : { name, reason: `${extension.slice(1).toUpperCase()} text could not be extracted`, text: '' };
  }

  return { name, reason: `${extension || 'file'} attachments are not readable by local AI yet`, text: '' };
}

function isPlainTextExtension(extension) {
  return new Set([
    '.c', '.cpp', '.css', '.csv', '.go', '.htm', '.html', '.js', '.json', '.jsx',
    '.log', '.md', '.py', '.rs', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml'
  ]).has(extension);
}

async function readDocxText(filePath, { spawnProcess }) {
  const xml = await runCommand('unzip', ['-p', filePath, 'word/document.xml'], { spawnProcess });

  if (!xml) {
    return '';
  }

  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readPdfText(filePath, { fs }) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const task = pdfjs.getDocument({
      data,
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false
    });
    const pdf = await task.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (typeof item?.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (text) {
        pages.push(text);
      }
    }

    try {
      pdf.cleanup?.();
      await task.destroy?.();
    } catch {
      // Cleanup is best effort; extracted text above is still usable.
    }

    return pages.join('\n\n').trim();
  } catch {
    return '';
  }
}

async function runTextutil(filePath, { spawnProcess }) {
  return runCommand('/usr/bin/textutil', ['-convert', 'txt', '-stdout', filePath], { spawnProcess });
}

function runCommand(command, args, { spawnProcess, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    const child = spawnProcess(command, args, {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill?.('SIGTERM');
      resolve('');
    }, timeoutMs);
    const settle = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', () => settle(''));
    child.on('close', (code) => {
      settle(code === 0 ? stdout.trim() : '');
    });
  });
}

function truncateAttachmentText(text) {
  const normalised = String(text ?? '').replace(/\0/g, '').trim();

  if (normalised.length <= localAttachmentTextLimit) {
    return normalised;
  }

  return `${normalised.slice(0, localAttachmentTextLimit).trim()}\n\n[Attachment truncated by Caul.]`;
}

module.exports = {
  buildLocalLlmPromptWithAttachments,
  clearLocalAttachmentTextCache,
  preloadLocalLlmAttachments,
  readPdfText,
  readAttachmentText
};

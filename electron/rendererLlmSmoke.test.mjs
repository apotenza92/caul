import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { rendererLlmSmokeSucceeded } = require('./rendererLlmSmoke.cjs');

describe('renderer LLM smoke validation', () => {
  it('accepts a changed response that exactly matches the expected text', () => {
    expect(rendererLlmSmokeSucceeded({
      finalValue: 'CAUL LIVE TEST OK',
      responseChanged: true
    }, 'CAUL LIVE TEST OK')).toBe(true);
  });

  it('rejects unchanged onboarding or placeholder text', () => {
    expect(rendererLlmSmokeSucceeded({
      finalValue: 'Permissions are needed before listening.',
      responseChanged: false
    })).toBe(false);
    expect(rendererLlmSmokeSucceeded({
      finalValue: 'No response yet.',
      responseChanged: true
    })).toBe(false);
  });

  it('rejects a real response that does not match the deterministic expectation', () => {
    expect(rendererLlmSmokeSucceeded({
      finalValue: 'Almost right',
      responseChanged: true
    }, 'CAUL LIVE TEST OK')).toBe(false);
  });

  it('writes the result to the smoke log and propagates failure through the process exit code', () => {
    const source = readFileSync(resolve(process.cwd(), 'electron/main.cjs'), 'utf8');

    expect(source).toContain(
      'emitSmokeLine(`caul-renderer-llm-smoke ${JSON.stringify(result)}`);'
    );
    expect(source).toContain('setImmediate(() => {');
    expect(source).toContain('setTimeout(() => process.exit(exitCode), 1_000);');
    expect(source).toContain('app.exit(exitCode);');
  });
});

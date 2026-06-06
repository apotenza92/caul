import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('onboarding model catalogue refresh', () => {
  it('attempts a bounded live catalogue refresh before falling back to bundled recommendations', () => {
    const mainSource = readFileSync(resolve(root, 'electron/main.cjs'), 'utf8');

    expect(mainSource).toContain('async function ensureLiveModelCatalogueForOnboarding()');
    expect(mainSource).toContain('await ensureLiveModelCatalogueForOnboarding();');
    expect(mainSource).toContain('timeoutMs: onboardingModelCatalogueRefreshTimeoutMs');
    expect(mainSource).toContain("console.error('Onboarding model catalogue refresh failed; using bundled fallback:'");
    expect(mainSource).toContain('loadBestModelCatalogue({');
    expect(mainSource).toContain('allowLive: false');
  });
});

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateVmE2eSummary } from './vm/summary.mjs';

const requiredProfiles = ['macos', 'win', 'linux'];
const summaryDir = path.join(process.cwd(), 'artifacts', 'vm-e2e');
const requirePassing = process.env.CAUL_REQUIRE_VM_E2E === '1';
const missing = [];
const blocked = [];
const failing = [];
const invalid = [];

for (const profile of requiredProfiles) {
  const summaryPath = path.join(summaryDir, `${profile}.json`);

  try {
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    const validation = validateVmE2eSummary(summary);

    if (!validation.ok) {
      invalid.push(`${profile} (${validation.missing.join(', ')})`);
    } else if (!summary?.ok) {
      if (summary?.blocked) {
        blocked.push(profile);
      } else {
        failing.push(profile);
      }
    }
  } catch {
    missing.push(profile);
  }
}

if (missing.length === 0 && blocked.length === 0 && failing.length === 0 && invalid.length === 0) {
  console.log('VM E2E summaries: ok');
  process.exit(0);
}

const message = [
  missing.length > 0 ? `missing ${missing.join(', ')}` : null,
  invalid.length > 0 ? `invalid ${invalid.join('; ')}` : null,
  blocked.length > 0 ? `blocked ${blocked.join(', ')}` : null,
  failing.length > 0 ? `failing ${failing.join(', ')}` : null
].filter(Boolean).join('; ');

if (requirePassing) {
  console.error(`VM E2E summaries blocked release: ${message}.`);
  process.exit(1);
}

console.warn(`Warning: VM E2E summaries are incomplete: ${message}. Set CAUL_REQUIRE_VM_E2E=1 to enforce this gate.`);

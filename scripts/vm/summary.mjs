import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const requiredVmE2eGates = [
  'package',
  'onboarding',
  'systemAudio',
  'microphone',
  'audioIsolation',
  'transcription',
  'ai',
  'privacy',
  'cleanup'
];

export function createVmE2eSummary({
  blocked = false,
  cleanup = null,
  details = '',
  evidence = {},
  gates = {},
  packagePath,
  packageVersion,
  profile,
  stage = null,
  vmName
}) {
  const completeGates = Object.fromEntries(requiredVmE2eGates.map((gate) => [gate, gates[gate] === true]));
  const validation = validateVmE2eSummary({
    gates: completeGates,
    packagePath,
    packageVersion,
    profile,
    vmName
  });

  return {
    blocked,
    cleanup,
    details,
    evidence: {
      logs: evidence.logs ?? [],
      screenshots: evidence.screenshots ?? []
    },
    gates: completeGates,
    ok: validation.ok && Object.values(completeGates).every(Boolean) && blocked !== true,
    packagePath,
    packageVersion,
    profile,
    stage,
    vmName
  };
}

export function validateVmE2eSummary(summary) {
  const missing = [];

  for (const field of ['profile', 'vmName', 'packagePath', 'packageVersion']) {
    if (!summary?.[field]) {
      missing.push(field);
    }
  }

  for (const gate of requiredVmE2eGates) {
    if (typeof summary?.gates?.[gate] !== 'boolean') {
      missing.push(gate);
    }
  }

  return {
    missing,
    ok: missing.length === 0
  };
}

export async function writeVmE2eSummary(summary, cwd = process.cwd()) {
  const outputDir = path.join(cwd, 'artifacts', 'vm-e2e');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, `${summary.profile}.json`), `${JSON.stringify(summary, null, 2)}\n`);
}

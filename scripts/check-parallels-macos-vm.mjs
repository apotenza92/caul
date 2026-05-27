import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const vmName = process.env.SUSURA_MACOS_VM_NAME ?? 'macOS Tahoe';

async function runPrlctl(args) {
  try {
    const result = await execFileAsync('prlctl', args, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });

    return {
      ok: true,
      text: result.stdout.trim()
    };
  } catch (error) {
    return {
      ok: false,
      text: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim()
    };
  }
}

function extractValue(text, label) {
  const line = text.split('\n').find((candidate) => candidate.trim().startsWith(label));

  return line ? line.split(':').slice(1).join(':').trim() : 'unknown';
}

const list = await runPrlctl(['list', vmName, '-i']);

if (!list.ok) {
  console.error(`Could not inspect Parallels VM "${vmName}".`);
  console.error(list.text);
  process.exit(1);
}

const guestTools = extractValue(list.text, 'GuestTools');
const state = extractValue(list.text, 'State');
const ipAddresses = extractValue(list.text, 'IP Addresses');
const guestToolsReady = /\bstate=installed\b/.test(guestTools);
const canRunHostDrivenChecks = state === 'running' && guestToolsReady;

console.log(`VM: ${vmName}`);
console.log(`State: ${state}`);
console.log(`Guest Tools: ${guestTools}`);
console.log(`IP Addresses: ${ipAddresses || 'none'}`);
console.log(`Host-driven checks: ${canRunHostDrivenChecks ? 'ready' : 'blocked'}`);

if (!canRunHostDrivenChecks) {
  console.log('Next step: install Parallels Tools or enable SSH inside the guest, then rerun npm run vm:status.');
} else if (!ipAddresses) {
  console.log('Note: prlctl did not report a guest IP address, but host-driven command checks should still work through Parallels Tools.');
}

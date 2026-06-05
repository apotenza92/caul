import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const vmName = process.env.CAUL_MACOS_VM_NAME ?? 'macOS Tahoe';
const testUrl = process.env.CAUL_VM_TEST_URL ?? 'http://10.211.55.2:5173/';

async function runPrlctl(args, options = {}) {
  try {
    const result = await execFileAsync('prlctl', args, {
      timeout: options.timeout ?? 15_000,
      maxBuffer: 5 * 1024 * 1024
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

const info = await runPrlctl(['list', vmName, '-i']);

if (!info.ok) {
  console.error(`Could not inspect Parallels VM "${vmName}".`);
  console.error(info.text);
  process.exit(1);
}

const state = extractValue(info.text, 'State');
const guestTools = extractValue(info.text, 'GuestTools');
const ipAddresses = extractValue(info.text, 'IP Addresses');
const ready = state === 'running' && /\bstate=installed\b/.test(guestTools);

if (!ready) {
  console.error(`VM smoke blocked for "${vmName}".`);
  console.error(`State: ${state}`);
  console.error(`Guest Tools: ${guestTools}`);
  console.error(`IP Addresses: ${ipAddresses || 'none'}`);
  console.error('Install Parallels Tools or enable SSH inside the guest, then rerun npm run vm:smoke.');
  process.exit(1);
}

const macos = await runPrlctl(['exec', vmName, '/usr/bin/sw_vers', '-productVersion']);
const arch = await runPrlctl(['exec', vmName, '/usr/bin/uname', '-m']);
const html = await runPrlctl(['exec', vmName, '/usr/bin/curl', '-fsS', '--max-time', '10', testUrl], {
  timeout: 20_000
});

if (!macos.ok || !arch.ok || !html.ok) {
  console.error('VM smoke failed while running guest commands.');
  console.error(macos.text);
  console.error(arch.text);
  console.error(html.text);
  process.exit(1);
}

if (!html.text.includes('<title>Caul</title>')) {
  console.error(`VM reached ${testUrl}, but the response did not look like the Caul app.`);
  process.exit(1);
}

console.log(`VM: ${vmName}`);
console.log(`Guest macOS: ${macos.text}`);
console.log(`Guest arch: ${arch.text}`);
console.log(`Guest IP Addresses: ${ipAddresses || 'not reported by prlctl'}`);
console.log(`App URL from guest: ${testUrl}`);
console.log('VM smoke: passed');

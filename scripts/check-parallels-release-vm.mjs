import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const profiles = {
  fedora: {
    defaultName: 'Fedora 42 ARM64',
    envName: 'CAUL_FEDORA_VM_NAME',
    probe: ['/usr/bin/uname', '-a']
  },
  linux: {
    defaultName: 'Ubuntu 24.04.3 ARM64',
    envName: 'CAUL_LINUX_VM_NAME',
    probe: ['/usr/bin/uname', '-a']
  },
  win: {
    defaultName: 'Windows 11 ARM',
    envName: 'CAUL_WINDOWS_VM_NAME',
    probe: ['cmd.exe', '/c', 'ver']
  }
};

const profileName = process.argv[2];
const profile = profiles[profileName];

if (!profile) {
  console.error('Usage: node scripts/check-parallels-release-vm.mjs <win|linux|fedora>');
  process.exit(1);
}

const vmName = process.env[profile.envName] ?? profile.defaultName;

async function runPrlctl(args, options = {}) {
  try {
    const result = await execFileAsync('prlctl', args, {
      timeout: options.timeout ?? 10_000,
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
console.log(`Profile: ${profileName}`);
console.log(`State: ${state}`);
console.log(`Guest Tools: ${guestTools}`);
console.log(`IP Addresses: ${ipAddresses || 'none'}`);
console.log(`Host-driven checks: ${canRunHostDrivenChecks ? 'ready' : 'blocked'}`);

if (!canRunHostDrivenChecks) {
  console.log(`Next step: start "${vmName}", install Parallels Tools if needed, then rerun npm run vm:status:${profileName}.`);
  process.exit(1);
}

const probe = await runPrlctl(['exec', vmName, ...profile.probe], { timeout: 15_000 });

if (!probe.ok) {
  console.error('VM command probe failed.');
  console.error(probe.text);
  process.exit(1);
}

console.log(`Guest probe: ${probe.text}`);

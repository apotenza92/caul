import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const profiles = {
  linux: {
    defaultName: 'Ubuntu 24.04.3 ARM64',
    envName: 'CAUL_LINUX_VM_NAME',
    repoEnv: 'CAUL_LINUX_VM_REPO',
    defaultRepo: '/home/parallels/caul-cross-platform',
    userEnv: 'CAUL_LINUX_VM_SSH_USER',
    defaultUser: 'parallels',
    knownHostsEnv: 'CAUL_LINUX_VM_KNOWN_HOSTS',
    defaultKnownHosts: '/tmp/caul_known_hosts',
    command(repo) {
      return `cd ${shellQuote(repo)} && /home/parallels/.cargo/bin/cargo run -p caul-desktop-backend -- --stream-system-audio --duration 3 --smoke-summary`;
    },
    prerequisiteCommand(repo) {
      return `test -f ${shellQuote(`${repo}/Cargo.toml`)} && test -x /home/parallels/.cargo/bin/cargo`;
    }
  },
  win: {
    defaultName: 'Windows 11 ARM',
    envName: 'CAUL_WINDOWS_VM_NAME',
    repoEnv: 'CAUL_WINDOWS_VM_REPO',
    defaultRepo: 'C:\\Users\\alex\\caul-cross-platform',
    cargoEnv: 'CAUL_WINDOWS_VM_CARGO',
    defaultCargo: 'C:\\WINDOWS\\system32\\config\\systemprofile\\.cargo\\bin\\cargo.exe',
    rustcEnv: 'CAUL_WINDOWS_VM_RUSTC',
    defaultRustc: 'C:\\WINDOWS\\system32\\config\\systemprofile\\.cargo\\bin\\rustc.exe',
    command(repo) {
      const cargo = process.env[this.cargoEnv] ?? this.defaultCargo;
      const rustc = process.env[this.rustcEnv] ?? this.defaultRustc;
      const stimulusScript = `${repo}\\scripts\\windows-audio-stimulus.ps1`;

      return [
        `cd /d ${cmdQuote(repo)}`,
        `start "Caul audio stimulus" /MIN powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${cmdQuote(stimulusScript)}`,
        'powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"',
        `set RUSTC=${rustc}&& ${cmdQuote(cargo)} run --target aarch64-pc-windows-msvc -p caul-desktop-backend -- --stream-system-audio --duration 3 --smoke-summary`
      ].join(' && ');
    },
    prerequisiteCommand(repo) {
      const cargo = process.env[this.cargoEnv] ?? this.defaultCargo;
      const rustc = process.env[this.rustcEnv] ?? this.defaultRustc;

      return [
        `if not exist ${cmdQuote(`${repo}\\Cargo.toml`)} (echo missing ${repo}\\Cargo.toml && exit /b 2)`,
        `if not exist ${cmdQuote(`${repo}\\scripts\\windows-audio-stimulus.ps1`)} (echo missing ${repo}\\scripts\\windows-audio-stimulus.ps1 && exit /b 2)`,
        `if not exist ${cmdQuote(cargo)} (echo missing ${cargo} && exit /b 2)`,
        `if not exist ${cmdQuote(rustc)} (echo missing ${rustc} && exit /b 2)`,
        `${cmdQuote(rustc)} -vV | findstr /C:"host: aarch64-pc-windows-msvc" >nul || (echo Rust host must be aarch64-pc-windows-msvc && ${cmdQuote(rustc)} -vV && exit /b 2)`,
        'echo caul-backend-smoke-ready'
      ].join(' && ');
    }
  }
};

const profileName = process.argv[2];
const profile = profiles[profileName];

if (!profile) {
  console.error('Usage: node scripts/smoke-parallels-backend-vm.mjs <win|linux>');
  process.exit(1);
}

const vmName = process.env[profile.envName] ?? profile.defaultName;
const repoPath = process.env[profile.repoEnv] ?? profile.defaultRepo;

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options.timeout ?? 30_000,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024
    });

    return {
      ok: true,
      text: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    };
  } catch (error) {
    return {
      ok: false,
      text: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim()
    };
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function cmdQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function extractValue(text, label) {
  const line = text.split('\n').find((candidate) => candidate.trim().startsWith(label));

  return line ? line.split(':').slice(1).join(':').trim() : 'unknown';
}

function parseSmokeSummary(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);

      if (parsed?.type === 'system_audio_smoke') {
        return parsed;
      }
    } catch {
      // Ignore non-JSON build output.
    }
  }

  return null;
}

const info = await run('prlctl', ['list', vmName, '-i']);

if (!info.ok) {
  console.error(`Could not inspect Parallels VM "${vmName}".`);
  console.error(info.text);
  process.exit(1);
}

const state = extractValue(info.text, 'State');
const guestTools = extractValue(info.text, 'GuestTools');
const ipAddresses = extractValue(info.text, 'IP Addresses');

if (state !== 'running' || !/\bstate=installed\b/.test(guestTools)) {
  console.error(`VM backend smoke blocked for "${vmName}".`);
  console.error(`State: ${state}`);
  console.error(`Guest Tools: ${guestTools}`);
  console.error(`IP Addresses: ${ipAddresses || 'none'}`);
  process.exit(1);
}

let smoke;

if (profileName === 'linux') {
  const sshUser = process.env[profile.userEnv] ?? profile.defaultUser;
  const knownHosts = process.env[profile.knownHostsEnv] ?? profile.defaultKnownHosts;
  const ipAddress = ipAddresses.split(/[,\s]+/).find((candidate) => /^\d+\.\d+\.\d+\.\d+$/.test(candidate));

  if (!ipAddress) {
    console.error(`No IPv4 address reported for "${vmName}".`);
    process.exit(1);
  }

  const prerequisite = await run(
    'ssh',
    ['-o', `UserKnownHostsFile=${knownHosts}`, `${sshUser}@${ipAddress}`, profile.prerequisiteCommand(repoPath)],
    { timeout: 30_000, maxBuffer: 1024 * 1024 }
  );

  if (!prerequisite.ok) {
    console.error(`Backend system-audio smoke prerequisites are missing for "${vmName}".`);
    console.error(`Expected checkout: ${repoPath}`);
    console.error('Expected Cargo: /home/parallels/.cargo/bin/cargo');
    console.error(prerequisite.text);
    process.exit(1);
  }

  smoke = await run(
    'ssh',
    ['-o', `UserKnownHostsFile=${knownHosts}`, `${sshUser}@${ipAddress}`, profile.command(repoPath)],
    { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 }
  );
} else {
  const prerequisite = await run(
    'prlctl',
    ['exec', vmName, 'cmd.exe', '/c', profile.prerequisiteCommand(repoPath)],
    { timeout: 30_000, maxBuffer: 1024 * 1024 }
  );

  if (!prerequisite.ok) {
    console.error(`Backend system-audio smoke prerequisites are missing for "${vmName}".`);
    console.error(`Expected checkout: ${repoPath}`);
    console.error('Expected Cargo on PATH inside the Windows guest.');
    console.error(prerequisite.text);
    process.exit(1);
  }

  smoke = await run(
    'prlctl',
    ['exec', vmName, 'cmd.exe', '/c', profile.command(repoPath)],
    { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 }
  );
}

if (!smoke.ok) {
  console.error(`Backend system-audio smoke failed for "${vmName}".`);
  console.error(smoke.text);
  process.exit(1);
}

const summary = parseSmokeSummary(smoke.text);

if (!summary) {
  console.error(`Backend system-audio smoke did not emit a system_audio_smoke summary for "${vmName}".`);
  console.error(smoke.text);
  process.exit(1);
}

const passed = summary.capture_started === true && summary.audio_frames > 0 && summary.level_events > 0;

console.log(`VM: ${vmName}`);
console.log(`Profile: ${profileName}`);
console.log(`Repository: ${repoPath}`);
console.log(`Capture started: ${summary.capture_started ? 'yes' : 'no'}`);
console.log(`Audio frames: ${summary.audio_frames}`);
console.log(`Level events: ${summary.level_events}`);
console.log(`Detected non-zero audio: ${summary.detected ? 'yes' : 'no'}`);
console.log(`Max level: ${summary.max_level}`);

if (!passed) {
  console.error('Backend system-audio smoke did not meet the minimum capture gate.');
  process.exit(1);
}

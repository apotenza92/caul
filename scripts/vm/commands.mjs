import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function createPowerShellEncodedArgs(script) {
  return [
    'powershell.exe',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ];
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function macGuestShellArgs(script) {
  return ['--current-user', '/bin/zsh', '-lc', shellQuote(script)];
}

export function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export async function runCommand(command, args = [], options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      timeout: options.timeout ?? 30_000
    });

    return {
      command: [command, ...args].join(' '),
      ok: true,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
      text: `${result.stdout}${result.stderr}`.trim()
    };
  } catch (error) {
    return {
      command: [command, ...args].join(' '),
      ok: false,
      stderr: String(error.stderr ?? '').trim(),
      stdout: String(error.stdout ?? '').trim(),
      text: `${error.stdout ?? ''}${error.stderr ?? error.message}`.trim()
    };
  }
}

export function runPrlctl(args, options = {}) {
  return runCommand('prlctl', args, options);
}

export function runInteractive(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
      stdio: options.stdio ?? 'inherit'
    });

    child.on('close', (code) => {
      resolve({
        command: [command, ...args].join(' '),
        ok: code === 0,
        code
      });
    });
  });
}

export function getSshArgs(profile, command) {
  return [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    `UserKnownHostsFile=${profile.knownHosts}`,
    `${profile.user}@${profile.host}`,
    command
  ];
}

export function getScpArgs(profile, source, destination) {
  return [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    `UserKnownHostsFile=${profile.knownHosts}`,
    source,
    `${profile.user}@${profile.host}:${destination}`
  ];
}

export function parseMacAppVersion(appPath) {
  const plist = readFileSync(`${appPath}/Contents/Info.plist`, 'utf8');
  const match = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);

  if (!match) {
    throw new Error(`Could not find CFBundleShortVersionString in ${appPath}`);
  }

  return match[1];
}

export function parseDebPackageVersion(controlText) {
  const line = controlText.split(/\r?\n/).find((candidate) => candidate.startsWith('Version:'));

  if (!line) {
    throw new Error('Could not find Version field in Debian control text.');
  }

  return line.split(':').slice(1).join(':').trim();
}

export function parsePrefixedJson(text, prefix) {
  const line = String(text).split(/\r?\n/).find((candidate) => candidate.startsWith(`${prefix} `));

  if (!line) {
    return null;
  }

  return JSON.parse(line.slice(prefix.length + 1));
}

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export const MAX_SUPPORTED_GLIBC_VERSION = '2.39';

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function parseGlibcVersions(output) {
  return [...new Set(
    [...output.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/g)].map((match) => match[1])
  )].sort(compareVersions);
}

export function assertGlibcVersionsWithinContract(
  versions,
  maximum = MAX_SUPPORTED_GLIBC_VERSION
) {
  const unsupported = versions.filter((version) => compareVersions(version, maximum) > 0);
  if (unsupported.length > 0) {
    throw new Error(
      `Packaged Linux runtime requires GLIBC_${unsupported.join(', GLIBC_')}; `
      + `the reviewed ceiling is GLIBC_${maximum}.`
    );
  }
}

export function parseDesktopEntry(source) {
  const fields = new Map();
  let activeSection = '';
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      activeSection = line.slice(1, -1);
      continue;
    }
    if (activeSection !== 'Desktop Entry') continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return fields;
}

export function assertDesktopEntryContract(source, { channel, format }) {
  const packageName = channel === 'beta' ? 'caul-beta' : 'caul';
  const displayName = channel === 'beta' ? 'Caul Beta' : 'Caul';
  const fields = parseDesktopEntry(source);
  const required = {
    Name: displayName,
    Terminal: 'false',
    Type: 'Application',
    Icon: packageName
  };
  for (const [field, expected] of Object.entries(required)) {
    if (fields.get(field) !== expected) {
      throw new Error(
        `${format} desktop entry field ${field} must be ${JSON.stringify(expected)}, `
        + `received ${JSON.stringify(fields.get(field))}.`
      );
    }
  }
  if (!(fields.get('Categories') ?? '').split(';').includes('Utility')) {
    throw new Error(`${format} desktop entry must include the Utility category.`);
  }
  const executable = fields.get('Exec') ?? '';
  const acceptedExecutables = format === 'appimage'
    ? [packageName, 'AppRun']
    : [packageName];
  if (!acceptedExecutables.some((candidate) => executable.includes(candidate))) {
    throw new Error(
      `${format} desktop entry Exec does not reference ${acceptedExecutables.join(' or ')}: `
      + JSON.stringify(executable)
    );
  }
}

function walkEntries(root) {
  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    entries.push({ entry, path: entryPath });
    if (entry.isDirectory()) entries.push(...walkEntries(entryPath));
  }
  return entries;
}

function elfArchitecture(filePath) {
  const file = readFileSync(filePath);
  if (file.length < 20 || file.subarray(0, 4).toString('hex') !== '7f454c46') return null;
  const machine = file[5] === 1 ? file.readUInt16LE(18) : file.readUInt16BE(18);
  return machine === 183 ? 'arm64' : machine === 62 ? 'x64' : `elf-${machine}`;
}

function runInspection(command, args, filePath) {
  const result = spawnSync(command, [...args, filePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed for ${filePath}: ${result.error?.message ?? ''}\n`
      + `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    );
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function inspectLinuxRuntimeContract(root, { arch, channel, format }) {
  const packageName = channel === 'beta' ? 'caul-beta' : 'caul';
  const entries = walkEntries(root);
  const desktopEntries = entries.filter(({ entry }) => (
    entry.isFile() && entry.name === `${packageName}.desktop`
  ));
  if (desktopEntries.length !== 1) {
    throw new Error(
      `${format} package must contain exactly one ${packageName}.desktop, `
      + `found ${desktopEntries.length}.`
    );
  }
  assertDesktopEntryContract(readFileSync(desktopEntries[0].path, 'utf8'), { channel, format });

  const icons = entries.filter(({ entry }) => (
    (entry.isFile() || entry.isSymbolicLink()) && entry.name === `${packageName}.png`
  ));
  if (icons.length === 0) {
    throw new Error(`${format} package does not contain a ${packageName}.png desktop icon.`);
  }

  const elfFiles = [];
  for (const { entry, path: entryPath } of entries) {
    if (!entry.isFile() || basename(entryPath) === 'chrome-sandbox') continue;
    const actualArchitecture = elfArchitecture(entryPath);
    if (!actualArchitecture) continue;
    if (actualArchitecture !== arch) {
      throw new Error(
        `${format} package contains ${entryPath} for ${actualArchitecture}; expected ${arch}.`
      );
    }
    elfFiles.push(entryPath);
  }
  if (elfFiles.length === 0) {
    throw new Error(`${format} package contains no inspectable ELF runtime files.`);
  }

  const glibcVersions = new Set();
  let dynamicFileCount = 0;
  for (const elfFile of elfFiles) {
    const versionInfo = runInspection('readelf', ['--version-info', '--wide'], elfFile);
    for (const version of parseGlibcVersions(versionInfo)) glibcVersions.add(version);

    const dynamicInfo = runInspection('readelf', ['--dynamic', '--wide'], elfFile);
    if (!/\(NEEDED\)/.test(dynamicInfo)) continue;
    dynamicFileCount += 1;
    const dependencies = runInspection('ldd', [], elfFile);
    if (/=>\s+not found\b/.test(dependencies) || /\bnot found\b/.test(dependencies)) {
      throw new Error(`${format} package has an unresolved runtime dependency:\n${dependencies}`);
    }
  }
  if (dynamicFileCount === 0) {
    throw new Error(`${format} package contains no dynamically linked runtime files.`);
  }
  if (glibcVersions.size === 0) {
    throw new Error(`${format} package exposes no inspectable GLIBC version contract.`);
  }
  assertGlibcVersionsWithinContract([...glibcVersions]);

  return {
    desktopEntry: desktopEntries[0].path,
    dynamicFileCount,
    elfFileCount: elfFiles.length,
    glibcMaximum: [...glibcVersions].sort(compareVersions).at(-1),
    iconCount: icons.length
  };
}

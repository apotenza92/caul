import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const release = process.argv.includes('--release');
const packagePath = 'native/macos-audio-helper';
const moduleCachePath = path.resolve(`${packagePath}/.build/clang-module-cache`);
const helperPath = `${packagePath}/.build/${release ? 'release' : 'debug'}/CaulAudioHelper`;
const swiftArgs = ['build', '--package-path', packagePath];

if (release) {
  swiftArgs.splice(1, 0, '-c', 'release');
}

const swiftResult = runSwiftBuild();

if (swiftResult.status !== 0) {
  process.exit(swiftResult.status ?? 1);
}

if (!release) {
  const signResult = spawnSync('codesign', [
    '--force',
    '--sign',
    '-',
    '--entitlements',
    `${packagePath}/CaulAudioHelper.entitlements`,
    helperPath
  ], { stdio: 'inherit' });

  process.exit(signResult.status ?? 1);
}

process.exit(0);

function runSwiftBuild() {
  const candidates = resolveDeveloperDirCandidates();
  let lastResult = null;

  mkdirSync(moduleCachePath, { recursive: true });

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const env = {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: process.env.CLANG_MODULE_CACHE_PATH ?? moduleCachePath
    };

    if (candidate.developerDir) {
      env.DEVELOPER_DIR = candidate.developerDir;
      console.log(`[caul] Building macOS audio helper with ${candidate.label}`);
    } else {
      console.log('[caul] Building macOS audio helper with the selected Swift toolchain');
    }

    const result = spawnSync('swift', swiftArgs, {
      env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });

    if (result.status === 0) {
      writeBufferedOutput(result);
      return result;
    }

    lastResult = result;

    if (canFallbackFromSwiftFailure(result) && index < candidates.length - 1) {
      console.warn('[caul] Selected SwiftPM toolchain is missing BuildServerProtocol.framework; trying an installed Xcode toolchain.');
      continue;
    }

    writeBufferedOutput(result);

    if (!canFallbackFromSwiftFailure(result)) {
      return result;
    }
  }

  return lastResult ?? { status: 1 };
}

function resolveDeveloperDirCandidates() {
  const explicitDeveloperDir = process.env.CAUL_SWIFT_DEVELOPER_DIR ?? process.env.DEVELOPER_DIR;

  if (explicitDeveloperDir) {
    return [{ label: explicitDeveloperDir, developerDir: explicitDeveloperDir }];
  }

  const candidates = [{ label: 'selected Swift toolchain', developerDir: null }];

  for (const xcodePath of ['/Applications/Xcode.app', '/Applications/Xcode-beta.app']) {
    const developerDir = `${xcodePath}/Contents/Developer`;

    if (existsSync(developerDir)) {
      candidates.push({ label: xcodePath, developerDir });
    }
  }

  return candidates;
}

function canFallbackFromSwiftFailure(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return output.includes('BuildServerProtocol.framework')
    || output.includes('Library not loaded: @rpath/BuildServerProtocol.framework');
}

function writeBufferedOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    console.error(result.error.message);
  }
}

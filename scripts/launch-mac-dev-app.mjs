import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const appPath = join(process.cwd(), 'release-dev', 'mac-arm64', 'Susura Dev.app');
const appExecutablePath = join(appPath, 'Contents', 'MacOS', 'Susura Dev');
const bundleIds = ['dev.susura.app.dev'];
const captureServices = ['ScreenCapture', 'AudioCapture'];
const launchServicesRegister = '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister';
const userDataDir = join(homedir(), 'Library', 'Application Support', 'susura-dev');
const modelsDir = join(userDataDir, 'models');
const resetPermissions = process.argv.includes('--reset-permissions');
const resetAllCapturePermissions = process.argv.includes('--reset-all-capture-permissions');
const fresh = !process.argv.includes('--keep-data');
const resetModels = process.argv.includes('--reset-models');

function sqliteString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function clearScopedTccRows(tccDbPath, options = {}) {
  const clients = [...bundleIds, appExecutablePath].map(sqliteString).join(',');
  const query = `delete from access where client in (${clients}) and service in ('kTCCServiceMicrophone','kTCCServiceScreenCapture','kTCCServiceAudioCapture');`;

  const result = run('sqlite3', [
    tccDbPath,
    query
  ], { allowFailure: true });

  if (result.status === 0 || !options.allowAdminRetry) {
    return;
  }

  const command = [
    'sqlite3',
    shellQuote(tccDbPath),
    shellQuote(query),
    '&&',
    'killall',
    'tccd'
  ].join(' ');

  run('osascript', [
    '-e',
    `do shell script ${JSON.stringify(command)} with administrator privileges`
  ], { allowFailure: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });

  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result;
}

if (!existsSync(appPath)) {
  console.error(`Missing ${appPath}`);
  console.error('Run `npm run dist:mac:dev` first.');
  process.exit(1);
}

run('pkill', ['-x', 'Susura Dev'], { allowFailure: true });
run('pkill', ['-f', '/Susura Dev.app/Contents/'], { allowFailure: true });

if (fresh) {
  const temporaryModelsDir = join(homedir(), 'Library', 'Application Support', `susura-dev-models-${Date.now()}`);

  if (!resetModels && existsSync(modelsDir)) {
    renameSync(modelsDir, temporaryModelsDir);
    console.log(`Preserved ${modelsDir}`);
  }

  rmSync(userDataDir, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 150
  });
  console.log(`Removed ${userDataDir}`);

  if (!resetModels && existsSync(temporaryModelsDir)) {
    mkdirSync(userDataDir, { recursive: true });
    renameSync(temporaryModelsDir, modelsDir);
    console.log(`Restored ${modelsDir}`);
  }
}

if (resetPermissions || resetAllCapturePermissions) {
  run(launchServicesRegister, ['-f', appPath], { allowFailure: true });

  for (const bundleId of bundleIds) {
    for (const service of ['Microphone', 'ScreenCapture', 'AudioCapture']) {
      run('tccutil', ['reset', service, bundleId], { allowFailure: true });
    }
  }

  clearScopedTccRows(join(homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db'));
  clearScopedTccRows('/Library/Application Support/com.apple.TCC/TCC.db', { allowAdminRetry: true });
  run('killall', ['tccd'], { allowFailure: true });
}

if (resetAllCapturePermissions) {
  for (const service of captureServices) {
    run('tccutil', ['reset', service], { allowFailure: true });
  }
}

run('open', ['-n', appPath]);

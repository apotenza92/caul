import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const privateBuild = process.argv.includes('--private');
const appName = privateBuild ? 'Caul Dev-Private' : 'Caul Dev';
const appPath = join(process.cwd(), privateBuild ? 'release-dev-private' : 'release-dev', 'mac-arm64', `${appName}.app`);
const appExecutablePath = join(appPath, 'Contents', 'MacOS', appName);
const bundleIds = [privateBuild ? 'dev.caul.app.dev-private' : 'dev.caul.app.dev'];
const captureServices = ['ScreenCapture', 'AudioCapture'];
const launchServicesRegister = '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister';
const userDataDir = join(homedir(), 'Library', 'Application Support', 'caul-dev');
const setupStatePath = join(userDataDir, 'setup-state.json');
const preservedDataDirs = [
  'models',
  'local-llm'
];
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

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getSystemAudioPermissionStateToPreserve() {
  if (resetPermissions || resetAllCapturePermissions) {
    return null;
  }

  const existingState = readJsonFile(setupStatePath);

  if (existingState?.systemAudioPermissionGranted === true) {
    return {
      systemAudioPermissionDenied: false,
      systemAudioPermissionGranted: true,
      systemAudioPermissionRequested: true
    };
  }

  if (hasGrantedSystemAudioTccRow()) {
    return {
      systemAudioPermissionDenied: false,
      systemAudioPermissionGranted: true,
      systemAudioPermissionRequested: true
    };
  }

  return null;
}

function hasGrantedSystemAudioTccRow() {
  const tccDbPath = join(homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db');

  if (!existsSync(tccDbPath)) {
    return false;
  }

  const clients = bundleIds.map(sqliteString).join(',');
  const query = `select auth_value from access where service = 'kTCCServiceAudioCapture' and client in (${clients}) order by last_modified desc limit 1;`;
  const result = spawnSync('sqlite3', [tccDbPath, query], {
    encoding: 'utf8'
  });

  return result.status === 0 && result.stdout.trim() === '2';
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
  console.error(`Run \`npm run ${privateBuild ? 'dist:mac:dev:private' : 'dist:mac:dev'}\` first.`);
  process.exit(1);
}

for (const processName of ['Caul Dev', 'Caul Dev-Private']) {
  run('pkill', ['-x', processName], { allowFailure: true });
}
for (const appBundleName of ['Caul Dev.app', 'Caul Dev-Private.app']) {
  run('pkill', ['-f', `/${appBundleName}/Contents/`], { allowFailure: true });
}

if (fresh) {
  const temporaryDataRoot = join(homedir(), 'Library', 'Application Support', `caul-dev-preserved-${Date.now()}`);
  const preservedPermissionState = getSystemAudioPermissionStateToPreserve();

  if (!resetModels) {
    for (const dataDir of preservedDataDirs) {
      const sourceDir = join(userDataDir, dataDir);
      const destinationDir = join(temporaryDataRoot, dataDir);

      if (existsSync(sourceDir)) {
        mkdirSync(temporaryDataRoot, { recursive: true });
        renameSync(sourceDir, destinationDir);
        console.log(`Preserved ${sourceDir}`);
      }
    }
  }

  rmSync(userDataDir, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 150
  });
  console.log(`Removed ${userDataDir}`);

  if (!resetModels && existsSync(temporaryDataRoot)) {
    mkdirSync(userDataDir, { recursive: true });

    for (const dataDir of preservedDataDirs) {
      const sourceDir = join(temporaryDataRoot, dataDir);
      const destinationDir = join(userDataDir, dataDir);

      if (existsSync(sourceDir)) {
        renameSync(sourceDir, destinationDir);
        console.log(`Restored ${destinationDir}`);
      }
    }

    rmSync(temporaryDataRoot, {
      force: true,
      recursive: true
    });
  }

  if (preservedPermissionState) {
    mkdirSync(userDataDir, { recursive: true });
    const nextSetupState = {
      ...readJsonFile(setupStatePath),
      ...preservedPermissionState
    };
    writeFileSync(setupStatePath, `${JSON.stringify(nextSetupState, null, 2)}\n`);
    console.log(`Restored System Audio permission state in ${setupStatePath}`);
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

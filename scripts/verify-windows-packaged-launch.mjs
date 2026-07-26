import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { validatePackagedLaunchProcessResult } from './native-package-smoke-output.mjs';
import { createReleaseLaunchEnvironment } from './release-launch-env.mjs';

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith('--') || !value) {
    throw new Error(`Expected a value for ${name ?? 'the final option'}`);
  }
  options.set(name, value);
}

if (process.platform !== 'win32') {
  throw new Error(`Windows packaged launch verification requires win32, received ${process.platform}`);
}

if (!options.get('--executable')) {
  throw new Error('Windows packaged launch verification requires --executable');
}
if (!options.get('--user-data')) {
  throw new Error('Windows packaged launch verification requires --user-data');
}

const executable = resolve(options.get('--executable'));
const userData = resolve(options.get('--user-data'));
if (!existsSync(executable)) {
  throw new Error(`Packaged Windows executable is missing: ${executable}`);
}

mkdirSync(userData, { recursive: true });
const smokeOutputPath = resolve(userData, 'release-launch-smoke.log');
rmSync(smokeOutputPath, { force: true });

const result = spawnSync(executable, [], {
  encoding: 'utf8',
  env: createReleaseLaunchEnvironment({
    CAUL_DISABLE_MODEL_AUTO_DOWNLOAD: '1',
    CAUL_DISABLE_UPDATE_CHECKS: '1',
    CAUL_PACKAGED_LAUNCH_SMOKE_MS: '250',
    CAUL_SMOKE_OUTPUT_FILE: smokeOutputPath,
    CAUL_USER_DATA_DIR: userData
  }),
  maxBuffer: 10 * 1024 * 1024,
  timeout: 30_000,
  windowsHide: true
});

const smokeFileOutput = existsSync(smokeOutputPath)
  ? readFileSync(smokeOutputPath, 'utf8')
  : '';
const combinedResult = {
  ...result,
  stdout: [result.stdout, smokeFileOutput].filter(Boolean).join('\n')
};

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
validatePackagedLaunchProcessResult('windows', combinedResult);
console.log(`Verified packaged Windows launch: ${executable}`);

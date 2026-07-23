const { spawnSync } = require('node:child_process');
const { chmodSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()}`);
  }
  return result;
}

function parseJson(result, label) {
  for (const value of [result.stdout, result.stderr]) {
    if (!value?.trim()) {
      continue;
    }
    try {
      return JSON.parse(value);
    } catch {
      // notarytool can write non-JSON diagnostics to either stream.
    }
  }
  throw new Error(`${label} did not return valid JSON`);
}

module.exports = async function notarizeMacApplication(context) {
  if (process.env.FORCE_DEV_BUILD === 'true'
    || process.env.CAUL_REQUIRE_RELEASE_SIGNING !== 'true') {
    return;
  }

  const { resolveMacReleaseContract, validateNotarisationRecord } = await import('./macos-release-contract.mjs');
  const channel = process.env.CAUL_RELEASE_CHANNEL;
  const contract = resolveMacReleaseContract(channel);
  const requiredEnvironment = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  for (const name of requiredEnvironment) {
    if (!process.env[name]?.trim()) {
      throw new Error(`Required notarisation environment variable is missing: ${name}`);
    }
  }

  const appPath = join(context.appOutDir, contract.appName);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'caul-notary-'));
  chmodSync(temporaryDirectory, 0o700);
  const submissionPath = join(temporaryDirectory, `${contract.productName}.zip`);
  const authorisation = [
    '--key', process.env.APPLE_API_KEY,
    '--key-id', process.env.APPLE_API_KEY_ID,
    '--issuer', process.env.APPLE_API_ISSUER
  ];

  try {
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', contract.appName, submissionPath], {
      cwd: context.appOutDir
    });
    const submissionResult = run('xcrun', [
      'notarytool', 'submit', submissionPath,
      ...authorisation,
      '--wait',
      '--output-format', 'json'
    ], { allowFailure: true });
    const submission = parseJson(submissionResult, 'Notarisation submission');
    if (typeof submission.id !== 'string') {
      throw new Error(`Notarisation submission did not return an ID: ${JSON.stringify(submission)}`);
    }

    const logResult = run('xcrun', [
      'notarytool', 'log', submission.id,
      ...authorisation,
      '--output-format', 'json'
    ], { allowFailure: true });
    const log = parseJson(logResult, `Notarisation log ${submission.id}`);
    const record = validateNotarisationRecord({ submission, log });
    if (submissionResult.status !== 0 || logResult.status !== 0) {
      throw new Error(`Notarisation command failed for submission ${submission.id}`);
    }

    const logPath = join(context.outDir, `notarization-${channel}-macos-arm64.json`);
    writeFileSync(logPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
    run('xcrun', ['stapler', 'staple', appPath]);
    run('xcrun', ['stapler', 'validate', appPath]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

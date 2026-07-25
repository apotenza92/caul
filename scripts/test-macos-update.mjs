import { _electron as electron } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import YAML from 'js-yaml';
import {
  CAUL_MAC_MINIMUM_KERNEL_VERSION,
  CAUL_TEAM_ID,
  normaliseFingerprint,
  parseCodesignMetadata,
  resolvePriorSigningFingerprints,
  validateSignatureMetadata
} from './macos-release-contract.mjs';
import { createReleaseLaunchEnvironment } from './release-launch-env.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function plist(appPath, key) {
  return run('plutil', ['-extract', key, 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')]).trim();
}

let certificateSequence = 0;

function verifyTrustedApp(appPath, bundleId, allowedFingerprints, expectations) {
  if (!existsSync(appPath) || plist(appPath, 'CFBundleIdentifier') !== bundleId) {
    throw new Error(`Package identity does not match ${bundleId}`);
  }
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
  const metadata = parseCodesignMetadata(run('codesign', ['-d', '--verbose=4', appPath]));
  validateSignatureMetadata(metadata, expectations, appPath);
  if (metadata.identifier !== bundleId) throw new Error(`${appPath} signature identifier does not match ${bundleId}`);
  run('xcrun', ['stapler', 'validate', appPath]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  const certificateDirectory = join(appPath, '..', '.certificates', `leaf-${certificateSequence += 1}-`);
  mkdirSync(join(appPath, '..', '.certificates'), { recursive: true, mode: 0o700 });
  run('codesign', ['-d', `--extract-certificates=${certificateDirectory}`, appPath]);
  const actual = createHash('sha256').update(readFileSync(`${certificateDirectory}0`)).digest('hex').toUpperCase();
  if (!allowedFingerprints.includes(actual)) {
    throw new Error(`Package signer ${actual} is not one of the explicitly trusted fingerprints`);
  }
}

function corrupt(buffer) {
  const copy = Buffer.from(buffer);
  copy[Math.floor(copy.length / 2)] ^= 0xff;
  return copy;
}

function executableProcessIds(executablePath) {
  const prefix = `${executablePath} `;
  return run('ps', ['-axo', 'pid=,command=']).split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    return match && (match[2] === executablePath || match[2].startsWith(prefix))
      ? [Number(match[1])]
      : [];
  });
}

async function waitForRelaunch(executablePath, excludedPid, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pid = executableProcessIds(executablePath).find((candidate) => candidate !== excludedPid);
    if (pid != null) return pid;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Updater did not automatically relaunch ${executablePath}`);
}

async function stopRelaunch(pid) {
  process.kill(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Automatically relaunched process ${pid} did not exit`);
}

async function waitForStatus(page, predicate, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await page.evaluate(() => window.caul.settings.updates.status());
    if (predicate(status)) return status;
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for updater status');
}

const priorZip = resolve(option('--prior-zip'));
const candidateZip = resolve(option('--candidate-zip'));
const trustedCandidateZip = resolve(option('--trusted-candidate-zip'));
const channel = option('--channel');
const scenario = option('--scenario');
const candidateTag = option('--candidate-tag');
const expectedVersion = option('--expected-version');
if (!['stable', 'beta'].includes(channel) || !['valid', 'corrupt', 'signature'].includes(scenario)) {
  throw new Error('Updater channel or scenario is invalid');
}
const stableCandidate = /^v\d+\.\d+\.\d+$/.test(candidateTag);
const betaCandidate = /^v\d+\.\d+\.\d+-beta\.[1-9]\d*$/.test(candidateTag);
if ((!stableCandidate && !betaCandidate) || candidateTag.slice(1) !== expectedVersion) {
  throw new Error(`Candidate tag ${candidateTag} does not match supported version ${expectedVersion}`);
}
const product = channel === 'beta' ? 'Caul Beta' : 'Caul';
const bundleId = channel === 'beta' ? 'dev.caul.app.beta' : 'dev.caul.app';
const currentFingerprint = normaliseFingerprint(process.env.APPLE_SIGNING_CERTIFICATE_SHA256);
const priorFingerprints = resolvePriorSigningFingerprints(
  currentFingerprint,
  process.env.APPLE_PRIOR_SIGNING_CERTIFICATE_SHA256
);
const signatureExpectations = {
  identity: process.env.APPLE_SIGNING_IDENTITY,
  teamId: process.env.APPLE_TEAM_ID
};
if (signatureExpectations.teamId !== CAUL_TEAM_ID
  || !signatureExpectations.identity?.startsWith('Developer ID Application: ')
  || !signatureExpectations.identity.endsWith(`(${CAUL_TEAM_ID})`)) {
  throw new Error('Strict Caul Developer ID expectations are required');
}
const workspace = mkdtempSync(join(tmpdir(), 'caul-update-'));
let appProcess;
let server;
try {
  const installed = join(workspace, 'installed');
  const candidate = join(workspace, 'candidate');
  const trustedCandidate = join(workspace, 'trusted-candidate');
  const userData = join(workspace, 'user-data');
  const home = join(workspace, 'home');
  for (const directory of [installed, candidate, trustedCandidate, userData, home]) mkdirSync(directory);
  run('ditto', ['-x', '-k', priorZip, installed]);
  run('ditto', ['-x', '-k', candidateZip, candidate]);
  run('ditto', ['-x', '-k', trustedCandidateZip, trustedCandidate]);
  const installedApp = join(installed, `${product}.app`);
  const candidateApp = join(candidate, `${product}.app`);
  const trustedCandidateApp = join(trustedCandidate, `${product}.app`);
  verifyTrustedApp(installedApp, bundleId, priorFingerprints, signatureExpectations);
  verifyTrustedApp(trustedCandidateApp, bundleId, [currentFingerprint], signatureExpectations);
  if (plist(trustedCandidateApp, 'CFBundleShortVersionString') !== expectedVersion) throw new Error('Trusted candidate version is wrong');
  if (plist(candidateApp, 'CFBundleIdentifier') !== bundleId || plist(candidateApp, 'CFBundleShortVersionString') !== expectedVersion) throw new Error('Scenario candidate package identity or version is wrong');
  const priorVersion = plist(installedApp, 'CFBundleShortVersionString');
  if (priorVersion === expectedVersion) throw new Error('N-1 package has the candidate version');
  const candidateBytes = readFileSync(candidateZip);
  const servedBytes = scenario === 'corrupt' ? corrupt(candidateBytes) : candidateBytes;
  const artifactName = basename(candidateZip);
  const metadata = YAML.dump({
    version: expectedVersion,
    files: [{ url: artifactName, sha512: createHash('sha512').update(candidateBytes).digest('base64'), size: candidateBytes.length }],
    minimumSystemVersion: CAUL_MAC_MINIMUM_KERNEL_VERSION,
    path: artifactName,
    sha512: createHash('sha512').update(candidateBytes).digest('base64'),
    releaseDate: new Date(0).toISOString()
  });
  const expectedMetadataPath = channel === 'beta' ? '/beta-mac.yml' : '/latest-mac.yml';
  const metadataRequests = [];
  server = createServer((request, response) => {
    const requestPath = new URL(request.url, 'http://127.0.0.1').pathname;
    if (requestPath === '/releases.json') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{
        draft: false,
        prerelease: betaCandidate,
        tag_name: candidateTag,
        name: candidateTag,
        html_url: 'http://127.0.0.1/',
        assets: [{ name: artifactName, size: candidateBytes.length, browser_download_url: `http://127.0.0.1:${server.address().port}/${artifactName}` }]
      }]));
    } else if (requestPath === expectedMetadataPath) {
      metadataRequests.push(requestPath);
      response.setHeader('content-type', 'text/yaml');
      response.end(metadata);
    } else if (['/latest-mac.yml', '/beta-mac.yml', '/latest.yml', '/beta.yml'].includes(requestPath)) {
      metadataRequests.push(requestPath);
      response.statusCode = 404;
      response.end('wrong updater channel');
    } else if (requestPath === `/${artifactName}`) {
      response.setHeader('content-type', 'application/zip');
      response.end(servedBytes);
    } else {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  await new Promise((resolveListen, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolveListen()));
  const address = server.address();
  const feedUrl = `http://127.0.0.1:${address.port}/`;
  const executable = join(installedApp, 'Contents', 'MacOS', plist(installedApp, 'CFBundleExecutable'));
  appProcess = await electron.launch({
    executablePath: executable,
    env: createReleaseLaunchEnvironment({
      HOME: home,
      CAUL_FORCE_UPDATE_CHECKS: '1',
      CAUL_UPDATE_FEED_URL: feedUrl,
      CAUL_UPDATE_TEST_MODE: '1',
      CAUL_USER_DATA_DIR: userData
    })
  });
  const page = await appProcess.firstWindow({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.caul?.settings?.updates));
  const checked = await page.evaluate(() => window.caul.settings.updates.checkNow());
  if (checked.lastResult?.status !== 'available') throw new Error(`Candidate was not available: ${JSON.stringify(checked)}`);
  await page.evaluate(() => window.caul.settings.updates.downloadAndInstall());
  const downloaded = await waitForStatus(page, (status) => ['ready', 'error'].includes(status.lastResult?.status));
  if (!metadataRequests.includes(expectedMetadataPath)
    || metadataRequests.some((requestPath) => requestPath !== expectedMetadataPath)) {
    throw new Error(`Updater requested the wrong channel metadata: ${metadataRequests.join(', ') || 'none'}`);
  }
  if (scenario === 'corrupt') {
    if (downloaded.lastResult?.status !== 'error' || !/sha|checksum|integrity/i.test(downloaded.lastResult?.message ?? '')) {
      throw new Error(`Corrupt package was not rejected: ${JSON.stringify(downloaded)}`);
    }
  } else {
    if (downloaded.lastResult?.status !== 'ready') throw new Error(`Candidate did not download: ${JSON.stringify(downloaded)}`);
    const originalPid = appProcess.process().pid;
    const automaticRelaunch = scenario === 'valid'
      ? waitForRelaunch(executable, originalPid)
      : null;
    await page.evaluate(() => window.caul.settings.updates.installDownloaded()).catch(() => undefined);
    if (scenario === 'signature') {
      const rejected = await waitForStatus(page, (status) => status.lastResult?.status === 'error');
      if (!/sign|signature|code/i.test(rejected.lastResult?.message ?? '')) throw new Error(`Wrong signer was not rejected: ${JSON.stringify(rejected)}`);
    } else {
      await new Promise((resolveExit, reject) => {
        const timer = setTimeout(() => reject(new Error('Updater did not exit to install')), 180_000);
        appProcess.process().once('exit', () => { clearTimeout(timer); resolveExit(); });
      });
      appProcess = null;
      const relaunchedPid = await automaticRelaunch;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline && plist(installedApp, 'CFBundleShortVersionString') !== expectedVersion) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
      }
      if (plist(installedApp, 'CFBundleShortVersionString') !== expectedVersion) throw new Error('Valid update did not replace the prior app');
      verifyTrustedApp(installedApp, bundleId, [currentFingerprint], signatureExpectations);
      await stopRelaunch(relaunchedPid);
      appProcess = await electron.launch({
        executablePath: executable,
        env: createReleaseLaunchEnvironment({
          HOME: home,
          CAUL_DISABLE_UPDATE_CHECKS: '1',
          CAUL_USER_DATA_DIR: userData
        })
      });
      const updatedPage = await appProcess.firstWindow({ timeout: 60_000 });
      await updatedPage.waitForFunction(() => Boolean(window.caul?.settings?.updates));
    }
  }
  console.log(`macOS ${channel} updater ${scenario} scenario passed from ${priorVersion} to ${expectedVersion}.`);
} finally {
  await appProcess?.close().catch(() => undefined);
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(workspace, { recursive: true, force: true });
}

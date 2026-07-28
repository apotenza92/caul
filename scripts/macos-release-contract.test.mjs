import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAUL_MAC_MINIMUM_KERNEL_VERSION,
  CAUL_MAC_MINIMUM_SYSTEM_VERSION,
  normaliseFingerprint,
  parseCodesignMetadata,
  resolvePriorSigningFingerprints,
  resolveMacReleaseContract,
  validateNotarisationRecord,
  validateSignatureMetadata
} from './macos-release-contract.mjs';
import {
  validateMachOArchitectures,
  validateUpdateMetadata
} from './verify-macos-package.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

function loadWorkflow(name) {
  return yaml.load(
    readFileSync(path.join(repositoryRoot, '.github', 'workflows', name), 'utf8'),
    { schema: yaml.JSON_SCHEMA }
  );
}

function collectWorkflowSteps(workflow) {
  return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

function loadBuilderConfig(environment) {
  const configPath = path.join(repositoryRoot, 'electron-builder.config.cjs');
  const names = ['CAUL_REQUIRE_RELEASE_SIGNING', 'CSC_NAME', 'FORCE_BETA_BUILD'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) {
      if (environment[name] == null) {
        delete process.env[name];
      } else {
        process.env[name] = environment[name];
      }
    }
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } finally {
    delete require.cache[require.resolve(configPath)];
    for (const [name, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe('macOS release contract', () => {
  it('accepts native and universal arm64 code while rejecting foreign-only slices', () => {
    expect(() => validateMachOArchitectures(['arm64'], 'native helper')).not.toThrow();
    expect(() => validateMachOArchitectures(['x86_64', 'arm64'], 'universal helper')).not.toThrow();
    expect(() => validateMachOArchitectures(['x86_64'], 'foreign helper'))
      .toThrow(/must include arm64/);
    expect(() => validateMachOArchitectures(['arm64', 'ppc64'], 'unsupported helper'))
      .toThrow(/supported Darwin slices/);
  });

  it('keeps stable and beta identities separate while remaining Apple Silicon only', () => {
    expect(resolveMacReleaseContract('stable')).toMatchObject({
      appName: 'Caul.app',
      artifactName: 'Caul-macos-arm64.zip',
      bundleId: 'dev.caul.app',
      iconFileName: 'icon.icns',
      metadataName: 'latest-mac.yml',
      packageName: 'caul',
      updaterChannel: 'latest'
    });
    expect(resolveMacReleaseContract('beta')).toMatchObject({
      appName: 'Caul Beta.app',
      artifactName: 'Caul-Beta-macos-arm64.zip',
      bundleId: 'dev.caul.app.beta',
      sourceIconPath: 'assets/icons/beta/icon.icns',
      metadataName: 'beta-mac.yml',
      packageName: 'caul-beta',
      updaterChannel: 'beta'
    });
    expect(() => resolveMacReleaseContract('preview')).toThrow(/stable or beta/);
    expect(CAUL_MAC_MINIMUM_KERNEL_VERSION).toBe('23.0.0');
    expect(CAUL_MAC_MINIMUM_SYSTEM_VERSION).toBe('14.0');
  });

  it('requires legacy updater digest fields to match the reviewed package', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'caul-updater-metadata-'));
    try {
      const artifact = path.join(root, 'Caul-macos-arm64.zip');
      const metadata = path.join(root, 'latest-mac.yml');
      writeFileSync(artifact, 'candidate');
      const sha512 = createHash('sha512').update('candidate').digest('base64');
      const version = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).version;
      writeFileSync(metadata, yaml.dump({
        version,
        files: [{ url: path.basename(artifact), sha512, size: 9 }],
        minimumSystemVersion: CAUL_MAC_MINIMUM_KERNEL_VERSION,
        path: path.basename(artifact),
        sha512
      }));
      expect(() => validateUpdateMetadata(metadata, artifact)).not.toThrow();
      writeFileSync(metadata, yaml.dump({
        version,
        files: [{ url: path.basename(artifact), sha512, size: 9 }],
        minimumSystemVersion: CAUL_MAC_MINIMUM_KERNEL_VERSION,
        path: path.basename(artifact),
        sha512: 'wrong'
      }));
      expect(() => validateUpdateMetadata(metadata, artifact)).toThrow(/legacy path and SHA-512/);
      writeFileSync(metadata, yaml.dump({
        version,
        files: [{ url: path.basename(artifact), sha512, size: 9 }],
        path: path.basename(artifact),
        sha512
      }));
      expect(() => validateUpdateMetadata(metadata, artifact)).toThrow(/minimumSystemVersion/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lets Electron Updater reject metadata requiring a newer macOS kernel', () => {
    const { AppUpdater } = require('electron-updater/out/AppUpdater');
    const updater = { _logger: { info() {}, warn() {} } };
    expect(AppUpdater.prototype.checkIfUpdateSupported.call(updater, {
      minimumSystemVersion: '999.0.0'
    })).toBe(false);
  });

  it('normalises only complete SHA-256 certificate fingerprints', () => {
    const fingerprint = 'ab'.repeat(32);
    expect(normaliseFingerprint(fingerprint.match(/.{2}/g).join(':'))).toBe(fingerprint.toUpperCase());
    expect(() => normaliseFingerprint('abcd')).toThrow(/SHA-256/);
  });

  it('limits N-1 signer trust to the current and explicitly reviewed prior certificate', () => {
    const current = 'ab'.repeat(32);
    const prior = 'cd'.repeat(32);
    expect(resolvePriorSigningFingerprints(current, prior)).toEqual([
      current.toUpperCase(),
      prior.toUpperCase()
    ]);
    expect(resolvePriorSigningFingerprints(current, current)).toEqual([current.toUpperCase()]);
    expect(() => resolvePriorSigningFingerprints(current, 'invalid')).toThrow(/SHA-256/);
  });

  it('requires the exact Developer ID authority, team, hardened runtime and timestamp', () => {
    const metadata = parseCodesignMetadata([
      'Executable=/tmp/Caul',
      'Identifier=dev.caul.app',
      'CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1+1 location=embedded',
      'Authority=Developer ID Application: Example (TEAM123456)',
      'Authority=Developer ID Certification Authority',
      'TeamIdentifier=TEAM123456',
      'Timestamp=22 Jul 2026 at 10:00:00'
    ].join('\n'));
    expect(() => validateSignatureMetadata(metadata, {
      identity: 'Developer ID Application: Example (TEAM123456)',
      teamId: 'TEAM123456'
    }, 'Caul.app')).not.toThrow();
    expect(() => validateSignatureMetadata(metadata, {
      identity: 'Developer ID Application: Someone Else (TEAM123456)',
      teamId: 'TEAM123456'
    }, 'Caul.app')).toThrow(/signer/);
  });

  it('rejects unaccepted, mismatched, and error-bearing notarisation logs', () => {
    expect(validateNotarisationRecord({
      submission: { id: 'submission-id', status: 'Accepted' },
      log: { jobId: 'submission-id', status: 'Accepted', issues: [] }
    })).toBeTruthy();
    expect(() => validateNotarisationRecord({
      submission: { id: 'submission-id', status: 'Accepted' },
      log: { jobId: 'other-id', status: 'Accepted', issues: [] }
    })).toThrow(/job ID/);
    expect(() => validateNotarisationRecord({
      submission: { id: 'submission-id', status: 'Accepted' },
      log: { jobId: 'submission-id', status: 'Accepted', issues: [{ severity: 'error' }] }
    })).toThrow(/error issues/);
  });

  it('requires the maintained signing hook and exact non-ambient release identity', () => {
    const defaultChannel = loadBuilderConfig({
      CAUL_REQUIRE_RELEASE_SIGNING: 'true',
      CSC_NAME: 'Alexander Potenza (27JL2VERNC)'
    });
    const sourceVersion = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
    ).version;
    const sourceIsBeta = sourceVersion.includes('-beta.');
    expect(defaultChannel.afterSign).toBe('./scripts/notarize-macos.cjs');
    expect(defaultChannel.forceCodeSigning).toBe(true);
    expect(defaultChannel.mac).toMatchObject({
      identity: 'Alexander Potenza (27JL2VERNC)',
      minimumSystemVersion: '14.0',
      notarize: false,
      target: [{ target: 'zip', arch: ['arm64'] }]
    });
    expect(defaultChannel.appId).toBe(sourceIsBeta ? 'dev.caul.app.beta' : 'dev.caul.app');

    const beta = loadBuilderConfig({
      CAUL_REQUIRE_RELEASE_SIGNING: 'true',
      CSC_NAME: 'Alexander Potenza (27JL2VERNC)',
      FORCE_BETA_BUILD: 'true'
    });
    expect(beta.appId).toBe('dev.caul.app.beta');
    expect(beta.productName).toBe('Caul Beta');
    expect(beta.extraMetadata.name).toBe('caul-beta');
    expect(beta.publish).toEqual([expect.objectContaining({ provider: 'github', channel: 'beta' })]);

    const notarisationHook = readFileSync(path.join(repositoryRoot, 'scripts', 'notarize-macos.cjs'), 'utf8');
    expect(notarisationHook).toContain("process.env.CAUL_REQUIRE_RELEASE_SIGNING !== 'true'");
  });

  it('keeps privileged credentials in protected, narrowly permissioned release jobs', () => {
    const workflow = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(workflow).toContain('environment: release-signing');
    expect(workflow).toContain('APPLE_SIGNING_CERTIFICATE_P12_BASE64');
    expect(workflow).toContain('APPLE_NOTARYTOOL_KEY_P8_BASE64');
    expect(workflow).toContain('APPLE_NOTARYTOOL_KEY_ID: ${{ vars.APPLE_NOTARYTOOL_KEY_ID }}');
    expect(workflow).toContain('APPLE_NOTARYTOOL_ISSUER_ID: ${{ vars.APPLE_NOTARYTOOL_ISSUER_ID }}');
    expect(workflow).not.toContain('secrets.APPLE_NOTARYTOOL_KEY_ID');
    expect(workflow).not.toContain('secrets.APPLE_NOTARYTOOL_ISSUER_ID');
    expect(workflow).toContain('release_environment=stable-release');
    expect(workflow).toContain('release_environment=beta-release');
    expect(workflow).not.toMatch(/APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|CSC_LINK|CSC_KEY_PASSWORD/);
    expect(workflow).toMatch(/permissions:\n  contents: read/);
    expect(workflow).toMatch(/publish-release:[\s\S]*?permissions:\n      attestations: write\n      contents: write\n      id-token: write/);
  });

  it('pins external actions and limits checkout credential persistence to the Homebrew publisher', () => {
    for (const name of ['ci.yml', 'release.yml']) {
      const workflow = loadWorkflow(name);
      const steps = collectWorkflowSteps(workflow);
      const externalActions = steps
        .map((step) => step.uses)
        .filter((uses) => uses && !uses.startsWith('./'));

      expect(externalActions.length).toBeGreaterThan(0);
      for (const uses of externalActions) {
        expect(uses, `${name}: ${uses}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      }

      const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
      expect(checkouts.length).toBeGreaterThan(0);
      for (const checkout of checkouts) {
        const homebrewPublisher = checkout.with?.repository === 'apotenza92/homebrew-tap';
        expect(checkout.with?.['persist-credentials']).toBe(homebrewPublisher);
        if (homebrewPublisher) {
          expect(checkout.with?.['ssh-key']).toBe('${{ secrets.HOMEBREW_TAP_DEPLOY_KEY }}');
        }
        expect(checkout.with?.ref).toBeTruthy();
      }
    }
  });

  it('keeps verification manual or release-called and publication deliberate', () => {
    const ci = loadWorkflow('ci.yml');
    expect(Object.keys(ci.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);

    const pages = loadWorkflow('pages.yml');
    expect(Object.keys(pages.on)).toEqual(['workflow_dispatch']);

    const release = loadWorkflow('release.yml');
    expect(Object.keys(release.on)).toEqual(['push']);
    expect(release.on.push).toEqual({ tags: ['v*'] });
  });

  it('prepares a checksum-sealed public site bundle without deploy credentials', () => {
    const pages = loadWorkflow('pages.yml');
    const preparation = JSON.stringify(pages.jobs.prepare);
    expect(preparation).toContain('caul-pages-publication-');
    expect(preparation).toContain('SHA256SUMS');
    expect(preparation).toContain('Apply these exact reviewed bytes manually');
    expect(preparation).not.toContain('PAGES_DEPLOY_KEY');
    expect(preparation).not.toContain('git commit');
    expect(preparation).not.toContain('git push');
  });

  it('keeps the download page manual while publishing validated Homebrew casks automatically', () => {
    for (const name of ['ci.yml', 'pages.yml']) {
      const source = readFileSync(path.join(repositoryRoot, '.github', 'workflows', name), 'utf8');
      expect(source).not.toMatch(/\bgit (?:commit|push)\b/);
      expect(source).not.toContain('PAGES_DEPLOY_KEY');
    }
    const releasePath = path.join(repositoryRoot, '.github', 'workflows', 'release.yml');
    const release = readFileSync(releasePath, 'utf8');
    const workflow = loadWorkflow('release.yml');
    expect(release).toContain('prepare-homebrew-publication:');
    expect(release).toContain('prepare-homebrew-beta-publication:');
    expect(release).not.toContain('HOMEBREW_TAP_TOKEN');
    expect(release).not.toContain('PAGES_DEPLOY_KEY');
    for (const [jobName, preparationJob, channel] of [
      ['publish-homebrew-stable', 'prepare-homebrew-publication', 'stable'],
      ['publish-homebrew-beta', 'prepare-homebrew-beta-publication', 'beta']
    ]) {
      const job = workflow.jobs[jobName];
      expect(job.needs).toEqual([
        'prepare',
        preparationJob,
        'verify-public-windows',
        'verify-public-linux'
      ]);
      expect(job.if).toBe(`needs.prepare.outputs.channel == '${channel}'`);
      expect(job.permissions).toEqual({ contents: 'read' });
      const checkout = job.steps.find((step) => step.name === 'Checkout Homebrew tap');
      expect(checkout.with).toMatchObject({
        repository: 'apotenza92/homebrew-tap',
        ref: 'main',
        path: 'homebrew-tap',
        'ssh-key': '${{ secrets.HOMEBREW_TAP_DEPLOY_KEY }}'
      });
      const publication = job.steps.at(-1).run;
      expect(publication).toContain('sha256sum --check SHA256SUMS');
      expect(publication).toContain(
        String.raw`sed -n 's/^[[:space:]]*version "\([^"]*\)".*/\1/p'`
      );
      expect(publication).not.toContain(String.raw`version \"\\(`);
      expect(publication).toContain('git diff --cached --check');
      expect(publication).toContain('git push origin HEAD:main');
      expect(publication).not.toContain('--force');
      expect(publication).not.toContain('git add -A');
    }
  });

  it('serialises releases by selected tag and validates that exact ref', () => {
    const ci = loadWorkflow('ci.yml');
    expect(ci.concurrency).toEqual({
      group: 'ci-${{ github.workflow }}-${{ inputs.ref || github.ref }}',
      'cancel-in-progress': true
    });

    const release = loadWorkflow('release.yml');
    expect(release.concurrency).toEqual({
      group: 'caul-release-${{ github.ref }}',
      'cancel-in-progress': false
    });
    expect(release.on.workflow_dispatch).toBeUndefined();
    expect(release.jobs.prepare.outputs).toMatchObject({
      tag: '${{ steps.release.outputs.tag }}',
      version: '${{ steps.release.outputs.version }}'
    });
    expect(release.jobs.quality.with.ref).toBe('${{ needs.prepare.outputs.tag }}');
    const prepareCheckout = release.jobs.prepare.steps.find((step) => step.name === 'Checkout code');
    expect(prepareCheckout.with['fetch-depth']).toBe(0);
    const provenance = release.jobs.prepare.steps.find((step) => step.name === 'Verify tag commit is on main');
    expect(provenance.env).toMatchObject({
      DEFAULT_BRANCH: '${{ github.event.repository.default_branch }}',
      RELEASE_SHA: '${{ github.sha }}'
    });
    expect(provenance.run).toContain('git merge-base --is-ancestor');
    expect(provenance.run).toContain('refs/tags/$CAUL_RELEASE_TAG^{commit}');
    expect(provenance.run).toContain('test "$TAG_COMMIT" = "$RELEASE_SHA"');
    expect(release.jobs['publish-release'].steps.at(-1).env).toMatchObject({
      RELEASE_TAG: '${{ needs.prepare.outputs.tag }}',
      RELEASE_PRERELEASE: '${{ needs.prepare.outputs.prerelease }}'
    });
    expect(release.jobs['publish-release'].steps.at(-1).run).toContain('gh release create');
    expect(release.jobs['publish-release'].steps.at(-1).run).toContain('--draft');
    expect(release.jobs['publish-release'].steps.at(-1).run).toContain('sha256sum --check SHA256SUMS');
    const stableHomebrewSteps = release.jobs['prepare-homebrew-publication'].steps;
    expect(stableHomebrewSteps.some((step) => step.name === 'Setup Node.js')).toBe(true);
    expect(stableHomebrewSteps.some((step) => step.name === 'Install verification dependencies'
      && step.run === 'npm ci')).toBe(true);
    expect(release.jobs['publish-release'].needs).toEqual(expect.arrayContaining([
      'test-macos-updater',
      'test-windows-upgrade',
      'test-linux-upgrade'
    ]));
    expect(release.jobs).toHaveProperty('verify-public-release');
    expect(release.jobs).toHaveProperty('verify-public-windows');
    expect(release.jobs).toHaveProperty('verify-public-linux');

    const source = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(source).not.toMatch(/GITHUB_REF#|inputs\.tag/);
    expect(source).not.toContain('--clobber');
    expect(source).not.toContain('--method DELETE');
    expect(source).toContain('generate-homebrew-casks.mjs');
    expect(source).toContain('brew tap apotenza92/tap');
    expect(source).toContain('brew --repository apotenza92/tap');
    expect(source).not.toContain('cat > Casks/caul.rb');
    expect(source).not.toContain("cat > 'Casks/caul@beta.rb'");
    expect(source).toContain('test ! -e "$app_path"');
    expect(source).toContain("test ! -e '/Applications/Caul Beta.app'");
    expect(source).toContain('/^v\\d+\\.\\d+\\.\\d+-beta\\.[1-9]\\d*$/');
    expect(source).toContain('cmp "release-assets/$asset_name" "existing-download/$asset_name"');
    expect(source).toContain(
      `gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name'`
    );
    expect(source).not.toContain(
      `gh api "repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG" --jq '.assets[].name'`
    );
    expect(source).toContain('Install, launch and uninstall published NSIS packages');
    expect(source).not.toContain('prepare-windows-7za');
    expect(source).not.toContain('USE_SYSTEM_7ZA');
    expect(source).toContain('gh attestation verify "$asset_path"');
    expect(source).toContain('env -u GH_TOKEN curl --fail --location');
    expect(source).toContain('Windows N-1 upgrade');
    expect(source).toContain('Linux N-1 upgrade');
    expect(source).toContain('./scripts/test-windows-upgrade.ps1');
    expect(source).toContain('./scripts/verify-public-windows.ps1');
    expect(source).toContain('function Resolve-InstalledFile');
    expect(source).toContain('Get-ChildItem -Path $Root -Recurse');
    expect(source).toContain('executable remains after uninstall');
    expect(source).not.toContain('$LASTEXITCODE');
    expect(source).toContain('brew upgrade --cask apotenza92/tap/caul apotenza92/tap/caul@beta');
    expect(source).toContain('Independently verify public macOS packages');
    expect(source).toContain('$assetName = $_.Name');
    expect(source).toContain('[regex]::Escape($assetName)');
    expect(source).not.toContain('[regex]::Escape($_.Name)');
    const nativeVerifier = readFileSync(path.join(repositoryRoot, 'scripts', 'verify-native-package.mjs'), 'utf8');
    expect(nativeVerifier).toContain('APPIMAGE_EXTRACT_AND_RUN');
    expect(nativeVerifier).toContain("spawnSync('dpkg-deb'");
    expect(nativeVerifier).toContain('rpm2cpio "$2" | cpio -idm --quiet');
    expect(nativeVerifier).toContain('inspectExtractedLinuxPackage(rpm, \'rpm\')');
    expect(nativeVerifier).toContain("asar.extractFile(archives[0], 'package.json')");
    expect(nativeVerifier).toContain('metadata.version !== packageVersion');
    const defenderEvidence = readFileSync(
      path.join(repositoryRoot, 'scripts', 'write-windows-defender-evidence.ps1'),
      'utf8'
    );
    expect(defenderEvidence).toContain('Get-MpThreatDetection');
    expect(defenderEvidence).toContain('Microsoft-Windows-Windows Defender/Operational');
    expect(defenderEvidence).toContain('$_.Id -in 1116, 1117');
    expect(defenderEvidence).not.toMatch(/Add-MpPreference|Set-MpPreference/);
    const publicWindowsVerifier = readFileSync(
      path.join(repositoryRoot, 'scripts', 'verify-public-windows.ps1'),
      'utf8'
    );
    expect(publicWindowsVerifier).toContain('./scripts/write-windows-defender-evidence.ps1');
    expect(publicWindowsVerifier).toContain('Stable and beta public Windows applications did not coexist');
    expect(publicWindowsVerifier).toContain('$LASTEXITCODE');
    const windowsCiSource = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(windowsCiSource).toContain("'./scripts/verify-public-windows.ps1'");
    const windowsUpgrade = readFileSync(
      path.join(repositoryRoot, 'scripts', 'test-windows-upgrade.ps1'),
      'utf8'
    );
    expect(windowsUpgrade).toContain('Stable and beta Windows applications did not coexist after upgrade');
    expect(windowsUpgrade).toContain('upgraded launch failed');
    expect(windowsUpgrade).toContain('verify-windows-packaged-launch.mjs');
    expect(windowsUpgrade).toContain('Get-CimInstance Win32_Process');
    expect(windowsUpgrade).toContain('ExecutablePath.StartsWith($installPrefix');
    expect(windowsUpgrade).toContain('$process.WaitForExit($remainingMilliseconds)');
    expect(windowsUpgrade).toContain('-TimeoutSeconds 300');
    expect(windowsUpgrade).toContain('-TimeoutSeconds 900');
    expect(windowsUpgrade).toContain("PriorTag -eq 'v0.1.21'");
    expect(windowsUpgrade).toContain(
      '$env:WINDOWS_ARM64_LEGACY_PUBLIC_BOOTSTRAP_TAG -eq $CandidateTag'
    );
    expect(windowsUpgrade).toContain('LegacyPartialInstall');
    expect(windowsUpgrade).toContain('Join-Path $env:TEMP');
    expect(windowsUpgrade).not.toContain('Join-Path $env:RUNNER_TEMP');
    expect(windowsUpgrade).not.toContain('-Wait -PassThru');
    expect(windowsUpgrade).toContain("ValidateSet('x64', 'arm64')");
    expect(windowsUpgrade).toContain("ValidateSet('stable', 'beta')");
    const windowsInstaller = readFileSync(
      path.join(repositoryRoot, 'build', 'installer.nsh'),
      'utf8'
    );
    expect(windowsInstaller).toContain('!macro customInit');
    expect(windowsInstaller).toContain('ReadRegStr $R9 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"');
    expect(windowsInstaller).toContain('${if} $R9 == "0.1.21"');
    expect(windowsInstaller).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"');
    expect(windowsInstaller).toContain('DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"');
    expect(windowsInstaller).not.toContain('${FileExists}');
    expect(windowsInstaller).not.toContain('RMDir');
    const windowsLaunchVerifier = readFileSync(
      path.join(repositoryRoot, 'scripts', 'verify-windows-packaged-launch.mjs'),
      'utf8'
    );
    expect(windowsLaunchVerifier).toContain("validatePackagedLaunchProcessResult('windows'");
    expect(windowsLaunchVerifier).toContain("CAUL_SMOKE_OUTPUT_FILE: smokeOutputPath");
    expect(windowsLaunchVerifier).toContain('timeout: 30_000');
    expect(release.jobs['test-windows-upgrade']['timeout-minutes']).toBe(65);
    expect(source).toContain(
      'WINDOWS_ARM64_LEGACY_PUBLIC_BOOTSTRAP_TAG: ${{ vars.WINDOWS_ARM64_LEGACY_PUBLIC_BOOTSTRAP_TAG }}'
    );
    const ciSource = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ciSource).toContain('Verify Windows release script syntax');
    expect(ciSource).toContain('./scripts/test-windows-upgrade.ps1');
    expect(ciSource).toContain('System.Management.Automation.Language.Parser');

    const signedBuild = readFileSync(path.join(repositoryRoot, 'scripts', 'build-signed-macos.mjs'), 'utf8');
    expect(signedBuild).toContain("'--skip-launch'");
    expect(signedBuild).toContain('stampUpdaterMinimumSystemVersion');
    expect(signedBuild).toContain('CAUL_MAC_MINIMUM_KERNEL_VERSION');
    const updaterHarness = readFileSync(path.join(repositoryRoot, 'scripts', 'test-macos-update.mjs'), 'utf8');
    expect(updaterHarness).toContain('waitForRelaunch(executable, originalPid)');
    expect(updaterHarness).toContain('await stopRelaunch(relaunchedPid)');
    expect(updaterHarness).toContain("candidate.startsWith('/var/')");
    expect(updaterHarness).toContain("candidate.startsWith('/private/var/')");
    expect(updaterHarness).toContain('realpathSync(executablePath)');
    expect(updaterHarness).toContain("option('--trusted-candidate-zip')");
    expect(updaterHarness).toContain("option('--candidate-tag')");
    expect(updaterHarness).toContain("channel === 'beta' ? '/beta-mac.yml' : '/latest-mac.yml'");
    expect(updaterHarness).toContain('prerelease: false');
    expect(updaterHarness).toContain('tag_name: `v${offeredVersion}`');
    expect(updaterHarness).toContain("response.end('wrong updater channel')");
    expect(updaterHarness).toContain('resolvePriorSigningFingerprints');
    expect(updaterHarness).toContain('upgrade-preservation-marker.json');
    expect(updaterHarness).toContain('did not preserve existing user data');
    expect(updaterHarness).toContain("scenario === 'valid' && priorVersion === expectedVersion");
    expect(source).toContain('MACOS_UPDATER_LEGACY_PUBLIC_BOOTSTRAP_TAG');
    expect(source).toContain('deferred-public-n-1');
    expect(source).toContain('APPLE_PRIOR_SIGNING_CERTIFICATE_SHA256: ${{ vars.APPLE_PRIOR_SIGNING_CERTIFICATE_SHA256 }}');
    expect(source).toContain('name: ${{ matrix.variant }}-updater-verification');
    expect(source).not.toContain('name: ${{ matrix.variant }}-release');
    const releaseGuide = readFileSync(path.join(repositoryRoot, 'docs', 'release-validation.md'), 'utf8');
    expect(releaseGuide).toContain('stable-updater-verification');
    expect(releaseGuide).toContain('beta-updater-verification');
    expect(releaseGuide).toContain("MACOS_UPDATER_BOOTSTRAP_TAG` in that channel's updater-verification environment");
    expect(releaseGuide).toContain('WINDOWS_ARM64_LEGACY_PUBLIC_BOOTSTRAP_TAG');
    expect(releaseGuide).not.toContain('`MACOS_UPDATER_BOOTSTRAP_TAG` repository variable');
    const packageVerifier = readFileSync(path.join(repositoryRoot, 'scripts', 'verify-macos-package.mjs'), 'utf8');
    expect(packageVerifier).toContain("'bin', 'caul-desktop-backend'");
    expect(packageVerifier).toContain("'bin', 'CaulAudioHelper'");
    expect(packageVerifier).toContain("['--fixture-live-pipeline']");
    expect(packageVerifier).toContain("['--capabilities']");
    expect(packageVerifier).not.toContain('.map(realpathSync)');
    expect(packageVerifier).toContain('map((bundlePath) => realpathSync(bundlePath))');
    expect(packageVerifier).toContain('map((filePath) => realpathSync(filePath))');
    const afterPack = readFileSync(path.join(repositoryRoot, 'scripts', 'after-pack.cjs'), 'utf8');
    expect(afterPack).toContain("'app.asar.unpacked'");
    expect(afterPack).toContain("'pi-tui'");
    expect(afterPack).toContain("'darwin-x64'");
    expect(afterPack).toContain("'clipboard-darwin-x64'");
    expect(afterPack).toContain('fs.rmSync');
    expect(source).toContain('verify-legacy-updater-baseline.mjs');
    expect(source).toContain('--candidate-tag "$RELEASE_TAG"');

    const builderSource = readFileSync(path.join(repositoryRoot, 'electron-builder.config.cjs'), 'utf8');
    expect(builderSource).toContain('/^\\d+\\.\\d+\\.\\d+-beta\\.[1-9]\\d*$/');
    expect(builderSource).toContain("process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ'");
    expect(builderSource).not.toContain("version.includes('-alpha')");
    expect(builderSource).not.toContain("version.includes('-rc')");
    expect(source).toContain('node scripts/extract-release-notes.mjs --version "${RELEASE_TAG#v}" --output release-notes.md');
    expect(source).toContain('--notes-file release-notes.md');
    expect(source).not.toContain('--generate-notes');
  });

  it('preserves stable and beta macOS ZIPs, feeds, checksums and Homebrew targets', () => {
    const workflow = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    for (const uploadPattern of [
      'release/*.zip',
      'release/latest*.yml',
      'release/beta*.yml',
      'release/*.blockmap',
      'release/*.sha256',
      'release/notarization-*.json'
    ]) {
      expect(workflow).toContain(uploadPattern);
    }

    expect(workflow.match(/Caul-macos-arm64\.zip/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflow.match(/Caul-Beta-macos-arm64\.zip/g)?.length).toBeGreaterThanOrEqual(4);
    const homebrewGenerator = readFileSync(path.join(repositoryRoot, 'scripts', 'generate-homebrew-casks.mjs'), 'utf8');
    expect(homebrewGenerator).toContain('app "Caul.app"');
    expect(homebrewGenerator).toContain('app "Caul Beta.app"');
    expect(workflow).toContain('cp release/stable-yml-backup/latest*.yml release/');
  });
});

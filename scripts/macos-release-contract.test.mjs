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
import { validateUpdateMetadata } from './verify-macos-package.mjs';

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
    expect(workflow.match(/secrets\.IMMUTABLE_RELEASES_READ_TOKEN/g)).toHaveLength(1);
  });

  it('pins external actions and prevents checkout credential persistence', () => {
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
        expect(checkout.with?.['persist-credentials']).toBe(false);
        expect(checkout.with?.ref).toBeTruthy();
      }
    }
  });

  it('keeps pull-request workflows outside secret-bearing environments', () => {
    for (const name of ['ci.yml', 'pages.yml', 'release.yml']) {
      const workflow = loadWorkflow(name);
      if (workflow.on.pull_request === undefined) continue;

      expect(JSON.stringify(workflow.jobs), `${name} references a secret`).not.toContain('${{ secrets.');
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        expect(job.environment, `${name}:${jobName} uses an environment`).toBeUndefined();
      }
    }
  });

  it('scopes the public site deploy key to the maintained Pages environment', () => {
    const pages = loadWorkflow('pages.yml');
    expect(pages.jobs.publish.environment).toBe('github-pages');
    expect(JSON.stringify(pages.jobs.publish)).toContain('PAGES_DEPLOY_KEY');
  });

  it('serialises releases by selected tag and validates that exact ref', () => {
    const ci = loadWorkflow('ci.yml');
    expect(ci.concurrency).toEqual({
      group: 'ci-${{ github.workflow }}-${{ inputs.ref || github.event.pull_request.number || github.ref }}',
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
    expect(release.jobs['release-policy']).toMatchObject({
      environment: 'release-policy',
      permissions: { contents: 'read' }
    });
    expect(release.jobs['release-policy'].steps).toHaveLength(1);
    expect(release.jobs['release-policy'].steps[0].env).toEqual({
      GH_TOKEN: '${{ secrets.IMMUTABLE_RELEASES_READ_TOKEN }}'
    });
    expect(release.jobs['release-policy'].steps[0].run).toContain('immutable-releases');
    expect(release.jobs['publish-release'].needs).toContain('release-policy');
    expect(release.jobs['publish-release'].steps.at(-1).env).toMatchObject({
      RELEASE_TAG: '${{ needs.prepare.outputs.tag }}',
      RELEASE_PRERELEASE: '${{ needs.prepare.outputs.prerelease }}'
    });
    expect(release.jobs['publish-release'].steps.at(-1).run).toContain('gh release create');
    expect(release.jobs['publish-release'].steps.at(-1).run).toContain('--draft');
    expect(release.jobs['publish-release'].steps.at(-1).run).toContain('sha256sum --check SHA256SUMS');

    const source = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(source).not.toMatch(/GITHUB_REF#|inputs\.tag/);
    expect(source).not.toContain('--clobber');
    expect(source).not.toContain('--method DELETE');
    expect(source).toContain('--jq .immutable');
    expect(source).toContain('Published release is not immutable');
    expect(source).toContain('generate-homebrew-casks.mjs');
    expect(source).toContain('brew tap apotenza92/tap');
    expect(source).toContain('brew --repository apotenza92/tap');
    expect(source).not.toContain('cat > Casks/caul.rb');
    expect(source).not.toContain("cat > 'Casks/caul@beta.rb'");
    expect(source).toContain('test ! -e "$app_path"');
    expect(source).toContain("test ! -e '/Applications/Caul Beta.app'");
    expect(source).toContain('/^v\\d+\\.\\d+\\.\\d+-beta\\.[1-9]\\d*$/');
    expect(source).toContain('cmp "release-assets/$asset_name" "existing-download/$asset_name"');
    expect(source).toContain('Install, launch and uninstall published NSIS packages');
    const nativeVerifier = readFileSync(path.join(repositoryRoot, 'scripts', 'verify-native-package.mjs'), 'utf8');
    expect(nativeVerifier).toContain('APPIMAGE_EXTRACT_AND_RUN');
    expect(nativeVerifier).toContain("spawnSync('dpkg-deb'");
    expect(nativeVerifier).toContain('rpm2cpio "$2" | cpio -idm --quiet');
    expect(nativeVerifier).toContain('inspectExtractedLinuxPackage(rpm, \'rpm\')');

    const signedBuild = readFileSync(path.join(repositoryRoot, 'scripts', 'build-signed-macos.mjs'), 'utf8');
    expect(signedBuild).toContain("'--skip-launch'");
    expect(signedBuild).toContain('stampUpdaterMinimumSystemVersion');
    expect(signedBuild).toContain('CAUL_MAC_MINIMUM_KERNEL_VERSION');
    const updaterHarness = readFileSync(path.join(repositoryRoot, 'scripts', 'test-macos-update.mjs'), 'utf8');
    expect(updaterHarness).toContain('waitForRelaunch(executable, originalPid)');
    expect(updaterHarness).toContain('await stopRelaunch(relaunchedPid)');
    expect(updaterHarness).toContain("option('--trusted-candidate-zip')");
    expect(updaterHarness).toContain("option('--candidate-tag')");
    expect(updaterHarness).toContain("channel === 'beta' ? '/beta-mac.yml' : '/latest-mac.yml'");
    expect(updaterHarness).toContain('prerelease: betaCandidate');
    expect(updaterHarness).toContain('tag_name: candidateTag');
    expect(updaterHarness).toContain("response.end('wrong updater channel')");
    expect(updaterHarness).toContain('resolvePriorSigningFingerprints');
    expect(source).toContain('APPLE_PRIOR_SIGNING_CERTIFICATE_SHA256: ${{ vars.APPLE_PRIOR_SIGNING_CERTIFICATE_SHA256 }}');
    expect(source).toContain('name: ${{ matrix.variant }}-updater-verification');
    expect(source).not.toContain('name: ${{ matrix.variant }}-release');
    const releaseGuide = readFileSync(path.join(repositoryRoot, 'docs', 'release-validation.md'), 'utf8');
    expect(releaseGuide).toContain('stable-updater-verification');
    expect(releaseGuide).toContain('beta-updater-verification');
    expect(releaseGuide).toContain("MACOS_UPDATER_BOOTSTRAP_TAG` in that channel's updater-verification environment");
    expect(releaseGuide).not.toContain('`MACOS_UPDATER_BOOTSTRAP_TAG` repository variable');
    const packageVerifier = readFileSync(path.join(repositoryRoot, 'scripts', 'verify-macos-package.mjs'), 'utf8');
    expect(packageVerifier).toContain("'bin', 'caul-desktop-backend'");
    expect(packageVerifier).toContain("'bin', 'CaulAudioHelper'");
    expect(packageVerifier).toContain("['--fixture-live-pipeline']");
    expect(packageVerifier).toContain("['--capabilities']");
    expect(source).toContain('verify-legacy-updater-baseline.mjs');
    expect(source).toContain('--candidate-tag "$RELEASE_TAG"');

    const builderSource = readFileSync(path.join(repositoryRoot, 'electron-builder.config.cjs'), 'utf8');
    expect(builderSource).toContain('/^\\d+\\.\\d+\\.\\d+-beta\\.[1-9]\\d*$/');
    expect(builderSource).not.toContain("version.includes('-alpha')");
    expect(builderSource).not.toContain("version.includes('-rc')");
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

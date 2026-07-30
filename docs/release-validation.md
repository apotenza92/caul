# Release Validation

Caul release validation tests packaged artefacts and their bundled resources. Source-mode smoke tests support development but do not replace packaged gates.

## Package Matrix

- Apple Silicon macOS 14 or later: signed and notarised application ZIP.
- Windows ARM64 and x64: NSIS package or unpacked packaged runtime where installer behaviour is tested separately.
- Linux ARM64 and x64: AppImage and Debian package.
- Linux x64: RPM package in addition to AppImage and Debian output.

Intel macOS is not supported. Every listed architecture is built by the GitHub release workflow. Local Parallels coverage is fallback evidence and is not required for ordinary cross-platform compilation.

## Existing-User Migration Contract

The TUF migration changes update authentication, not the installed product identity or data layout. Caul explicitly maintains stable and beta as separate products. These existing paths and identifiers are compatibility boundaries:

| Boundary | Stable | Beta |
| --- | --- | --- |
| Application ID | `dev.caul.app` | `dev.caul.app.beta` |
| macOS application | `/Applications/Caul.app` | `/Applications/Caul Beta.app` |
| Windows default installation | `%LOCALAPPDATA%\Programs\Caul` | `%LOCALAPPDATA%\Programs\Caul Beta` |
| Linux package installation | `/opt/Caul`, command `caul` | `/opt/Caul Beta`, command `caul-beta` |
| macOS `userData` | `~/Library/Application Support/Caul` | `~/Library/Application Support/Caul Beta` |
| Windows `userData` | `%APPDATA%\Caul` | `%APPDATA%\Caul Beta` |
| Linux `userData` | `~/.config/Caul` | `~/.config/Caul Beta` |
| Electron Updater cache name | `caul-updater` | `caul-beta-updater` |
| TUF persisted trust | `<userData>/update-trust` | `<userData>/update-trust` |
| Package names | `caul`, `Caul` | `caul-beta`, `Caul Beta` |

The user-selected portable profile remains under `Documents/Caul` by default and contains versioned `settings.json`, `prompts.json` and dated HTML history. Legacy TXT history conversion remains supported. Private window state, setup state, encrypted provider API-key records, Pi authentication state, model caches and updater trust remain inside the channel-specific `userData` directory. Caul has no project database whose schema is changed by this release. Existing NSIS registrations, Linux package-manager records, Homebrew casks and macOS bundle identifiers keep their current names. The release gates must preserve these files and authentication state in place; the first TUF-enabled build must not copy, rename, reset or delete them.

## GitHub-Hosted Gates

The `CI` workflow is manually dispatchable and callable by the tag-only release workflow. It runs actionlint from a checksum-pinned upstream archive, the renderer and TypeScript checks, the complete deterministic Rust test suite, bundled dependency licence verification and native build preflights on macOS ARM64, Windows x64 and Linux x64. Run it deliberately against a release-preparation branch before merging; the release workflow reruns the same gate against the exact tag.

The release workflow calls the same `CI` workflow before any release packaging begins. It then builds the complete supported package matrix on GitHub-hosted macOS, Windows and Linux runners. A tag must not publish a release when the shared checks or any platform build fails.

Before publication, native Windows and Linux runners install the previous public stable and beta packages, launch them with separate user-data roots, upgrade both variants in place to the candidate, verify preserved state and launch the upgraded applications. Stable and beta must coexist after the upgrade. A separate reusable native TUF audit builds a synthetic older package with an ephemeral loopback-only trust root, performs a real automatic update to the exact candidate package on every supported Windows and Linux architecture, verifies restart, retained settings, credential state, project data and persisted trust, then verifies Windows uninstall. The macOS updater scenarios likewise assert that existing user data survives a valid update and both rejection paths.

Linux release verification extracts AppImage, Debian and RPM packages on each supported native architecture. It rejects foreign ELF files, unresolved `ldd` dependencies, a required GLIBC symbol newer than `GLIBC_2.39`, missing application metadata, or incomplete desktop-entry and icon integration. This is the declared Ubuntu 24.04-class runtime ceiling, not a claim of compatibility with older distributions. The x64 RPM additionally undergoes a package-manager-native N-1 upgrade in a digest-pinned Fedora 42 container: `dnf` resolves the package dependency closure, stable and beta launch, user data survives the upgrade, desktop integration remains registered, and uninstall removes the applications without deleting user data.

Windows installer checks keep Microsoft Defender active. If an expected executable disappears during installation, the workflow records matching Defender detections and operational-log events before failing. It must not add scanning exclusions or disable real-time protection to make a package pass.

Windows N-1 installations remain isolated under the runner's `%TEMP%` directory. Electron Builder's NSIS updater atomically moves the old installation through an NSIS plug-in directory under `%TEMP%`; placing the test installation on another volume creates a cross-volume move that is not representative of the normal per-user installation path.

Windows ARM64 NSIS payloads force the established BCJ executable filter. Modern 7-Zip otherwise selects its newer ARM64 filter automatically, which the bundled NSIS extractor cannot restore. Electron Builder supplies the checksum-pinned native 7-Zip toolset; do not reintroduce a machine-level 7za shim.

The one-time Windows migration from `0.1.21` is a documented legacy recovery because its NSIS uninstaller does not complete when a newer installer invokes it. Its authenticated ARM64 installers also exit successfully without restoring their application executable. The candidate installer recognises only that exact registered version, clears the stale installation and uninstall registration, and overwrites the old files in place without deleting user data or an arbitrary installation directory. The x64 gate must install and launch both genuine prior applications before the migration, then verify their preserved user data, candidate launches and coexistence. For the ARM64 partial-install case only, set `WINDOWS_ARM64_LEGACY_PUBLIC_BOOTSTRAP_TAG` to the exact candidate tag. That gate must reproduce both partial installations before running the same candidate verification. Remove the variable immediately after the successful public release and never advance it.

Releases are tag-push only. Every validation and packaging job checks out that exact tag, verifies that the tagged commit is on `main`, and publication uses the validated tag rather than a mutable branch ref. The migration does not require a release-tag ruleset for the current single-owner repository; add broader branch or tag rules only after separately reviewing the collaboration model and release-authoring threat boundary.

Both publication environments must be restricted to `v*` tags, with the workflow's strict grammar selecting the channel. `stable-release` and `beta-release` both require final human approval. The release workflow verifies tag-to-main provenance, exact assets and checksums without requiring a repository Administration token.

GitHub-hosted checks use synthetic fixtures and inspectable build outputs. They do not claim to prove physical microphone behaviour, real system-audio capture, interactive operating-system permission prompts or permission persistence.

## macOS Signing and Notarisation

Release macOS jobs use a Developer ID Application certificate exported as PKCS #12 and a separate App Store Connect API key for `notarytool`. Apple ID passwords and app-specific-password notarisation are not supported release paths.

The signing job imports the certificate into a password-protected disposable keychain, selects the configured signer explicitly, verifies the imported certificate's SHA-256 fingerprint, and removes the keychain and decoded credentials after the job. The notarisation hook submits the signed application with the App Store Connect P8 key, records the accepted submission and complete notary log, rejects error issues, staples the application, and validates the ticket with both `stapler` and Gatekeeper. After Electron Builder creates the final ZIP, the same protected job submits that exact distributable separately and publishes a second accepted notarisation record. ZIP files cannot carry a stapled ticket, so verification extracts the distributable and validates the stapled application inside it.

Post-package verification checks the exact stable or beta bundle identity, version, updater provider and channel, ZIP safety, blockmap and updater hashes, Developer ID authority, Team ID, certificate fingerprint, hardened-runtime timestamp, entitlements, every nested signed bundle and Mach-O object, exact ARM64 architecture, stapled ticket, Gatekeeper assessment and an isolated packaged launch with update traffic disabled.

After publication, the workflow re-downloads the exact public asset set, verifies the release classification, SHA-256 manifest and GitHub attestations, and checks that every asset URL is anonymously reachable. Native Windows and Linux runners then install, inspect and launch the publicly downloaded packages. The Homebrew preparation job independently re-downloads both public macOS packages and repeats the complete signature, notarisation, architecture, bundle, checksum, helper and launch verifier before preparing casks.

Release candidates also run the macOS updater from the previous public package for each applicable channel. The gate proves a valid replacement and rejection of a corrupt archive and an ad-hoc signed archive. The updater jobs use the tag-restricted `stable-updater-verification` and `beta-updater-verification` environments, which have no reviewer and contain no signing credentials. A channel with no prior public package may skip N-1 only when the exact candidate tag is named by `MACOS_UPDATER_BOOTSTRAP_TAG` in that channel's updater-verification environment. Remove that variable after the bootstrap release and never advance it to bypass later N-1 tests.

The one-time migration from `0.1.21` is a documented legacy exception because that public build predates the isolated updater test feed. For this migration only, set `MACOS_UPDATER_LEGACY_PUBLIC_BOOTSTRAP_TAG` to the exact candidate tag in both updater-verification environments. Corrupt-package and wrong-signature rejection still run before publication against the candidate updater. The valid N-1 transition must then be run from the signed `0.1.21` applications against the real public release, for both stable and beta, before the release is considered complete. Remove the legacy variable immediately afterwards. Never advance it to a later release.

Windows NSIS and Linux AppImage packages enter Electron Updater only through a temporary loopback feed populated from TUF-authenticated metadata. Production metadata and targets use HTTPS, and redirect, missing, expired, corrupt, incorrectly signed or mismatched metadata fails closed. Native ARM64 and x64 release jobs install a synthetic previous package and prove a valid replacement plus rejection of a corrupt package payload and incorrectly signed timestamp metadata without changing the installed app, user data or trust. The app copies its embedded reviewed root only when no persisted root exists and never overwrites advanced trust. The temporary feed closes before an installer hand-off. Debian and RPM builds open the public release page and remain upgradeable through their system package manager.

The first TUF-enabled Windows and Linux release is a bootstrap from the existing checksum-verified manual package path. Existing stable and beta identities, installation paths, `userData`, projects and settings do not change. After a user installs that release, its embedded root establishes the persisted trust used for later automatic updates. Do not claim a TUF-authenticated automatic transition from a package that predates the embedded root.

The public root document is committed at `build/update-trust/root.json`. Its private root key remains offline in 1Password and must never enter GitHub Actions. The protected `update-signing` environment contains only the matching `CAUL_TUF_TARGETS_PRIVATE_KEY_PEM`, `CAUL_TUF_SNAPSHOT_PRIVATE_KEY_PEM` and `CAUL_TUF_TIMESTAMP_PRIVATE_KEY_PEM` secrets. The signing job produces expiring, monotonically versioned metadata from exact package-builder YAML and immutable release URLs. Public verification anonymously re-downloads the sealed feed and performs actual TUF verification for every Windows and Linux architecture before the release is considered complete.

Record the prior `updates` branch commit and retain the prior public release before publication. If new metadata has not become publicly observable, the feed commit may be restored. Once any client may have accepted the higher TUF metadata versions, never restore lower metadata versions because conforming clients will reject that rollback. Instead, sign higher-version metadata that points to the retained prior immutable package, or publish a corrected higher application version after explicit approval. Published release assets remain immutable in either case.

GitHub stores Apple signing credentials only in the protected `release-signing` environment. Its required secrets are `APPLE_SIGNING_CERTIFICATE_P12_BASE64`, `APPLE_SIGNING_CERTIFICATE_PASSWORD` and `APPLE_NOTARYTOOL_KEY_P8_BASE64`. Non-secret environment variables pin `APPLE_NOTARYTOOL_KEY_ID` and `APPLE_NOTARYTOOL_ISSUER_ID`; repository variables pin `APPLE_SIGNING_CERTIFICATE_SHA256`, `APPLE_PRIOR_SIGNING_CERTIFICATE_SHA256`, `APPLE_SIGNING_IDENTITY` and `APPLE_TEAM_ID`. TUF online keys remain isolated in `update-signing`. Stable and beta publication and updater verification use separate protected environments, and jobs receive only the permissions they require. Homebrew casks and the download page are checksum-sealed workflow artefacts. The tag-only release workflow publishes the exact validated casks after all public platform checks pass, using a tap-specific deploy key that cannot access the Caul repository or other repositories. The download page remains a deliberate manual publication because it writes to a separate website repository.

For a stable release, the Homebrew preparation gate installs both previous public casks, generates the candidate casks from the final public SHA-256 values, upgrades both installations in place, verifies preserved user data, confirms stable and beta coexist, and launches both signed applications. A separate publication job verifies the sealed artefact, release tag and release commit, changes only the expected cask files, rejects unexpected diffs and pushes one non-forced commit to the tap. Re-running the publication is idempotent.

## Hardware Packaged Gates

A persistent Apple Silicon Mac with an interactive user session is required for the real ScreenCaptureKit, microphone and macOS permission gates. Run those checks only from a protected environment that cannot execute untrusted pull-request code. A remote self-hosted GitHub runner may provide this gate without relying on a developer's local Mac.

Fresh macOS permission-prompt testing is a separate explicit gate because TCC state is persistent. Do not reset permissions as part of ordinary E2E iteration.

Windows and Linux package correctness is primarily covered by the GitHub-hosted release matrix. Dedicated hardware is required only when a change specifically depends on physical audio devices or operating-system behaviour that synthetic fixtures cannot represent.

## Local Parallels Fallback

The existing Parallels profiles remain a temporary fallback until the protected remote macOS hardware gate is operational. They are not the primary static, deterministic or cross-platform package build path.

Use explicit prepare, package, stage and E2E commands when local fallback evidence is required:

- `npm run vm:prepare:<platform>` validates and prepares the guest checkout.
- `npm run vm:package:<platform>` builds the platform package in the guest where required.
- `npm run vm:stage:<platform>` stages the exact packaged artefact under test.
- `npm run vm:e2e:<platform>` runs the packaged gate.

The supported fallback profiles are `macos`, `win` and `linux`. `npm run vm:e2e` runs those three packaged gates in sequence. `npm run vm:e2e:fedora` is the separate RPM install and package gate.

Profile defaults in `scripts/vm/profiles.mjs` may be overridden through their documented `CAUL_<PLATFORM>_*` environment variables. Credentials and VM passwords must not be committed.

## Required Evidence

Each applicable packaged gate must verify:

- Launch or installation from the staged package.
- Bundled backend and required runtime resources.
- Fresh-user onboarding and explicit provider setup boundaries.
- No provider, update or telemetry requests before setup when the privacy gate is active.
- No raw audio or transcript debug files written unexpectedly under app `userData`.
- Native microphone and system-audio capture with non-zero level evidence.
- Input and output source isolation.
- Local transcription against a known speech fixture.
- Renderer AI response using the selected test provider path.
- Clean capture stop and restart in the same process.
- Overlay and floating-handle content protection on macOS and Windows. Linux records the shared protection path as best effort because Electron does not expose equivalent protection there.

## Release Workflow

Keep active GitHub CI, release, Pages, security and package workflows intact. A release is eligible only when the shared hosted checks, licence verification, platform packaging and applicable hardware gates pass. Record released changes in the changelog rather than rewriting history when an implementation is later replaced.

Before creating a release tag, add a matching version section to `CHANGELOG.md`. The release workflow extracts that section into the GitHub release body, and Caul displays the same notes when it detects the update. Release preparation fails if the matching changelog section is missing.

Caul checks for app updates weekly by default, with other check frequencies available in Settings. Checks do not silently download or install software. A user must start the download and explicitly restart to install on macOS, Windows NSIS and Linux AppImage. Debian and RPM users upgrade through the system package manager.

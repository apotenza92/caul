# Release Validation

Caul release validation tests packaged artefacts and their bundled resources. Source-mode smoke tests support development but do not replace packaged gates.

## Package Matrix

- Apple Silicon macOS 14 or later: signed and notarised application ZIP.
- Windows ARM64 and x64: NSIS package or unpacked packaged runtime where installer behaviour is tested separately.
- Linux ARM64 and x64: AppImage and Debian package.
- Linux x64: RPM package in addition to AppImage and Debian output.

Intel macOS is not supported. Every listed architecture is built by the GitHub release workflow. Local Parallels coverage is fallback evidence and is not required for ordinary cross-platform compilation.

## GitHub-Hosted Gates

The `CI` workflow runs on pull requests and pushes to `main`. It runs the renderer and TypeScript checks, the complete deterministic Rust test suite, bundled dependency licence verification and native build preflights on macOS ARM64, Windows x64 and Linux x64. GitHub repository settings determine whether its jobs are required before merging.

The release workflow calls the same `CI` workflow before any release packaging begins. It then builds the complete supported package matrix on GitHub-hosted macOS, Windows and Linux runners. A tag must not publish a release when the shared checks or any platform build fails.

Releases are tag-push only. Every validation and packaging job checks out that exact tag, verifies that the tagged commit is on `main`, and publication uses the validated tag rather than a mutable branch ref. The migration does not require a release-tag ruleset for the current single-owner repository; add broader branch or tag rules only after separately reviewing the collaboration model and release-authoring threat boundary.

Before pushing the first release tag, enable immutable releases in the repository settings and configure a tag-restricted `release-policy` environment. That environment contains only `IMMUTABLE_RELEASES_READ_TOKEN`, a fine-grained token with read-only Administration access to this repository. The read-only policy job verifies the live immutable-release setting before publication can run. Both publication environments must be restricted to `v*` tags, with the workflow's strict grammar selecting the channel; `stable-release` requires the final human approval, while `beta-release` runs automatically after its required checks. These hosted settings are action-time prerequisites and are not mutated by the workflow.

GitHub-hosted checks use synthetic fixtures and inspectable build outputs. They do not claim to prove physical microphone behaviour, real system-audio capture, interactive operating-system permission prompts or permission persistence.

## macOS Signing and Notarisation

Release macOS jobs use a Developer ID Application certificate exported as PKCS #12 and a separate App Store Connect API key for `notarytool`. Apple ID passwords and app-specific-password notarisation are not supported release paths.

The signing job imports the certificate into a password-protected disposable keychain, selects the configured signer explicitly, verifies the imported certificate's SHA-256 fingerprint, and removes the keychain and decoded credentials after the job. The notarisation hook submits the signed application with the App Store Connect P8 key, records the accepted submission and complete notary log, rejects error issues, staples the application, and validates the ticket with both `stapler` and Gatekeeper.

Post-package verification checks the exact stable or beta bundle identity, version, updater provider and channel, ZIP safety, blockmap and updater hashes, Developer ID authority, Team ID, certificate fingerprint, hardened-runtime timestamp, entitlements, every nested signed bundle and Mach-O object, exact ARM64 architecture, stapled ticket, Gatekeeper assessment and an isolated packaged launch with update traffic disabled.

Release candidates also run the macOS updater from the previous public package for each applicable channel. The gate proves a valid replacement and rejection of a corrupt archive and an ad-hoc signed archive. The updater jobs use the tag-restricted `stable-updater-verification` and `beta-updater-verification` environments, which have no reviewer and contain no signing credentials. A channel with no prior public package may skip N-1 only when the exact candidate tag is named by `MACOS_UPDATER_BOOTSTRAP_TAG` in that channel's updater-verification environment. Remove that variable after the bootstrap release and never advance it to bypass later N-1 tests.

Automatic download and restart-to-install updates are supported only by the signed macOS packages. Windows and Linux builds check the same GitHub stable/beta release channels and download the matching native package for explicit user installation. They must not enter Electron Updater's automatic-install path until their update metadata and native install transition have a maintained release gate.

GitHub stores signing credentials only in the protected `release-signing` environment. Its required secrets are `APPLE_SIGNING_CERTIFICATE_P12_BASE64`, `APPLE_SIGNING_CERTIFICATE_PASSWORD` and `APPLE_NOTARYTOOL_KEY_P8_BASE64`. Non-secret environment variables pin `APPLE_NOTARYTOOL_KEY_ID` and `APPLE_NOTARYTOOL_ISSUER_ID`; repository variables pin `APPLE_SIGNING_CERTIFICATE_SHA256`, `APPLE_PRIOR_SIGNING_CERTIFICATE_SHA256`, `APPLE_SIGNING_IDENTITY` and `APPLE_TEAM_ID`. Stable and beta publication, updater verification, immutable-release policy and Homebrew updates use separate protected environments, and jobs receive only the permissions they require.

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

# Changelog

All notable Caul changes are recorded here.

## [0.1.43]

- Kept incomplete onboarding visible across launches, improved Windows onboarding focus around browser sign-in, and placed the first floating handle at the top centre of the display where setup was completed.
- Made the main toolbar responsive at compact window widths, kept window resizing available while Settings is open, and extended packaged onboarding checks to reject overlapping or clipped toolbar actions.
- Made Parallels Windows release staging use the host bridge with an exact `app.asar` checksum, then locate and verify the installed package without relying on a blocked shared folder or installer process wait.
- Added stable and beta version details to every alternative download while keeping beta builds inside the secondary download area.
- Reduced the packaged app by excluding already-bundled renderer tooling, development files and unused Electron localisations, and by stripping release symbols from the Rust and Swift helpers.
- Made `CHANGELOG.md` the source for GitHub release notes and displayed those notes inside Caul when an update is available.

## [0.1.42]

- Moved public Windows installation verification into a syntax-checked PowerShell script so malformed workflow-embedded expressions cannot bypass preflight validation.

## [0.1.41]

- Made macOS updater relaunch verification recognise the canonical `/private/var` process path used by macOS when the test app is installed beneath a temporary `/var` path.

## [0.1.40]

- Installed repository dependencies before independent public macOS and Homebrew verification.
- Corrected public Windows checksum verification so nested PowerShell pipelines retain the package filename being authenticated.

## [0.1.39]

- Simplified onboarding into a fixed 560 × 560 top-aligned flow using the repository’s shadcn/Base UI controls, with clear Local and Cloud choices and no scrolling across supported AI setup combinations.
- Added browser-based ChatGPT subscription sign-in through the exact Pi 0.82.1 runtime, including passkey support, strict OpenAI authentication URL validation and concise failure handling.
- Added optional encrypted API-key setup for OpenAI, Anthropic, Google and xAI while keeping sign-in first and exposing only configured provider models.
- Isolated Pi from inherited credentials and optional tools, context files, extensions, skills and prompt templates, and injects only the selected provider credential into each child process.
- Added provider/model compatibility coverage, secure credential-store tests, deterministic renderer AI gates, real signed-in request validation and packaged checks that reject embedded credentials or superseded dependencies.
- Restored the maintained ScreenCaptureKit and local Parakeet known-text hardware smoke, including isolated model reuse and deterministic cleanup.
- Made draft release publication use GitHub CLI’s draft-aware asset lookup so an approved release can upload and verify its immutable asset set before becoming public.

## [0.1.38] (unpublished release candidate)

- Identical application changes to 0.1.39, but publication stopped safely at an empty draft after GitHub’s public release-by-tag API could not resolve a draft release.

## [0.1.37]

- Extended the exact `0.1.21` Windows compatibility path to x64 after hosted evidence showed its legacy NSIS uninstaller also remained blocked when invoked by a newer installer.

## [0.1.36]

- Kept hosted Windows N-1 installations on the same volume as the NSIS plug-in directory so the legacy atomic update path is tested without an artificial cross-volume deadlock.
- Made the Windows installer recover the exact incomplete `0.1.21` ARM64 registration by safely overwriting its partial files without deleting user data or an arbitrary installation directory.

## [0.1.35]

- Added an exact-tag recovery gate for the immutable `0.1.21` Windows ARM64 partial installers while retaining the full x64 N-1 launch, upgrade and user-data checks.
- Kept Windows installer operations bounded with progress evidence and enough time for legacy NSIS uninstall and extraction work on hosted runners.

## [0.1.34]

- Kept Windows N-1 installer operations bounded while allowing the authenticated legacy installers and their in-place uninstall helpers enough time to complete on hosted x64 and ARM64 runners.

## [0.1.33]

- Made Windows N-1 packaged launches bounded and evidence-based so a legacy Electron process that remains alive after reporting success cannot hang the release workflow.

## [0.1.32]

- Moved the Windows N-1 upgrade lifecycle into a dedicated PowerShell script and added hosted parser validation so syntax defects fail during the preflight gate instead of after native release packaging.

## [0.1.31]

- Forced the established BCJ executable filter for Windows ARM64 NSIS payloads so the bundled extractor restores every executable and DLL instead of silently omitting entries encoded with 7-Zip's newer ARM64 filter.
- Removed the obsolete system-7za shim because the maintained Electron Builder toolset now supplies a native, checksum-pinned Windows ARM64 binary.

## [0.1.30]

- Accepted a Windows packaged process timeout only after explicit successful packaged-launch evidence, consistently across x64 and ARM64 runners.
- Added focused Microsoft Defender detection evidence when a hosted Windows installer removes an expected executable, without disabling scanning or relaxing installation checks.
- Restored standard Windows ARM64 package compression after the stored-payload release candidate proved that archive extraction was not the cause of the missing executable.

## [0.1.29]

- Stored the Windows ARM64 NSIS application payload without the unsupported 7-Zip ARM64 executable filter so installed packages retain and launch the main executable.

## [0.1.28]

- Added separate stable and beta identities for Apple Silicon macOS, Windows ARM64/x64, and Linux ARM64/x64 packages.
- Hardened hosted macOS releases with Developer ID signing, nested Rust and Swift helper verification, notarisation, stapling, Gatekeeper assessment, checksums, provenance, and native N-1 update tests.
- Added signed macOS automatic updates and explicit Windows/Linux package downloads that verify the selected asset against the versioned release SHA-256 manifest before revealing it to the user.
- Consolidated current release validation, repository instructions, generated icon sources, and deterministic renderer, Rust, helper, package, and updater coverage while removing obsolete plans and VM machinery.
- Aligned native Windows and Linux Rust target directories with the package layout expected by hosted release runners.
- Made the verifier’s Windows x64 and ARM64 unpacked-directory contract match Electron Builder’s platform naming.
- Made Windows packaged-launch gates wait for the GUI process and inspect its explicit exit code.
- Added an exact-tag legacy updater bootstrap so adversarial checks use the current testable updater while the valid 0.1.21-to-current transition is verified against the public release.
- Made native package launch verification require explicit packaged-app success output while tolerating the Windows ARM64 runner’s post-success Electron exit timeout.
- Made adversarial macOS updater gates observe checksum rejection and verify that the trusted app survives or relaunches after signature rejection.
- Made hosted NSIS verification wait for Windows ARM64 installations and removals to settle, resolve installed files within the isolated install root, and report its contents on failure.

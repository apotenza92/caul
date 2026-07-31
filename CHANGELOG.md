# Changelog

All notable Caul changes are recorded here.

## [0.1.59]

- Served standards-compliant multipart byte ranges from the native Windows updater audit so Electron's differential downloader is exercised directly without a stalled full-package fallback.
- Carries forward the update-restart process cleanup from the unpublished 0.1.58 candidate and authenticated metadata timeout correction from the unpublished 0.1.57 candidate.

## [0.1.58] (unpublished release candidate)

- Dispose persistent Pi subprocesses before installing a downloaded update so Windows package replacement cannot be blocked by executable locks.
- Carries forward the authenticated metadata timeout correction from the unpublished 0.1.57 candidate.

## [0.1.57] (unpublished release candidate)

- Increased each authenticated update metadata fetch's bounded timeout from 15 to 60 seconds so refreshes remain reliable on slower native Windows ARM systems without weakening signature or hash verification.
- Carries forward the verified Windows differential-updater correction from the unpublished 0.1.56 candidate.

## [0.1.56] (unpublished release candidate)

- Seeded the Windows native updater audit with the exact verified prior installer and now require both previous and candidate blockmap requests before accepting a valid differential update.
- Carries forward the isolated Windows updater profile correction from the unpublished 0.1.55 candidate.

## [0.1.55] (unpublished release candidate)

- Isolated every Windows native updater scenario's roaming profile and updater cache inside its disposable audit directory so pending installers cannot leak between scenarios.
- Carries forward the Windows updater audit corrections from the unpublished 0.1.54 candidate.

## [0.1.54] (unpublished release candidate)

- Gave synthetic Windows updater packages versioned audit URLs so valid differential updates receive distinct previous and candidate blockmaps.
- Made the corrupt-payload audit serve a small truncated package so checksum rejection completes deterministically without streaming an entire damaged installer.
- Carries forward the native updater audit corrections from the unpublished 0.1.53 candidate.

## [0.1.53] (unpublished release candidate)

- Required a valid packaged-launch marker for the native updater audit's final ordinary relaunch, while accepting a bounded post-success process timeout on Linux or Windows.
- Captured the final smoke result through an explicit file so GUI-process output remains deterministic across native runners.
- Forced the Windows corrupt-payload audit to download the deliberately damaged installer and required evidence of the package request rather than accepting a blockmap request.
- Carries forward the native package smoke correction from the unpublished 0.1.52 candidate.

## [0.1.52] (unpublished release candidate)

- Accepted a bounded native package smoke timeout after the packaged app has already emitted its successful packaged-launch evidence.
- Carries forward the native updater lifecycle verifier corrections from the unpublished 0.1.51 candidate.

## [0.1.51] (unpublished release candidate)

- Served NSIS blockmaps from the native updater audit server and gave large hosted Windows update lifecycles a bounded 15-minute completion window.
- Prepared corrupt package bytes before launching the previous app so the audit timeout measures native update behaviour rather than fixture construction.
- Carries forward the Linux updater metadata correction from the unpublished 0.1.50 candidate.

## [0.1.50] (unpublished release candidate)

- Normalised Linux x64 update metadata to the published `caul-x64.AppImage` name after Electron Builder emits its architecture-native `caul-x86_64.AppImage` name.
- Made native Windows updater audits use an explicit isolated user-data directory so retained settings and TUF trust are verified at the exact path used by the packaged app.
- Carries forward the cross-channel artefact retention and native TUF audit corrections from the unpublished 0.1.49 candidate.

## [0.1.49] (unpublished release candidate)

- Preserved the already-verified stable Linux package and update-metadata set while building the beta channel in the same release job.
- Reused an unchanged, checksum-verified TUF target across repeated refreshes so Windows update downloads do not stall while replacing the same trusted metadata file.
- Made native updater audits use Electron Builder's actual x64 AppImage name and an explicit isolated NSIS installation directory.
- Carries forward the corrected RPM upgrade integration, static AppImage runtime and TUF-authenticated cross-platform updates from the unpublished 0.1.44 through 0.1.48 candidates.

## [0.1.48] (unpublished release candidate)

- Restored each installed RPM product's command link and AppArmor profile after an older package version is removed during an upgrade, while skipping replacement cleanup and retaining complete cleanup for a genuine final uninstall.
- Carries forward corrected stable and beta RPM co-installation, the static AppImage runtime and TUF-authenticated cross-platform updates from the unpublished 0.1.44 through 0.1.47 candidates.

## [0.1.47] (unpublished release candidate)

- Made Fedora desktop-integration verification inspect the complete installed RPM file list without a `pipefail` false failure when `grep` closes a large pipeline early.
- Carries forward corrected stable and beta RPM co-installation, the static AppImage runtime and TUF-authenticated cross-platform updates from the unpublished 0.1.44 through 0.1.46 candidates.

## [0.1.46] (unpublished release candidate)

- Removed RPM's global build-ID symlinks from stable and beta packages so both product variants can coexist without identical-file conflicts.
- Made the Fedora N-1 gate migrate historically conflicting packages one channel at a time before proving both corrected candidates coexist, launch, preserve their separate user data and uninstall cleanly.
- Carries forward the TUF-authenticated cross-platform updater and corrected static AppImage runtime introduced by the unpublished 0.1.44 and 0.1.45 candidates.

## [0.1.45] (unpublished release candidate)

- Replaced the legacy FUSE2 AppImage toolset with Electron Builder's checksum-pinned static runtime and corrected Linux dependency inspection to follow the actual packaged runtime graph under the launcher environment.
- Carries forward the TUF-authenticated cross-platform updater, native package gates and protected release publication introduced by the unpublished 0.1.44 candidate.

## [0.1.44] (unpublished release candidate)

- Added TUF-authenticated automatic updates for Windows NSIS and Linux AppImage packages while keeping Debian and RPM upgrades with the system package manager.
- Added native Windows and Linux release gates for authenticated update, restart, corrupt-payload and wrong-signature rejection, retained settings, credential state, project data, updater trust and Windows uninstall across ARM64 and x64.
- Added GLIBC, dependency and desktop-integration inspection for every Linux package, plus a Fedora-native RPM upgrade and uninstall gate.
- Separated offline root trust from protected online signing keys, sealed stable and beta update feeds, and independently verified every public feed byte and TUF target after publication.
- Added separate accepted notarisation evidence for the signed macOS application and its exact final distributable.
- Disclosed unsigned Windows and Linux packages on the download page and added checksum-pinned actionlint to the deterministic release checks.

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

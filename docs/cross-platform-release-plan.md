# Cross-Platform Release Plan

This is the persistent plan for getting Caul to cleanly build, package, test and release on Windows and Linux without weakening the current macOS implementation or privacy boundaries.

## Goal

Make Caul release-ready on Windows ARM64 and Linux ARM64 first, using the local Parallels VMs as the initial release gate. Windows/Linux x64 artefacts can be CI-built and published from the same platform backend, but must be described as CI-built rather than locally smoke-tested until dedicated x64 release gates exist.

## Target Matrix

- macOS: keep Apple Silicon macOS as the reference implementation and preserve the existing Swift Core Audio helper path.
- Windows: target `Windows 11 ARM` first for local smoke coverage, with Windows x64 built in CI, packaged as NSIS installers.
- Linux: target `Ubuntu 24.04.3 ARM64` first for local AppImage and `.deb` smoke coverage, with Linux x64 built in CI. Linux ARM64 is packaged as AppImage plus `.deb`; Linux x64 is packaged as AppImage, `.deb` and `.rpm`.
- Defer x64 release-smoke claims until there is dedicated x64 VM, hardware or cloud runner coverage.

## Architecture Work

- Refactor `caul-desktop-backend` so it builds cleanly on macOS, Windows and Linux. The first platform-neutral `system_audio` boundary exists, with macOS mapped through the existing helper, Windows using CPAL's WASAPI output-device loopback path, and Linux using PipeWire `pw-record` against the default sink.
- Remove unconditional backend dependencies on macOS-only crates or helper paths.
- Put system audio behind explicit platform backends:
  - macOS: Swift Core Audio helper.
  - Windows: WASAPI loopback for the default render device.
  - Linux: PipeWire sink capture for the default output, with Pulse monitor capture deferred unless PipeWire coverage proves insufficient.
- Keep microphone capture in Rust using `cpal` wherever it works reliably.
- Preserve the current sensitive-data boundary: raw audio stays in Rust/backend processes, renderer events stay typed and narrow, and provider calls remain outside capture code.
- Keep platform permission handling explicit and inspectable. Do not show macOS-only permission shortcuts or claims on Windows/Linux.

## Packaging Work

- Replace the placeholder `dist:win` and `dist:linux` scripts with real platform packaging commands. The scripts now target Windows ARM64/x64 NSIS, Linux ARM64 AppImage and `.deb`, and Linux x64 AppImage, `.deb` and `.rpm`.
- Make `electron-builder.config.cjs` platform-aware:
  - macOS bundles `caul-desktop-backend` and `CaulAudioHelper`.
  - Windows/Linux bundle `caul-desktop-backend`, ChatGPT sign-in resources, model resources and icons, but not the Swift helper.
- Ensure packaged resources resolve through app paths on each platform, not repository-relative development paths.
- Keep app names, app IDs, icons, user data paths and release artefact names distinct for stable, beta and dev builds.

## VM E2E Release Gates

Add Parallels-driven checks for the macOS, Windows and Ubuntu VMs:

- `vm:e2e:macos`: inspect `macOS Tahoe`, validate a packaged `.app`, run packaged launch/onboarding/privacy checks, and exercise packaged audio, transcription and renderer AI smoke paths.
- `vm:status:win`: inspect `Windows 11 ARM`, Parallels Tools state and guest reachability.
- `vm:status:linux`: inspect `Ubuntu 24.04.3 ARM64`, Parallels Tools state and guest reachability.
- `vm:backend-smoke:win`: run the backend system-audio smoke inside the Windows VM checkout and require capture start, audio frames and level events.
- `vm:backend-smoke:linux`: run the backend system-audio smoke inside the Ubuntu VM checkout and require capture start, audio frames and level events.
- `vm:smoke:win`: validate the Windows ARM64 NSIS installer artefact or unpacked app layout, run packaged-resource WASAPI loopback smoke, run packaged-resource microphone capture smoke, run packaged-resource local Parakeet known-WAV transcription smoke, and launch the packaged Electron app with a fresh user data directory that must render the onboarding surface, pass the pre-setup privacy gate, and complete onboarding once smoke-seeded prerequisites are ready.
- `vm:smoke:linux`: validate the Ubuntu-built `.deb`, confirm it contains the packaged backend resource, install it, play a bounded Linux audio stimulus, run packaged-resource system-audio smoke with a non-zero audio level gate, run packaged-resource microphone capture smoke, run packaged-resource local Parakeet known-WAV transcription smoke, and launch the installed Electron app with a fresh user data directory that must render the onboarding surface, pass the pre-setup privacy gate, and complete onboarding once smoke-seeded prerequisites are ready.

For each platform, packaged E2E must verify:

- Fresh packaged launch.
- Onboarding opens and can complete.
- Microphone level movement.
- Browser or meeting audio reaches the system audio path without relying on speaker bleed.
- Local transcription emits confirmed text.
- Renderer AI response emits visible text.
- Stop and restart work without relaunching the app.
- Raw audio is not written by default.
- No provider call or hidden telemetry happens before explicit setup. Privacy smokes disable update checks with `CAUL_DISABLE_UPDATE_CHECKS=1`; normal packaged builds still default to weekly GitHub-backed update checks.

The unified `vm:e2e` command runs macOS, Windows and Ubuntu Linux gates. Each gate emits a machine-parseable `caul-vm-e2e` summary and writes `artifacts/vm-e2e/<profile>.json` for passing, failing and VM-provisioning-blocked runs. `scripts/release.sh` warns when those summaries are missing or failing, and `CAUL_REQUIRE_VM_E2E=1` turns the warning into a hard release block. Linux RPM is currently published for x64 only.

The backend also has bounded `smoke:desktop-system-audio`, `vm:backend-smoke:win` and `vm:backend-smoke:linux` commands for native system-audio smoke checks before the full packaged Electron E2E is automated. The Ubuntu VM backend smoke uses PipeWire capture and a bounded audio stimulus. The Windows VM backend smoke uses WASAPI loopback for the default render endpoint and includes `--windows-audio-diagnostics` output so missing or unusable VM audio endpoints fail with actionable context.

Linux packaging builds an ARM64 AppImage with Electron Builder and an ARM64 `.deb` through native `dpkg-deb`, avoiding Electron Builder's x86 fpm helper on ARM Linux. The Ubuntu VM `vm:smoke:linux` gate validates `release/caul-arm64.deb`, checks for the packaged backend under `/opt/Caul/resources/bin/caul-desktop-backend`, installs the `.deb`, verifies packaged-resource PipeWire capture with a generated WAV played through `pw-play` and a non-zero max-level gate, verifies packaged-resource CPAL microphone capture, verifies same-process stop/restart for both system audio and microphone capture, verifies local Parakeet against a known speech WAV, drives the installed Electron renderer through the real Start listening control, confirms onboarding from a fresh user data directory, checks that pre-setup launch made no provider or telemetry requests and wrote no raw audio or transcript debug files under app `userData`, then completes onboarding with smoke-seeded ready prerequisites. Linux private overlay and handle privacy is a best-effort gate: the app must apply the shared protection path, but Electron does not expose content protection on Linux.

Windows packaging builds a reproducible ARM64 unpacked Electron app with `dist:win:dir` and an ARM64 NSIS installer with `dist:win`. Packaged resources source the bundled ChatGPT sign-in CLI directly from the installed root `node_modules/@earendil-works/pi-coding-agent` package. `vm:smoke:win` defaults to the NSIS setup executable, installs it silently in the Windows VM, verifies the installed backend under `resources\bin\caul-desktop-backend.exe`, and checks that the Windows Apps uninstall display name is product-name-only. It then records Windows audio diagnostics, plays a WASAPI or fallback render-audio stimulus, verifies packaged-resource WASAPI loopback capture with a non-zero max-level gate, verifies packaged-resource CPAL microphone capture, verifies same-process stop/restart for both system audio and microphone capture, verifies local Parakeet against a known speech WAV, drives the packaged Electron renderer through the real Start listening control, confirms onboarding from a fresh user data directory, checks pre-setup privacy, then completes onboarding with smoke-seeded ready prerequisites.

The packaged onboarding completion smoke is deliberately scoped: it seeds a selected ChatGPT model and placeholder local Moonshine Tiny model files so the final onboarding transition can be tested without downloading models or signing into ChatGPT during release smoke. It proves packaged setup-state handling, onboarding completion and post-completion window creation. Real local transcription is covered separately by the packaged Parakeet known-WAV gate.

The packaged stop/restart smoke has backend and renderer layers. The backend layer starts, stops and starts the packaged capture backend again in one process for both system audio and microphone capture. The renderer layer drives the packaged Electron listening control through Start listening, visible transcript text, Stop listening, Start listening again and final stop in one app session, with Auto Send disabled through the UI before the stop/restart sequence. The renderer AI smoke injects a confirmed transcript event through the smoke bridge and requires streamed, visible AI response text.

The packaged local transcription smoke has two layers. The direct-backend layer uses the packaged backend binary, a generated 16 kHz mono speech WAV, and the real Parakeet model directories already present in the Windows and Ubuntu VMs. Windows generates the speech fixture inside the guest with `System.Speech`; Linux uses a temporary Mac-generated 16 kHz mono WAV copied over SSH for the smoke. It requires a non-empty transcript with word overlap against the expected phrase. The renderer layer drives the packaged Electron listening control with a fresh setup-complete user data directory, disables persistent Pi for the smoke, starts through the real Start listening button, plays bounded guest audio, and requires visible local transcript text in the renderer from either final completed chunks or live partial chunks. The direct-backend layer remains the confirmed known-text proof; the renderer layer proves packaged UI wiring, button enablement, capture startup and transcript rendering.

Current VM setup state:

- Ubuntu is reachable through Parallels Tools and SSH, has a synced checkout at `/home/parallels/caul-cross-platform`, and can build latest ARM64 Linux artefacts for E2E.
- Windows is reachable through Parallels Tools and has a synced checkout at `C:\Users\alex\caul-cross-platform`; Windows audio remains a hard E2E gate and failures should include `--windows-audio-diagnostics` output.
- The macOS VM gate requires Parallels Tools, a visible guest IP and a synced packaged `.app`; release automation must report this as a provisioning blocker when those requirements are not met.

## Release Criteria

An ARM64 Windows or Linux artefact can move from `Coming soon` to a smoke-tested public download only after:

- The platform backend builds in release mode on the target VM.
- The packaged artefact installs or launches successfully.
- The packaged E2E release gate passes.
- Documentation describes the actual supported platform, architecture and package format.
- The download page links only to artefacts that have passed the gate.

## Deferred Work

- Dedicated Windows x64 and Linux x64 release-smoke gates.
- Additional Linux distributions beyond Ubuntu.
- Linux portal-based capture or Pulse monitor fallback if the PipeWire sink path proves insufficient.
- Windows installer signing and update channels beyond the first local release gate.
- Cross-platform private overlay polish beyond the minimum needed for a trustworthy packaged release.

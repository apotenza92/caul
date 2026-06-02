# Cross-Platform Release Plan

This is the persistent plan for getting Susura to cleanly build, package, test and release on Windows and Linux without weakening the current macOS implementation or privacy boundaries.

## Goal

Make Susura release-ready on Windows ARM64 and Linux ARM64 first, using the local Parallels VMs as the initial release gate. Windows/Linux x64 artefacts can be CI-built and published from the same platform backend, but must be described as CI-built rather than locally smoke-tested until dedicated x64 release gates exist.

## Target Matrix

- macOS: keep Apple Silicon macOS as the reference implementation and preserve the existing Swift Core Audio helper path.
- Windows: target `Windows 11 ARM` first for local smoke coverage, with Windows x64 built in CI, packaged as NSIS installers.
- Linux: target `Ubuntu 24.04.3 ARM64` first for local smoke coverage, with Linux x64 built in CI, packaged as AppImage plus `.deb`.
- Defer x64 release-smoke claims until there is dedicated x64 VM, hardware or cloud runner coverage.

## Architecture Work

- Refactor `susura-desktop-backend` so it builds cleanly on macOS, Windows and Linux. The first platform-neutral `system_audio` boundary exists, with macOS mapped through the existing helper, Windows using CPAL's WASAPI output-device loopback path, and Linux using PipeWire `pw-record` against the default sink.
- Remove unconditional backend dependencies on macOS-only crates or helper paths.
- Put system audio behind explicit platform backends:
  - macOS: Swift Core Audio helper.
  - Windows: WASAPI loopback for the default render device.
  - Linux: PipeWire sink capture for the default output, with Pulse monitor capture deferred unless PipeWire coverage proves insufficient.
- Keep microphone capture in Rust using `cpal` wherever it works reliably.
- Preserve the current sensitive-data boundary: raw audio stays in Rust/backend processes, renderer events stay typed and narrow, and provider calls remain outside capture code.
- Keep platform permission handling explicit and inspectable. Do not show macOS-only permission shortcuts or claims on Windows/Linux.

## Packaging Work

- Replace the placeholder `dist:win` and `dist:linux` scripts with real platform packaging commands. The scripts now target Windows ARM64/x64 NSIS and Linux ARM64/x64 AppImage plus `.deb`.
- Make `electron-builder.config.cjs` platform-aware:
  - macOS bundles `susura-desktop-backend` and `SusuraAudioHelper`.
  - Windows/Linux bundle `susura-desktop-backend`, Pi resources, model resources and icons, but not the Swift helper.
- Ensure packaged resources resolve through app paths on each platform, not repository-relative development paths.
- Keep app names, app IDs, icons, user data paths and release artefact names distinct for stable, beta and dev builds.

## VM E2E Release Gates

Add Parallels-driven checks for the Windows and Ubuntu VMs:

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
- Stop and restart work without relaunching the app.
- Raw audio is not written by default.
- No provider call or hidden telemetry happens before explicit setup.

The backend also has bounded `smoke:desktop-system-audio`, `vm:backend-smoke:win` and `vm:backend-smoke:linux` commands for native system-audio smoke checks before the full packaged Electron E2E is automated. The Ubuntu VM backend smoke currently passes with PipeWire capture started, audio frames received, level events received and non-zero system audio detected. The Windows VM backend smoke currently passes with an ARM64/MSVC backend build, a generated render-audio stimulus, WASAPI loopback capture started, audio frames received, level events received and non-zero system audio detected.

Linux packaging now builds an ARM64 AppImage with Electron Builder and an ARM64 `.deb` through native `dpkg-deb`, avoiding Electron Builder's x86 fpm helper on ARM Linux. The current Ubuntu VM `vm:smoke:linux` gate validates `release/susura-arm64.deb`, checks for the packaged backend under `/opt/Susura/resources/bin/susura-desktop-backend`, installs the `.deb`, verifies packaged-resource PipeWire capture with a generated WAV played through `pw-play` and a non-zero max-level gate, verifies packaged-resource CPAL microphone capture with frames, level events and a positive max-level gate, verifies same-process stop/restart for both system audio and microphone capture, verifies local Parakeet emits confirmed text from a known speech WAV using the real VM model directory, drives the installed Electron renderer through the real Start listening control and verifies transcript text appears in the UI, confirms the installed Electron app renders onboarding from a fresh user data directory, checks that pre-setup launch made no HTTP(S) provider or telemetry requests and wrote no raw audio or transcript debug files under app `userData`, then completes onboarding with smoke-seeded ready prerequisites and verifies the handle appears. The Linux smoke can use `SUSURA_LINUX_VM_SSH_HOST`, defaulting to `10.211.55.12`, when Parallels Tools does not report a guest IPv4 address.

Windows packaging now builds a reproducible ARM64 unpacked Electron app with `dist:win:dir` and an ARM64 NSIS installer with `dist:win`. Packaged resources now source the bundled Pi CLI directly from the installed root `node_modules/@earendil-works/pi-coding-agent` package, avoiding the duplicate `.susura/pi-bundle` install and the slow Windows VM transfer/extraction path. The Windows VM uses system 7-Zip for NSIS payload compression because Electron Builder's bundled ARM64 `7za.exe` hangs in the VM. `vm:smoke:win` validates the installer or unpacked package, checks for the packaged backend under `resources\bin\susura-desktop-backend.exe`, plays a generated render-audio stimulus, verifies packaged-resource WASAPI loopback capture with a non-zero max-level gate, verifies packaged-resource CPAL microphone capture with frames, level events and a positive max-level gate, verifies same-process stop/restart for both system audio and microphone capture, verifies local Parakeet emits confirmed text from a known speech WAV using the real VM model directory, drives the packaged Electron renderer through the real Start listening control and verifies transcript text appears in the UI, confirms the packaged Electron app renders onboarding from a fresh user data directory, checks that pre-setup launch made no HTTP(S) provider or telemetry requests and wrote no raw audio or transcript debug files under app `userData`, then completes onboarding with smoke-seeded ready prerequisites and verifies the handle appears.

The packaged onboarding completion smoke is deliberately scoped: it seeds a selected Pi model and placeholder local Moonshine Tiny model files so the final onboarding transition can be tested without downloading models or signing into ChatGPT during release smoke. It proves packaged setup-state handling, onboarding completion and post-completion window creation. Real local transcription is covered separately by the packaged Parakeet known-WAV gate.

The packaged stop/restart smoke has backend and renderer layers. The backend layer starts, stops and starts the packaged capture backend again in one process for both system audio and microphone capture. The renderer layer drives the packaged Electron listening control through Start listening, visible transcript text, Stop listening, Start listening again and final stop in one app session, with Auto Send disabled through the UI before the stop/restart sequence.

The packaged local transcription smoke has two layers. The direct-backend layer uses the packaged backend binary, a generated 16 kHz mono speech WAV, and the real Parakeet model directories already present in the Windows and Ubuntu VMs. Windows generates the speech fixture inside the guest with `System.Speech`; Linux uses a temporary Mac-generated 16 kHz mono WAV copied over SSH for the smoke. It requires a non-empty transcript with word overlap against the expected phrase. The renderer layer drives the packaged Electron listening control with a fresh setup-complete user data directory, disables persistent Pi for the smoke, starts through the real Start listening button, plays bounded guest audio, and requires visible local transcript text in the renderer from either final completed chunks or live partial chunks. The direct-backend layer remains the confirmed known-text proof; the renderer layer proves packaged UI wiring, button enablement, capture startup and transcript rendering.

Current VM setup state:

- Ubuntu is reachable through Parallels Tools and SSH, has a synced checkout at `/home/parallels/susura-cross-platform`, and passes `vm:backend-smoke:linux` plus the full packaged `vm:smoke:linux` gate.
- Linux backend build scripts resolve Cargo and Rustc from `~/.cargo/bin` when the non-interactive VM shell does not load Rustup onto `PATH`, so packaging remains repeatable after VM restart.
- Windows is reachable through Parallels Tools, has a synced checkout at `C:\Users\alex\susura-cross-platform`, Node/Git, native rustup `stable-aarch64-pc-windows-msvc`, and passes `vm:backend-smoke:win` plus the full packaged `vm:smoke:win` gate against `dist:win:dir`.

Latest release-smoke evidence:

- Windows `vm:smoke:win`: system audio `290` frames, `291` level events, max level `0.261332`; system audio restart `178` frames then `200` frames; microphone `294` frames, `294` level events, max level `0.006711`; microphone restart `197` frames then `197` frames; local transcription overlap `1.00`, transcript `Susura release transcription smoke. Local transcription emits confirmed text`; renderer transcription overlap `1.00` through the real Start listening button with visible transcript text and same-session UI stop/restart; packaged launch surface `onboarding`; pre-setup privacy `ok`; onboarding completion `ok (handle shown)`.
- Linux `vm:smoke:linux`: system audio `135` frames, `136` level events, max level `0.016419`; system audio restart `93` frames then `91` frames; microphone `208` frames, `208` level events, max level `0.003157`; microphone restart `137` frames then `139` frames; local transcription overlap `0.88`, transcript `Sejura release transcription smoke. Local transcription emits confirmed text.`; renderer transcription passed through the real Start listening button with visible live transcript text and same-session UI stop/restart; packaged launch surface `onboarding`; pre-setup privacy `ok`; onboarding completion `ok (handle shown)`.
- Windows `dist:win`: current ARM64 NSIS installer build completed and produced `release\Susura-windows-arm64-setup.exe` plus `release\Susura-windows-arm64-setup.exe.blockmap`.
- Download page: `docs/index.html` now exposes stable and beta Windows ARM64/x64, Linux ARM64/x64 AppImage and Ubuntu/Linux ARM64/x64 `.deb` links. ARM64 links use the artefact names that passed local release smoke; x64 links use CI-built artefacts from the same backend and are labelled with that caveat. `docs/README.md` documents the supported public download matrix.

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

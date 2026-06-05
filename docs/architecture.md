# Architecture

Caul should be a single monorepo with strict internal boundaries. The architecture should make sensitive behaviour easy to inspect and make it possible for contributors to work in one area without understanding the whole app.

## Current Shape

- `desktop-ui`: Electron renderer, onboarding, overlay and settings.
- `desktop-backend`: Rust process boundary for desktop capture commands and normalised events.
- `capture`: Platform capture implementations behind the Rust backend system-audio boundary. macOS uses the Swift Core Audio Process Tap helper, Windows uses WASAPI loopback through CPAL, and Linux uses PipeWire `pw-record` against the default sink, with Pulse monitor fallback deferred.
- `audio-core`: Audio frame types, levels, buffering and resampling.
- `session-core`: Session lifecycle, start, stop, pause, resume and current state.
- `ai-core`: Transcription, answer generation and provider orchestration later.

Current repository foundations:

- `src` and `electron`: React and Electron desktop surface. This is the primary desktop UI while Rust owns the sensitive backend boundary.
- `crates/desktop-backend`: Rust backend binary spawned by Electron for platform-gated system audio capture and local transcription event streaming.
- `crates/desktop-ui`: Dioxus Native experiment kept as a reference while renderer quality and native defaults are evaluated, not the current primary desktop surface.
- `crates/macos-capture`: Rust process wrapper and typed event parser for the macOS audio helper.
- `crates/audio-core`: Rust audio frame, source and level types.
- `crates/session-core`: Rust session state and event types.
- `native/macos-audio-helper`: Swift helper for macOS Core Audio Tap probing and lower-level reference work.

Future modules should preserve the same boundaries in crate, package or directory names.

## Current Technical Choices

- Use Electron and React for the desktop UI so the visible controls can use shadcn/ui defaults with browser-grade text and shape rendering.
- Support Apple Silicon Macs, Windows ARM64/x64 and Ubuntu/Linux ARM64/x64 for the current product line. Intel macOS builds should not be produced or advertised. ARM64 Windows/Linux has local VM release-smoke coverage; x64 Windows/Linux is CI-built from the same platform backend until dedicated x64 release-smoke coverage exists.
- Use three primary Electron window shapes for the packaged desktop runtime: a normal centred onboarding window for first-run setup, the full app as a protected Dockless private overlay, and an always-available floating handle. The handle uses explicit renderer surface routing, while the full app overlay loads the normal app route, stays capture-protected where supported in non-development builds, adapts its controls around the live handle edge, and avoids polling-based screen-share detection or process identity disguise. The source `npm run dev` loop deliberately avoids private window behaviour, content protection and accessory activation so contributors can capture screenshots and mark up UI issues. Local release-shape privacy checks use the separate `Caul Dev-Private.app` package identity so the private packaged behaviour can be tested before pushing without changing or colliding with the normal development loop. That local private-dev target applies screenshot protection to all app windows, including onboarding, so accidental capture is easier to catch during manual testing.
- Use Rust as the durable backend for capture process control, typed event normalisation, processing, session state, provider calls and cross-platform abstractions. Platform-specific system-audio code should sit behind a Rust boundary before Electron sees capture events.
- Treat Electron resource use as a measured budget, not an assumption. The idle production app should stay below the current `npm run smoke:resources` working-set budget and avoid renderer polling and animations.
- Keep the Dioxus Native scaffold pinned to the current evaluation line only while it remains useful for comparison. It is not the primary renderer after the May 2026 Electron pivot.
- Use the small Swift helper as the first macOS system audio route because it keeps the sensitive Core Audio Process Tap boundary inspectable and avoids coupling capture to screen enumeration.
- Prefer local transcription on every platform. First-run onboarding profiles CPU, memory and architecture, then recommends Parakeet v3 for stronger machines or Moonshine tiny streaming for lighter machines. Both models live under app `userData` and are downloaded by the onboarding or Settings flow, not from a global model cache.
- Warm the selected local transcription model in a Rust backend daemon after Electron starts only when the required local model files are already present. The daemon also hot-prepares selected microphone and system-audio streams before Start listening, but drops all frames while idle and must not emit transcript chunks or provider requests until listening is active.
- Keep the current local transcription path optimised for live-call latency. The app captures selected sources natively, keeps system audio at its native capture rate until it reaches Rust, resamples once to 16 kHz mono with `rubato`, closes utterances with an isolated Rust endpoint detector, and transcribes completed utterances with the recommended local model.
- Keep the Swift helper limited to macOS system audio capture. It should emit PCM frames and capture events; Rust owns microphone capture, buffering and local ASR orchestration.
- Do not use Electron `desktopCapturer` or browser `getDisplayMedia` as a fallback for system audio. The app route should use the platform backend behind Rust: Swift Core Audio Tap on macOS, WASAPI loopback on Windows and PipeWire sink capture on Linux.
- Use typed contracts between the capture helper, Rust core and desktop UI.
- Route Electron transcription commands through the Rust desktop backend, which starts and stops selected microphone and system sources, emits plain final transcript chunks, and keeps raw audio out of the renderer.
- Support one local listening mode. Caul transcribes selected sources until the user stops listening. AI submission is optional and must require explicit setup through the onboarding or Settings flow in packaged builds, rather than silently using local Pi, Codex, browser or subscription logins.
- Bundle Pi only after its package licence has been verified locally during packaging. Pi must run with Caul-owned configuration under the app `userData` directory and must never read or modify global `~/.pi/agent` state. ChatGPT sign-in should open in the user's default browser and return through Pi's local callback server, rather than using a separate Electron auth window.
- Keep LLM dispatch out of capture code. Manual stop-to-LLM requests are owned by the Electron bridge, not by the Rust audio and ASR pipeline. Auto mode and Smart Turn were removed because the automatic turn detection path was not reliable enough for the current product.
- Store prompt template attachments as explicit local file references chosen by the user. Development-only Pi bridge attachments are passed through by the one-shot Pi file-argument path because the current persistent RPC path only accepts text prompts. Caul should not parse or convert document attachments itself unless the provider path proves insufficient.
- Prefer helper-process IPC first. `napi-rs` should remain a migration reference unless process IPC proves inadequate.

## Boundary Rules

- Capture code should not own AI provider logic.
- UI code should not parse raw audio frames.
- Provider code should not know about platform permission details.
- Rust should expose stable events and commands rather than shared global state.
- Swift should stay limited to Apple API integration and hand normalised audio data to Rust.

## Extensibility

Do not add plugin architecture yet. The current goal is a stable inspected desktop assistant across the supported ARM64 platforms, with macOS as the reference path and Windows/Linux release gates proving the equivalent package behaviour. Add extension points only after repeated real implementations prove the shape.

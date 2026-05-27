# Architecture

Susura should be a single monorepo with strict internal boundaries. The architecture should make sensitive behaviour easy to inspect and make it possible for contributors to work in one area without understanding the whole app.

## Current Shape

- `desktop-ui`: Electron renderer, onboarding, overlay and settings.
- `desktop-backend`: Rust process boundary for desktop capture commands and normalised events.
- `capture`: Platform capture implementations, starting with macOS system audio through a Swift Core Audio Process Tap helper.
- `audio-core`: Audio frame types, levels, buffering and resampling.
- `session-core`: Session lifecycle, start, stop, pause, resume and current state.
- `ai-core`: Transcription, answer generation and provider orchestration later.

Current repository foundations:

- `src` and `electron`: React and Electron desktop surface. This is the primary desktop UI while Rust owns the sensitive backend boundary.
- `crates/desktop-backend`: Rust backend binary spawned by Electron for system audio capture and local transcription event streaming.
- `crates/desktop-ui`: Dioxus Native experiment kept as a reference while renderer quality and native defaults are evaluated, not the current primary desktop surface.
- `crates/macos-capture`: Rust process wrapper and typed event parser for the macOS audio helper.
- `crates/audio-core`: Rust audio frame, source and level types.
- `crates/session-core`: Rust session state and event types.
- `native/macos-audio-helper`: Swift helper for macOS Core Audio Tap probing and lower-level reference work.

Future modules should preserve the same boundaries in crate, package or directory names.

## Current Technical Choices

- Use Electron and React for the desktop UI so the visible controls can use shadcn/ui defaults with browser-grade text and shape rendering.
- Use two primary Electron windows for the desktop runtime: the full app as a protected, Dockless private overlay and an always-available floating handle. The handle uses explicit renderer surface routing, while the full app overlay loads the normal app route, stays capture-protected where supported, adapts its controls around the live handle edge, and avoids polling-based screen-share detection or process identity disguise.
- Use Rust as the durable backend for capture process control, typed event normalisation, processing, session state, provider calls and cross-platform abstractions.
- Treat Electron resource use as a measured budget, not an assumption. The idle production app should stay below the current `npm run smoke:resources` working-set budget and avoid renderer polling and animations.
- Keep the Dioxus Native scaffold pinned to the current evaluation line only while it remains useful for comparison. It is not the primary renderer after the May 2026 Electron pivot.
- Use the small Swift helper as the first macOS system audio route because it keeps the sensitive Core Audio Process Tap boundary inspectable and avoids coupling capture to screen enumeration.
- Use local Parakeet TDT v3 through Rust `transcribe-rs` as the default no-API-key transcription path while keeping transcription events narrow and easy to replace.
- Warm Parakeet in a Rust backend daemon after Electron starts so the first listening action does not pay model-load latency. The daemon also hot-prepares selected microphone and system-audio streams before Start listening, but drops all frames while idle and must not emit transcript chunks or provider requests until listening is active.
- Keep the current local transcription path optimised for live-call latency. The app captures selected sources natively, keeps system audio at its native capture rate until it reaches Rust, resamples once to 16 kHz mono with `rubato`, closes utterances with an isolated Rust endpoint detector, and transcribes completed utterances with Parakeet.
- Keep the Swift helper limited to macOS system audio capture. It should emit PCM frames and capture events; Rust owns microphone capture, buffering and local ASR orchestration.
- Do not use Electron `desktopCapturer` or browser `getDisplayMedia` as a fallback for system audio. The app route should use the Swift Core Audio Tap helper only.
- Use typed contracts between the capture helper, Rust core and desktop UI.
- Route Electron transcription commands through the Rust desktop backend, which starts and stops selected microphone and system sources, emits plain final transcript chunks, and keeps raw audio out of the renderer.
- Support one local listening mode. Susura transcribes selected sources until the user stops listening, then sends the visible transcript to the configured subscription LLM bridge when text exists.
- Keep LLM dispatch out of capture code. Manual stop-to-LLM requests are owned by the Electron bridge, not by the Rust audio and ASR pipeline. Auto mode and Smart Turn were removed because the automatic turn detection path was not reliable enough for the current product.
- Store prompt template attachments as explicit local file references chosen by the user. Attachments are passed through to the model provider by the one-shot Pi file-argument path because the current persistent RPC path only accepts text prompts. Susura should not parse or convert document attachments itself unless the provider path proves insufficient.
- Prefer helper-process IPC first. `napi-rs` should remain a migration reference unless process IPC proves inadequate.

## Boundary Rules

- Capture code should not own AI provider logic.
- UI code should not parse raw audio frames.
- Provider code should not know about platform permission details.
- Rust should expose stable events and commands rather than shared global state.
- Swift should stay limited to Apple API integration and hand normalised audio data to Rust.

## Extensibility

Do not add plugin architecture yet. The first goal is a stable macOS capture and overlay workflow. Add extension points only after repeated real implementations prove the shape.

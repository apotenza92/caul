# macOS Audio

Caul supports microphone and system-audio capture on Apple Silicon macOS 14 and later.

## Product Route

- ScreenCaptureKit is the normal system-audio backend. Microphone capture is disabled in the ScreenCaptureKit stream where the operating system exposes that control.
- Core Audio Process Tap remains an explicit diagnostic backend selected with `CAUL_MACOS_SYSTEM_AUDIO_BACKEND=core-audio`.
- Electron `desktopCapturer` and browser `getDisplayMedia` are not fallbacks for system audio.
- Microphone and system audio remain separate selected sources.
- Raw audio is not saved by default.

## Ownership

The Swift helper owns Apple framework integration, permission-facing capture setup, sample-buffer conversion and capture-level events. It emits a documented stream to Rust.

Rust owns capture process control, frame buffering, resampling to 16 kHz mono, endpointing, local transcription, session state and normalised errors and events. The renderer receives typed state, levels and transcript events, not raw audio.

## Permissions

System-audio capture must surface macOS Screen and System Audio Recording permission failures clearly. Microphone capture must surface microphone permission failures separately. Denial recovery must not require reinstalling the app.

Do not reset TCC permissions during ordinary development. Use the packaged development identity and its explicit reset option only when deliberately retesting first-run permission prompts.

## Verification

Use the narrowest applicable command:

- `npm run macos-audio:build`: build and ad-hoc sign the Swift helper.
- `npm run macos-audio:capabilities`: inspect helper capabilities.
- `npm run macos-audio:sck-stream-smoke`: exercise the ScreenCaptureKit stream directly.
- `npm run macos-audio:tap-smoke`: exercise Core Audio Process Tap diagnostics.
- `npm run smoke:desktop-system-audio`: exercise the Rust backend system-audio boundary.
- `npm run smoke:browser-system-audio`: exercise bounded browser stimulus through the normal helper route.
- `npm run smoke:local-parakeet-browser-system-audio`: exercise capture through local transcription.

When capture code changes, the packaged macOS gate must cover fresh setup, permission denial and recovery, microphone and system-audio level movement, source isolation, local transcription, clean stop and restart, and the privacy checks described in `release-validation.md`.

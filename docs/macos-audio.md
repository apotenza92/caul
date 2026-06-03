# macOS Audio

The immediate implementation target is Apple Silicon macOS 15+ microphone plus system audio capture. The local development machine is macOS 26.5 on Apple Silicon with Xcode 26.5, so modern Core Audio Process Tap APIs are available for development.

## Capture Direction

- Use the Swift Core Audio helper as the first app route for system audio.
- Prefer Apple's modern Core Audio Process Tap path: `CATapDescription`, `AudioHardwareCreateProcessTap`, a private aggregate device with `kAudioAggregateDeviceTapListKey`, then `AudioDeviceCreateIOProcIDWithBlock`.
- Use the direct Core Audio Tap backend as the only app route now that System Audio Recording permission has been granted locally.
- Keep the helper's ScreenCaptureKit backend only as an explicit development probe while the team compares platform behaviour. Do not wire it into the app as a fallback.
- Do not use Electron `desktopCapturer` or browser `getDisplayMedia` as a system audio fallback.
- Capture microphone audio and system audio as separate streams where possible.
- Use a small Swift helper for Apple framework integration.
- Stream normalised PCM frames and level events into the Rust core at the capture rate. Rust owns resampling, fixed-duration batching and local transcription.
- Do not save raw audio by default.

## Swift And Rust Boundary

For the first app route, the Swift helper should own:

- `CATapDescription`, `AudioHardwareCreateProcessTap` and tap-backed aggregate device setup.
- macOS System Audio Recording permission experiments and direct HAL diagnostics.
- Conversion from Apple sample buffers into a documented PCM format.
- Per-stream level measurement when it is cheaper to calculate near capture.

The Rust core should own:

- Frame buffering.
- Resampling to 16 kHz mono with `rubato`.
- Session state.
- Error and event routing.
- Local Parakeet transcription and future provider orchestration.

## Expected Events

- `mic_level`
- `system_level`
- `audio_frame`
- `transcription_completed`
- `daemon_state`
- `capture_stage`
- `tap_ready`
- `permission_error`
- `capture_error`
- `capture_started`
- `capture_stopped`

Names can change during implementation, but the contract should stay typed and narrow.

## Smoke Tests

- Start capture with no permissions granted and receive clear permission errors.
- Grant microphone permission and verify mic levels move.
- Grant System Audio Recording permission and verify system levels move.
- Play browser or meeting audio and confirm it appears on the system stream without relying on speaker bleed.
- Capture mic and system audio simultaneously.
- Stop capture and confirm streams release cleanly.
- Restart capture without relaunching the app.
- Run a 30-minute capture session and check for dropped frames, memory growth and stuck streams.

## Current Helper

The repository includes a Swift package at `native/macos-audio-helper`. It is intentionally small and speaks JSON lines so Electron can spawn it during development and Rust can own the durable buffering contract later.

Useful commands:

- `npm run macos-audio:capabilities`
- `npm run macos-audio:tap-smoke`
- `npm run macos-audio:stream-smoke`
- `npm run smoke:core-audio-browser-system-audio`
- `npm run smoke:local-parakeet-helper-system-audio`
- `npm run smoke:local-parakeet-browser-system-audio`
- `npm run smoke:sck-browser-system-audio`

Current local findings:

- Direct helper tap setup succeeds: default output lookup, process tap creation, aggregate creation, tap format lookup, IO callback creation and aggregate-device start all complete.
- Direct Core Audio helper streaming starts successfully after granting System Audio Recording permission to the responsible app.
- Local browser audio detection has been verified through `npm run smoke:core-audio-browser-system-audio`: Chrome tone playback produced non-zero Core Audio Tap system audio levels.
- The source Electron development app is locally signed with `electron/SusuraDevElectron.entitlements` before app-level Core Audio capture can be tested. The packaged `Susura Dev.app` should use a stable Apple Development signing identity so macOS TCC permissions stay attached to a predictable app identity across rebuilds.
- The ScreenCaptureKit helper backend starts successfully on the local machine and can detect browser audio when the output route is MacBook Pro Speakers.
- The current default output route is a Scarlett 2i2 USB interface. The ScreenCaptureKit backend returned silent buffers on that route during local smoke tests.
- The app route is intentionally Core Audio only. ScreenCaptureKit remains available through direct helper smoke commands for comparison testing, not product behaviour.
- The browser audio verification command is `npm run smoke:browser-system-audio`. It launches a temporary Chrome profile that plays a tone and fails unless the Susura smoke output reports `"detected":true`.
- The direct Core Audio helper browser verification command is `npm run smoke:core-audio-browser-system-audio`.
- The direct ScreenCaptureKit helper browser verification command is `npm run smoke:sck-browser-system-audio`.
- Local browser audio detection has been verified through `npm run smoke:sck-browser-system-audio`: Chrome tone playback produced non-zero ScreenCaptureKit system audio levels.
- Local app transcription now uses the Rust backend: microphone capture through `cpal`, system audio PCM from the Swift helper, single-pass Rust resampling, endpointed utterances and Parakeet TDT v3 through `transcribe-rs`.
- Stopping local listening must flush pending audio, destroy the Core Audio tap and release capture resources.
- The direct helper route has been verified locally with `npm run smoke:local-parakeet-helper-system-audio`: Core Audio starts, local Parakeet streaming starts, and confirmed transcript events are emitted.
- The Electron app route should be verified with `npm run smoke:local-parakeet-browser-system-audio`: Electron starts native local transcription, Chrome plays public-domain spoken media, and the renderer bridge receives confirmed local Parakeet transcript events.

The Core Audio helper needs:

- A host app or helper identity with `NSAudioCaptureUsageDescription`.
- The audio input entitlement for sandboxed or hardened app builds.
- System Audio Recording permission from macOS before readable system samples can be expected.

# macOS Audio

The immediate implementation target is Apple Silicon macOS 15+ microphone plus system audio capture. The local development machine is macOS 26.5 on Apple Silicon with Xcode 26.5, so modern Core Audio Process Tap APIs are available for development.

## Capture Direction

- Use the Swift ScreenCaptureKit audio helper as the app route for system audio on macOS, with microphone capture disabled where macOS exposes `captureMicrophone = false`.
- Keep Apple's modern Core Audio Process Tap path available as an explicit diagnostic backend: `CATapDescription`, `AudioHardwareCreateProcessTap`, a private aggregate device with `kAudioAggregateDeviceTapListKey`, then `AudioDeviceCreateIOProcIDWithBlock`.
- Use `CAUL_MACOS_SYSTEM_AUDIO_BACKEND=core-audio` only for diagnostic comparison or regression testing.
- Do not use Electron `desktopCapturer` or browser `getDisplayMedia` as a system audio fallback.
- Capture microphone audio and system audio as separate streams where possible.
- Treat audio interfaces that are both the default input and output as privacy-sensitive during diagnostics. Do not assume microphone bleed from the shared device name alone.
- Use a small Swift helper for Apple framework integration.
- Stream normalised PCM frames and level events into the Rust core at the capture rate. Rust owns resampling, fixed-duration batching and local transcription.
- Do not save raw audio by default.

## Swift And Rust Boundary

For the first app route, the Swift helper should own:

- ScreenCaptureKit system-audio capture with microphone capture disabled.
- `CATapDescription`, `AudioHardwareCreateProcessTap` and tap-backed aggregate device setup for diagnostics.
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
- `npm run diagnose:macos-audio-route`

Current local findings:

- Direct helper tap setup succeeds: default output lookup, process tap creation, aggregate creation, tap format lookup, IO callback creation and aggregate-device start all complete.
- Direct Core Audio helper streaming starts successfully after granting System Audio Recording permission to the responsible app.
- Local browser audio detection has been verified through `npm run smoke:core-audio-browser-system-audio`: Chrome tone playback produced non-zero Core Audio Tap system audio levels.
- The source Electron development app is locally signed with `electron/CaulDevElectron.entitlements` before app-level Core Audio capture can be tested. The packaged `Caul Dev.app` should use a stable Apple Development signing identity so macOS TCC permissions stay attached to a predictable app identity across rebuilds.
- The ScreenCaptureKit helper backend starts successfully on the local machine and can detect browser audio when the output route is MacBook Pro Speakers.
- The current default output route is a Scarlett 2i2 USB interface. The ScreenCaptureKit backend returned silent buffers on that route during local smoke tests.
- The app route uses ScreenCaptureKit because the packaged Core Audio route can receive microphone speech as `system` audio on the Scarlett route, even when Input is off.
- When a USB audio interface such as Scarlett 2i2 is both default input and default output, verify the route with the dev diagnostic before changing product behaviour. The local Scarlett diagnostic showed mic-only speech did not appear in ScreenCaptureKit output capture, while speaker playback did.
- The browser audio verification command is `npm run smoke:browser-system-audio`. It launches a temporary Chrome profile that plays a tone and fails unless the Caul smoke output reports `"detected":true`.
- The direct Core Audio helper browser verification command is `npm run smoke:core-audio-browser-system-audio`.
- The direct ScreenCaptureKit helper browser verification command is `npm run smoke:sck-browser-system-audio`.
- Local browser audio detection has been verified through `npm run smoke:sck-browser-system-audio`: Chrome tone playback produced non-zero ScreenCaptureKit system audio levels.
- Local app transcription now uses the Rust backend: microphone capture through `cpal`, system audio PCM from the Swift helper, single-pass Rust resampling, endpointed utterances and Parakeet TDT v3 through `transcribe-rs`. The daemon warms Parakeet while idle, but does not open Core Audio capture until listening starts.
- Stopping local listening must flush pending audio, destroy the Core Audio tap and release capture resources.
- The direct helper route has been verified locally with `npm run smoke:local-parakeet-helper-system-audio`: Core Audio starts, local Parakeet streaming starts, and confirmed transcript events are emitted.
- The Electron app route should be verified with `npm run smoke:local-parakeet-browser-system-audio`: Electron starts native local transcription, Chrome plays public-domain spoken media, and the renderer bridge receives confirmed local Parakeet transcript events.

Scarlett route diagnostic:

- Run `npm run diagnose:macos-audio-route` with Scarlett selected as both default input and default output, then run it again with Scarlett as input and MacBook Pro Speakers as output.
- To switch the output route from the command line for the second run, use `CAUL_AUDIO_ROUTE_DIAGNOSTIC_OUTPUT_UID=BuiltInSpeakerDevice CAUL_AUDIO_ROUTE_DIAGNOSTIC_RESTORE_OUTPUT=1 npm run diagnose:macos-audio-route`.
- The diagnostic does not launch Caul. It runs the Swift helper directly against both the Core Audio Process Tap backend and the ScreenCaptureKit backend, with `captureMicrophone = false` on macOS versions that expose it.
- Each run records the active default input and output from `system_profiler SPAudioDataType -json`, whether frames arrived, peak and RMS levels during silence, mic-only speech and known speaker playback, and whether local Parakeet emitted transcript text.
- Treat transcript text or meaningful levels during the mic-only phase as evidence that the output route is contaminated by microphone audio. If ScreenCaptureKit stays clean during mic-only speech and captures speaker playback, prefer it over Core Audio for the product route.

The Core Audio helper needs:

- A host app or helper identity with `NSAudioCaptureUsageDescription`.
- The audio input entitlement for sandboxed or hardened app builds.
- System Audio Recording permission from macOS before readable system samples can be expected.

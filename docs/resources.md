# Resources

Prefer maintained platform APIs and open-source projects with clear licences. Use these resources as references before writing bespoke implementations.

## Platform Documentation

- Apple Core Audio taps sample, capturing system audio with Core Audio taps: https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps
- Apple `AudioHardwareCreateProcessTap`: https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/ScreenCaptureKit
- Apple ScreenCaptureKit sample, capturing screen content in macOS: https://developer.apple.com/documentation/screencapturekit/capturing_screen_content_in_macos

## macOS Capture References

- `AudioTee`: https://github.com/makeusabrew/audiotee
- `systemAudioDump`: https://github.com/sohzm/systemAudioDump
- `BetterCapture`: https://github.com/jsattler/BetterCapture
- `macparakeet`: https://github.com/moona3k/macparakeet
- `AudioCap`: https://github.com/insidegui/AudioCap
- `FluidAudio`: https://github.com/FluidInference/FluidAudio

Use these projects to understand capture patterns, permission behaviour and practical edge cases. Do not copy code unless the licence is compatible and the copied surface is intentionally documented.

## Local Transcription

- Prefer local Parakeet TDT v3 through Rust `transcribe-rs` for the app ASR path.
- Auto mode and Smart Turn are intentionally removed for now because automatic turn completion was not reliable enough for the current product.
- Use Handy as an architectural reference for capture, segmentation and batch transcription when those behaviours are reintroduced, but do not vendor Handy code.
- Treat TypeWhisper as a research reference only unless a specific approach is intentionally reintroduced. TypeWhisper is GPL/commercial, so do not vendor its implementation.
- Keep the helper boundary explicit: the Swift helper may run Apple-framework capture code, while Rust owns microphone capture, buffering, model loading and transcript events.
- Treat transcript quality as a tuning surface. Do not build product claims around local ASR quality until chunking, segmentation behaviour and model selection have real test coverage.

## Rust And Desktop Libraries

- `Dioxus Native`: Native Rust UI renderer for the desktop shell.
- `cpal`: Cross-platform audio I/O for future device abstraction.
- `transcribe-rs`: Local Parakeet transcription.
- `rubato`: Audio sample-rate conversion. Prefer this over bespoke interpolation before ASR.
- `rtrb`: Realtime-safe single-producer single-consumer ring buffers.
- `serde`: Typed serialisation and deserialisation.
- `tokio`: Async runtime for Rust services and orchestration.
- `bytes`: Efficient byte buffers for frame transport.
- `interprocess`: Local sockets and IPC when a helper-process boundary is useful.
- `napi-rs`: Rust to Node bindings only if legacy Electron migration needs direct native integration.

## Selection Rules

- Prefer active projects with clear maintenance signals.
- Prefer permissive licences that fit Caul's intended licence.
- Prefer small dependency surfaces for sensitive capture and storage code.
- Avoid copying competitor implementations when a platform API or focused library can provide the same foundation.

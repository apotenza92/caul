# Architecture

Caul is a single Electron, React and Rust monorepo with explicit boundaries around privacy-sensitive behaviour.

## Current Shape

- `src` and `electron`: React renderer, onboarding, overlay, settings, Electron lifecycle and typed preload bridge.
- `crates/desktop-backend`: Rust process spawned by Electron for capture control, event normalisation and local transcription.
- `crates/audio-core`: shared Rust audio frame, source and level types.
- `crates/macos-capture`: Rust wrapper and typed event parser for the macOS helper.
- `native/macos-audio-helper`: Swift integration with ScreenCaptureKit and diagnostic Core Audio Process Tap APIs.

Electron and React own visible application behaviour. Rust owns capture process control, buffering, resampling, local transcription and stable cross-platform commands and events. Swift is restricted to Apple API integration and emits documented audio and capture events to Rust.

## Current Technical Choices

- Use the repository's shadcn/ui components, CSS variables and Lucide icons for visible controls. Extend local primitives instead of adding a second component system.
- Support Apple Silicon macOS, Windows ARM64/x64 and Linux ARM64/x64 in the current package matrix. Intel macOS is not supported.
- Maintain stable and beta as separate products. Their bundle or application IDs, install paths, package names, `userData` directories and updater channels must not converge.
- Authenticate Windows NSIS and Linux AppImage automatic updates with TUF before handing metadata to Electron Updater. Keep the root key offline, protect the three online role keys separately, and retain advanced root trust in the product's existing `userData` directory. Debian and RPM upgrades remain owned by the system package manager.
- Use ScreenCaptureKit for product system-audio capture on macOS. Keep Core Audio Process Tap available only for explicit diagnostics and comparison.
- Use WASAPI loopback through CPAL on Windows and PipeWire sink capture on Linux.
- Keep microphone and system audio as independently selected sources.
- Keep raw audio out of the renderer. The backend emits typed levels, state and transcript events.
- Resample captured audio once in Rust to the transcription format. Bound every inference job so long listening sessions cannot create unbounded model input.
- Keep confirmed transcript chunks as the persistence, export, history and AI-submission contract. Provisional transcript tails are display-only and may never replace confirmed text.
- Store user-visible portable history and settings under `Documents/Caul`. Keep secrets, models, runtime caches and private window state in Electron `userData`.
- Do not silently reuse global provider state. Provider setup must be explicit, and cloud requests must respect the chosen provider and privacy boundary.
- Subscription sign-in remains the preferred cloud setup path. First-party OpenAI, Anthropic, Google and xAI API keys may be configured explicitly when operating-system credential encryption is available. Electron encrypts these keys at rest, never returns them to the renderer, and injects only the selected provider's key into the Pi child process.
- Keep LLM dispatch out of capture code. Electron owns explicit transcript-to-provider requests.
- Treat resource use as a measured budget and avoid renderer polling where event-driven state is available.

## Boundary Rules

- Capture code does not own provider logic.
- UI code does not parse raw audio frames.
- Provider code does not know platform permission details.
- Rust exposes stable commands and events instead of shared global state.
- Swift remains limited to Apple framework integration.
- No plugin architecture is added until repeated, proven implementations establish a stable extension boundary.

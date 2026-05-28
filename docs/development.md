# Development

Susura is currently using an Electron and React desktop shell with shadcn/ui defaults, Rust workspace crates and a small Swift macOS audio helper. The immediate product target is a basic setup UI, followed by reliable Apple Silicon macOS 15+ microphone plus system audio capture.

The Electron renderer currently owns onboarding, settings, audio source selection, transcript display and optional stop-to-LLM submission. It starts local transcription through `crates/desktop-backend`, which captures microphone audio with `cpal`, captures system audio through `crates/macos-capture` and the Swift helper, resamples to 16 kHz mono in Rust with `rubato`, closes utterances with Rust endpointing, and transcribes completed utterances with local Parakeet. Susura is manual-only for now: the user starts listening, watches live and final transcript text, then stops listening. Packaged builds must not auto-use a local Pi, Codex, browser or subscription login. Users must complete the onboarding or Settings setup flow, and Pi must run with Susura-owned configuration under app `userData`, not global `~/.pi/agent` state.

The Dioxus Native crate remains in the tree as an experiment and comparison target, but it is not the primary desktop surface. The app route no longer uses browser media APIs for local microphone transcription. Electron starts the Rust backend through the main process, and the Rust backend streams JSON-line events back to Electron.

Electron starts a warm Rust local transcription daemon while the app is idle only after the Parakeet model has been explicitly installed into the app models directory. The daemon loads Parakeet ahead of the first listening action and hot-prepares the selected audio sources. Hot prepare means microphone and system-audio streams may be opened before the user clicks Start listening, but Rust drops all frames until listening is active and emits no transcript or LLM request while idle. This is an explicit latency tradeoff for a live-call assistant. Auto mode and Smart Turn were removed because the automatic turn detection path was not reliable enough for the current product.

First-run setup is owned by a dedicated onboarding window. It checks microphone and Screen and System Audio Recording readiness, manages explicit Parakeet download, and opens Pi login/model setup with the isolated Susura Pi configuration. Completion is stored in app `userData`, but app start always re-checks real readiness so deleted models or disconnected Pi setup reopen onboarding.

Speculative LLM dispatch is available for benchmark and development behind `VITE_SUSURA_SPECULATIVE_LLM=1`. When enabled, confirmed stable transcript text may start a hidden LLM request while listening. The stream is revealed on Stop listening only if the visible transcript still matches the speculative request.

Transcript pipeline logging is available for debugging Parakeet output versus renderer assembly. Launch with both `SUSURA_TRANSCRIPT_DEBUG_LOG=1` and `VITE_SUSURA_TRANSCRIPT_DEBUG_LOG=1` to log raw Rust backend JSON lines, parsed Electron events, emitted bridge events, renderer partial suppression, completed chunk merging and final visible text. Electron prints JSONL lines prefixed with `susura-transcript-debug` and also writes them to the app user data log file at `logs/transcript-debug.jsonl`.

## Commands

- `npm install`: install JavaScript and Electron dependencies.
- `npm run logo:update`: extract the latest `assets/susura.af` preview into the icon pipeline and regenerate app, marketing and platform icons.
- `npm run dev`: build the Rust backend and Swift helper, start Vite, and launch the primary Electron app.
- `cargo build -p susura-desktop-backend`: build the Rust backend binary spawned by Electron.
- `cargo run -p susura-desktop-backend -- --stream-system-audio`: run system audio capture through the Rust backend.
- `cargo run -p susura-desktop-backend -- --local-transcription --source system --source microphone`: run the native local transcription pipeline.
- `cargo run -p susura-desktop-ui`: run the Dioxus Native experiment.
- `cargo check -p susura-desktop-ui`: check the Dioxus Native experiment.
- `cargo test -p susura-desktop-ui`: run the Dioxus Native model tests.
- `cargo test -p susura-macos-capture`: run the Rust helper protocol parser tests.
- `npm run build`: type-check the renderer and build the web assets.
- `npm run dist:mac`: package the Apple Silicon macOS release artefact. Release packaging must run on Apple Silicon macOS so the bundled Rust backend and Swift helper match the published architecture.
- `npm run dist:mac:arm`: package the Apple Silicon macOS release artefact explicitly.
- Tagged GitHub releases build, sign and notarise in CI, then download the published ZIP and verify it with `codesign` and `spctl`.
- `npm test`: run the React and TypeScript foundation tests.
- `npm run check`: run the web build and frontend tests together.
- `npm run smoke:electron`: launch Electron against Vite, exercise the preload runtime and capture bridge, then exit.
- `npm run smoke:electron:built`: launch the built Electron app and verify the production renderer is not blank.
- `npm run smoke:onboarding`: launch Electron with fresh temporary app data, force incomplete setup, verify the onboarding window opens, and capture step screenshots in `artifacts/onboarding/`.
- `npm run smoke:resources`: launch the built idle Electron app, record Electron process memory metrics and fail if the working set exceeds the current 450 MiB budget.
- `npm run smoke:system-audio`: launch Electron against Vite and measure whether the helper produces non-zero system audio levels.
- `npm run smoke:browser-system-audio`: play a Chrome tone, launch Electron against Vite and measure whether the app route detects browser system audio.
- `npm run smoke:local-parakeet-helper-system-audio`: legacy helper-level comparison route for the old FluidAudio path.
- `npm run smoke:local-parakeet-browser-system-audio`: launch Electron on a free local Vite port, start native local Parakeet transcription, play public-domain spoken media through Chrome, and fail unless the renderer bridge receives confirmed local transcription events with no helper errors.
- `npm run bench:llm-bridges`: compare Pi and Codex subscription bridge latency using an identical short transcript prompt, including first assistant output and completion timing. The default comparison model is `gpt-5.4-mini` with low reasoning.
- `npm run bench:llm-first-chunk`: run the Electron renderer LLM smoke repeatedly across model, reasoning, warm-up, request strategy, prompt shape, transcript windowing and Pi startup variants, then summarise stop-to-first-visible-LLM-text latency. Use `SUSURA_LLM_FIRST_CHUNK_RUNS`, `SUSURA_LLM_FIRST_CHUNK_MODELS`, `SUSURA_LLM_FIRST_CHUNK_REASONING`, `SUSURA_LLM_FIRST_CHUNK_WARMUPS`, `SUSURA_LLM_FIRST_CHUNK_WARMUP_COUNTS`, `SUSURA_LLM_FIRST_CHUNK_WARMUP_PROMPTS`, `SUSURA_LLM_FIRST_CHUNK_OFFLINE`, `SUSURA_LLM_FIRST_CHUNK_SESSION_DIRS`, `SUSURA_LLM_FIRST_CHUNK_REQUEST_STRATEGIES`, `SUSURA_LLM_FIRST_CHUNK_PROMPT_SHAPES`, `SUSURA_LLM_FIRST_CHUNK_TRANSCRIPT_WINDOWS`, `SUSURA_LLM_FIRST_CHUNK_SMOKE_MODES` and `SUSURA_LLM_FIRST_CHUNK_BACKUP_PREWARM` to control the matrix.
- `npm run bench:parakeet-direct`: generate a known `say` fixture, convert it to 16 kHz mono WAV, feed it directly into local Parakeet, and print transcript accuracy plus model-load and ASR timing. Use this before the full capture benchmark to separate model accuracy from Core Audio and browser playback effects.
- `npm run bench:live-call-fixture`: run the pure Rust endpointing fixture path and print JSON summaries for fixed synthetic cases.
- `npm run bench:live-call-pipeline`: mute host output, preload local Parakeet for the benchmark run, wait for Core Audio capture readiness, play deterministic generated speech through Chrome, run the real app transcription pipeline, and print JSONL timing metrics for endpointing and ASR completion.
- `npm run smoke:sck-browser-system-audio`: route output to built-in speakers for the test, play a Chrome tone, verify the ScreenCaptureKit helper backend detects non-zero browser audio, then restore the previous output route.
- `npm run smoke:core-audio-browser-system-audio`: play a Chrome tone and verify the direct Core Audio helper backend detects non-zero browser audio.
- `npm run macos-audio:build`: build and ad-hoc sign the Swift Core Audio helper with the local audio-input entitlement.
- `npm run electron:sign-dev`: ad-hoc sign the local Electron app with the macOS audio entitlements needed for Core Audio Tap development.
- `npm run macos-audio:capabilities`: print helper capability JSON.
- `npm run macos-audio:tap-smoke`: create and destroy a Core Audio Process Tap and private aggregate device.
- `npm run macos-audio:stream-smoke`: attempt a one-second system audio stream and report permission or capture errors.
- `npm run macos-audio:sck-stream-smoke`: attempt a one-second ScreenCaptureKit system audio stream and report permission or capture errors.
- `npm run vm:status`: inspect the configured Parallels macOS VM readiness.
- `npm run vm:smoke`: start the host dev server and verify the Parallels macOS VM can reach the Susura app.
- `cargo test`: run Rust workspace tests.

## Parallels macOS VM Testing

Use the Parallels macOS VM as a repeatable test target for onboarding and permission flows. It should be treated as an important runtime environment, not an afterthought.

Current VM target:

- Name: `macOS Tahoe`
- Parallels CLI: `prlctl`
- Current status: Parallels Tools are installed and host-driven command execution works through `prlctl exec`.
- Current guest IP address seen from the host: `10.211.55.8`, although `prlctl` may omit it intermittently.
- Current host dev server address seen from the guest: `http://10.211.55.2:5173/`.
- Installation attempt recorded: `prlctl installtools "macOS Tahoe"` started successfully from the host, but the VM still reported Guest Tools as not installed afterwards.

When the capture layer exists, verify at minimum:

- Fresh install or fresh profile first-run setup.
- Microphone permission prompt and denial recovery.
- Screen and System Audio Recording permission prompt and denial recovery.
- Mic level movement.
- System audio level movement from browser or meeting audio.
- Clean stop and restart without relaunching the app.

If Parallels limits a specific host or guest audio path, document that limitation in this file with the VM macOS version, Parallels version and observed behaviour.

If `npm run vm:smoke` fails, first run `npm run vm:status`. If Guest Tools or the guest IP disappears, reinstall Parallels Tools or enable another explicit guest access path such as SSH, then document the chosen access method here.

Do not write VM passwords into this repository. If a password is needed for a local VM operation, use it only at the prompt and keep the access method documented without the secret.

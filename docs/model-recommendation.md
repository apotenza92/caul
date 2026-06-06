# Model Recommendation Policy

Caul recommends transcription and AI response models from the best available reviewed catalogue. Every Caul release ships a bundled catalogue as the offline seed and fallback, and release work should refresh that bundled catalogue before shipping. When the user has internet access and model auto-updates are enabled, onboarding may fetch trusted live sources, write a reviewed cache under app data, and use that cache for the first recommendation. If the live refresh fails or times out, onboarding falls back to the bundled catalogue without blocking setup.

## Sources

- Transcription quality and efficiency use the Hugging Face Open ASR Leaderboard and its paper. The relevant metrics are word error rate and inverse real-time factor, with extra weight on long-form and meeting-like datasets because Caul is for live calls.
- AI response quality uses Artificial Analysis as the primary score source because it publishes quality, speed, latency, price and open-weight signals in one place. LMArena is a human-preference cross-check. SWE-bench, Terminal-Bench and LiveCodeBench are useful only when Caul is evaluating coding or agent-style behaviour; they are not primary benchmarks for a live-call assistant.
- Seamless local AI uses Caul-managed `llama.cpp` plus GGUF models on supported platforms, Caul-managed MLX on Apple Silicon when an MLX model is the best fit, and LiteRT-LM candidates when Google's local runtime metadata and Caul smoke tests show they are suitable.
- Runtime and availability metadata may come from Hugging Face Hub APIs, Google/Gemma pages, MLX, `llama.cpp` and LiteRT-LM release or documentation endpoints. Runtime metadata can make a model eligible or ineligible, but it does not replace independent quality benchmarks.
- LM Studio's public model-management behaviour is useful product precedent, especially format filtering, quantisation choices and hardware-fit indicators. Caul should not depend on LM Studio or copy private LM Studio implementation. The reusable open-source surface is the `lms` CLI, not a standalone hardware recommender library.
- Caul keeps its own implementation maturity and smoke-result notes because a high benchmark score is not enough for a live overlay if the model cannot stream quickly, fit memory or run through Caul's current runtime.

## Scoring

Recommendations are three-stage:

1. Filter to models Caul can actually run for the requested feature.
2. Filter by stable system capacity: total RAM, architecture, CPU cores, platform and GPU or unified-memory capability. Do not use momentary free memory as the primary onboarding recommendation signal.
3. Rank viable models by benchmark quality, live latency, stable memory fit, platform support, implementation maturity and Caul smoke results.

For transcription, live latency matters as much as benchmark accuracy. Models with strong WER but offline-only or GPU-heavy behaviour remain catalogue candidates, but are not recommended until Caul has a proven runtime for them.

For AI responses, local models are recommended only when the user's CPU, RAM, GPU or unified memory profile suggests short answers can stream at an acceptable pace. On Apple Silicon, local model capacity is based on unified memory. On Windows and Linux, GPU-specific models must fit detected VRAM where available, while CPU-safe models use the stable RAM capacity estimate. Caul should recommend the strongest benchmark-grounded model that fits the stable machine budget and has passed Caul runtime smoke tests. Model size, download size and memory footprint are penalties, not hard preferences for tiny models. If no local model is a good fit, Caul recommends the implemented cloud path instead and explains that prompts leave the machine.

Current available memory is a readiness signal only. It may warn that a model could be tight to start right now, but it should not change the onboarding default because VMs, browsers, Spotlight and other user activity can change it minute to minute.

## Freshness

Each catalogue entry has a `reviewedAt` date and source URL. Entries older than 90 days are treated as stale in diagnostics and tests. Stale entries are still usable, but the UI should expose the reviewed date so users can inspect the basis for the recommendation.

Catalogue refreshes are deliberate work. The bundled catalogue is updated with Caul releases so offline installs still get a reasonable recommendation. The live catalogue cache is updated during onboarding when model auto-update is enabled, by an explicit model-list refresh, by a model setup flow, or after the user's configured app update check once onboarding is complete. It records source URLs and reviewed dates, and can be discarded without breaking offline recommendations. Once a live cache exists, recommendations may read it locally even if automatic model updates are later disabled.

Existing users may opt in to automatic model updates for transcription and AI responses. When enabled, Caul may move them to a better benchmark-grounded, implemented and smoke-tested model during onboarding, a scheduled app update check, explicit model-list refresh or model setup flow. It must not check leaderboards after every call, replace models during active listening, or delete old local models without a clear user action because model files are large, licences can change, and provider/runtime choices are privacy-sensitive.

`npm run models:refresh` is the maintainer path for auditing live source changes. By default it prints a diff-oriented summary without rewriting the bundled catalogue. Use `--output` to write a reviewed candidate file, `--user-data` to write an app-data live cache for local testing, or `--write-bundled` only when intentionally updating the offline seed for a Caul release.

## Privacy

First-run setup uses a bounded live catalogue refresh plus local hardware probes when model auto-update is enabled. If the user is offline, sources fail, or the refresh times out, Caul uses the bundled catalogue. It may check Caul's managed local runtime state in app data, but it must not send prompts before the user chooses a provider.

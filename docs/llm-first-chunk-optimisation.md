# LLM First Chunk Optimisation Plan

Caul should optimise for the time from the user stopping listening to the first useful LLM text appearing in the response box. Slower app startup is acceptable when it reliably reduces this interactive latency.

## Primary Metric

The primary metric is `stop_to_first_visible_llm_chunk_ms`.

This is measured from the renderer Stop listening action to the first non-empty text painted in the LLM response field. It is intentionally user-facing. Lower-level timings are supporting diagnostics only.

## Current Baseline

The current best path is:

- persistent Pi RPC process
- `openai-codex/gpt-5.4-mini`
- reasoning `off`
- hidden startup prompt
- fresh session reset after hidden warm-up
- streaming deltas into the renderer

Recent renderer smoke runs showed `stop_to_first_visible_llm_chunk_ms` around `990ms` to `1253ms`, with a median near `1040ms`.

Low-level timing showed:

- cold persistent RPC without hidden prompt first token around `1.6s` to `1.8s`
- hidden warm-up readiness usually around `1.0s` to `2.2s`
- hidden warm-up plus session reset real first token usually around `1.0s` to `1.3s`
- reusing the same session after hidden warm-up can hang, so the post-warm session reset is required
- one-shot Pi JSON is slower and more variable than persistent RPC

## Current Ranking

The first broader benchmark used three samples per variant across `5.4-mini`, `5.4` and `5.5`, reasoning `off` and `minimal`, and warm-up strategies `hidden-prompt` and `session-only`.

The best stable variant was:

- `openai-codex/gpt-5.4-mini`
- reasoning `off`
- `hidden-prompt` warm-up with session reset
- median `stop_to_first_visible_llm_chunk_ms`: `1089ms`
- p95 in that sample set: `1132ms`
- range: `923ms` to `1132ms`
- failures: `0`

The next closest clean variant was `5.4-mini/off/session-only`, with median `1256ms` and p95 `1921ms`.

Rejected variants from this run:

- `5.4-mini/minimal`: slower first visible text even when Pi first delta is similar, likely because reasoning mode delays visible answer text.
- `5.4/off`: had a failed hidden-prompt renderer sample and slower visible text.
- `5.5/off`: consistently slower visible text than `5.4-mini/off`.
- `5.5/minimal`: much slower first visible text.
- `5.3-codex-spark/off`: tested because it sounded latency-oriented, but measured around `1920ms` to `2067ms`.
- `5.3-codex/off`: measured around `1654ms` to `1787ms`.
- `5.2/off`: measured around `1652ms` to `1733ms`.

A benchmark harness bug allowed one impossible `26ms` first visible result when no real Electron delta was seen. The harness now rejects runs without an Electron text delta and ignores the `No response yet.` placeholder.

The next variable pass tested warm prompt wording, repeated warm prompts, `PI_OFFLINE=1`, and app-specific Pi session directories against `5.4-mini/off/hidden-prompt`.

Findings:

- One `Answer: What is the refund policy?` warm prompt looked promising in a tiny sample, but regressed when sampled more broadly.
- Two hidden warm prompts were unstable and produced failed runs. Do not use repeated warm prompts as a default.
- App-specific `--session-dir` was slower and produced failures. Keep Pi's default session behaviour with `--no-session`.
- `PI_OFFLINE=1` with the current `OK` warm prompt had a slightly better median in one head-to-head, `1116ms` versus `1139ms`, but worse tail latency, `3704ms` versus `1375ms`, and the same failure count. Do not enable it by default yet.
- The current default remains `5.4-mini`, reasoning `off`, one `Reply with OK.` hidden prompt, default session behaviour.

The next pass tested the remaining speed ideas using benchmark-only modes.

Findings:

- **Speculative dispatch while listening is the only clear step-change.** With a simulated `500ms` head start, raw speculative mode measured around `772ms` to `844ms` on short transcript samples, compared with normal stop mode around `1011ms` to `1122ms`. On a longer transcript, one successful speculative sample measured `430ms`.
- **Speculative dispatch is not ready as a silent default.** Several speculative samples also hit the existing Pi RPC no-response failure mode. Productising this needs cancellation, stale-transcript validation and recovery behaviour.
- **Prompt shape alone does not beat raw transcript in normal stop mode.** `short-answer` was close, around `1005ms` to `1088ms`, but not materially better than raw. `answer-prefix` was slower in normal stop mode.
- **Speculative plus `answer-prefix` was fastest in a tiny sample**, around `527ms` to `799ms`, but this needs a larger run before it is trusted because `answer-prefix` was poor in normal stop mode.
- **One-shot and race-one-shot were slower.** One-shot measured around `1625ms` to `2140ms`; racing persistent against one-shot did not beat persistent.
- **A prewarmed backup persistent Pi process had one promising tiny sample, around `928ms` to `1221ms`, but costs extra startup and memory and produced process-exit noise in the benchmark. It needs more isolation before use.
- **Transcript windowing did not help.** A `120` character window on the synthetic longer transcript had failures and one slow normal-stop sample around `3377ms`.

The most promising next product change is a guarded speculative mode:

1. Start a hidden LLM request after confirmed transcript text has been stable for a short interval.
2. Keep the stream hidden until Stop listening.
3. On Stop, reveal the stream only if the visible transcript still exactly matches the speculative request.
4. If the transcript changed, discard the speculative stream and start a normal request.
5. If no text arrives by a threshold, recover with the normal persistent request path.

## Guarded Speculative Dispatch

The first guarded implementation is available behind `VITE_CAUL_SPECULATIVE_LLM=1`. It is off by default.

Behaviour:

- A speculative request starts only after confirmed transcript text is stable for `VITE_CAUL_SPECULATIVE_LLM_DELAY_MS`, default `500ms`.
- Speculative `llm-response-delta` events are keyed by request id and stay hidden while listening.
- Stop listening reuses and reveals the speculative request only if transcript, model and reasoning still match.
- If the transcript changed, Stop listening starts a normal visible request.

Measured app-path result with the guarded hook enabled:

- normal stop path, three samples: median `1236ms`, p95 sample `3085ms`
- speculative path, three samples: median `732ms`, p95 sample `769ms`

This is the strongest latency improvement so far. It should remain behind a flag until it has more testing with real microphone and system-audio transcript updates, plus clearer cancellation or recovery behaviour for Pi no-response cases.

## Additional Variables

These are the remaining variables worth testing after model, reasoning and basic warm-up strategy.

### High Value

- **Speculative LLM request while listening:** start a draft LLM request before Stop listening when transcript text has been stable for a short period, then either keep or cancel it on Stop. This is the only path likely to get perceived time below the backend first-token floor.
- **Multiple warm prompts:** run two short hidden prompts at startup and reset the session after each. This may reduce p95 if the first request after startup still pays backend routing cost.
- **Warm prompt wording:** compare `Reply with OK.`, the expected user transcript shape, and an empty/minimal call if Pi accepts it. The warm prompt should exercise the same output path as the real request without adding much startup cost.
- **Model-change prewarm:** when the user changes model or reasoning, immediately run the full warm-up for the new selection and keep Start listening disabled until ready.
- **Outlier recovery:** if the real request has no first text by a threshold, start a second persistent Pi process or one-shot fallback in parallel and use whichever streams first. This increases resource use but may reduce bad tail latency.

### Medium Value

- **Prompt shape:** compare raw transcript, trimmed raw transcript, and a tiny instruction such as `Answer:` plus transcript. Prompt shape can affect first visible text because some models produce disclaimers or planning text before useful text.
- **Transcript size:** benchmark short, medium and long transcripts. The app currently sends the whole visible transcript, which is the desired manual behaviour, but latency may climb with long calls.
- **Renderer update path:** measure first Electron delta to first visible field text directly. This should stay in the low milliseconds. If it does not, batch state updates less aggressively or write the first delta through a dedicated fast path.
- **Session directory isolation:** test `--session-dir` on a temporary or app-specific directory even with `--no-session`, in case Pi startup still probes session state.
- **Offline startup flag:** test `PI_OFFLINE=1` for the already-authenticated Pi path. It may reduce startup network checks, but must not break subscription login.

### Low Value Or Risky

- **Same-session reuse after hidden warm-up:** measured as unsafe because it can hang. Keep session reset.
- **Higher reasoning:** consistently worse for first visible text.
- **One-shot JSON:** slower and more variable than persistent RPC.
- **Larger coding models:** slower or less stable for this product metric.

## Variables To Test

Test one variable at a time, then test the best combinations.

### Model

- `openai-codex/gpt-5.4-mini`
- `openai-codex/gpt-5.4`
- `openai-codex/gpt-5.5`
- `openai-codex/gpt-5.2`
- any faster Pi-exposed non-coding model that is available through the same login path

### Reasoning

- `off`
- `minimal`
- `low`

Higher reasoning levels are not expected to be competitive for first chunk latency, but can be sampled occasionally for quality comparison.

### Warm-Up Strategy

- no hidden prompt, session ready only
- hidden prompt with session reset
- hidden prompt without session reset, diagnostic only because it has hung before
- repeated hidden prompts, diagnostic only
- model-change warm-up before listening becomes available

### Prompt Shape

- raw transcript only
- raw transcript with leading and trailing whitespace trimmed
- short instruction plus transcript
- structured JSON transcript payload

The current product default is raw transcript only. Prompt changes must improve latency or answer quality without making the app feel less direct.

### Transport

- persistent Pi RPC
- Pi JSON one-shot fallback
- direct provider API only if a future login-safe transport exists

### Renderer Behaviour

- IPC request time
- first Electron delta emit
- first React state update
- first visible response field text

The renderer should add only a few milliseconds after Pi emits the first delta.

## Benchmark Matrix

Each benchmark run should output JSONL with:

- `variant`
- `model`
- `reasoning`
- `warmup_strategy`
- `startup_to_ready_ms`
- `stop_to_ipc_ms`
- `ipc_to_pi_prompt_ms`
- `pi_prompt_to_first_delta_ms`
- `electron_delta_to_visible_ms`
- `stop_to_first_visible_llm_chunk_ms`
- `stop_to_llm_complete_ms`
- `first_chunk_text`
- `final_text`
- `error`

Run at least five samples per variant. Use medians for decisions, but keep p95 and all outliers visible because live-call UX suffers from spikes.

## Decision Gates

Prefer a variant only if it:

- reduces median `stop_to_first_visible_llm_chunk_ms`
- does not increase p95 enough to feel unreliable
- streams visible text, not only final text
- avoids known Pi RPC hangs
- keeps the transcript sent to the model unchanged unless explicitly testing prompt shape
- keeps the UI simple

Current target gates:

- good: median under `1200ms`
- excellent: median under `900ms`
- warning: p95 over `2200ms`
- failure: any hung hidden warm-up or first chunk over `5000ms`

## Optimisation Loop

1. Run the focused first-chunk benchmark against the current baseline.
2. Change one variable.
3. Run the same benchmark with at least five samples.
4. Compare median, p95 and outliers.
5. Keep the change only if it improves first chunk latency without reducing stability.
6. Re-run the real renderer smoke after any accepted change.
7. Record the winning variant and measured numbers in this document.

## First Implementation Tasks

- Add a dedicated `npm run bench:llm-first-chunk` command.
- Make the benchmark run multiple Electron renderer smoke samples and parse `caul-renderer-llm-smoke`.
- Add low-level Pi RPC variants for startup and session strategy.
- Add model and reasoning matrix support through environment variables.
- Emit a summary sorted by median `stop_to_first_visible_llm_chunk_ms`.
- Add a warning when the benchmark sees Pi fallback or a hung run.
- Preserve the current full hidden warm-up with session reset until a better measured strategy replaces it.

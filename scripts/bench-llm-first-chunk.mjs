import { spawn } from 'node:child_process';

const runs = Number(process.env.SUSURA_LLM_FIRST_CHUNK_RUNS ?? 5);
const timeoutMs = Number(process.env.SUSURA_LLM_FIRST_CHUNK_TIMEOUT_MS ?? 45_000);
const models = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_MODELS,
  ['openai-codex/gpt-5.4-mini']
);
const reasoningLevels = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_REASONING,
  ['off']
);
const warmupStrategies = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_WARMUPS,
  ['hidden-prompt', 'session-only']
);
const warmupCounts = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_WARMUP_COUNTS,
  ['1']
);
const warmupPrompts = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_WARMUP_PROMPTS,
  ['ok']
);
const offlineModes = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_OFFLINE,
  ['0']
);
const sessionDirModes = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_SESSION_DIRS,
  ['default']
);
const requestStrategies = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_REQUEST_STRATEGIES,
  ['persistent']
);
const promptShapes = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_PROMPT_SHAPES,
  ['raw']
);
const transcriptWindows = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_TRANSCRIPT_WINDOWS,
  ['0']
);
const smokeModes = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_SMOKE_MODES,
  ['stop']
);
const backupPrewarmModes = listFromEnv(
  process.env.SUSURA_LLM_FIRST_CHUNK_BACKUP_PREWARM,
  ['0']
);
const smokeTranscript = process.env.SUSURA_LLM_FIRST_CHUNK_TRANSCRIPT
  ?? 'What is the refund policy?';

await runCommand('npm', ['run', 'build'], { label: 'build' });
await runCommand('npm', ['run', 'electron:sign-dev'], { label: 'sign' });

const results = [];

for (const model of models) {
  for (const reasoning of reasoningLevels) {
    for (const warmupStrategy of warmupStrategies) {
      for (const warmupCount of warmupCounts) {
        for (const warmupPromptName of warmupPrompts) {
          for (const offlineMode of offlineModes) {
            for (const sessionDirMode of sessionDirModes) {
              for (const requestStrategy of requestStrategies) {
                for (const promptShape of promptShapes) {
                  for (const transcriptWindow of transcriptWindows) {
                    for (const smokeMode of smokeModes) {
                      for (const backupPrewarm of backupPrewarmModes) {
                        const warmupPrompt = resolveWarmupPrompt(warmupPromptName);
                        const variant = [
                          model,
                          reasoning,
                          warmupStrategy,
                          `count=${warmupCount}`,
                          `prompt=${warmupPromptName}`,
                          `offline=${offlineMode}`,
                          `sessionDir=${sessionDirMode}`,
                          `request=${requestStrategy}`,
                          `shape=${promptShape}`,
                          `window=${transcriptWindow}`,
                          `smoke=${smokeMode}`,
                          `backupWarm=${backupPrewarm}`
                        ].join('|');

                        for (let run = 1; run <= runs; run += 1) {
                          const result = await runElectronSmoke({
                            backupPrewarm,
                            model,
                            offlineMode,
                            promptShape,
                            reasoning,
                            requestStrategy,
                            run,
                            sessionDirMode,
                            smokeMode,
                            transcriptWindow,
                            variant,
                            warmupCount,
                            warmupPrompt,
                            warmupPromptName,
                            warmupStrategy
                          });
                          results.push(result);
                          console.log(`susura-llm-first-chunk-run ${JSON.stringify(result)}`);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

for (const summary of summarise(results)) {
  console.log(`susura-llm-first-chunk-summary ${JSON.stringify(summary)}`);
}

function runElectronSmoke({
  backupPrewarm,
  model,
  offlineMode,
  promptShape,
  reasoning,
  requestStrategy,
  run,
  sessionDirMode,
  smokeMode,
  transcriptWindow,
  variant,
  warmupCount,
  warmupPrompt,
  warmupPromptName,
  warmupStrategy
}) {
  const startedAt = process.hrtime.bigint();
  let stdout = '';
  let stderr = '';

  return new Promise((resolve) => {
    const child = spawn('electron', ['.'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PI_OFFLINE: offlineMode,
        SUSURA_RENDERER_REAL_LLM_SMOKE: '1',
        VITE_SUSURA_SPECULATIVE_LLM: smokeMode === 'speculative' ? '1' : '0',
        VITE_SUSURA_SPECULATIVE_LLM_DELAY_MS: process.env.SUSURA_LLM_SPECULATIVE_STOP_DELAY_MS ?? '500',
        SUSURA_LLM_MODEL: model,
        SUSURA_LLM_PREWARM_BACKUP: backupPrewarm,
        SUSURA_LLM_PROMPT_SHAPE: promptShape,
        SUSURA_LLM_REQUEST_STRATEGY: requestStrategy,
        SUSURA_LLM_SMOKE_TRANSCRIPT: smokeTranscript,
        SUSURA_LLM_SMOKE_MODE: smokeMode,
        SUSURA_LLM_THINKING: reasoning,
        SUSURA_LLM_TRANSCRIPT_WINDOW_CHARS: transcriptWindow,
        SUSURA_LLM_WARMUP_COUNT: warmupCount,
        SUSURA_LLM_WARMUP_PROMPT: warmupPrompt,
        SUSURA_LLM_WARMUP_STRATEGY: warmupStrategy,
        SUSURA_PI_SESSION_DIR_MODE: sessionDirMode
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      const parsed = parseSmokeOutput(stdout);

      resolve({
        variant,
        model,
        reasoning,
        warmupStrategy,
        warmupCount: Number(warmupCount),
        warmupPrompt: warmupPromptName,
        offlineMode,
        requestStrategy,
        sessionDirMode,
        promptShape,
        transcriptWindow: Number(transcriptWindow),
        smokeMode,
        backupPrewarm,
        run,
        success: code === 0
          && parsed.renderer?.streamed === true
          && parsed.renderer?.stopToFirstResponseTextMs != null
          && parsed.firstElectronDeltaMs != null
          && parsed.renderer?.finalValue !== 'No response yet.',
        exitCode: code,
        signal,
        totalMs: elapsedMs(startedAt),
        warmupFirstDeltaMs: parsed.firstWarmupDeltaMs,
        realPiFirstDeltaMs: parsed.firstRealPiDeltaMs,
        firstElectronDeltaMs: parsed.firstElectronDeltaMs,
        stopToFirstVisibleLlmChunkMs: parsed.renderer?.stopToFirstResponseTextMs ?? null,
        finalTextLength: parsed.renderer?.finalValue?.length ?? 0,
        fallbackCount: parsed.fallbackCount,
        stderrTail: tail(stderr)
      });
    });
  });
}

function parseSmokeOutput(stdout) {
  const timing = [];
  let renderer = null;
  let fallbackCount = 0;

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('susura-llm-timing ')) {
      timing.push(JSON.parse(line.slice('susura-llm-timing '.length)));
    }

    if (line.startsWith('susura-renderer-llm-smoke ')) {
      renderer = JSON.parse(line.slice('susura-renderer-llm-smoke '.length));
    }

    if (line.startsWith('susura-pi-rpc-fallback ')) {
      fallbackCount += 1;
    }
  }

  const firstRequestIndex = timing.findIndex((event) => event.event === 'electron_request_started');
  const warmupEvents = firstRequestIndex >= 0 ? timing.slice(0, firstRequestIndex) : timing;
  const realEvents = firstRequestIndex >= 0 ? timing.slice(firstRequestIndex) : [];

  return {
    fallbackCount,
    renderer,
    firstWarmupDeltaMs: warmupEvents.find((event) => event.event === 'pi_rpc_text_delta')?.atMs ?? null,
    firstRealPiDeltaMs: realEvents.find((event) => event.event === 'pi_rpc_text_delta')?.atMs ?? null,
    firstElectronDeltaMs: realEvents.find((event) => event.event === 'electron_delta_emit')?.atMs ?? null
  };
}

function resolveWarmupPrompt(name) {
  if (name === 'transcript') {
    return 'What is the refund policy?';
  }

  if (name === 'answer') {
    return 'Answer: What is the refund policy?';
  }

  return 'Reply with OK.';
}

function summarise(results) {
  const byVariant = new Map();

  for (const result of results) {
    if (!byVariant.has(result.variant)) {
      byVariant.set(result.variant, []);
    }

    byVariant.get(result.variant).push(result);
  }

  return Array.from(byVariant.entries())
    .map(([variant, rows]) => {
      const successes = rows.filter((row) => row.success);
      const visible = successes
        .map((row) => row.stopToFirstVisibleLlmChunkMs)
        .filter((value) => value != null)
        .sort((a, b) => a - b);
      const realPi = successes
        .map((row) => row.realPiFirstDeltaMs)
        .filter((value) => value != null)
        .sort((a, b) => a - b);
      const warmup = successes
        .map((row) => row.warmupFirstDeltaMs)
        .filter((value) => value != null)
        .sort((a, b) => a - b);

      return {
        variant,
        runs: rows.length,
        successes: successes.length,
        failures: rows.length - successes.length,
        fallbackCount: rows.reduce((total, row) => total + row.fallbackCount, 0),
        medianStopToFirstVisibleLlmChunkMs: median(visible),
        p95StopToFirstVisibleLlmChunkMs: percentile(visible, 0.95),
        medianRealPiFirstDeltaMs: median(realPi),
        medianWarmupFirstDeltaMs: median(warmup),
        minStopToFirstVisibleLlmChunkMs: visible[0] ?? null,
        maxStopToFirstVisibleLlmChunkMs: visible.at(-1) ?? null
      };
    })
    .sort((a, b) => {
      if (a.medianStopToFirstVisibleLlmChunkMs == null) return 1;
      if (b.medianStopToFirstVisibleLlmChunkMs == null) return -1;
      return a.medianStopToFirstVisibleLlmChunkMs - b.medianStopToFirstVisibleLlmChunkMs;
    });
}

function runCommand(command, args, { label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit'
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

function listFromEnv(value, fallback) {
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const middle = Math.floor(values.length / 2);

  return values.length % 2 === 0
    ? Math.round((values[middle - 1] + values[middle]) / 2)
    : values[middle];
}

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1);

  return values[index];
}

function elapsedMs(startedAt) {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

function tail(value) {
  return value.trim().slice(-500);
}

import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runs = Number(process.env.CAUL_LLM_BRIDGE_BENCH_RUNS ?? 3);
const timeoutMs = Number(process.env.CAUL_LLM_BRIDGE_BENCH_TIMEOUT_MS ?? 45_000);
const transcript = process.env.CAUL_LLM_BRIDGE_BENCH_TRANSCRIPT
  ?? 'What is the refund policy for annual plans?';
const codexThinking = process.env.CAUL_BENCH_LLM_THINKING ?? 'low';
const piThinking = process.env.CAUL_BENCH_LLM_THINKING ?? 'low';
const sharedModel = process.env.CAUL_LLM_BRIDGE_BENCH_MODEL ?? 'gpt-5.4-mini';
const piSharedModel = process.env.CAUL_LLM_BRIDGE_BENCH_PI_MODEL ?? `openai-codex/${sharedModel}`;
const systemPrompt = [
  'You are Caul, a live-call answer engine.',
  'Use only the transcript supplied by the caller.',
  'Do not inspect files, search, call tools, create todo lists, or mention local context.',
  'Return only one concise final answer sentence.',
  'If the transcript does not contain enough information, say: I need the policy details to answer that accurately.'
].join(' ');
const userPrompt = `Transcript: ${transcript}`;
const isolatedCodexDir = await mkdtemp(path.join(tmpdir(), 'caul-codex-bridge-'));

const variants = [
  {
    id: `codex-default-config-${sharedModel}-low`,
    command: 'codex',
    args: [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ignore-rules',
      '--model',
      sharedModel,
      '-c',
      `model_reasoning_effort="${codexThinking}"`,
      `${systemPrompt} ${userPrompt}`
    ],
    parser: 'codex'
  },
  {
    id: `codex-minimal-project-cwd-${sharedModel}-low`,
    command: 'codex',
    args: codexArgs(sharedModel),
    parser: 'codex'
  },
  {
    id: `codex-isolated-no-tools-${sharedModel}-low`,
    command: 'codex',
    args: codexArgs(sharedModel, {
      isolated: true,
      disableTools: true
    }),
    parser: 'codex'
  },
  {
    id: `pi-minimal-${piSharedModel.replace('/', '-')}-low`,
    command: 'pi',
    args: [
      '--mode',
      'json',
      '--print',
      '--no-session',
      '--no-tools',
      '--no-context-files',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--system-prompt',
      systemPrompt,
      '--model',
      piSharedModel,
      '--thinking',
      piThinking,
      userPrompt
    ],
    env: {
      PI_SKIP_VERSION_CHECK: '1',
      PI_TELEMETRY: '0'
    },
    parser: 'pi'
  }
];

const results = [];

for (const variant of variants) {
  for (let index = 0; index < runs; index += 1) {
    const result = await runVariant(variant, index + 1);
    results.push(result);
    console.log(`caul-llm-bridge-bench-run ${JSON.stringify(result)}`);
  }
}

const summaries = summarise(results);
for (const summary of summaries) {
  console.log(`caul-llm-bridge-bench-summary ${JSON.stringify(summary)}`);
}

const usable = summaries
  .filter((summary) => summary.successes > 0)
  .sort((a, b) => a.medianFirstAssistantMs - b.medianFirstAssistantMs);

if (usable.length > 0) {
  console.log(`caul-llm-bridge-bench-best ${JSON.stringify(usable[0])}`);
}

function codexArgs(model, options = {}) {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ignore-rules',
    '--model',
    model,
    '-c',
    `model_reasoning_effort="${codexThinking}"`,
    `${systemPrompt} ${userPrompt}`
  ];

  if (options.disableTools) {
    args.splice(5, 0,
      '--disable',
      'apps',
      '--disable',
      'plugins',
      '--disable',
      'tool_search',
      '--disable',
      'shell_tool',
      '--disable',
      'unified_exec',
      '--disable',
      'browser_use',
      '--disable',
      'browser_use_external',
      '--disable',
      'goals',
      '-c',
      'web_search="disabled"'
    );
  }

  if (options.isolated) {
    args.splice(args.length - 1, 0, '-C', isolatedCodexDir);
  }

  return args;
}

function runVariant(variant, run) {
  const startedAt = process.hrtime.bigint();
  let stdout = '';
  let stderr = '';
  let firstAssistantMs = null;
  let firstJsonEventMs = null;
  let completedMs = null;
  let assistantText = '';
  let stdoutLineBuffer = '';
  let toolEventCount = 0;
  let usage = null;
  let timedOut = false;

  return new Promise((resolve) => {
    const child = spawn(variant.command, variant.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(variant.env ?? {})
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      const parsedLines = nextLines(stdoutLineBuffer + text);
      stdoutLineBuffer = parsedLines.remainder;
      for (const line of parsedLines.lines) {
        const elapsed = elapsedMs(startedAt);
        const parsed = parseEventLine(line, variant.parser);
        if (parsed.isJson && firstJsonEventMs === null) {
          firstJsonEventMs = elapsed;
        }
        if (parsed.assistantDelta && firstAssistantMs === null) {
          firstAssistantMs = elapsed;
        }
        if (parsed.assistantDelta) {
          assistantText += parsed.assistantDelta;
        }
        if (parsed.assistantText) {
          assistantText = parsed.assistantText;
          if (firstAssistantMs === null) {
            firstAssistantMs = elapsed;
          }
        }
        if (parsed.completed) {
          completedMs = elapsed;
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
        if (parsed.toolEvent) {
          toolEventCount += 1;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        variant: variant.id,
        run,
        success: false,
        error: error.message,
        timedOut,
        firstJsonEventMs,
        firstAssistantMs,
        completedMs: elapsedMs(startedAt),
        assistantText
      });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (stdoutLineBuffer.trim()) {
        const parsed = parseEventLine(stdoutLineBuffer.trim(), variant.parser);
        if (parsed.toolEvent) {
          toolEventCount += 1;
        }
      }
      const totalMs = elapsedMs(startedAt);
      resolve({
        variant: variant.id,
        run,
        success: code === 0 && !timedOut && firstAssistantMs !== null && toolEventCount === 0,
        exitCode: code,
        signal,
        timedOut,
        toolEventCount,
        firstJsonEventMs,
        firstAssistantMs,
        completedMs: completedMs ?? totalMs,
        totalMs,
        assistantText: assistantText.trim(),
        usage,
        stderrPreview: preview(stderr),
        stdoutPreview: preview(stdout)
      });
    });
  });
}

function nextLines(text) {
  const parts = text.split('\n');
  const remainder = parts.pop() ?? '';
  return {
    lines: parts.map((line) => line.trim()).filter(Boolean),
    remainder
  };
}

function parseEventLine(line, parser) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return {};
  }

  if (parser === 'pi') {
    if (value.type?.startsWith('tool_execution')) {
      return { isJson: true, toolEvent: true };
    }
    const event = value.assistantMessageEvent;
    if (event?.type === 'text_delta') {
      return { isJson: true, assistantDelta: event.delta ?? '' };
    }
    if (value.type === 'message_end' && value.message?.role === 'assistant') {
      return { isJson: true, completed: true, assistantText: extractPiAssistantText(value.message) };
    }
    if (value.type === 'agent_end') {
      return { isJson: true, completed: true };
    }
    return { isJson: true };
  }

  if (parser === 'codex') {
    if (codexItemIsToolEvent(value.item)) {
      return { isJson: true, toolEvent: true };
    }
    if (value.type === 'item.completed' && value.item?.type === 'agent_message') {
      return { isJson: true, completed: true, assistantText: value.item.text ?? '' };
    }
    if (value.type === 'turn.completed') {
      return { isJson: true, completed: true, usage: value.usage };
    }
    return { isJson: true };
  }

  return { isJson: true };
}

function codexItemIsToolEvent(item) {
  return [
    'command_execution',
    'web_search',
    'todo_list',
    'tool_search',
    'mcp_tool_call',
    'function_call',
    'local_shell_call'
  ].includes(item?.type);
}

function extractPiAssistantText(message) {
  if (typeof message?.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        return part?.text ?? '';
      })
      .join('');
  }

  return '';
}

function summarise(allResults) {
  return variants.map((variant) => {
    const variantResults = allResults.filter((result) => result.variant === variant.id);
    const successes = variantResults.filter((result) => result.success);
    const failures = variantResults.length - successes.length;

    return {
      variant: variant.id,
      runs: variantResults.length,
      successes: successes.length,
      failures,
      medianFirstAssistantMs: median(successes.map((result) => result.firstAssistantMs)),
      medianCompletedMs: median(successes.map((result) => result.completedMs)),
      bestFirstAssistantMs: minimum(successes.map((result) => result.firstAssistantMs)),
      bestCompletedMs: minimum(successes.map((result) => result.completedMs)),
      toolEvents: variantResults.reduce((sum, result) => sum + result.toolEventCount, 0),
      firstFailure: failures > 0
        ? variantResults.find((result) => !result.success)?.stderrPreview
          || variantResults.find((result) => !result.success)?.stdoutPreview
          || null
        : null
    };
  });
}

function median(values) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (numbers.length === 0) {
    return null;
  }
  return numbers[Math.floor(numbers.length / 2)];
}

function minimum(values) {
  const numbers = values.filter(Number.isFinite);
  if (numbers.length === 0) {
    return null;
  }
  return Math.min(...numbers);
}

function elapsedMs(startedAt) {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}

function preview(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

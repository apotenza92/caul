import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const phrase = process.env.SUSURA_BENCH_PHRASE
  ?? 'What is the refund policy for annual plans?';
const minWordOverlap = Number(process.env.SUSURA_BENCH_MIN_WORD_OVERLAP ?? 0.45);
const fixtureDir = await mkdtemp(path.join(tmpdir(), 'susura-parakeet-direct-'));
const aiffPath = path.join(fixtureDir, 'fixture.aiff');
const wavPath = path.join(fixtureDir, 'fixture-16k-mono.wav');

await writeFile(path.join(fixtureDir, 'fixture.txt'), phrase, 'utf8');
await run('say', ['-o', aiffPath, phrase]);
await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiffPath, wavPath]);

const output = await run('target/debug/susura-desktop-backend', ['--transcribe-parakeet-wav', wavPath]);
const resultLine = output
  .split('\n')
  .find((line) => line.includes('"type":"parakeet_direct_bench"'));

if (!resultLine) {
  throw new Error(`Parakeet direct benchmark did not emit a result: ${output.trim()}`);
}

const result = JSON.parse(resultLine);
const wordOverlap = scoreTranscript(phrase, result.transcript ?? '');
const benchmark = {
  phrase,
  transcript: result.transcript,
  wordOverlap,
  audioDurationMs: result.audio_duration_ms,
  audioReadMs: result.audio_read_ms,
  modelLoadMs: result.model_load_ms,
  asrMs: result.asr_ms,
  rms: result.rms,
  peak: result.peak,
  audioReadToAsrCompletedMs: result.asr_completed_at_ms - result.audio_read_started_at_ms,
  fixtureWavPath: wavPath
};

console.log(`susura-parakeet-direct-bench ${JSON.stringify(benchmark)}`);

if (wordOverlap < minWordOverlap || !result.transcript) {
  process.exit(1);
}

function scoreTranscript(expected, actual) {
  const actualWords = new Set(normaliseWords(actual));
  const expectedWords = [...new Set(normaliseWords(expected).filter((word) => word.length > 3))];

  if (expectedWords.length === 0) {
    return 0;
  }

  const hits = expectedWords.filter((word) => actualWords.has(word)).length;
  return hits / expectedWords.length;
}

function normaliseWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}\n${stdout.trim()}`));
    });
  });
}

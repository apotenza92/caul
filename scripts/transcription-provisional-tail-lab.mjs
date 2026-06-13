import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const artifactDir = path.resolve(process.env.CAUL_TRANSCRIPTION_LAB_DIR ?? path.join('artifacts', 'transcription-lab'));
const sourceDir = path.join(artifactDir, 'source');
const windowsDir = path.join(artifactDir, 'windows');
const resultsDir = path.join(artifactDir, 'results');
const backendPath = process.env.CAUL_TRANSCRIPTION_LAB_BACKEND ?? path.join('target', 'debug', 'caul-desktop-backend');
const librivoxCatalogUrl = 'https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll/';
const gutenbergTextUrl = 'https://www.gutenberg.org/files/11/11-0.txt';
const sourceMp3Path = path.join(sourceDir, 'alice-chapter-1.mp3');
const sourceWavPath = path.join(sourceDir, 'alice-chapter-1-16k-mono.wav');
const excerptWavPath = path.join(sourceDir, 'alice-chapter-1-excerpt-16k-mono.wav');
const startupWavPath = path.join(sourceDir, 'alice-startup-excerpt-16k-mono.wav');
const gutenbergTextPath = path.join(sourceDir, 'alice-gutenberg.txt');
const referenceTextPath = path.join(sourceDir, 'alice-chapter-1-reference.txt');
const generatedEventsPath = path.join(resultsDir, 'events.jsonl');
const generatedStatesPath = path.join(resultsDir, 'states.jsonl');
const startupEventsPath = path.join(resultsDir, 'startup-events.jsonl');
const startupStatesPath = path.join(resultsDir, 'startup-states.jsonl');
const summaryPath = path.join(resultsDir, 'summary.json');
const finalTranscriptPath = path.join(resultsDir, 'final-transcript.txt');
const startupTranscriptPath = path.join(resultsDir, 'startup-final-transcript.txt');
const startupRawTranscriptPath = path.join(resultsDir, 'startup-raw-final-transcript.txt');
const startupReferenceWindowPath = path.join(resultsDir, 'startup-reference-window.txt');
const excerptStartSeconds = Number(process.env.CAUL_TRANSCRIPTION_LAB_SKIP_SECONDS ?? 45);
const excerptSeconds = Number(process.env.CAUL_TRANSCRIPTION_LAB_EXCERPT_SECONDS ?? 240);
const startupSeconds = Number(process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_SECONDS ?? 60);
const minReferenceCoverage = Number(process.env.CAUL_TRANSCRIPTION_LAB_MIN_REFERENCE_COVERAGE ?? 0.45);
const minReferenceRecall = Number(process.env.CAUL_TRANSCRIPTION_LAB_MIN_REFERENCE_RECALL ?? 0.25);
const minUniqueActualWords = Number(process.env.CAUL_TRANSCRIPTION_LAB_MIN_UNIQUE_WORDS ?? 120);
const minGeneratedPartialEvents = Number(process.env.CAUL_TRANSCRIPTION_LAB_MIN_PARTIAL_EVENTS ?? 3);
const minStartupReferenceCoverage = Number(process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_MIN_REFERENCE_COVERAGE ?? 0.6);
const minStartupReferenceRecall = Number(process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_MIN_REFERENCE_RECALL ?? 0.45);
const minStartupOpeningCoverage = Number(process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_MIN_OPENING_COVERAGE ?? 0.7);
const startupOpeningWordCount = Number(process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_OPENING_WORDS ?? 8);
const maxStartupWarmFirstPartialMs = Number(process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_MAX_WARM_FIRST_PARTIAL_MS ?? 10_000);
const maxStartupColdFirstPartialMs = Number(process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_MAX_COLD_FIRST_PARTIAL_MS ?? 14_000);
const maxAsrEventMs = Number(process.env.CAUL_TRANSCRIPTION_LAB_MAX_ASR_EVENT_MS ?? 30_000);
const knownDuplicateBoundaryPhrases = [
  'But I shall have to ask them'
];
const allowFail = process.env.CAUL_TRANSCRIPTION_LAB_ALLOW_FAIL === '1';
const selfTestOnly = process.argv.includes('--self-test');
const helpRequested = process.argv.includes('--help') || process.argv.includes('-h');

if (helpRequested) {
  printHelp();
  process.exit(0);
}

await mkdir(resultsDir, { recursive: true });
await mkdir(windowsDir, { recursive: true });
writeFileSync(generatedEventsPath, '');
writeFileSync(generatedStatesPath, '');
writeFileSync(startupEventsPath, '');
writeFileSync(startupStatesPath, '');

const reducerSelfTest = runReducerSelfTest();
const eventTraceSelfTest = runEventTraceSelfTest();

if (selfTestOnly) {
  const summary = {
    eventTrace: eventTraceSelfTest,
    ok: reducerSelfTest.ok && eventTraceSelfTest.ok,
    mode: 'self-test',
    provisional: reducerSelfTest
  };
  await writeJson(summaryPath, summary);
  console.log(`caul-transcription-provisional-tail-lab ${JSON.stringify(summary)}`);
  process.exit(summary.ok || allowFail ? 0 : 1);
}

await mkdir(sourceDir, { recursive: true });
await ensureBackend();
const audioUrl = await resolveAudioUrlForSource();
await ensureDownloaded(sourceMp3Path, audioUrl);
await ensureDownloaded(gutenbergTextPath, gutenbergTextUrl);
await convertToMono16kWav(sourceMp3Path, sourceWavPath);
const audioInfo = sliceWav(sourceWavPath, excerptWavPath, {
  durationSeconds: excerptSeconds,
  startSeconds: excerptStartSeconds
});
const referenceText = extractChapterOne(readFileSync(gutenbergTextPath, 'utf8'));
await writeFile(referenceTextPath, `${referenceText.trim()}\n`, 'utf8');

const finalResult = await transcribeWav(excerptWavPath, 'final');
await writeFile(finalTranscriptPath, `${finalResult.transcript.trim()}\n`, 'utf8');

const generatedEvents = await generateAsrEventTrace({
  finalResult,
  finalTranscript: finalResult.transcript,
  referenceText,
  sourceWav: excerptWavPath,
  totalSeconds: audioInfo.durationMs / 1000
});
const replay = await replayEvents([...generatedEvents, ...stressEvents()], {
  eventsPath: generatedEventsPath,
  requireMicrophoneLabel: true,
  statesPath: generatedStatesPath,
  strictStressInvariants: true
});
const finalScore = scoreTranscriptAgainstReference(referenceText, finalResult.transcript);
const formattingReport = analyseChunkFormatting(finalResult);
const generatedPartialEventCount = generatedEvents.filter((event) => event.type === 'partial').length;
const generatedFinalEventCount = generatedEvents.filter((event) => event.type === 'completed').length;
const maxGeneratedEventDurationMs = generatedEvents.reduce((maxDuration, event) => (
  Math.max(maxDuration, Math.max(0, Number(event.endMs ?? 0) - Number(event.startMs ?? 0)))
), 0);
const startup = await runStartupTimingLab({ referenceText });
const verification = [
  ...buildVerificationChecks({
    finalResult,
    finalScore,
    formattingReport,
    generatedFinalEventCount,
    maxGeneratedEventDurationMs,
    generatedPartialEventCount,
    replay,
    reducerSelfTest
  }),
  ...startup.verification
];
const ok = verification.every((check) => check.ok);
const summary = {
  ok,
  artifactDir,
  sources: {
    audioCatalogue: librivoxCatalogUrl,
    audioUrl,
    referenceText: gutenbergTextUrl
  },
  audio: {
    excerptDurationMs: audioInfo.durationMs,
    excerptStartSeconds,
    excerptWavPath,
    sourceMp3Path,
    sourceWavPath
  },
  finalAsr: {
    audioDurationMs: finalResult.audio_duration_ms,
    asrMs: finalResult.asr_ms,
    modelLoadMs: finalResult.model_load_ms,
    peak: finalResult.peak,
    referenceCoverage: finalScore.referenceCoverage,
    referenceRecall: finalScore.referenceRecall,
    rms: finalResult.rms,
    formatting: formattingReport,
    transcriptPath: finalTranscriptPath,
    uniqueActualWords: finalScore.uniqueActualWords,
    uniqueReferenceWords: finalScore.uniqueReferenceWords
  },
  provisional: {
    eventCount: replay.eventCount,
    eventsPath: generatedEventsPath,
    generatedAsrEvents: generatedEvents.length,
    generatedFinalEvents: generatedFinalEventCount,
    generatedPartialEvents: generatedPartialEventCount,
    invariants: replay.invariants,
    maxGeneratedEventDurationMs,
    ok: replay.ok,
    reducerSelfTest: reducerSelfTest.ok,
    statesPath: generatedStatesPath,
    stressEvents: stressEvents().length
  },
  startup,
  verification
};

await writeJson(summaryPath, summary);
console.log(`caul-transcription-provisional-tail-lab ${JSON.stringify(summary)}`);

if (!ok && !allowFail) {
  process.exit(1);
}

function printHelp() {
  console.log(`Usage: node scripts/transcription-provisional-tail-lab.mjs [--self-test]

Downloads a public-domain LibriVox audiobook chapter, converts it to 16 kHz mono WAV,
runs Parakeet on an excerpt, then replays generated partial/final events through a
lab-only provisional transcript tail reducer.

Useful environment:
  CAUL_TRANSCRIPTION_LAB_DIR                 output directory, default artifacts/transcription-lab
  CAUL_TRANSCRIPTION_LAB_AUDIO_URL           direct audio override
  CAUL_TRANSCRIPTION_LAB_SKIP_SECONDS        excerpt start offset, default 45
  CAUL_TRANSCRIPTION_LAB_EXCERPT_SECONDS     excerpt length, default 240
  CAUL_TRANSCRIPTION_LAB_PARTIAL_SECONDS     comma list for partial windows, default 30,60,90,120,180
  CAUL_TRANSCRIPTION_LAB_STARTUP_SECONDS     startup excerpt length, default 60
  CAUL_TRANSCRIPTION_LAB_STARTUP_PARTIAL_SECONDS comma list for startup partial windows, default 1.5,2,3,4,5,7,10,14,18,22,30,40
  CAUL_TRANSCRIPTION_LAB_STARTUP_MIN_REFERENCE_COVERAGE default 0.6
  CAUL_TRANSCRIPTION_LAB_STARTUP_MIN_OPENING_COVERAGE default 0.7
  CAUL_TRANSCRIPTION_LAB_STARTUP_OPENING_WORDS default 8
  CAUL_TRANSCRIPTION_LAB_STARTUP_MAX_WARM_FIRST_PARTIAL_MS default 10000
  CAUL_TRANSCRIPTION_LAB_STARTUP_MAX_COLD_FIRST_PARTIAL_MS default 14000
  CAUL_TRANSCRIPTION_LAB_MAX_ASR_EVENT_MS      default 30000
  CAUL_TRANSCRIPTION_LAB_MIN_REFERENCE_COVERAGE default 0.45
  CAUL_TRANSCRIPTION_LAB_MIN_REFERENCE_RECALL default 0.25
  CAUL_TRANSCRIPTION_LAB_MIN_UNIQUE_WORDS    default 120
  CAUL_TRANSCRIPTION_LAB_MIN_PARTIAL_EVENTS  default 3
  CAUL_TRANSCRIPTION_LAB_ALLOW_FAIL=1        write artefacts without failing the process
`);
}

function buildVerificationChecks({
  finalResult,
  finalScore,
  formattingReport,
  generatedFinalEventCount,
  generatedPartialEventCount,
  maxGeneratedEventDurationMs,
  replay,
  reducerSelfTest
}) {
  const checks = [
    {
      actual: finalResult.transcript.trim().length,
      name: 'final transcript is non-empty',
      ok: finalResult.transcript.trim().length > 0,
      required: '> 0 characters'
    },
    {
      actual: finalScore.referenceCoverage,
      name: 'final transcript words overlap Gutenberg chapter',
      ok: finalScore.referenceCoverage >= minReferenceCoverage,
      required: `>= ${minReferenceCoverage}`
    },
    {
      actual: finalScore.referenceRecall,
      name: 'excerpt covers enough Gutenberg vocabulary for a real long-form check',
      ok: finalScore.referenceRecall >= minReferenceRecall,
      required: `>= ${minReferenceRecall}`
    },
    {
      actual: finalScore.uniqueActualWords,
      name: 'final transcript contains enough unique words to avoid trivial passes',
      ok: finalScore.uniqueActualWords >= minUniqueActualWords,
      required: `>= ${minUniqueActualWords}`
    },
    {
      actual: generatedPartialEventCount,
      name: 'generated ASR partial windows are present',
      ok: generatedPartialEventCount >= minGeneratedPartialEvents,
      required: `>= ${minGeneratedPartialEvents}`
    },
    {
      actual: generatedFinalEventCount,
      name: 'generated final utterance events are present',
      ok: generatedFinalEventCount > 0,
      required: '> 0'
    },
    {
      actual: maxGeneratedEventDurationMs,
      name: 'generated ASR events stay within bounded Parakeet windows',
      ok: maxGeneratedEventDurationMs <= maxAsrEventMs,
      required: `<= ${maxAsrEventMs}`
    },
    {
      actual: reducerSelfTest.ok,
      name: 'pure reducer self-test passes',
      ok: reducerSelfTest.ok,
      required: true
    },
    {
      actual: replay.ok,
      name: 'replayed generated and stress events preserve transcript invariants',
      ok: replay.ok,
      required: true
    },
    {
      actual: finalResult.stitched,
      name: 'chunked direct WAV output records stitched transcript mode',
      ok: finalResult.mode !== 'chunked' || finalResult.stitched === true,
      required: true
    },
    {
      actual: formattingReport.knownDuplicateBoundaryPhrases,
      name: 'stitched transcript removes known duplicated chunk-boundary phrases',
      ok: formattingReport.knownDuplicateBoundaryPhrases.every((phrase) => (
        phrase.rawOccurrences <= 1 || phrase.stitchedOccurrences <= 1
      )),
      required: '<= 1 stitched occurrence when raw transcript repeats the phrase'
    }
  ];

  for (const [name, actual] of Object.entries(replay.invariants)) {
    if (name === 'previouslySeenDrafts') {
      checks.push({
        actual,
        name: 'at least one provisional draft tail was exercised',
        ok: actual > 0,
        required: '> 0'
      });
      continue;
    }

    checks.push({
      actual,
      name: `invariant: ${name}`,
      ok: name === 'partialAfterFinalVisible' ? actual === false : actual === true,
      required: name === 'partialAfterFinalVisible' ? false : true
    });
  }

  return checks;
}

function analyseChunkFormatting(finalResult) {
  const rawTranscript = typeof finalResult.raw_transcript === 'string'
    ? finalResult.raw_transcript
    : Array.isArray(finalResult.chunks)
      ? finalResult.chunks
        .map((chunk) => typeof chunk.transcript === 'string' ? chunk.transcript.trim() : '')
        .filter(Boolean)
        .join('\n')
      : '';
  const stitchedTranscript = typeof finalResult.transcript === 'string' ? finalResult.transcript : '';
  const knownDuplicateBoundaryPhraseReports = knownDuplicateBoundaryPhrases.map((phrase) => ({
    phrase,
    rawOccurrences: countNormalisedPhraseOccurrences(rawTranscript, phrase),
    stitchedOccurrences: countNormalisedPhraseOccurrences(stitchedTranscript, phrase)
  }));
  const rawChars = rawTranscript.trim().length;
  const stitchedChars = stitchedTranscript.trim().length;

  return {
    knownDuplicateBoundaryPhrases: knownDuplicateBoundaryPhraseReports,
    rawChars,
    removedChars: Math.max(0, rawChars - stitchedChars),
    stitched: finalResult.mode === 'chunked' ? finalResult.stitched === true : Boolean(finalResult.stitched),
    stitchedChars
  };
}

function countNormalisedPhraseOccurrences(text, phrase) {
  const haystack = normaliseForPhraseCount(text);
  const needle = normaliseForPhraseCount(phrase);

  if (!haystack || !needle) {
    return 0;
  }

  let count = 0;
  let offset = 0;

  while (offset <= haystack.length) {
    const index = haystack.indexOf(needle, offset);

    if (index < 0) {
      break;
    }

    count += 1;
    offset = index + needle.length;
  }

  return count;
}

function normaliseForPhraseCount(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function runStartupTimingLab({ referenceText }) {
  const startupWindowsDir = path.join(windowsDir, 'startup');
  await mkdir(startupWindowsDir, { recursive: true });
  const startupInfo = sliceWav(sourceWavPath, startupWavPath, {
    durationSeconds: startupSeconds,
    startSeconds: excerptStartSeconds
  });
  const totalSeconds = startupInfo.durationMs / 1000;
  const finalResult = await transcribeWav(startupWavPath, 'startup-final');
  const rawFinalTranscript = finalResult.transcript.trim();
  await writeFile(startupRawTranscriptPath, `${rawFinalTranscript}\n`, 'utf8');

  const generatedEvents = await generateAsrEventTrace({
    finalTranscript: finalResult.transcript,
    partialSeconds: getStartupPartialSeconds(totalSeconds),
    referenceText,
    sourceWav: startupWavPath,
    totalSeconds,
    windowDir: startupWindowsDir,
    windowPrefix: 'alice-startup-window'
  });
  const replay = await replayEvents(generatedEvents, {
    eventsPath: startupEventsPath,
    requireMicrophoneLabel: false,
    statesPath: startupStatesPath,
    strictStressInvariants: false
  });
  const rescuedFinalTranscript = replay.finalSnapshot.confirmed.find((line) => line.key === 'system:1')?.text.trim() ?? rawFinalTranscript;
  await writeFile(startupTranscriptPath, `${rescuedFinalTranscript}\n`, 'utf8');
  const finalScore = scoreTranscriptAgainstBestReferenceWindow(referenceText, rescuedFinalTranscript);
  await writeFile(startupReferenceWindowPath, `${finalScore.referenceWindowText.trim()}\n`, 'utf8');

  const partials = generatedEvents.filter((event) => event.type === 'partial');
  const nonEmptyPartials = partials.filter((event) => event.text.trim());
  const firstNonEmptyPartial = nonEmptyPartials[0] ?? null;
  const openingCoverageBefore = scoreOpeningWords(firstNonEmptyPartial?.text ?? '', rawFinalTranscript);
  const openingCoverageAfter = scoreOpeningWords(firstNonEmptyPartial?.text ?? '', rescuedFinalTranscript);
  const startupLine = replay.finalSnapshot.confirmed.find((line) => line.key === 'system:1');
  const openingRescue = startupLine?.openingRescue ?? createNoopOpeningRescue(rawFinalTranscript);
  const finalVisibleWarmMs = Math.round(startupInfo.durationMs + finalResult.asr_ms);
  const finalVisibleColdMs = Math.round(startupInfo.durationMs + finalResult.model_load_ms + finalResult.asr_ms);
  const verification = buildStartupVerificationChecks({
    finalResult,
    finalScore,
    firstNonEmptyPartial,
    openingCoverageAfter,
    openingRescue,
    replay
  });

  return {
    audio: {
      durationMs: startupInfo.durationMs,
      startSeconds: excerptStartSeconds,
      wavPath: startupWavPath
    },
    finalAsr: {
      asrMs: finalResult.asr_ms,
      bestReferenceCoverage: finalScore.referenceCoverage,
      bestReferenceRecall: finalScore.referenceRecall,
      coldFinalVisibleMs: finalVisibleColdMs,
      modelLoadMs: finalResult.model_load_ms,
      peak: finalResult.peak,
      referenceWindowPath: startupReferenceWindowPath,
      rms: finalResult.rms,
      rawTranscriptChars: rawFinalTranscript.length,
      rawTranscriptPath: startupRawTranscriptPath,
      rescuedTranscriptChars: rescuedFinalTranscript.length,
      transcriptPath: startupTranscriptPath,
      uniqueActualWords: finalScore.uniqueActualWords,
      uniqueReferenceWindowWords: finalScore.uniqueReferenceWords,
      warmFinalVisibleMs: finalVisibleWarmMs,
      wallMs: finalResult.wall_ms
    },
    firstPartial: firstNonEmptyPartial ? {
      asrMs: firstNonEmptyPartial.asrMs,
      audioWindowMs: firstNonEmptyPartial.endMs,
      coldVisibleMs: firstNonEmptyPartial.coldVisibleMs,
      modelLoadMs: firstNonEmptyPartial.modelLoadMs,
      text: firstNonEmptyPartial.text,
      transcriptChars: firstNonEmptyPartial.text.length,
      warmVisibleMs: firstNonEmptyPartial.warmVisibleMs,
      wallMs: firstNonEmptyPartial.wallMs
    } : null,
    partialWindows: partials.map((event) => ({
      asrMs: event.asrMs,
      audioWindowMs: event.endMs,
      coldVisibleMs: event.coldVisibleMs,
      modelLoadMs: event.modelLoadMs,
      transcriptChars: event.text.length,
      warmVisibleMs: event.warmVisibleMs,
      wallMs: event.wallMs
    })),
    provisional: {
      eventCount: replay.eventCount,
      eventsPath: startupEventsPath,
      generatedPartialEvents: partials.length,
      invariants: replay.invariants,
      nonEmptyPartialEvents: nonEmptyPartials.length,
      ok: replay.ok,
      statesPath: startupStatesPath
    },
    openingCheck: openingCoverageAfter,
    openingRescue: {
      ...openingRescue,
      openingCoverageAfter: openingCoverageAfter.coverage,
      openingCoverageBefore: openingCoverageBefore.coverage
    },
    verification
  };
}

function buildStartupVerificationChecks({ finalResult, finalScore, firstNonEmptyPartial, openingCoverageAfter, openingRescue, replay }) {
  return [
    {
      actual: finalResult.transcript.trim().length,
      name: 'startup final transcript is non-empty',
      ok: finalResult.transcript.trim().length > 0,
      required: '> 0 characters'
    },
    {
      actual: firstNonEmptyPartial?.text.length ?? 0,
      name: 'startup has a non-empty first partial',
      ok: Boolean(firstNonEmptyPartial?.text.trim()),
      required: '> 0 characters'
    },
    {
      actual: firstNonEmptyPartial?.warmVisibleMs ?? null,
      name: 'startup first partial warm visible estimate',
      ok: Boolean(firstNonEmptyPartial) && firstNonEmptyPartial.warmVisibleMs <= maxStartupWarmFirstPartialMs,
      required: `<= ${maxStartupWarmFirstPartialMs} ms`
    },
    {
      actual: firstNonEmptyPartial?.coldVisibleMs ?? null,
      name: 'startup first partial cold visible estimate',
      ok: Boolean(firstNonEmptyPartial) && firstNonEmptyPartial.coldVisibleMs <= maxStartupColdFirstPartialMs,
      required: `<= ${maxStartupColdFirstPartialMs} ms`
    },
    {
      actual: finalScore.referenceCoverage,
      name: 'startup final transcript overlaps aligned Gutenberg window',
      ok: finalScore.referenceCoverage >= minStartupReferenceCoverage,
      required: `>= ${minStartupReferenceCoverage}`
    },
    {
      actual: finalScore.referenceRecall,
      name: 'startup aligned Gutenberg window is substantially covered',
      ok: finalScore.referenceRecall >= minStartupReferenceRecall,
      required: `>= ${minStartupReferenceRecall}`
    },
    {
      actual: openingCoverageAfter.coverage,
      name: 'startup final preserves the opening spoken words',
      ok: openingCoverageAfter.coverage >= minStartupOpeningCoverage,
      required: `>= ${minStartupOpeningCoverage}`
    },
    {
      actual: openingRescue.openingCoverageAfter,
      name: 'startup opening rescue preserves or restores opening words',
      ok: openingRescue.openingCoverageAfter >= minStartupOpeningCoverage,
      required: `>= ${minStartupOpeningCoverage}`
    },
    {
      actual: replay.ok,
      name: 'startup provisional replay preserves core invariants',
      ok: replay.ok,
      required: true
    }
  ];
}

async function ensureBackend() {
  if (existsSync(backendPath)) {
    return;
  }

  if (process.env.CAUL_TRANSCRIPTION_LAB_BUILD_BACKEND === '0') {
    throw new Error(`Missing backend at ${backendPath}. Run npm run desktop-backend:build first.`);
  }

  await run('node', ['scripts/build-desktop-backend.mjs'], { inherit: true });

  if (!existsSync(backendPath)) {
    throw new Error(`Backend build completed but ${backendPath} was not found.`);
  }
}

async function resolveAudioUrl() {
  if (process.env.CAUL_TRANSCRIPTION_LAB_AUDIO_URL) {
    return process.env.CAUL_TRANSCRIPTION_LAB_AUDIO_URL;
  }

  const catalogHtml = await run('curl', ['-L', '--fail', '--silent', '--show-error', librivoxCatalogUrl]);
  const directMp3 = collectMatches(catalogHtml, /href=["']([^"']+\.mp3(?:\?[^"']*)?)["']/gi)
    .map(decodeHtml)
    .find((url) => /(?:^|[_/-])(?:ch(?:apter)?[_-]?)?0?1(?:[_./-]|$)/i.test(url))
    ?? null;

  if (directMp3) {
    return directMp3;
  }

  const archiveIds = [
    ...collectMatches(catalogHtml, /archive\.org\/download\/([^/"'?]+)/gi),
    ...collectMatches(catalogHtml, /archive\.org\/details\/([^/"'?]+)/gi)
  ].filter((value, index, values) => values.indexOf(value) === index);

  for (const archiveId of archiveIds) {
    const metadata = await fetchJson(`https://archive.org/metadata/${archiveId}`).catch(() => null);
    const files = Array.isArray(metadata?.files) ? metadata.files : [];
    const mp3 = files
      .filter((file) => typeof file?.name === 'string' && /\.mp3$/i.test(file.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .find((file) => /(?:^|[_/-])(?:ch(?:apter)?[_-]?)?0?1(?:[_./-]|$)/i.test(file.name))
      ?? files
        .filter((file) => typeof file?.name === 'string' && /\.mp3$/i.test(file.name))
        .sort((left, right) => left.name.localeCompare(right.name))[0];

    if (mp3?.name) {
      return `https://archive.org/download/${archiveId}/${encodeArchivePath(mp3.name)}`;
    }
  }

  throw new Error(`Could not discover a Chapter 1 MP3 from ${librivoxCatalogUrl}. Set CAUL_TRANSCRIPTION_LAB_AUDIO_URL.`);
}

async function resolveAudioUrlForSource() {
  if (process.env.CAUL_TRANSCRIPTION_LAB_AUDIO_URL) {
    return process.env.CAUL_TRANSCRIPTION_LAB_AUDIO_URL;
  }

  if (existsSync(sourceMp3Path) && readFileSync(sourceMp3Path).length > 0) {
    return `file://${sourceMp3Path}`;
  }

  return resolveAudioUrl();
}

async function ensureDownloaded(filePath, url) {
  if (existsSync(filePath) && readFileSync(filePath).length > 0) {
    return;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  await run('curl', ['-L', '--fail', '--silent', '--show-error', '--output', filePath, url], { inherit: true });
}

async function convertToMono16kWav(inputPath, outputPath) {
  if (existsSync(outputPath)) {
    const existing = readWavInfo(outputPath);
    if (existing.channels === 1 && existing.sampleRate === 16_000 && existing.bitsPerSample === 16) {
      return;
    }
  }

  await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', inputPath, outputPath], { inherit: true });
}

async function generateAsrEventTrace({
  finalResult,
  finalTranscript,
  partialSeconds,
  referenceText,
  sourceWav,
  totalSeconds,
  windowDir = windowsDir,
  windowPrefix = 'alice-window'
}) {
  if (finalResult?.mode === 'chunked' && Array.isArray(finalResult.chunks) && finalResult.chunks.length > 0) {
    return generateChunkedAsrEventTrace(finalResult);
  }

  const resolvedPartialSeconds = partialSeconds ?? getPartialSeconds(totalSeconds);
  const events = [];

  for (const seconds of resolvedPartialSeconds) {
    const windowPath = path.join(windowDir, `${windowPrefix}-${formatSecondsLabel(seconds)}s.wav`);
    sliceWav(sourceWav, windowPath, {
      durationSeconds: seconds,
      startSeconds: 0
    });
    const result = await transcribeWav(windowPath, `partial-${seconds}s`);
    const score = scoreTranscriptAgainstReference(referenceText, result.transcript);
    const endMs = Math.round(seconds * 1000);
    events.push({
      asrMs: result.asr_ms,
      coldVisibleMs: Math.round(endMs + result.model_load_ms + result.asr_ms),
      endMs,
      modelLoadMs: result.model_load_ms,
      referenceCoverage: score.referenceCoverage,
      source: 'system',
      startMs: 0,
      text: result.transcript,
      transcriptChars: result.transcript.length,
      type: 'partial',
      utteranceId: 1,
      wallMs: result.wall_ms,
      warmVisibleMs: Math.round(endMs + result.asr_ms)
    });
  }

  events.push({
    endMs: Math.round(totalSeconds * 1000),
    source: 'system',
    startMs: 0,
    text: finalTranscript,
    type: 'completed',
    utteranceId: 1
  });

  return events;
}

function generateChunkedAsrEventTrace(finalResult) {
  const events = [];

  for (const chunk of finalResult.chunks) {
    const text = typeof chunk.stitched_transcript === 'string'
      ? chunk.stitched_transcript.trim()
      : typeof chunk.transcript === 'string'
        ? chunk.transcript.trim()
        : '';
    if (!text) {
      continue;
    }

    const utteranceId = Number(chunk.index) + 1;
    const startMs = Number.isFinite(chunk.start_ms) ? Number(chunk.start_ms) : 0;
    const endMs = Number.isFinite(chunk.end_ms) ? Number(chunk.end_ms) : startMs;
    const partialText = provisionalPrefix(text);

    if (partialText) {
      events.push({
        endMs: Math.max(startMs, Math.min(endMs, startMs + Math.round((endMs - startMs) * 0.6))),
        source: 'system',
        startMs,
        text: partialText,
        transcriptChars: partialText.length,
        type: 'partial',
        utteranceId
      });
    }

    events.push({
      endMs,
      source: 'system',
      startMs,
      text,
      transcriptChars: text.length,
      type: 'completed',
      utteranceId
    });
  }

  return events;
}

function provisionalPrefix(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return text.trim();
  }

  const keep = Math.max(1, Math.ceil(words.length * 0.6));
  return words.slice(0, keep).join(' ');
}

function getPartialSeconds(totalSeconds) {
  const configured = process.env.CAUL_TRANSCRIPTION_LAB_PARTIAL_SECONDS
    ? process.env.CAUL_TRANSCRIPTION_LAB_PARTIAL_SECONDS
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
    : [30, 60, 90, 120, 180, 240];

  return configured
    .filter((seconds) => seconds < totalSeconds - 1)
    .filter((seconds, index, values) => values.indexOf(seconds) === index);
}

function getStartupPartialSeconds(totalSeconds) {
  const configured = process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_PARTIAL_SECONDS
    ? process.env.CAUL_TRANSCRIPTION_LAB_STARTUP_PARTIAL_SECONDS
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
    : [1.5, 2, 3, 4, 5, 7, 10, 14, 18, 22, 30, 40];

  return configured
    .filter((seconds) => seconds < totalSeconds - 0.25)
    .filter((seconds, index, values) => values.indexOf(seconds) === index);
}

function formatSecondsLabel(seconds) {
  return String(Math.round(seconds * 10)).padStart(4, '0').replace(/0$/, '');
}

function stressEvents() {
  return [
    {
      endMs: 999_000,
      source: 'system',
      startMs: 0,
      text: 'late partial after final should be ignored',
      type: 'partial',
      utteranceId: 1
    },
    {
      endMs: 1_000,
      source: 'system',
      startMs: 1_000,
      text: 'Second confirmed system line.',
      type: 'completed',
      utteranceId: 2
    },
    {
      endMs: 1_800,
      source: 'microphone',
      startMs: 1_200,
      text: 'microphone draft words change',
      type: 'partial',
      utteranceId: 1
    },
    {
      endMs: 1_600,
      source: 'microphone',
      startMs: 1_200,
      text: 'older microphone draft should be ignored',
      type: 'partial',
      utteranceId: 1
    },
    {
      endMs: 2_100,
      source: 'microphone',
      startMs: 1_200,
      text: 'microphone',
      type: 'partial',
      utteranceId: 1
    },
    {
      endMs: 2_200,
      source: 'microphone',
      startMs: 1_200,
      text: '',
      type: 'partial',
      utteranceId: 1
    },
    {
      endMs: 2_600,
      source: 'microphone',
      startMs: 1_200,
      text: 'Microphone final words.',
      type: 'completed',
      utteranceId: 1
    }
  ];
}

async function replayEvents(events, options = {}) {
  const {
    eventsPath = generatedEventsPath,
    requireMicrophoneLabel = true,
    statesPath = generatedStatesPath,
    strictStressInvariants = true
  } = options;
  const reducer = createProvisionalTranscriptReducer();
  const invariants = {
    confirmedNeverShrank: true,
    draftNeverBlankedBeforeFinal: true,
    draftTailShortened: false,
    draftTailWasReplaced: false,
    finalReplacedDraft: true,
    olderPartialIgnored: false,
    partialAfterFinalIgnored: true,
    permanentNeverContainsKnownDraftText: true,
    permanentTranscriptHasNoDrafts: true,
    partialNeverChangedConfirmed: true,
    sourceLabelsPresent: true
  };
  let previousPermanent = '';
  const previousDraftKeys = new Map();
  let partialAfterFinalVisible = false;

  for (const event of events) {
    const before = reducer.snapshot();
    const after = reducer.apply(event);
    const key = eventKey(event);
    const draftBefore = key ? before.drafts.find((draft) => draft.key === key) : null;
    const draftAfter = key ? after.drafts.find((draft) => draft.key === key) : null;

    await appendJsonLine(eventsPath, event);
    await appendJsonLine(statesPath, {
      event,
      permanentTranscript: after.permanentTranscript,
      visibleTranscript: after.visibleTranscript
    });

    if (after.permanentTranscript.length < previousPermanent.length) {
      invariants.confirmedNeverShrank = false;
    }

    if (event.type === 'partial' && before.permanentTranscript !== after.permanentTranscript) {
      invariants.partialNeverChangedConfirmed = false;
    }

    if (event.type === 'partial' && draftBefore && !draftAfter && !after.confirmed.some((line) => line.key === key)) {
      invariants.draftNeverBlankedBeforeFinal = false;
    }

    if (event.type === 'partial' && draftBefore && draftAfter && draftBefore.text !== draftAfter.text) {
      invariants.draftTailWasReplaced = true;
      if (draftAfter.text.length < draftBefore.text.length) {
        invariants.draftTailShortened = true;
      }
    }

    if (event.type === 'partial' && draftBefore && draftAfter && Number(event.endMs) < Number(draftBefore.endMs)) {
      invariants.olderPartialIgnored = draftBefore.text === draftAfter.text;
    }

    if (event.type === 'completed' && draftBefore && draftAfter) {
      invariants.finalReplacedDraft = false;
    }

    if (event.type === 'partial' && key && before.finalisedKeys.includes(key) && before.visibleTranscript !== after.visibleTranscript) {
      invariants.partialAfterFinalIgnored = false;
      partialAfterFinalVisible = true;
    }

    if (after.permanentTranscript.includes('[Draft]')) {
      invariants.permanentTranscriptHasNoDrafts = false;
    }

    if (/(draft words change|older microphone draft|late partial after final|side note draft)/i.test(after.permanentTranscript)) {
      invariants.permanentNeverContainsKnownDraftText = false;
    }

    for (const draft of after.drafts) {
      previousDraftKeys.set(draft.key, draft.text);
      if (!draft.text.trim()) {
        invariants.draftNeverBlankedBeforeFinal = false;
      }
    }

    previousPermanent = after.permanentTranscript;
  }

  const finalSnapshot = reducer.snapshot();
  const sourceLabelsPresent = finalSnapshot.visibleTranscript.includes('[Speaker]')
    && (!requireMicrophoneLabel || finalSnapshot.visibleTranscript.includes('[Microphone]'));
  invariants.sourceLabelsPresent = sourceLabelsPresent;
  const requiredInvariantEntries = Object.entries(invariants)
    .filter(([key]) => strictStressInvariants || !['draftTailShortened', 'draftTailWasReplaced', 'olderPartialIgnored'].includes(key));

  return {
    eventCount: events.length,
    finalSnapshot,
    invariants: {
      ...invariants,
      partialAfterFinalVisible,
      previouslySeenDrafts: previousDraftKeys.size
    },
    ok: requiredInvariantEntries
      .every(([, value]) => value === true)
      && !partialAfterFinalVisible
  };
}

function replayProvisionalEventsSync(events) {
  const reducer = createProvisionalTranscriptReducer();
  let confirmedNeverShrank = true;
  let partialNeverChangedConfirmed = true;
  let permanentTranscriptHasNoDrafts = true;
  let previousPermanent = '';

  for (const event of events) {
    const before = reducer.snapshot();
    const after = reducer.apply(event);

    if (after.permanentTranscript.length < previousPermanent.length) {
      confirmedNeverShrank = false;
    }

    if (event.type === 'partial' && before.permanentTranscript !== after.permanentTranscript) {
      partialNeverChangedConfirmed = false;
    }

    if (after.permanentTranscript.includes('[Draft]')) {
      permanentTranscriptHasNoDrafts = false;
    }

    previousPermanent = after.permanentTranscript;
  }

  return {
    finalSnapshot: reducer.snapshot(),
    ok: confirmedNeverShrank
      && partialNeverChangedConfirmed
      && permanentTranscriptHasNoDrafts
  };
}

function runReducerSelfTest() {
  const cases = [
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 500, text: 'alice was' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 900, text: 'alice was beginning' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 850, text: 'older stale guess' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_300, text: 'Alice was beginning to get very tired.' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_500, text: 'bad late partial' },
        { type: 'partial', source: 'microphone', utteranceId: 1, startMs: 2_000, endMs: 2_400, text: 'side note draft' },
        { type: 'completed', source: 'microphone', utteranceId: 1, startMs: 2_000, endMs: 2_900, text: 'Side note final.' }
      ],
      name: 'basic finalisation and stop safety',
      verify: (state) => (
        state.permanentTranscript.includes('Alice was beginning to get very tired.')
        && state.permanentTranscript.includes('Side note final.')
        && !state.visibleTranscript.includes('bad late partial')
        && !state.permanentTranscript.includes('side note draft')
        && state.drafts.length === 0
      )
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_500, text: 'Rabbit with pink eyes ran close to the' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'Rabbit with pink eyes ran close by her.' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 14_000, text: 'The rabbit with pink eyes ran close by her. There was nothing so very remarkable in that, nor did Alice think it so very much out of the way to hear the rabbit say to itself Oh dear, oh dear, I shall be late.' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 45_000, text: 'Oh dear, oh dear, I shall be late.' }
      ],
      name: 'rescues dropped startup prefix',
      verify: (state) => {
        const line = state.confirmed.find((confirmed) => confirmed.key === 'system:1');
        return Boolean(
          line?.text.includes('rabbit with pink eyes')
          && line.text.includes('Oh dear, oh dear')
          && line.openingRescue?.openingRescueApplied === true
        );
      }
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_000, text: 'alpha beta gamma opening words' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'alpha beta gamma opening words continue' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 3_000, text: 'alpha beta gamma opening words final' }
      ],
      name: 'adequate final opening coverage is not modified',
      verify: (state) => {
        const line = state.confirmed.find((confirmed) => confirmed.key === 'system:1');
        return Boolean(
          line?.text === 'alpha beta gamma opening words final'
          && line.openingRescue?.openingRescueApplied === false
        );
      }
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_000, text: 'purple coffee spaceship words' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'purple coffee spaceship words again' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 3_000, text: 'real final words' }
      ],
      name: 'does not rescue unrelated draft text',
      verify: (state) => (
        state.permanentTranscript.includes('real final words')
        && !state.permanentTranscript.includes('purple coffee spaceship')
      )
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_000, text: '' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'clean final words are here' }
      ],
      name: 'empty partial is ignored',
      verify: (state) => state.permanentTranscript.includes('clean final words are here')
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_000, text: 'draft only words before stop' }
      ],
      name: 'draft-only stop does not become permanent',
      verify: (state) => (
        state.permanentTranscript === ''
        && state.visibleTranscript.includes('draft only words before stop')
      )
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_000, text: 'the white rabbit hurried past alice' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_800, text: 'the white rabbit hurried past' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_300, text: 'The White Rabbit hurried past.' }
      ],
      name: 'shorter replacement partial stays visible until final',
      verify: (state, states) => (
        states[1]?.visibleTranscript.includes('[Draft] [Speaker] the white rabbit hurried past')
        && !states[1]?.visibleTranscript.includes('alice')
        && state.permanentTranscript.includes('The White Rabbit hurried past.')
        && !state.visibleTranscript.includes('[Draft]')
      )
    },
    {
      events: [
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'already final words' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 3_000, text: 'late partial should not show' }
      ],
      name: 'partial after final is ignored',
      verify: (state) => (
        state.permanentTranscript.includes('already final words')
        && !state.visibleTranscript.includes('late partial should not show')
      )
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_000, text: 'speaker draft words' },
        { type: 'partial', source: 'microphone', utteranceId: 1, startMs: 1_100, endMs: 1_900, text: 'microphone draft words' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'Speaker final words.' },
        { type: 'completed', source: 'microphone', utteranceId: 1, startMs: 1_100, endMs: 2_500, text: 'Microphone final words.' }
      ],
      name: 'finalising one source keeps the other source draft isolated',
      verify: (state, states) => (
        states[2]?.visibleTranscript.includes('[Speaker] Speaker final words.')
        && states[2]?.visibleTranscript.includes('[Draft] [Microphone] microphone draft words')
        && !states[2]?.permanentTranscript.includes('microphone draft words')
        && state.permanentTranscript.includes('[Microphone] Microphone final words.')
        && !state.visibleTranscript.includes('[Draft]')
      )
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 1_000, text: 'first chunk draft words' },
        { type: 'completed', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'First chunk final words.' },
        { type: 'partial', source: 'system', utteranceId: 2, startMs: 2_000, endMs: 3_000, text: 'second chunk draft words' },
        { type: 'completed', source: 'system', utteranceId: 2, startMs: 2_000, endMs: 4_000, text: 'Second chunk final words.' }
      ],
      name: 'multiple chunk finals append as separate utterances',
      verify: (state) => (
        state.confirmed.length === 2
        && state.permanentTranscript.includes('First chunk final words.')
        && state.permanentTranscript.includes('Second chunk final words.')
        && !state.visibleTranscript.includes('[Draft]')
      )
    },
    {
      events: [
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 2_000, text: 'system opening words before final overlap' },
        { type: 'partial', source: 'system', utteranceId: 1, startMs: 0, endMs: 3_000, text: 'system opening words before final overlap microphone final' },
        { type: 'completed', source: 'microphone', utteranceId: 1, startMs: 0, endMs: 4_000, text: 'microphone final' }
      ],
      name: 'multi-source isolation',
      verify: (state) => (
        state.permanentTranscript.includes('Microphone')
        && state.permanentTranscript.includes('microphone final')
        && !state.permanentTranscript.includes('system opening words')
      )
    }
  ];

  const results = cases.map((testCase) => {
    const reducer = createProvisionalTranscriptReducer();
    const states = testCase.events.map((event) => reducer.apply(event));
    const finalState = states.at(-1) ?? reducer.snapshot();

    return {
      finalPermanentTranscript: finalState.permanentTranscript,
      finalVisibleTranscript: finalState.visibleTranscript,
      name: testCase.name,
      ok: testCase.verify(finalState, states)
    };
  });
  const ok = results.every((result) => result.ok);

  return {
    caseCount: results.length,
    failedCases: results.filter((result) => !result.ok).map((result) => result.name),
    ok
  };
}

function runEventTraceSelfTest() {
  const events = generateChunkedAsrEventTrace({
    chunks: [
      {
        end_ms: 30_000,
        index: 0,
        start_ms: 0,
        stitched_transcript: 'First Alice chunk final words for a bounded Parakeet window.',
        transcript: 'First Alice chunk final words for a bounded Parakeet window.'
      },
      {
        end_ms: 58_000,
        index: 1,
        start_ms: 28_000,
        stitched_transcript: 'words after overlap.',
        transcript: 'Alice chunk final words after overlap.'
      },
      {
        end_ms: 86_000,
        index: 2,
        start_ms: 56_000,
        stitched_transcript: 'Third Alice chunk final words after another overlap.',
        transcript: 'Third Alice chunk final words after another overlap.'
      }
    ],
    mode: 'chunked'
  });
  const finalEvents = events.filter((event) => event.type === 'completed');
  const partialEvents = events.filter((event) => event.type === 'partial');
  const maxDurationMs = events.reduce((maxDuration, event) => (
    Math.max(maxDuration, Math.max(0, Number(event.endMs ?? 0) - Number(event.startMs ?? 0)))
  ), 0);
  const replay = replayProvisionalEventsSync(events);
  const ok = finalEvents.length === 3
    && partialEvents.length === 3
    && maxDurationMs <= maxAsrEventMs
    && replay.ok
    && replay.finalSnapshot.permanentTranscript.includes('[Speaker] words after overlap.')
    && !replay.finalSnapshot.permanentTranscript.includes('[Speaker] Alice chunk final words after overlap.');

  return {
    finalEvents: finalEvents.length,
    maxDurationMs,
    ok,
    partialEvents: partialEvents.length,
    replayOk: replay.ok
  };
}

function createProvisionalTranscriptReducer() {
  const state = {
    confirmed: new Map(),
    drafts: new Map(),
    firstPartials: new Map(),
    finalisedKeys: new Set(),
    order: 0,
    partials: new Map()
  };

  return {
    apply(event) {
      state.order += 1;
      const key = eventKey(event);
      const text = typeof event.text === 'string' ? event.text.trim() : '';

      if (!key || (event.type !== 'partial' && event.type !== 'completed')) {
        return snapshot();
      }

      if (event.type === 'partial') {
        if (!text || state.finalisedKeys.has(key)) {
          return snapshot();
        }

        const existing = state.drafts.get(key);
        if (existing && isOlderPartial(event, existing)) {
          return snapshot();
        }

        const partialLine = {
          endMs: Number.isFinite(event.endMs) ? Number(event.endMs) : null,
          key,
          order: existing?.order ?? state.order,
          source: event.source,
          startMs: Number.isFinite(event.startMs) ? Number(event.startMs) : null,
          text
        };

        if (!state.firstPartials.has(key)) {
          state.firstPartials.set(key, partialLine);
        }

        state.partials.set(key, [...(state.partials.get(key) ?? []), partialLine]);
        state.drafts.set(key, {
          ...partialLine
        });

        return snapshot();
      }

      if (!text) {
        return snapshot();
      }

      const finalised = finaliseWithOpeningRescue({
        finalText: text,
        firstPartial: state.firstPartials.get(key),
        partials: state.partials.get(key) ?? []
      });
      const existingConfirmed = state.confirmed.get(key);
      if (existingConfirmed && finalised.text.length < existingConfirmed.text.length) {
        return snapshot();
      }

      state.drafts.delete(key);
      state.finalisedKeys.add(key);
      state.confirmed.set(key, {
        endMs: Number.isFinite(event.endMs) ? Number(event.endMs) : null,
        key,
        openingRescue: finalised.openingRescue,
        order: existingConfirmed?.order ?? state.order,
        source: event.source,
        startMs: Number.isFinite(event.startMs) ? Number(event.startMs) : null,
        text: finalised.text
      });

      return snapshot();
    },
    snapshot
  };

  function snapshot() {
    const confirmed = [...state.confirmed.values()].sort(compareLines);
    const drafts = [...state.drafts.values()].sort(compareLines);
    const permanentTranscript = confirmed.map(renderConfirmedLine).join('\n').trim();
    const draftTranscript = drafts.map(renderDraftLine).join('\n').trim();
    const visibleTranscript = [permanentTranscript, draftTranscript].filter(Boolean).join('\n').trim();

    return {
      confirmed,
      drafts,
      finalisedKeys: [...state.finalisedKeys],
      permanentTranscript,
      visibleTranscript
    };
  }
}

function isOlderPartial(event, existing) {
  if (Number.isFinite(event.endMs) && Number.isFinite(existing.endMs)) {
    return Number(event.endMs) <= Number(existing.endMs);
  }

  return false;
}

function compareLines(left, right) {
  const startDelta = (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER);
  if (startDelta !== 0) {
    return startDelta;
  }

  return left.order - right.order;
}

function renderConfirmedLine(line) {
  return `${sourcePrefix(line.source)}${line.text}`;
}

function renderDraftLine(line) {
  return `[Draft] ${sourcePrefix(line.source)}${line.text}`;
}

function sourcePrefix(source) {
  if (source === 'system') {
    return '[Speaker] ';
  }

  if (source === 'microphone') {
    return '[Microphone] ';
  }

  return '';
}

function eventKey(event) {
  if (event.utteranceId === undefined || event.utteranceId === null) {
    return null;
  }

  return `${event.source ?? 'unknown'}:${event.utteranceId}`;
}

async function transcribeWav(wavPath, label) {
  const startedAt = Date.now();
  const output = await run(backendPath, ['--transcribe-parakeet-wav', wavPath]);
  const wallMs = Date.now() - startedAt;
  const resultLine = output
    .split('\n')
    .find((line) => line.includes('"type":"parakeet_direct_bench"'));

  if (!resultLine) {
    throw new Error(`Parakeet direct benchmark did not emit a result for ${label}: ${output.trim()}`);
  }

  return {
    ...JSON.parse(resultLine),
    wall_ms: wallMs
  };
}

function sliceWav(inputPath, outputPath, { startSeconds, durationSeconds }) {
  const info = readWavInfo(inputPath);
  if (info.channels !== 1 || info.sampleRate !== 16_000 || info.bitsPerSample !== 16) {
    throw new Error(`Expected 16 kHz mono PCM16 WAV, got ${info.sampleRate} Hz, ${info.channels} channels, ${info.bitsPerSample} bits.`);
  }

  const bytesPerSample = 2;
  const startSample = Math.max(0, Math.floor(startSeconds * info.sampleRate));
  const requestedSamples = Math.max(1, Math.floor(durationSeconds * info.sampleRate));
  const availableSamples = Math.max(0, Math.floor(info.data.length / bytesPerSample) - startSample);
  const sampleCount = Math.min(requestedSamples, availableSamples);
  const byteStart = startSample * bytesPerSample;
  const byteEnd = byteStart + sampleCount * bytesPerSample;
  const data = info.data.subarray(byteStart, byteEnd);
  writePcm16MonoWav(outputPath, data, info.sampleRate);

  return {
    durationMs: Math.round((sampleCount / info.sampleRate) * 1000),
    sampleCount,
    startSeconds
  };
}

function readWavInfo(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath} is not a RIFF/WAVE file.`);
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;

    if (id === 'fmt ') {
      fmt = buffer.subarray(start, end);
    } else if (id === 'data') {
      data = buffer.subarray(start, end);
    }

    offset = end + (size % 2);
  }

  if (!fmt || !data) {
    throw new Error(`${filePath} is missing fmt or data chunks.`);
  }

  return {
    audioFormat: fmt.readUInt16LE(0),
    bitsPerSample: fmt.readUInt16LE(14),
    channels: fmt.readUInt16LE(2),
    data,
    sampleRate: fmt.readUInt32LE(4)
  };
}

function writePcm16MonoWav(filePath, pcm16Data, sampleRate) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm16Data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm16Data.length, 40);
  writeFileSync(filePath, Buffer.concat([header, pcm16Data]));
}

function extractChapterOne(text) {
  const starts = [...text.matchAll(/CHAPTER\s+I\./gi)].map((match) => match.index ?? -1).filter((index) => index >= 0);

  for (const start of starts) {
    const nextChapter = text.slice(start + 1).search(/CHAPTER\s+II\./i);
    const end = nextChapter >= 0 ? start + 1 + nextChapter : text.length;
    const candidate = text.slice(start, end);

    if (/Alice was beginning to get very tired/i.test(candidate)) {
      return candidate;
    }
  }

  if (starts.length > 0) {
    const start = starts.at(-1);
    const nextChapter = text.slice(start + 1).search(/CHAPTER\s+II\./i);
    const end = nextChapter >= 0 ? start + 1 + nextChapter : text.length;
    return text.slice(start, end);
  }

  return text;
}

function scoreTranscriptAgainstReference(reference, actual) {
  const referenceWords = [...new Set(normaliseWords(reference).filter((word) => word.length > 3))];
  const actualWords = [...new Set(normaliseWords(actual).filter((word) => word.length > 3))];
  const referenceSet = new Set(referenceWords);
  const actualSet = new Set(actualWords);
  const hitsFromActual = actualWords.filter((word) => referenceSet.has(word)).length;
  const hitsFromReference = referenceWords.filter((word) => actualSet.has(word)).length;

  return {
    referenceCoverage: actualWords.length === 0 ? 0 : hitsFromActual / actualWords.length,
    referenceRecall: referenceWords.length === 0 ? 0 : hitsFromReference / referenceWords.length,
    uniqueActualWords: actualWords.length,
    uniqueReferenceWords: referenceWords.length
  };
}

function scoreTranscriptAgainstBestReferenceWindow(reference, actual) {
  const referenceWords = normaliseWords(reference).filter((word) => word.length > 3);
  const actualWords = normaliseWords(actual).filter((word) => word.length > 3);
  const uniqueActualWords = [...new Set(actualWords)];

  if (referenceWords.length === 0 || actualWords.length === 0) {
    return {
      referenceCoverage: 0,
      referenceRecall: 0,
      referenceWindowText: '',
      uniqueActualWords: uniqueActualWords.length,
      uniqueReferenceWords: 0,
      windowEndWord: 0,
      windowStartWord: 0
    };
  }

  const actualSet = new Set(uniqueActualWords);
  const minWindowSize = Math.max(1, Math.floor(actualWords.length * 0.75));
  const maxWindowSize = Math.min(referenceWords.length, Math.max(minWindowSize, Math.ceil(actualWords.length * 1.6)));
  let best = null;

  for (let start = 0; start < referenceWords.length; start += 1) {
    for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize += 1) {
      const end = start + windowSize;
      if (end > referenceWords.length) {
        break;
      }

      const windowWords = referenceWords.slice(start, end);
      const uniqueReferenceWords = [...new Set(windowWords)];
      const referenceSet = new Set(uniqueReferenceWords);
      const hitsFromActual = uniqueActualWords.filter((word) => referenceSet.has(word)).length;
      const hitsFromReference = uniqueReferenceWords.filter((word) => actualSet.has(word)).length;
      const referenceCoverage = hitsFromActual / uniqueActualWords.length;
      const referenceRecall = hitsFromReference / uniqueReferenceWords.length;
      const score = referenceCoverage * 0.65 + referenceRecall * 0.35;

      if (!best || score > best.score) {
        best = {
          referenceCoverage,
          referenceRecall,
          referenceWindowText: windowWords.join(' '),
          score,
          uniqueActualWords: uniqueActualWords.length,
          uniqueReferenceWords: uniqueReferenceWords.length,
          windowEndWord: end,
          windowStartWord: start
        };
      }
    }
  }

  return best ?? {
    referenceCoverage: 0,
    referenceRecall: 0,
    referenceWindowText: '',
    uniqueActualWords: uniqueActualWords.length,
    uniqueReferenceWords: 0,
    windowEndWord: 0,
    windowStartWord: 0
  };
}

function scoreOpeningWords(reference, actual) {
  const expectedWords = openingWords(reference);
  const actualSet = new Set(normaliseWords(actual).filter((word) => word.length > 3));
  const matchedWords = expectedWords.filter((word) => actualSet.has(word));

  return {
    coverage: expectedWords.length === 0 ? 0 : matchedWords.length / expectedWords.length,
    expectedWords,
    matchedWords,
    missingWords: expectedWords.filter((word) => !actualSet.has(word))
  };
}

function finaliseWithOpeningRescue({ finalText, firstPartial, partials }) {
  const rawFinalText = finalText.trim();
  const noop = createNoopOpeningRescue(rawFinalText, firstPartial?.text ?? '');

  if (!rawFinalText || !firstPartial?.text) {
    return { openingRescue: noop, text: rawFinalText };
  }

  const openingCoverageBefore = scoreOpeningWords(firstPartial.text, rawFinalText).coverage;
  if (openingCoverageBefore >= minStartupOpeningCoverage) {
    return {
      openingRescue: {
        ...noop,
        openingCoverageAfter: openingCoverageBefore,
        openingCoverageBefore
      },
      text: rawFinalText
    };
  }

  const expectedOpeningWords = openingWords(firstPartial.text);
  if (expectedOpeningWords.length < 3 || !hasCorroboratedOpening(firstPartial, partials)) {
    return {
      openingRescue: {
        ...noop,
        openingCoverageBefore
      },
      text: rawFinalText
    };
  }

  const candidates = partials
    .filter((partial) => partial.text.trim())
    .map((partial) => createOpeningRescueCandidate(partial.text, rawFinalText, firstPartial.text))
    .filter((candidate) => candidate.hasFinalOverlap)
    .filter((candidate) => candidate.openingCoverage >= minStartupOpeningCoverage)
    .filter((candidate) => candidate.prefixWords.length >= Math.min(3, expectedOpeningWords.length))
    .sort((left, right) => {
      if (left.hasFinalOverlap !== right.hasFinalOverlap) {
        return left.hasFinalOverlap ? -1 : 1;
      }

      if (left.finalOverlapWords !== right.finalOverlapWords) {
        return right.finalOverlapWords - left.finalOverlapWords;
      }

      return right.prefixWords.length - left.prefixWords.length;
    });

  const candidate = candidates[0];
  if (!candidate?.prefixText) {
    return {
      openingRescue: {
        ...noop,
        openingCoverageBefore
      },
      text: rawFinalText
    };
  }

  const rescuedText = appendPrefixToFinal(candidate.prefixText, rawFinalText);
  const openingCoverageAfter = scoreOpeningWords(firstPartial.text, rescuedText).coverage;
  const applied = openingCoverageAfter >= minStartupOpeningCoverage;

  return {
    openingRescue: {
      openingCoverageAfter,
      openingCoverageBefore,
      openingRescueApplied: applied,
      rawFinalText,
      rescuedFinalText: applied ? rescuedText : rawFinalText,
      rescuedPrefix: applied ? candidate.prefixText : '',
      supportedByPartialCount: countOpeningSupport(firstPartial, partials)
    },
    text: applied ? rescuedText : rawFinalText
  };
}

function createNoopOpeningRescue(rawFinalText, firstPartialText = '') {
  const coverage = firstPartialText ? scoreOpeningWords(firstPartialText, rawFinalText).coverage : 0;

  return {
    openingCoverageAfter: coverage,
    openingCoverageBefore: coverage,
    openingRescueApplied: false,
    rawFinalText,
    rescuedFinalText: rawFinalText,
    rescuedPrefix: '',
    supportedByPartialCount: 0
  };
}

function hasCorroboratedOpening(firstPartial, partials) {
  return countOpeningSupport(firstPartial, partials) >= 2;
}

function countOpeningSupport(firstPartial, partials) {
  return partials.filter((partial) => (
    partial.text.trim()
    && scoreOpeningWords(firstPartial.text, partial.text).coverage >= minStartupOpeningCoverage
  )).length;
}

function createOpeningRescueCandidate(partialText, finalText, firstPartialText) {
  const overlap = findFinalPrefixOverlap(partialText, finalText);
  const prefixText = (overlap
    ? partialText.slice(0, overlap.startIndex)
    : partialText
  ).trim();
  const prefixWords = openingWords(prefixText, Number.POSITIVE_INFINITY);

  return {
    finalOverlapWords: overlap?.length ?? 0,
    hasFinalOverlap: Boolean(overlap),
    openingCoverage: scoreOpeningWords(firstPartialText, prefixText).coverage,
    prefixText,
    prefixWords
  };
}

function findFinalPrefixOverlap(partialText, finalText) {
  const partialTokens = meaningfulWordTokens(partialText);
  const finalTokens = meaningfulWordTokens(finalText);
  const finalPrefix = finalTokens.slice(0, Math.min(6, finalTokens.length));

  if (partialTokens.length === 0 || finalPrefix.length < 3) {
    return null;
  }

  let best = null;
  for (let partialIndex = 0; partialIndex < partialTokens.length; partialIndex += 1) {
    let length = 0;
    while (
      partialIndex + length < partialTokens.length
      && length < finalPrefix.length
      && partialTokens[partialIndex + length].word === finalPrefix[length].word
    ) {
      length += 1;
    }

    if (length >= 3 && (!best || length > best.length)) {
      best = {
        length,
        startIndex: partialTokens[partialIndex].start
      };
    }
  }

  return best;
}

function appendPrefixToFinal(prefixText, finalText) {
  let prefix = prefixText.trim().replace(/[,\s]+$/u, '');
  const final = finalText.trim();

  if (!prefix) {
    return final;
  }

  if (!final) {
    return prefix;
  }

  const prefixWords = rawWordTokens(prefix);
  const finalWords = rawWordTokens(final);
  const lastPrefixWord = prefixWords.at(-1);
  const firstFinalWord = finalWords[0];
  if (lastPrefixWord && firstFinalWord && lastPrefixWord.word === firstFinalWord.word) {
    prefix = prefix.slice(0, lastPrefixWord.start).trim().replace(/[,\s]+$/u, '');
  }

  return `${prefix} ${final}`;
}

function openingWords(text, count = startupOpeningWordCount) {
  return normaliseWords(text)
    .filter((word) => word.length > 3)
    .slice(0, count);
}

function meaningfulWordTokens(text) {
  return [...String(text).matchAll(/[a-z0-9']+/gi)]
    .map((match) => ({
      start: match.index ?? 0,
      word: match[0].toLowerCase()
    }))
    .filter((token) => token.word.length > 3);
}

function rawWordTokens(text) {
  return [...String(text).matchAll(/[a-z0-9']+/gi)]
    .map((match) => ({
      start: match.index ?? 0,
      word: match[0].toLowerCase()
    }));
}

function normaliseWords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

async function fetchJson(url) {
  return JSON.parse(await run('curl', ['-L', '--fail', '--silent', '--show-error', url]));
}

function collectMatches(text, regex) {
  return [...text.matchAll(regex)].map((match) => match[1]);
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'");
}

function encodeArchivePath(fileName) {
  return fileName.split('/').map(encodeURIComponent).join('/');
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendJsonLine(filePath, value) {
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    if (!options.inherit) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

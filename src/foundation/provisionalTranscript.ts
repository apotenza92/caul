import type { CaptureSource } from './capture';

export type ProvisionalTranscriptEvent = {
  displayAtMs?: number;
  endMs?: number;
  revision?: number;
  source?: CaptureSource;
  startMs?: number;
  text: string;
  type: 'completed' | 'partial';
  utteranceId?: number;
};

export type ProvisionalTranscriptLine = {
  displayAtMs: number;
  endMs: number | null;
  key: string;
  openingRescue?: OpeningRescue;
  order: number;
  revision: number;
  source?: CaptureSource;
  startMs: number | null;
  text: string;
};

export type OpeningRescue = {
  openingCoverageAfter: number;
  openingCoverageBefore: number;
  openingRescueApplied: boolean;
  rescuedPrefix: string;
};

export type ProvisionalTranscriptSnapshot = {
  confirmed: ProvisionalTranscriptLine[];
  drafts: ProvisionalTranscriptLine[];
};

type ProvisionalTranscriptState = {
  confirmed: Map<string, ProvisionalTranscriptLine>;
  drafts: Map<string, ProvisionalTranscriptLine>;
  finalisedKeys: Set<string>;
  firstPartials: Map<string, ProvisionalTranscriptLine>;
  latestConfirmedStartBySource: Map<string, number>;
  order: number;
  partials: Map<string, ProvisionalTranscriptLine[]>;
};

const openingWordCount = 8;
const adequateOpeningCoverage = 0.7;

export function createProvisionalTranscriptReducer() {
  const state: ProvisionalTranscriptState = {
    confirmed: new Map(),
    drafts: new Map(),
    finalisedKeys: new Set(),
    firstPartials: new Map(),
    latestConfirmedStartBySource: new Map(),
    order: 0,
    partials: new Map()
  };

  return {
    apply(event: ProvisionalTranscriptEvent) {
      state.order += 1;
      const key = eventKey(event);
      const text = event.text.trim();

      if (!key) {
        return snapshot(state);
      }

      if (event.type === 'partial') {
        if (!text || state.finalisedKeys.has(key) || isOlderThanLatestConfirmed(event, state)) {
          return snapshot(state);
        }

        const existing = state.drafts.get(key);
        if (existing && isOlderPartial(event, existing)) {
          return snapshot(state);
        }

        const partialLine = createLine(event, key, text, existing?.order ?? state.order);

        if (!state.firstPartials.has(key)) {
          state.firstPartials.set(key, partialLine);
        }

        state.partials.set(key, [...(state.partials.get(key) ?? []), partialLine]);
        state.drafts.set(key, partialLine);

        return snapshot(state);
      }

      if (!text) {
        return snapshot(state);
      }

      const existingConfirmed = state.confirmed.get(key);
      const finalised = finaliseWithOpeningRescue({
        finalText: text,
        firstPartial: state.firstPartials.get(key),
        partials: state.partials.get(key) ?? []
      });

      if (existingConfirmed && finalised.text.length < existingConfirmed.text.length) {
        return snapshot(state);
      }

      state.drafts.delete(key);
      state.finalisedKeys.add(key);
      const confirmedLine = {
        ...createLine(event, key, finalised.text, existingConfirmed?.order ?? state.order),
        openingRescue: finalised.openingRescue
      };
      state.confirmed.set(key, confirmedLine);
      if (confirmedLine.startMs !== null) {
        const sourceKey = eventSourceKey(event);
        state.latestConfirmedStartBySource.set(
          sourceKey,
          Math.max(state.latestConfirmedStartBySource.get(sourceKey) ?? 0, confirmedLine.startMs)
        );
      }

      return snapshot(state);
    },
    reset() {
      state.confirmed.clear();
      state.drafts.clear();
      state.finalisedKeys.clear();
      state.firstPartials.clear();
      state.latestConfirmedStartBySource.clear();
      state.order = 0;
      state.partials.clear();
    },
    snapshot: () => snapshot(state)
  };
}

function snapshot(state: ProvisionalTranscriptState): ProvisionalTranscriptSnapshot {
  return {
    confirmed: [...state.confirmed.values()].sort(compareLines),
    drafts: [...state.drafts.values()].sort(compareLines)
  };
}

function createLine(
  event: ProvisionalTranscriptEvent,
  key: string,
  text: string,
  order: number
): ProvisionalTranscriptLine {
  return {
    displayAtMs: Number.isFinite(event.displayAtMs) ? Number(event.displayAtMs) : Date.now(),
    endMs: Number.isFinite(event.endMs) ? Number(event.endMs) : null,
    key,
    order,
    revision: Number.isFinite(event.revision) ? Number(event.revision) : 0,
    source: event.source,
    startMs: Number.isFinite(event.startMs) ? Number(event.startMs) : null,
    text
  };
}

function eventKey(event: ProvisionalTranscriptEvent) {
  if (event.utteranceId === undefined || event.utteranceId === null) {
    return null;
  }

  return `${eventSourceKey(event)}:${event.utteranceId}`;
}

function eventSourceKey(event: Pick<ProvisionalTranscriptEvent, 'source'>) {
  return event.source ?? 'unknown';
}

function isOlderThanLatestConfirmed(
  event: ProvisionalTranscriptEvent,
  state: ProvisionalTranscriptState
) {
  if (!Number.isFinite(event.startMs)) {
    return false;
  }

  const latestConfirmedStart = state.latestConfirmedStartBySource.get(eventSourceKey(event));
  return latestConfirmedStart !== undefined && Number(event.startMs) < latestConfirmedStart;
}

function isOlderPartial(event: ProvisionalTranscriptEvent, existing: ProvisionalTranscriptLine) {
  const nextRevision = Number.isFinite(event.revision) ? Number(event.revision) : null;

  if (nextRevision !== null && existing.revision !== 0) {
    return nextRevision <= existing.revision;
  }

  if (Number.isFinite(event.endMs) && Number.isFinite(existing.endMs)) {
    return Number(event.endMs) <= Number(existing.endMs);
  }

  return false;
}

function compareLines(left: ProvisionalTranscriptLine, right: ProvisionalTranscriptLine) {
  const startDelta = (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER);
  if (startDelta !== 0) {
    return startDelta;
  }

  return left.order - right.order;
}

function finaliseWithOpeningRescue({
  finalText,
  firstPartial,
  partials
}: {
  finalText: string;
  firstPartial?: ProvisionalTranscriptLine;
  partials: ProvisionalTranscriptLine[];
}) {
  const rawFinalText = finalText.trim();
  const noop = createNoopOpeningRescue(rawFinalText, firstPartial?.text ?? '');

  if (!rawFinalText || !firstPartial?.text) {
    return { openingRescue: noop, text: rawFinalText };
  }

  const openingCoverageBefore = scoreOpeningWords(firstPartial.text, rawFinalText).coverage;
  if (openingCoverageBefore >= adequateOpeningCoverage) {
    return {
      openingRescue: {
        ...noop,
        openingCoverageAfter: openingCoverageBefore,
        openingCoverageBefore
      },
      text: rawFinalText
    };
  }

  if (partials.length < 2) {
    return { openingRescue: noop, text: rawFinalText };
  }

  const candidate = partials
    .map((partial) => createOpeningRescueCandidate(partial.text, rawFinalText, firstPartial.text))
    .filter((item): item is OpeningRescueCandidate => item !== null)
    .sort((left, right) => {
      if (right.coverage !== left.coverage) {
        return right.coverage - left.coverage;
      }

      return right.supportedWords - left.supportedWords;
    })[0];

  if (!candidate || candidate.coverage < adequateOpeningCoverage) {
    return { openingRescue: noop, text: rawFinalText };
  }

  const rescuedText = appendPrefixToFinal(candidate.prefixText, rawFinalText);
  const openingCoverageAfter = scoreOpeningWords(firstPartial.text, rescuedText).coverage;
  const applied = openingCoverageAfter >= adequateOpeningCoverage;

  return {
    openingRescue: {
      openingCoverageAfter,
      openingCoverageBefore,
      openingRescueApplied: applied,
      rescuedPrefix: applied ? candidate.prefixText : ''
    },
    text: applied ? rescuedText : rawFinalText
  };
}

type OpeningRescueCandidate = {
  coverage: number;
  prefixText: string;
  supportedWords: number;
};

function createOpeningRescueCandidate(
  partialText: string,
  finalText: string,
  firstPartialText: string
): OpeningRescueCandidate | null {
  const partialWords = rawWordTokens(partialText);
  const finalWords = new Set(normaliseWords(finalText));
  const opening = openingWords(firstPartialText);

  if (partialWords.length === 0 || opening.length === 0) {
    return null;
  }

  const prefixWords = [];

  for (const word of partialWords) {
    const normalised = normaliseWord(word);
    if (!normalised) {
      continue;
    }

    if (finalWords.has(normalised)) {
      break;
    }

    prefixWords.push(word);
  }

  if (prefixWords.length === 0) {
    return null;
  }

  const prefixText = prefixWords.join(' ');
  const score = scoreOpeningWords(firstPartialText, appendPrefixToFinal(prefixText, finalText));

  return {
    coverage: score.coverage,
    prefixText,
    supportedWords: score.matchedWords.length
  };
}

function createNoopOpeningRescue(rawFinalText: string, firstPartialText = ''): OpeningRescue {
  const coverage = firstPartialText ? scoreOpeningWords(firstPartialText, rawFinalText).coverage : 0;

  return {
    openingCoverageAfter: coverage,
    openingCoverageBefore: coverage,
    openingRescueApplied: false,
    rescuedPrefix: ''
  };
}

function appendPrefixToFinal(prefix: string, finalText: string) {
  const cleanPrefix = prefix.trim();
  const cleanFinal = finalText.trim();

  if (!cleanPrefix) {
    return cleanFinal;
  }

  if (!cleanFinal) {
    return cleanPrefix;
  }

  return `${cleanPrefix.replace(/[,\s]+$/, '')}. ${cleanFinal}`;
}

function scoreOpeningWords(reference: string, actual: string) {
  const expectedWords = openingWords(reference);
  const actualSet = new Set(normaliseWords(actual).filter((word) => word.length > 3));
  const matchedWords = expectedWords.filter((word) => actualSet.has(word));

  return {
    coverage: expectedWords.length === 0 ? 0 : matchedWords.length / expectedWords.length,
    matchedWords
  };
}

function openingWords(text: string) {
  return normaliseWords(text)
    .filter((word) => word.length > 3)
    .slice(0, openingWordCount);
}

function rawWordTokens(text: string) {
  return text.split(/\s+/).map((word) => word.trim()).filter(Boolean);
}

function normaliseWords(text: string) {
  return rawWordTokens(text)
    .map(normaliseWord)
    .filter(Boolean);
}

function normaliseWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

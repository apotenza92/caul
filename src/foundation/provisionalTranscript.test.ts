import { describe, expect, it } from 'vitest';
import { createProvisionalTranscriptReducer } from './provisionalTranscript';

describe('provisional transcript reducer', () => {
  it('shows a new partial as a draft without changing confirmed text', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      source: 'system',
      text: 'Confirmed words.',
      type: 'completed',
      utteranceId: 1
    });
    const snapshot = reducer.apply({
      endMs: 1_500,
      source: 'system',
      text: 'draft words',
      type: 'partial',
      utteranceId: 2
    });

    expect(snapshot.confirmed.map((line) => line.text)).toEqual(['Confirmed words.']);
    expect(snapshot.drafts.map((line) => line.text)).toEqual(['draft words']);
  });

  it('replaces only the draft tail with newer partials', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      endMs: 1_500,
      revision: 1,
      source: 'system',
      text: 'first draft',
      type: 'partial',
      utteranceId: 1
    });
    const snapshot = reducer.apply({
      endMs: 3_000,
      revision: 2,
      source: 'system',
      text: 'better draft',
      type: 'partial',
      utteranceId: 1
    });

    expect(snapshot.drafts).toHaveLength(1);
    expect(snapshot.drafts[0]?.text).toBe('better draft');
  });

  it('ignores empty, older and post-final partials', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      endMs: 3_000,
      revision: 2,
      source: 'system',
      text: 'newer draft',
      type: 'partial',
      utteranceId: 1
    });
    reducer.apply({
      endMs: 1_500,
      revision: 1,
      source: 'system',
      text: 'older draft',
      type: 'partial',
      utteranceId: 1
    });
    reducer.apply({
      endMs: 3_500,
      revision: 3,
      source: 'system',
      text: '',
      type: 'partial',
      utteranceId: 1
    });
    reducer.apply({
      source: 'system',
      text: 'final words',
      type: 'completed',
      utteranceId: 1
    });
    const snapshot = reducer.apply({
      endMs: 4_500,
      revision: 4,
      source: 'system',
      text: 'late draft',
      type: 'partial',
      utteranceId: 1
    });

    expect(snapshot.confirmed.map((line) => line.text)).toEqual(['final words']);
    expect(snapshot.drafts).toEqual([]);
  });

  it('ignores a delayed partial that starts before the latest confirmed line for the same source', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      source: 'system',
      startMs: 12_000,
      text: 'newer confirmed words',
      type: 'completed',
      utteranceId: 2
    });
    const snapshot = reducer.apply({
      endMs: 11_500,
      source: 'system',
      startMs: 11_000,
      text: 'delayed older draft',
      type: 'partial',
      utteranceId: 1
    });

    expect(snapshot.confirmed.map((line) => line.text)).toEqual(['newer confirmed words']);
    expect(snapshot.drafts).toEqual([]);
  });

  it('atomically replaces draft text with final text', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      source: 'system',
      text: 'draft words',
      type: 'partial',
      utteranceId: 1
    });
    const snapshot = reducer.apply({
      source: 'system',
      text: 'final words',
      type: 'completed',
      utteranceId: 1
    });

    expect(snapshot.confirmed.map((line) => line.text)).toEqual(['final words']);
    expect(snapshot.drafts).toEqual([]);
  });

  it('rescues startup opening words when the final starts late', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      endMs: 1_500,
      source: 'system',
      text: 'A rabbit with pink eyes ran close by her',
      type: 'partial',
      utteranceId: 1
    });
    reducer.apply({
      endMs: 5_000,
      source: 'system',
      text: 'A rabbit with pink eyes ran close by her and then it hurried away',
      type: 'partial',
      utteranceId: 1
    });
    const snapshot = reducer.apply({
      source: 'system',
      text: 'There was nothing so very remarkable in that.',
      type: 'completed',
      utteranceId: 1
    });

    expect(snapshot.confirmed[0]?.text).toContain('A rabbit with pink eyes ran close by her.');
    expect(snapshot.confirmed[0]?.openingRescue?.openingRescueApplied).toBe(true);
  });

  it('does not make unrelated partials permanent', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      source: 'system',
      text: 'purple coffee spaceship',
      type: 'partial',
      utteranceId: 1
    });
    const snapshot = reducer.apply({
      source: 'system',
      text: 'real final words',
      type: 'completed',
      utteranceId: 1
    });

    expect(snapshot.confirmed[0]?.text).toBe('real final words');
  });

  it('keeps multiple sources isolated', () => {
    const reducer = createProvisionalTranscriptReducer();
    reducer.apply({
      source: 'system',
      text: 'system draft',
      type: 'partial',
      utteranceId: 1
    });
    reducer.apply({
      source: 'microphone',
      text: 'microphone draft',
      type: 'partial',
      utteranceId: 1
    });
    const snapshot = reducer.apply({
      source: 'microphone',
      text: 'microphone final',
      type: 'completed',
      utteranceId: 1
    });

    expect(snapshot.confirmed.map((line) => line.text)).toEqual(['microphone final']);
    expect(snapshot.drafts.map((line) => line.text)).toEqual(['system draft']);
  });
});

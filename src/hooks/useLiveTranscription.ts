import { useEffect, useRef, useState } from 'react';
import {
  getSettingsBridge,
  getTranscriptionBridge,
  type AiProvider,
  type LlmModel,
  type LlmReasoning,
  type PromptTemplateAttachment,
  type TranscriptionBridgeEvent
} from '../foundation/desktopBridge';
import type { CaptureSource } from '../foundation/capture';
import { getRuntimeContext } from '../foundation/runtime';

const awaitingResponseText = '';
const preparingLocalAiText = 'Preparing local AI...';
const idleLlmText = 'Auto Send is on.\nStop listening to send transcript to AI';
const idleTranscriptText = 'Your live transcript will appear here once you start listening.';
let rendererTranscriptDebugEnabled = import.meta.env.VITE_CAUL_TRANSCRIPT_DEBUG_LOG === '1';

export type LiveTranscriptionOptions = {
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
};

export type StopTranscriptionOptions = {
  llmModel: LlmModel;
  llmReasoning: LlmReasoning;
  aiProvider?: AiProvider;
  generalInstructionsText?: string;
  promptTemplateAttachments?: PromptTemplateAttachment[];
  promptTemplateText?: string;
  sendToLlm?: boolean;
};

export type TranscriptSession = {
  id: string;
  output: string;
  startedAt: string;
};

export type AiResponseSession = {
  historySessionId?: string;
  id: string;
  isWaiting?: boolean;
  request: string;
  requestedAt: string;
  response: string;
};

type SpeculativeRequest = {
  deltas: string;
  finalText: string | null;
  id: string;
  model: LlmModel;
  promise: Promise<{ ok: boolean; text: string } | undefined>;
  reasoning: LlmReasoning;
  transcript: string;
};

type TranscriptLine = {
  displayAt: Date;
  key: string;
  order: number;
  source?: CaptureSource;
  startAt: Date;
  startMs?: number;
  text: string;
};

export function useLiveTranscription() {
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [output, setOutput] = useState(idleTranscriptText);
  const [sessions, setSessions] = useState<TranscriptSession[]>([]);
  const [llmQuery, setLlmQuery] = useState('No query sent yet.');
  const [llmOutput, setLlmOutput] = useState(idleLlmText);
  const [llmRequestedAt, setLlmRequestedAt] = useState<string | null>(null);
  const [llmResponses, setLlmResponses] = useState<AiResponseSession[]>([]);
  const sessionsRef = useRef<TranscriptSession[]>([]);
  const llmResponsesRef = useRef<AiResponseSession[]>([]);
  const finalTranscriptRef = useRef('');
  const finalTranscriptLinesRef = useRef<TranscriptLine[]>([]);
  const partialTranscriptLinesRef = useRef<Map<string, TranscriptLine>>(new Map());
  const activeSourcesRef = useRef<CaptureSource[]>([]);
  const sourceLabelsStartOrderRef = useRef<number | null>(null);
  const sessionStartedAtRef = useRef<Date | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeLlmRequestIdRef = useRef<string | null>(null);
  const activeLlmResponseIdRef = useRef<string | null>(null);
  const speculativeRequestRef = useRef<SpeculativeRequest | null>(null);
  const speculativeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const debugSequenceRef = useRef(0);

  useEffect(() => () => {
    void stop();
  }, []);

  useEffect(() => {
    void getRuntimeContext().then((context) => {
      rendererTranscriptDebugEnabled = rendererTranscriptDebugEnabled || context.appChannel === 'dev';
    });
  }, []);

  async function start(options: LiveTranscriptionOptions) {
    const bridge = getTranscriptionBridge();
    const sources = getSelectedSources(options);
    const waitingText = 'Listening. Waiting for speech...';

    logTranscriptDebug('renderer.start_requested', {
      selectedSources: sources
    });

    if (sources.length === 0) {
      setOutput('Select at least one audio source.');
      return;
    }

    if (!bridge) {
      setOutput('Live transcription is unavailable in this environment.');
      return;
    }

    setIsStarting(true);
    setIsListening(true);
    const sessionStartedAt = new Date();
    const sessionId = `transcript-${sessionStartedAt.getTime()}`;
    sessionStartedAtRef.current = sessionStartedAt;
    activeSessionIdRef.current = sessionId;
    finalTranscriptRef.current = '';
    finalTranscriptLinesRef.current = [];
    partialTranscriptLinesRef.current = new Map();
    activeSourcesRef.current = sources;
    sourceLabelsStartOrderRef.current = sources.length > 1 ? 0 : null;
    activeLlmRequestIdRef.current = null;
    speculativeRequestRef.current = null;
    clearSpeculativeTimer();
    const sessionHeader = getTranscriptHeader(sessionStartedAt);
    const waitingTranscript = appendTranscript(sessionHeader, waitingText);
    const session = {
      id: sessionId,
      output: waitingTranscript,
      startedAt: sessionStartedAt.toISOString()
    };
    setTranscriptSessions((current) => [...current, session]);
    saveHistorySession({ ...session, output: sessionHeader });
    setOutput((currentOutput) => {
      const previousOutput = isTranscriptText(currentOutput) ? currentOutput : '';
      return appendTranscript(previousOutput, waitingTranscript);
    });

    logTranscriptDebug('renderer.start_state_reset', {
      snapshot: getTranscriptDebugSnapshot()
    });

    try {
      unsubscribeRef.current = bridge.onEvent(handleTranscriptionEvent);
      await bridge.start({
        sources
      });
      setOutput((currentOutput) => (
        shouldShowListeningWaitingText(currentOutput, sessionHeader)
          ? currentOutput.replace(sessionHeader, appendTranscript(sessionHeader, waitingText))
          : currentOutput
      ));
    } catch (error) {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      await bridge.stop().catch(() => undefined);
      setIsListening(false);
      setOutput(getErrorMessage(error));
    } finally {
      setIsStarting(false);
    }
  }

  async function stop({
    llmModel = 'openai-codex/gpt-5.4-mini',
    llmReasoning = 'off',
    generalInstructionsText,
    aiProvider = 'cloud',
    promptTemplateAttachments = [],
    promptTemplateText,
    sendToLlm = false
  }: Partial<StopTranscriptionOptions> = {}) {
    const bridge = getTranscriptionBridge();
    const transcriptBeforeStop = renderTranscript();
    const speculativeRequest = speculativeRequestRef.current;

    logTranscriptDebug('renderer.stop_requested', {
      llmModel,
      llmReasoning,
      sendToLlm,
      snapshot: getTranscriptDebugSnapshot(),
      transcript: transcriptBeforeStop
    });

    speculativeRequestRef.current = null;
    clearSpeculativeTimer();

    setIsListening(false);
    setIsStarting(false);
    const stopPromise = bridge?.stop().catch(() => undefined) ?? Promise.resolve();
    await stopPromise;

    const transcript = renderTranscript();

    publishTranscript(transcript);

    if (sendToLlm && transcript) {
      const requestTranscript = formatPromptTemplateRequest(transcript, promptTemplateText, generalInstructionsText);
      const requestedAt = new Date().toISOString();
      const responseId = `ai-response-${Date.now()}`;
      const initialResponseText = getAwaitingResponseText(aiProvider);
      setIsAsking(true);
      setLlmQuery(requestTranscript);
      setLlmRequestedAt(requestedAt);
      setLlmOutput(initialResponseText);
      activeLlmResponseIdRef.current = responseId;
      const historySessionId = activeSessionIdRef.current ?? undefined;
      setAiResponseSessions((current) => [...current, {
        historySessionId,
        id: responseId,
        isWaiting: true,
        request: requestTranscript,
        requestedAt,
        response: initialResponseText
      }]);
      saveHistorySessionById(historySessionId);

      try {
        const matchingSpeculativeRequest = speculativeRequest
          && speculativeRequest.transcript === requestTranscript
          && speculativeRequest.model === llmModel
          && speculativeRequest.reasoning === llmReasoning
          ? speculativeRequest
          : null;
        const responsePromise = matchingSpeculativeRequest
          ? revealSpeculativeRequest(matchingSpeculativeRequest)
          : requestVisibleLlm({
            bridge,
            attachments: promptTemplateAttachments,
            llmModel,
            llmReasoning,
            transcript: requestTranscript
          });

        const response = await responsePromise;
        const responseText = response?.text?.trim() || 'No response returned.';
        setLlmOutput(responseText);
        updateLlmResponse(responseId, { isWaiting: false, response: responseText });
      } catch (error) {
        const responseText = getErrorMessage(error);
        setLlmOutput(responseText);
        updateLlmResponse(responseId, { isWaiting: false, response: responseText });
      } finally {
        setIsAsking(false);
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        activeLlmRequestIdRef.current = null;
        activeLlmResponseIdRef.current = null;
      }

      return;
    }

    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }

  async function updateSources(options: LiveTranscriptionOptions) {
    const bridge = getTranscriptionBridge();
    const sources = getSelectedSources(options);

    logTranscriptDebug('renderer.sources_update_requested', {
      selectedSources: sources,
      snapshot: getTranscriptDebugSnapshot()
    });

    if (!bridge || !isListening) {
      return;
    }

    if (areCaptureSourcesEqual(activeSourcesRef.current, sources)) {
      return;
    }

    if (sources.length === 0) {
      setIsListening(false);
      setIsStarting(false);
      activeSourcesRef.current = [];
      await bridge.stop().catch(() => undefined);
      setOutput('Select at least one audio source.');
      return;
    }

    markSourceLabelsStarted(sources);
    activeSourcesRef.current = sources;

    try {
      await bridge.start({ sources });
    } catch (error) {
      setOutput(getErrorMessage(error));
    }
  }

  async function ask({
    llmModel = 'openai-codex/gpt-5.4-mini',
    llmReasoning = 'off',
    aiProvider = 'cloud',
    promptTemplateAttachments = [],
    promptTemplateText,
    generalInstructionsText,
    transcript
  }: Partial<Pick<StopTranscriptionOptions, 'aiProvider' | 'llmModel' | 'llmReasoning'>> & {
    promptTemplateAttachments?: PromptTemplateAttachment[];
    promptTemplateText?: string;
    generalInstructionsText?: string;
    transcript?: string;
  } = {}) {
    const bridge = getTranscriptionBridge();
    const requestTranscript = formatPromptTemplateRequest(transcript ?? output, promptTemplateText, generalInstructionsText);

    if (!bridge || !requestTranscript || isSetupMessage(requestTranscript) || requestTranscript === idleTranscriptText) {
      return;
    }

    setIsAsking(true);
    setLlmQuery(requestTranscript);
    const requestedAt = new Date().toISOString();
    const responseId = `ai-response-${Date.now()}`;
    const initialResponseText = getAwaitingResponseText(aiProvider);
    setLlmRequestedAt(requestedAt);
    setLlmOutput(initialResponseText);
    activeLlmResponseIdRef.current = responseId;
    const historySessionId = findHistorySessionIdForTranscript(transcript ?? output);
    setAiResponseSessions((current) => [...current, {
      historySessionId,
      id: responseId,
      isWaiting: true,
      request: requestTranscript,
      requestedAt,
      response: initialResponseText
    }]);
    saveHistorySessionById(historySessionId);

    try {
      const response = await requestVisibleLlm({
        attachments: promptTemplateAttachments,
        bridge,
        llmModel,
        llmReasoning,
        transcript: requestTranscript
      });
      const responseText = response?.text?.trim() || 'No response returned.';
      setLlmOutput(responseText);
      updateLlmResponse(responseId, { isWaiting: false, response: responseText });
    } catch (error) {
      const responseText = getErrorMessage(error);
      setLlmOutput(responseText);
      updateLlmResponse(responseId, { isWaiting: false, response: responseText });
    } finally {
      setIsAsking(false);
      activeLlmRequestIdRef.current = null;
      activeLlmResponseIdRef.current = null;
    }
  }

  function handleTranscriptionEvent(event: TranscriptionBridgeEvent) {
    const sequence = nextTranscriptDebugSequence();

    logTranscriptDebug('renderer.raw_event', {
      event,
      sequence,
      snapshot: getTranscriptDebugSnapshot()
    });

    if (!isTranscriptionEventSourceActive(event, activeSourcesRef.current)) {
      logTranscriptDebug('renderer.event_ignored_inactive_source', {
        event,
        sequence,
        snapshot: getTranscriptDebugSnapshot()
      });
      return;
    }

    if (event.type === 'completed') {
      const transcript = event.text.trim();

      if (transcript) {
        let line = createTranscriptLine({
          event,
          order: sequence,
          text: transcript
        }, sessionStartedAtRef.current);
        const eventUtteranceKey = line.key;
        const beforeBody = renderTranscriptBody();
        const before = renderTranscript();
        const beforeSnapshot = getTranscriptDebugSnapshot();
        const beforeFinalLines = finalTranscriptLinesRef.current;
        const partialKey = getPartialTranscriptSlotKey(line);
        const matchingPartial = partialTranscriptLinesRef.current.get(partialKey);
        const mergedText = chooseCompletedTranscriptText(transcript, matchingPartial?.text);
        if (mergedText !== transcript) {
          line = {
            ...line,
            text: mergedText
          };
        }
        const shouldClearPartial = eventUtteranceKey === undefined
          || partialTranscriptLinesRef.current.get(partialKey)?.key === eventUtteranceKey;

        if (shouldClearPartial) {
          partialTranscriptLinesRef.current.delete(partialKey);
        }

        upsertFinalTranscriptLine(line);
        let after = renderTranscript();

        if (!shouldClearPartial && shouldPreserveVisibleTranscript(before, after)) {
          logTranscriptDebug('renderer.completed_preserved_previous', {
            afterCandidate: after,
            before,
            event,
            sequence,
            snapshot: getTranscriptDebugSnapshot()
          });

          finalTranscriptLinesRef.current = beforeFinalLines;
          finalTranscriptRef.current = beforeBody;
          partialTranscriptLinesRef.current.delete(partialKey);
          after = before;
        }

        logTranscriptDebug('renderer.completed_merged', {
          afterSnapshot: getTranscriptDebugSnapshot(),
          beforeSnapshot,
          event,
          before,
          rawText: transcript,
          labelledText: labelTranscriptBySource(transcript, event.source, activeSourcesRef.current),
          timestampedText: renderTranscriptLine(line, sourceLabelsStartOrderRef.current),
          finalTranscript: finalTranscriptRef.current,
          partialTranscript: renderPartialTranscriptDebugText(partialTranscriptLinesRef.current, sourceLabelsStartOrderRef.current),
          sequence,
          shouldClearPartial,
          after
        });
        invalidateSpeculativeRequest(after);
        publishTranscript(after);
        scheduleSpeculativeRequest();
      } else {
        logTranscriptDebug('renderer.completed_ignored_empty', {
          event,
          sequence,
          snapshot: getTranscriptDebugSnapshot()
        });
      }

      return;
    }

    if (event.type === 'partial' || event.type === 'delta') {
      const transcript = event.text.trim();

      if (transcript) {
        const eventSource = event.type === 'partial' ? event.source : undefined;
        const line = createTranscriptLine({
          event: event.type === 'partial' ? event : { ...event, source: eventSource },
          order: sequence,
          text: transcript
        }, sessionStartedAtRef.current);
        const beforeSnapshot = getTranscriptDebugSnapshot();
        if (isStalePartialTranscriptLine(line, finalTranscriptLinesRef.current)) {
          logTranscriptDebug('renderer.partial_ignored_stale', {
            beforeSnapshot,
            event,
            rawText: transcript,
            sequence
          });
          return;
        }

        partialTranscriptLinesRef.current.set(getPartialTranscriptSlotKey(line), line);
        const after = renderTranscript();
        logTranscriptDebug('renderer.partial_displayed', {
          afterSnapshot: getTranscriptDebugSnapshot(),
          beforeSnapshot,
          event,
          rawText: transcript,
          labelledText: labelTranscriptBySource(transcript, eventSource, activeSourcesRef.current),
          timestampedText: renderTranscriptLine(line, sourceLabelsStartOrderRef.current),
          finalTranscript: finalTranscriptRef.current,
          partialTranscript: renderPartialTranscriptDebugText(partialTranscriptLinesRef.current, sourceLabelsStartOrderRef.current),
          sequence,
          after
        });
        invalidateSpeculativeRequest(after);
        publishTranscript(after);
        clearSpeculativeTimer();
      } else {
        logTranscriptDebug('renderer.partial_ignored_empty', {
          event,
          sequence,
          snapshot: getTranscriptDebugSnapshot()
        });
      }

      return;
    }

    if (event.type === 'speech-started' && !renderTranscript()) {
      publishTranscript(appendTranscript(getTranscriptHeader(sessionStartedAtRef.current), 'Speech detected...'));
      logTranscriptDebug('renderer.speech_started_displayed', {
        event,
        sequence,
        snapshot: getTranscriptDebugSnapshot()
      });
      return;
    }

    if (event.type === 'error') {
      const message = event.message.trim() || 'Live transcription failed.';

      if (!renderTranscriptBody()) {
        publishTranscript(appendTranscript(getTranscriptHeader(sessionStartedAtRef.current), message));
      } else {
        setOutput(message);
      }

      setIsListening(false);
      setIsStarting(false);
      void getTranscriptionBridge()?.stop().catch(() => undefined);
      logTranscriptDebug('renderer.error_displayed', {
        event,
        sequence,
        snapshot: getTranscriptDebugSnapshot()
      });
      return;
    }

    if (event.type === 'llm-response') {
      if (event.requestId && event.requestId !== activeLlmRequestIdRef.current) {
        const speculativeRequest = speculativeRequestRef.current;

        if (speculativeRequest?.id === event.requestId) {
          speculativeRequest.finalText = event.text.trim() || 'No response returned.';
        }

        return;
      }

      const responseText = event.text.trim() || 'No response returned.';
      setLlmOutput(responseText);
      if (activeLlmResponseIdRef.current) {
        updateLlmResponse(activeLlmResponseIdRef.current, { isWaiting: false, response: responseText });
      }
      setIsAsking(false);
      activeLlmResponseIdRef.current = null;
      return;
    }

    if (event.type === 'llm-response-delta') {
      if (event.requestId && event.requestId !== activeLlmRequestIdRef.current) {
        const speculativeRequest = speculativeRequestRef.current;

        if (speculativeRequest?.id === event.requestId) {
          speculativeRequest.deltas = `${speculativeRequest.deltas}${event.text}`;
        }

        return;
      }

      setLlmOutput((current) => {
        const next = isAwaitingResponseText(current) ? event.text : `${current}${event.text}`;

        if (activeLlmResponseIdRef.current) {
          updateLlmResponse(activeLlmResponseIdRef.current, { response: next });
        }

        return next;
      });
      setIsAsking(true);
      return;
    }

    if (event.type === 'llm-query') {
      if (event.requestId && event.requestId !== activeLlmRequestIdRef.current) {
        return;
      }

      setLlmQuery(event.text.trim() || 'No query sent yet.');
      setLlmRequestedAt(new Date().toISOString());
      setLlmOutput((current) => (current === preparingLocalAiText ? current : awaitingResponseText));
      setIsAsking(true);
      return;
    }

    if (event.type === 'stage' && !renderTranscript()) {
      const message = formatStageMessage(event.message);

      if (!isSetupMessage(message)) {
          setOutput(message);
        logTranscriptDebug('renderer.stage_displayed', {
          event,
          message,
          sequence,
          snapshot: getTranscriptDebugSnapshot()
        });
      }
    }
  }

  function renderTranscript() {
    const body = renderTranscriptBody();

    if (!body) {
      return '';
    }

    return appendTranscript(getTranscriptHeader(sessionStartedAtRef.current), body);
  }

  function publishTranscript(transcript: string) {
    const sessionId = activeSessionIdRef.current;

    if (!sessionId) {
      setOutput(transcript || idleTranscriptText);
      return;
    }

    setTranscriptSessions((current) => {
      const next = current.map((session) => (
        session.id === sessionId ? { ...session, output: transcript } : session
      ));
      const savedSession = next.find((session) => session.id === sessionId);
      if (savedSession) {
        saveHistorySession(savedSession);
      }
      setOutput(combineTranscriptSessions(next));
      return next;
    });
  }

  function getTranscriptDebugSnapshot() {
    return {
      finalTranscript: finalTranscriptRef.current,
      finalTranscriptLength: finalTranscriptRef.current.length,
      partialTranscript: renderPartialTranscriptDebugText(partialTranscriptLinesRef.current, sourceLabelsStartOrderRef.current),
      partialTranscriptLength: [...partialTranscriptLinesRef.current.values()]
        .reduce((length, line) => length + line.text.length, 0),
      partialUtteranceKeys: [...partialTranscriptLinesRef.current.values()].map((line) => line.key),
      renderedTranscript: renderTranscript()
    };
  }

  function renderTranscriptBody() {
    const lines = [...finalTranscriptLinesRef.current];

    lines.push(...partialTranscriptLinesRef.current.values());

    const body = lines
      .sort(compareTranscriptLines)
      .map((line) => renderTranscriptLine(line, sourceLabelsStartOrderRef.current))
      .join('\n')
      .trim();

    finalTranscriptRef.current = finalTranscriptLinesRef.current
      .sort(compareTranscriptLines)
      .map((line) => renderTranscriptLine(line, sourceLabelsStartOrderRef.current))
      .join('\n')
      .trim();

    return body;
  }

  function upsertFinalTranscriptLine(line: TranscriptLine) {
    const existingIndex = finalTranscriptLinesRef.current.findIndex((current) => current.key === line.key);

    if (existingIndex >= 0) {
      finalTranscriptLinesRef.current = finalTranscriptLinesRef.current.map((current, index) => (
        index === existingIndex ? line : current
      ));
      return;
    }

    finalTranscriptLinesRef.current = [...finalTranscriptLinesRef.current, line];
  }

  function nextTranscriptDebugSequence() {
    debugSequenceRef.current += 1;

    return debugSequenceRef.current;
  }

  function scheduleSpeculativeRequest() {
    if (!isSpeculativeLlmEnabled()) {
      return;
    }

    clearSpeculativeTimer();
    speculativeTimerRef.current = setTimeout(() => {
      const transcript = renderTranscript();

      if (!transcript) {
        return;
      }

      void startSpeculativeRequest(transcript);
    }, getSpeculativeDelayMs());
  }

  async function startSpeculativeRequest(transcript: string) {
    const bridge = getTranscriptionBridge();

    if (!bridge || speculativeRequestRef.current?.transcript === transcript) {
      return;
    }

    const id = `speculative-${Date.now()}`;
    const model = getSpeculativeModel();
    const reasoning = getSpeculativeReasoning();
    const request: SpeculativeRequest = {
      deltas: '',
      finalText: null,
      id,
      model,
      promise: Promise.resolve(undefined),
      reasoning,
      transcript
    };
    request.promise = bridge.requestLlm({
      model,
      reasoning,
      requestId: id,
      speculative: true,
      trace: {
        requestedAt: Date.now(),
        speculative: true
      },
      transcript
    }).catch(() => undefined);
    speculativeRequestRef.current = request;
  }

  function revealSpeculativeRequest(request: SpeculativeRequest) {
    activeLlmRequestIdRef.current = request.id;

    if (request.deltas) {
      setLlmOutput(request.deltas);
    }

    return request.promise.then((response) => ({
      ok: response?.ok ?? true,
      text: response?.text ?? request.finalText ?? request.deltas
    }));
  }

  function requestVisibleLlm({
    attachments = [],
    bridge,
    llmModel,
    llmReasoning,
    transcript
  }: {
    attachments?: PromptTemplateAttachment[];
    bridge: ReturnType<typeof getTranscriptionBridge>;
    llmModel: LlmModel;
    llmReasoning: LlmReasoning;
    transcript: string;
  }) {
    const requestId = `manual-${Date.now()}`;
    activeLlmRequestIdRef.current = requestId;

    return bridge?.requestLlm({
      attachments,
      model: llmModel,
      reasoning: llmReasoning,
      requestId,
      trace: {
        requestedAt: Date.now()
      },
      transcript
    });
  }

  function clearSpeculativeTimer() {
    if (speculativeTimerRef.current) {
      clearTimeout(speculativeTimerRef.current);
      speculativeTimerRef.current = null;
    }
  }

  function getAwaitingResponseText(_aiProvider: AiProvider) {
    return awaitingResponseText;
  }

  function isAwaitingResponseText(text: string) {
    return text === awaitingResponseText || text === preparingLocalAiText;
  }

  function invalidateSpeculativeRequest(transcript: string) {
    if (speculativeRequestRef.current?.transcript !== transcript) {
      speculativeRequestRef.current = null;
    }
  }

  return {
    isListening,
    isStarting,
    isAsking,
    llmQuery,
    llmOutput,
    llmRequestedAt,
    llmResponses,
    output,
    sessions,
    ask,
    clearAiResponses,
    clearTranscript,
    start,
    updateSources,
    stop
  };

  function clearAiResponses() {
    if (isAsking) {
      return;
    }

    setLlmOutput(idleLlmText);
    setLlmRequestedAt(null);
    setAiResponseSessions([]);
    activeLlmResponseIdRef.current = null;
  }

  function clearTranscript() {
    if (isListening || isStarting) {
      return;
    }

    setOutput(idleTranscriptText);
    setTranscriptSessions([]);
    finalTranscriptRef.current = '';
    finalTranscriptLinesRef.current = [];
    partialTranscriptLinesRef.current = new Map();
    sourceLabelsStartOrderRef.current = null;
    activeSessionIdRef.current = null;
    sessionStartedAtRef.current = null;
  }

  function updateLlmResponse(id: string, patch: Partial<AiResponseSession>) {
    const next = llmResponsesRef.current.map((response) => (
      response.id === id ? { ...response, ...patch } : response
    ));
    const updated = next.find((response) => response.id === id);
    setAiResponseSessions(next);
    saveHistorySessionById(updated?.historySessionId);
  }

  function setTranscriptSessions(update: TranscriptSession[] | ((current: TranscriptSession[]) => TranscriptSession[])) {
    const next = typeof update === 'function' ? update(sessionsRef.current) : update;
    sessionsRef.current = next;
    setSessions(next);
  }

  function setAiResponseSessions(update: AiResponseSession[] | ((current: AiResponseSession[]) => AiResponseSession[])) {
    const next = typeof update === 'function' ? update(llmResponsesRef.current) : update;
    llmResponsesRef.current = next;
    setLlmResponses(next);
  }

  function saveHistorySessionById(sessionId: string | undefined) {
    if (!sessionId) {
      return;
    }

    const session = sessionsRef.current.find((item) => item.id === sessionId);
    if (session) {
      saveHistorySession(session);
    }
  }

  function saveHistorySession(session: TranscriptSession) {
    void getSettingsBridge()?.history?.saveSession({
      aiResponses: llmResponsesRef.current
        .filter((response) => response.historySessionId === session.id)
        .map((response) => ({
          id: response.id,
          request: response.request,
          requestedAt: response.requestedAt,
          response: response.response
        })),
      sessionId: session.id,
      startedAt: session.startedAt,
      transcript: session.output
    });
  }

  function findHistorySessionIdForTranscript(transcript: string) {
    const trimmedTranscript = transcript.trim();

    return sessionsRef.current.find((session) => session.output.trim() === trimmedTranscript)?.id
      ?? sessionsRef.current.at(-1)?.id;
  }

  function markSourceLabelsStarted(sources: CaptureSource[]) {
    if (sources.length > 1 && sourceLabelsStartOrderRef.current === null) {
      sourceLabelsStartOrderRef.current = debugSequenceRef.current + 1;
    }
  }
}

function getSelectedSources(options: LiveTranscriptionOptions): CaptureSource[] {
  return [
    options.listenToSystemAudio ? 'system' : null,
    options.listenToMicrophone ? 'microphone' : null
  ].filter((source): source is CaptureSource => source !== null);
}

function areCaptureSourcesEqual(left: CaptureSource[], right: CaptureSource[]) {
  return left.length === right.length
    && left.every((source, index) => source === right[index]);
}

function isTranscriptionEventSourceActive(
  event: TranscriptionBridgeEvent,
  activeSources: CaptureSource[]
) {
  if (event.type !== 'completed' && event.type !== 'partial') {
    return true;
  }

  return !event.source || activeSources.includes(event.source);
}

function getErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Audio access was denied.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Live transcription failed.';
}

function appendTranscript(current: string, next: string) {
  const left = current.trim();
  const right = next.trim();

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return `${left}\n${right}`;
}

function combineTranscriptSessions(sessions: TranscriptSession[]) {
  const transcript = sessions
    .map((session) => session.output.trim())
    .filter(Boolean)
    .join('\n\n');

  return transcript || idleTranscriptText;
}

function isTranscriptText(output: string) {
  return output.trim().length > 0
    && output !== idleTranscriptText
    && !isSetupMessage(output);
}

function shouldShowListeningWaitingText(output: string, sessionHeader: string) {
  return output.includes(sessionHeader)
    && !output.includes('Listening. Waiting for speech...')
    && !output.includes('Speech detected...')
    && !output.includes('Transcribing local audio...');
}

function formatPromptTemplateRequest(
  transcript: string,
  promptTemplateText: string | undefined,
  generalInstructionsText: string | undefined
) {
  const trimmedTranscript = transcript.trim();
  const trimmedGeneralInstructions = generalInstructionsText?.trim();
  const trimmedTemplate = promptTemplateText?.trim();
  const instructionBlocks = [
    trimmedGeneralInstructions ? `General instructions:\n${trimmedGeneralInstructions}` : null,
    trimmedTemplate
  ].filter((block): block is string => Boolean(block));

  if (instructionBlocks.length === 0) {
    return trimmedTranscript;
  }

  return `${instructionBlocks.join('\n\n')}\n\nTranscript:\n${trimmedTranscript}`;
}

function getTranscriptHeader(startedAt: Date | null) {
  const timestamp = formatUserDateTime(startedAt ?? new Date());

  return `Transcript started: ${timestamp}`;
}

function timestampTranscriptLine(transcript: string, recordedAt: Date) {
  return `[${formatUserTime(recordedAt)}]: ${transcript}`;
}

function createTranscriptLine({
  event,
  order,
  text
}: {
  event: Extract<TranscriptionBridgeEvent, { type: 'completed' | 'partial' }> | (Extract<TranscriptionBridgeEvent, { type: 'delta' }> & { source?: CaptureSource });
  order: number;
  text: string;
}, sessionStartedAt: Date | null): TranscriptLine {
  const source = event.source;
  const startMs = event.type === 'delta' ? undefined : event.startMs;
  const displayAt = new Date();
  const startAt = getEventStartedAt(startMs, sessionStartedAt);
  const utteranceKey = event.type === 'delta' ? undefined : getUtteranceKey(source, event.utteranceId);

  return {
    displayAt,
    key: utteranceKey ?? getTranscriptEventItemId(event) ?? `${source ?? 'unknown'}:${startMs ?? startAt.getTime()}:${text}`,
    order,
    source,
    startAt,
    startMs,
    text
  };
}

function getTranscriptEventItemId(event: TranscriptionBridgeEvent) {
  return 'itemId' in event ? event.itemId : undefined;
}

function renderTranscriptLine(line: TranscriptLine, sourceLabelsStartOrder: number | null) {
  return formatTranscriptLine(
    line.text,
    line.source,
    shouldShowTranscriptSourceLabel(line, sourceLabelsStartOrder),
    line.displayAt
  );
}

function formatTranscriptLine(
  transcript: string,
  source: CaptureSource | undefined,
  showSourceLabel: boolean,
  recordedAt: Date
) {
  const label = getTranscriptSourceLabel(source, showSourceLabel);
  const sourcePrefix = label ? ` [${label}]` : '';

  return `[${formatUserTime(recordedAt)}]${sourcePrefix}: ${transcript}`;
}

function shouldShowTranscriptSourceLabel(line: TranscriptLine, sourceLabelsStartOrder: number | null) {
  return sourceLabelsStartOrder !== null && line.order >= sourceLabelsStartOrder;
}

function chooseCompletedTranscriptText(completed: string, partial: string | undefined) {
  const completedText = completed.trim();
  const partialText = partial?.trim();

  if (!partialText || partialText.length <= completedText.length) {
    return completedText;
  }

  const completedWords = words(completedText.toLocaleLowerCase());
  const partialWords = words(partialText.toLocaleLowerCase());

  if (completedWords.length === 0 || partialWords.length <= completedWords.length) {
    return completedText;
  }

  const completedAsSuffix = partialWords
    .slice(partialWords.length - completedWords.length)
    .every((word, index) => word === completedWords[index]);

  return completedAsSuffix ? partialText : completedText;
}

function words(text: string) {
  return text.split(/\s+/).filter(Boolean);
}

function compareTranscriptLines(left: TranscriptLine, right: TranscriptLine) {
  const startDelta = left.startAt.getTime() - right.startAt.getTime();

  if (startDelta !== 0) {
    return startDelta;
  }

  return left.order - right.order;
}

function isStalePartialTranscriptLine(partial: TranscriptLine, finalLines: TranscriptLine[]) {
  return finalLines.some((line) => (
    line.source === partial.source
    && line.startMs !== undefined
    && partial.startMs !== undefined
    && partial.startMs <= line.startMs
  ));
}

function getPartialTranscriptSlotKey(line: TranscriptLine) {
  return line.key ?? line.source ?? 'unknown';
}

function renderPartialTranscriptDebugText(
  partials: Map<string, TranscriptLine>,
  sourceLabelsStartOrder: number | null
) {
  return [...partials.values()]
    .sort(compareTranscriptLines)
    .map((line) => renderTranscriptLine(line, sourceLabelsStartOrder))
    .join('\n');
}

function getEventStartedAt(startMs: number | undefined, sessionStartedAt: Date | null) {
  if (sessionStartedAt && Number.isFinite(startMs)) {
    return new Date(sessionStartedAt.getTime() + Number(startMs));
  }

  return new Date();
}

function formatUserDateTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(date);
}

function formatUserTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function labelTranscriptBySource(
  transcript: string,
  source: CaptureSource | undefined,
  activeSources: CaptureSource[]
) {
  const label = getTranscriptSourceLabel(source, activeSources.length > 1);

  return label ? `[${label}] ${transcript}` : transcript;
}

function getTranscriptSourceLabel(
  source: CaptureSource | undefined,
  showSourceLabel: boolean
) {
  if (!showSourceLabel || !source) {
    return null;
  }

  return source === 'system' ? 'Speaker' : 'Microphone';
}

function getUtteranceKey(source: CaptureSource | undefined, utteranceId: number | undefined) {
  if (utteranceId === undefined) {
    return undefined;
  }

  return `${source ?? 'unknown'}:${utteranceId}`;
}

function shouldPreserveVisibleTranscript(before: string, after: string) {
  const previous = before.trim();
  const next = after.trim();

  if (!previous || !next) {
    return false;
  }

  return next.length < previous.length;
}

function formatStageMessage(message: string) {
  if (message === 'loading local Parakeet') {
    return 'Loading local Parakeet...';
  }

  if (message === 'local Parakeet loaded') {
    return 'Listening. Waiting for speech...';
  }

  if (message === 'local Parakeet capture started') {
    return 'Listening with local Parakeet...';
  }

  return message;
}

function isSetupMessage(message: string) {
  return [
    'Starting local Parakeet...',
    'Loading local Parakeet...',
    'starting microphone capture',
    'starting system audio capture',
    'local Parakeet hot capture prepared',
    'microphone capture started',
    'Core Audio capture started',
    'local Parakeet warm daemon started',
    'local Parakeet loaded',
    'local Parakeet capture started',
    'Listening with local Parakeet...',
    'local transcription stopped'
  ].includes(message);
}

function isSpeculativeLlmEnabled() {
  return import.meta.env.VITE_CAUL_SPECULATIVE_LLM === '1';
}

function logTranscriptDebug(stage: string, payload: Record<string, unknown>) {
  if (!rendererTranscriptDebugEnabled) {
    return;
  }

  console.info(`caul-renderer-transcript-debug ${JSON.stringify({
    at: new Date().toISOString(),
    stage,
    ...payload
  })}`);
}

function getSpeculativeDelayMs() {
  const delay = Number(import.meta.env.VITE_CAUL_SPECULATIVE_LLM_DELAY_MS ?? 500);

  return Number.isFinite(delay) ? Math.max(0, delay) : 500;
}

function getSpeculativeModel(): LlmModel {
  const model = import.meta.env.VITE_CAUL_SPECULATIVE_LLM_MODEL;

  return isLlmModel(model) ? model : 'openai-codex/gpt-5.4-mini';
}

function getSpeculativeReasoning(): LlmReasoning {
  const reasoning = import.meta.env.VITE_CAUL_SPECULATIVE_LLM_REASONING;

  return isLlmReasoning(reasoning) ? reasoning : 'off';
}

function isLlmModel(value: unknown): value is LlmModel {
  return [
    'openai-codex/gpt-5.2',
    'openai-codex/gpt-5.4',
    'openai-codex/gpt-5.4-mini',
    'openai-codex/gpt-5.5'
  ].includes(String(value));
}

function isLlmReasoning(value: unknown): value is LlmReasoning {
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(String(value));
}

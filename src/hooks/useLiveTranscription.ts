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
import {
  createProvisionalTranscriptReducer,
  type ProvisionalTranscriptLine
} from '../foundation/provisionalTranscript';
import { getRuntimeContext } from '../foundation/runtime';
import cloudLlmConfig from '../../electron/llmConfig.json';

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
  confirmedOutput: string;
  draftOutput?: string;
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

export function useLiveTranscription() {
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [confirmedOutput, setConfirmedOutput] = useState('');
  const [output, setOutput] = useState(idleTranscriptText);
  const [sessions, setSessions] = useState<TranscriptSession[]>([]);
  const [llmQuery, setLlmQuery] = useState('No query sent yet.');
  const [llmOutput, setLlmOutput] = useState(idleLlmText);
  const [llmRequestedAt, setLlmRequestedAt] = useState<string | null>(null);
  const [llmResponses, setLlmResponses] = useState<AiResponseSession[]>([]);
  const sessionsRef = useRef<TranscriptSession[]>([]);
  const llmResponsesRef = useRef<AiResponseSession[]>([]);
  const finalTranscriptRef = useRef('');
  const provisionalTranscriptRef = useRef(createProvisionalTranscriptReducer());
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
  const startSequenceRef = useRef(0);

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
    const startingAudioText = 'Starting audio...';

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
    const startSequence = startSequenceRef.current + 1;
    startSequenceRef.current = startSequence;
    const sessionStartedAt = new Date();
    const sessionId = `transcript-${sessionStartedAt.getTime()}`;
    sessionStartedAtRef.current = sessionStartedAt;
    activeSessionIdRef.current = sessionId;
    finalTranscriptRef.current = '';
    provisionalTranscriptRef.current.reset();
    activeSourcesRef.current = sources;
    sourceLabelsStartOrderRef.current = sources.length > 1 ? 0 : null;
    activeLlmRequestIdRef.current = null;
    speculativeRequestRef.current = null;
    clearSpeculativeTimer();
    const sessionHeader = getTranscriptHeader(sessionStartedAt);
    const waitingTranscript = appendTranscript(sessionHeader, startingAudioText);
    const session = {
      confirmedOutput: sessionHeader,
      draftOutput: '',
      id: sessionId,
      output: waitingTranscript,
      startedAt: sessionStartedAt.toISOString()
    };
    setTranscriptSessions((current) => [...current, session]);
    setConfirmedOutput(sessionHeader);
    saveHistorySession({ ...session, output: sessionHeader });
    setOutput((currentOutput) => {
      const previousOutput = isTranscriptText(currentOutput) ? currentOutput : '';
      return appendTranscript(previousOutput, waitingTranscript);
    });

    logTranscriptDebug('renderer.start_state_reset', {
      snapshot: getTranscriptDebugSnapshot()
    });

    let captureReadiness: ReturnType<typeof createCaptureReadinessTracker> | null = null;

    try {
      captureReadiness = createCaptureReadinessTracker(sources);
      unsubscribeRef.current = bridge.onEvent((event) => {
        captureReadiness?.handleEvent(event);
        handleTranscriptionEvent(event);
      });
      const prepareResult = await bridge.prepare?.({
        hotCapture: true,
        sources
      });

      if (prepareResult?.hotCaptureArmed) {
        await captureReadiness.wait();
      } else {
        captureReadiness.cancel();
      }

      if (startSequenceRef.current !== startSequence) {
        return;
      }

      await bridge.start({
        sources
      });
      setOutput((currentOutput) => (
        shouldShowListeningWaitingText(currentOutput, sessionHeader)
          ? currentOutput.replace(
            appendTranscript(sessionHeader, startingAudioText),
            appendTranscript(sessionHeader, waitingText)
          )
          : currentOutput
      ));
    } catch (error) {
      captureReadiness?.cancel();
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
    llmModel = cloudLlmConfig.defaultModel,
    llmReasoning = cloudLlmConfig.defaultReasoning as LlmReasoning,
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
    startSequenceRef.current += 1;
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
    llmModel = cloudLlmConfig.defaultModel,
    llmReasoning = cloudLlmConfig.defaultReasoning as LlmReasoning,
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
    const sourceTranscript = transcript ?? confirmedOutput;

    if (transcript === undefined && !isTranscriptText(sourceTranscript)) {
      return;
    }

    const requestTranscript = formatPromptTemplateRequest(sourceTranscript, promptTemplateText, generalInstructionsText);

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
    const historySessionId = findHistorySessionIdForTranscript(sourceTranscript);
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
        const before = renderTranscript();
        const beforeSnapshot = getTranscriptDebugSnapshot();

        provisionalTranscriptRef.current.apply({
          ...event,
          displayAtMs: Date.now(),
          text: transcript,
          utteranceId: event.utteranceId ?? sequence
        });
        const after = renderTranscript();
        const visibleAfter = renderVisibleTranscript();
        const draftAfter = renderDraftTranscript();

        logTranscriptDebug('renderer.completed_appended', {
          afterSnapshot: getTranscriptDebugSnapshot(),
          beforeSnapshot,
          event,
          before,
          rawText: transcript,
          labelledText: labelTranscriptBySource(transcript, event.source, activeSourcesRef.current),
          finalTranscript: finalTranscriptRef.current,
          sequence,
          after
        });
        invalidateSpeculativeRequest(after);
        publishTranscript(visibleAfter || after, after, draftAfter);
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
        const beforeSnapshot = getTranscriptDebugSnapshot();
        const statusTranscript = appendTranscript(getTranscriptHeader(sessionStartedAtRef.current), 'Transcribing local audio...');

        if (event.type === 'partial') {
          provisionalTranscriptRef.current.apply({
            ...event,
            displayAtMs: Date.now(),
            text: transcript
          });
        }

        const confirmed = renderTranscript();
        const visible = renderVisibleTranscript();
        const draft = renderDraftTranscript();

        if (draft) {
          publishTranscript(visible || confirmed, confirmed, draft);
        } else if (!confirmed) {
          publishTranscript(statusTranscript, getTranscriptHeader(sessionStartedAtRef.current), '');
        }

        logTranscriptDebug('renderer.partial_displayed_status', {
          afterSnapshot: getTranscriptDebugSnapshot(),
          beforeSnapshot,
          event,
          rawText: transcript,
          labelledText: labelTranscriptBySource(transcript, eventSource, activeSourcesRef.current),
          finalTranscript: finalTranscriptRef.current,
          sequence
        });
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
    const body = renderTranscriptBody('confirmed');

    if (!body) {
      return '';
    }

    return appendTranscript(getTranscriptHeader(sessionStartedAtRef.current), body);
  }

  function renderDraftTranscript() {
    const body = renderTranscriptBody('draft');

    if (!body) {
      return '';
    }

    return appendTranscript(getTranscriptHeader(sessionStartedAtRef.current), body);
  }

  function renderVisibleTranscript() {
    const confirmed = renderTranscript();
    const draftBody = renderTranscriptBody('draft');

    if (!draftBody) {
      return confirmed;
    }

    const visibleBody = [renderTranscriptBody('confirmed'), draftBody].filter(Boolean).join('\n');

    return appendTranscript(getTranscriptHeader(sessionStartedAtRef.current), visibleBody);
  }

  function publishTranscript(transcript: string, confirmedTranscript = transcript, draftTranscript = '') {
    const sessionId = activeSessionIdRef.current;

    if (!sessionId) {
      setOutput(transcript || idleTranscriptText);
      setConfirmedOutput(confirmedTranscript || '');
      return;
    }

    setTranscriptSessions((current) => {
      const next = current.map((session) => (
        session.id === sessionId
          ? {
            ...session,
            confirmedOutput: confirmedTranscript,
            draftOutput: draftTranscript,
            output: transcript
          }
          : session
      ));
      const savedSession = next.find((session) => session.id === sessionId);
      if (savedSession) {
        saveHistorySession(savedSession);
      }
      setOutput(combineTranscriptSessions(next));
      setConfirmedOutput(combineConfirmedTranscriptSessions(next));
      return next;
    });
  }

  function getTranscriptDebugSnapshot() {
    return {
      finalTranscript: finalTranscriptRef.current,
      finalTranscriptLength: finalTranscriptRef.current.length,
      renderedDraftTranscript: renderDraftTranscript(),
      renderedTranscript: renderTranscript()
    };
  }

  function renderTranscriptBody(kind: 'confirmed' | 'draft' = 'confirmed') {
    const snapshot = provisionalTranscriptRef.current.snapshot();
    const lines = kind === 'confirmed' ? snapshot.confirmed : snapshot.drafts;
    const body = lines
      .map((line) => renderTranscriptLine(line, sourceLabelsStartOrderRef.current))
      .join('\n')
      .trim();

    if (kind === 'confirmed') {
      finalTranscriptRef.current = body;
    }

    return body;
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
    confirmedOutput,
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
    setConfirmedOutput('');
    setTranscriptSessions([]);
    finalTranscriptRef.current = '';
    provisionalTranscriptRef.current.reset();
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
      transcript: session.confirmedOutput
    });
  }

  function findHistorySessionIdForTranscript(transcript: string) {
    const trimmedTranscript = transcript.trim();

    return sessionsRef.current.find((session) => session.confirmedOutput.trim() === trimmedTranscript)?.id
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

function createCaptureReadinessTracker(sources: CaptureSource[]) {
  const pending = new Set(sources);
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
    timeout = setTimeout(() => {
      finish(() => reject(new Error('Timed out waiting for audio capture to start.')));
    }, 15_000);
  });

  const finish = (complete: () => void) => {
    if (settled) {
      return;
    }

    settled = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    complete();
  };

  const markReady = (source: CaptureSource) => {
    pending.delete(source);
    if (pending.size === 0) {
      finish(resolveReady);
    }
  };

  const handleEvent = (event: TranscriptionBridgeEvent) => {
    if (settled) {
      return;
    }

    if (event.type === 'error') {
      finish(() => rejectReady(new Error(event.message || 'Audio capture failed to start.')));
      return;
    }

    if (event.type !== 'stage') {
      return;
    }

    if (event.message === 'microphone capture started') {
      markReady('microphone');
      return;
    }

    if (isSystemAudioReadyStage(event.message)) {
      markReady('system');
    }
  };

  if (pending.size === 0) {
    finish(resolveReady);
  }

  return {
    cancel: () => finish(resolveReady),
    handleEvent,
    wait: () => promise
  };
}

function isSystemAudioReadyStage(message: string) {
  return message === 'ScreenCaptureKit audio capture started'
    || message === 'Core Audio capture started'
    || message === 'WASAPI loopback capture started'
    || message === 'Pulse/PipeWire monitor capture started'
    || message === 'system audio capture started';
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

function combineConfirmedTranscriptSessions(sessions: TranscriptSession[]) {
  return sessions
    .map((session) => session.confirmedOutput.trim())
    .filter(Boolean)
    .join('\n\n');
}

function isTranscriptText(output: string) {
  return getTranscriptBody(output).trim().length > 0
    && output !== idleTranscriptText
    && !isSetupMessage(output);
}

function getTranscriptBody(output: string) {
  const lines = output.split('\n');

  if (/^Transcript started:/.test(lines[0] ?? '')) {
    return lines.slice(1).join('\n');
  }

  return output;
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

function renderTranscriptLine(line: ProvisionalTranscriptLine, sourceLabelsStartOrder: number | null) {
  return formatTranscriptLine(
    line.text,
    line.source,
    shouldShowTranscriptSourceLabel(line, sourceLabelsStartOrder),
    new Date(line.displayAtMs)
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

function shouldShowTranscriptSourceLabel(line: ProvisionalTranscriptLine, sourceLabelsStartOrder: number | null) {
  return sourceLabelsStartOrder !== null && line.order >= sourceLabelsStartOrder;
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
    'Starting audio...',
    'Starting local Parakeet...',
    'Loading local Parakeet...',
    'starting microphone capture',
    'starting system audio capture',
    'local Parakeet model prepared',
    'local Parakeet hot capture armed',
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

  return isLlmModel(model) ? model : cloudLlmConfig.defaultModel;
}

function getSpeculativeReasoning(): LlmReasoning {
  const reasoning = import.meta.env.VITE_CAUL_SPECULATIVE_LLM_REASONING;

  return isLlmReasoning(reasoning) ? reasoning : cloudLlmConfig.defaultReasoning as LlmReasoning;
}

function isLlmModel(value: unknown): value is LlmModel {
  return cloudLlmConfig.models.some((model) => model.value === String(value));
}

function isLlmReasoning(value: unknown): value is LlmReasoning {
  return cloudLlmConfig.reasoningLevels.some((reasoning) => reasoning.value === String(value));
}

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, CheckboxDisplay } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDownIcon, CopyIcon, DownloadIcon, FileIcon, FileTextIcon, ImageIcon, LoaderCircleIcon, PaperclipIcon, PencilIcon, PlayIcon, SearchIcon, SendIcon, SettingsIcon, SquareIcon, XIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import susuraMarkUrl from '../assets/icons/susura-mark.svg?url';
import {
  getLlmBridge,
  getPermissionsBridge,
  getPrivateOverlayBridge,
  getSettingsBridge,
  getTranscriptionBridge,
  type LlmModel,
  type LlmReasoning,
  type PermissionItem,
  type PermissionsStatus,
  type PrivateOverlayState,
  type PromptTemplate,
  type PromptTemplateAttachment,
  type PromptTemplateState
} from './foundation/desktopBridge';
import { useLiveTranscription, type TranscriptSession } from './hooks/useLiveTranscription';
import { useRuntimeContext } from './hooks/useRuntimeContext';
import { useSystemColourScheme } from './hooks/useSystemColourScheme';

const layout = {
  main: 'grid h-screen grid-rows-[48px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/70 bg-background text-foreground shadow-2xl',
  appBody: 'relative min-h-0 overflow-hidden',
  windowTitleBar: 'relative z-[60] flex h-12 select-none items-center justify-center border-b border-border/70 bg-background/95 text-muted-foreground',
  windowTitleBarDragArea: 'absolute inset-0 flex min-w-0 cursor-default items-center justify-center px-12 active:cursor-default',
  windowTitleBarTitle: 'truncate text-sm font-medium text-foreground',
  windowTitleBarButton: 'absolute right-1 top-1/2 z-10 size-7 -translate-y-1/2 cursor-default text-muted-foreground hover:text-foreground',
  windowTitleBarSettingsButton: 'absolute top-1/2 z-[70] size-9 min-h-9 min-w-9 -translate-y-1/2 rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
  windowTitleBarSettingsButtonMac: 'right-1.5',
  windowTitleBarSettingsButtonDesktop: 'left-1.5',
  windowTitleBarMacCloseButton: 'susura-mac-close-button absolute left-3 top-1/2 z-10 size-[14px] -translate-y-1/2 cursor-default rounded-full border-[0.5px] border-[#FB1626] bg-[#FF5C60] p-0 shadow-none hover:bg-[#FF5C60] active:bg-[#D94D4F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5C60]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  page: 'h-full min-h-0 overflow-hidden',
  form: 'h-full w-full',
  contentTopToolbar: 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]',
  contentRightToolbar: 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto]',
  contentBottomToolbar: 'grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]',
  contentLeftToolbar: 'grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)]',
  panelGrid: 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border',
  panelGridStacked: 'grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] divide-y divide-border',
  panel: 'panel-background grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden',
  panelPlain: 'panel-background h-full min-h-0 overflow-hidden',
  homeToolbar: 'z-10 overflow-hidden bg-background',
  homeToolbarTop: 'grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center divide-x divide-border border-b border-border',
  homeToolbarRight: 'grid h-full w-12 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] items-stretch divide-y divide-border border-l border-border p-0',
  homeToolbarBottom: 'grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center divide-x divide-border border-t border-border',
  homeToolbarLeft: 'grid h-full w-12 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] items-stretch divide-y divide-border border-r border-border p-0',
  homeToolbarHorizontalSection: 'flex min-w-0 items-center gap-2 px-3 py-1.5',
  homeToolbarHorizontalSectionAi: 'justify-center',
  homeToolbarVerticalSection: 'flex min-h-0 flex-col items-center justify-between gap-2 overflow-hidden px-1.5 py-3',
  homeToolbarVerticalSectionTop: '',
  homeToolbarVerticalSectionBottom: '',
  panelScroller: 'panel-background -mt-px box-border h-full min-h-0 overflow-y-auto',
  settingsBackdrop: 'absolute inset-0 z-40 bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
  settingsDialog: 'susura-settings-dialog absolute z-50 grid overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10',
  modalHeaderTitle: 'font-heading text-sm leading-none font-medium text-center',
  settingsHeader: 'flex h-12 items-center justify-center border-b border-border px-12',
  settingsHeaderMac: '',
  settingsContent: 'min-h-0 overflow-y-auto p-4',
  modalCloseButton: 'absolute top-6 z-20 -translate-y-1/2',
  modalCloseButtonDesktop: 'right-3 size-8 rounded-md',
  modalCloseButtonMac: 'susura-mac-close-button left-3 size-[14px] cursor-default rounded-full border-[0.5px] border-[#FB1626] bg-[#FF5C60] p-0 text-[#802F31] shadow-none hover:bg-[#FF5C60] active:bg-[#D94D4F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5C60]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
  settingsInlineGroup: 'flex-row flex-wrap items-start',
  settingsDescription: 'text-sm text-muted-foreground',
  settingsPermissionActions: 'flex flex-wrap items-center gap-2',
  transcriptPrimaryActions: 'flex min-w-0 items-center gap-2',
  transcriptPrimaryActionsVertical: 'flex min-w-0 flex-col items-center gap-2',
  aiToolbarActions: 'flex w-auto min-w-0 items-center justify-center gap-2',
  aiToolbarActionsVertical: 'flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2',
  transcriptActions: 'ml-auto flex items-center gap-2',
  transcriptActionsVertical: 'flex flex-col items-center gap-2',
  listeningButton: 'w-[140px]',
  listeningButtonVertical: 'w-full',
  sideToolbarRow: 'flex w-full items-center justify-center',
  sideToolbarButton: 'size-9 min-h-9 min-w-9 rounded-md px-0',
  sideToolbarIconButton: 'size-9 min-h-9 min-w-9 rounded-md',
  sideToolbarButtonLabel: 'sr-only',
  compactToolbarButton: 'compact-toolbar-button',
  compactToolbarButtonLabel: 'compact-toolbar-button-label',
  permissionButton: 'h-auto min-h-9 max-w-full whitespace-normal break-words px-2.5 py-1.5 text-center text-xs leading-snug border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/60 focus-visible:ring-destructive/20 dark:border-destructive/40 dark:bg-destructive/20 dark:hover:bg-destructive/30',
  startButton: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30 dark:bg-emerald-600 dark:hover:bg-emerald-500',
  output: 'box-border h-full min-h-0 overflow-y-auto px-6 py-6 whitespace-pre-wrap text-sm leading-6',
  transcriptSessionOutput: 'transcript-session-output box-border h-full min-h-0 overflow-y-auto',
  transcriptList: 'min-h-full',
  transcriptSection: 'bg-card text-card-foreground',
  transcriptSectionHeader: 'transcript-section-header sticky top-0 z-30 flex min-h-12 items-center gap-2 border-y border-border bg-card px-3 py-1.5',
  transcriptSectionTitle: 'min-w-0 flex-1 truncate text-sm font-medium text-card-foreground',
  sectionTitleFull: 'section-title-full',
  sectionTitleCompact: 'section-title-compact',
  transcriptSectionBody: 'whitespace-pre-wrap px-3 py-3 text-sm leading-6',
  aiSectionBody: 'markdown-output px-3 py-3 text-sm leading-6',
  promptTemplateTrigger: 'w-[256px] max-w-[256px] justify-between',
  promptTemplateTriggerVertical: 'size-9 min-h-9 min-w-9 justify-center rounded-md px-0',
  compactPromptTemplateTrigger: 'compact-prompt-template-trigger',
  promptTemplateSearch: 'relative',
  promptTemplateSearchIcon: 'pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
  promptTemplateSearchInput: 'pl-8',
  promptTemplateList: 'max-h-64 overflow-y-auto',
  promptTemplateItem: 'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted aria-current:bg-muted aria-current:text-foreground',
  promptTemplateDialog: 'susura-titlebar-centred-dialog grid h-[85vh] w-[85vw] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[85vw]',
  promptTemplateHeader: 'flex h-12 items-center justify-center border-b border-border px-12',
  promptTemplateHeaderMac: '',
  promptTemplateEditor: 'grid min-h-0 flex-1 gap-0 md:grid-cols-[220px_minmax(0,1fr)]',
  promptTemplateSidebar: 'flex flex-col gap-2 border-b border-border p-4 md:border-b-0 md:border-r',
  promptTemplateEditorForm: 'grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 p-4',
  promptTemplateBody: 'grid min-h-0 gap-4 md:grid-cols-2',
  promptTemplateAttachmentPane: 'grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3',
  promptTemplateAttachmentList: 'min-h-0 overflow-y-auto rounded-md border border-border',
  promptTemplateAttachmentItem: 'flex min-h-12 items-center gap-2 border-b border-border px-3 py-2 last:border-b-0',
  promptTemplateAttachmentName: 'min-w-0 flex-1',
  promptTemplateAttachmentMeta: 'truncate text-xs text-muted-foreground',
  promptTemplateFooter: 'mx-0 mb-0',
  handleRoot: 'grid h-screen w-screen overflow-hidden place-items-center bg-transparent text-foreground',
  handleButton: 'susura-handle-button',
  handleButtonOpen: '',
  placeholder: 'box-border flex h-full min-h-0 items-center justify-center overflow-y-auto whitespace-pre-wrap px-6 py-6 text-center text-sm text-muted-foreground'
};

const transcriptPlaceholder = 'Your live transcript will appear here once you start listening.';
const legacyAiResponsePlaceholder = 'The AI response will appear here after you stop listening with transcript text.';
const shortAiResponsePlaceholder = 'Stop listening to send to AI.';
const aiResponsePlaceholder = 'Auto Send is on.\nStop listening to send to AI.';
const aiResponseDisabledPlaceholder = 'Auto Send is off.\nManually send a transcript.';
const defaultListenToMicrophone = false;
const defaultListenToSystemAudio = true;
const defaultSendToAiWhenListeningStops = true;
const defaultLlmModel: LlmModel = 'openai-codex/gpt-5.4-mini';
const defaultLlmReasoning: LlmReasoning = 'off';
const initialPermissionRequestKey = 'susura.initial-permission-requested';
const handleDragThresholdPx = 6;
const handleSnapVisualDurationMs = 280;
const privateOverlayHandleSizePx = 32;
const handleIconStyle = {
  '--susura-handle-icon-url': `url("${susuraMarkUrl}")`
} as React.CSSProperties;

type OverlayEdge = 'bottom' | 'left' | 'right' | 'top';
type TooltipSide = NonNullable<React.ComponentProps<typeof TooltipContent>['side']>;

const starterPromptTemplates: PromptTemplate[] = [
  createPromptTemplate({
    id: 'starter-summarise-phone-call',
    name: 'Summarise this phone call',
    prompt: 'Summarise this phone call clearly. Include the main points, decisions, open questions and follow-up actions.'
  }),
  createPromptTemplate({
    id: 'starter-extract-action-items',
    name: 'Extract action items',
    prompt: 'Extract action items from this transcript. Include owner, task and due date when available.'
  }),
  createPromptTemplate({
    id: 'starter-draft-follow-up-email',
    name: 'Draft follow-up email',
    prompt: 'Draft a concise follow-up email based on this transcript. Include decisions, action items and next steps.'
  })
];

const llmModels: Array<{ label: string; value: LlmModel }> = [
  { label: '5.4 mini (Default)', value: 'openai-codex/gpt-5.4-mini' },
  { label: '5.4', value: 'openai-codex/gpt-5.4' },
  { label: '5.5', value: 'openai-codex/gpt-5.5' },
  { label: '5.2', value: 'openai-codex/gpt-5.2' }
];

const llmReasoningLevels: Array<{ label: string; value: LlmReasoning }> = [
  { label: 'Off (Default)', value: 'off' },
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra high', value: 'xhigh' }
];

type AudioSource = {
  checked: boolean;
  disabled: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

type TranscriptDownloadFormat = 'txt' | 'docx';
type AiResponseSectionData = {
  id: string;
  isWaiting?: boolean;
  requestedAt: string | null;
  response: string;
};

const scrollFixtureQueryParam = 'susura-scroll-fixture';

const scrollFixtureTranscriptSessions: TranscriptSession[] = [
  createScrollFixtureTranscriptSession({
    id: 'scroll-fixture-transcript-1',
    startedAt: '2026-05-26T05:10:00.000Z',
    title: 'Transcript started: 26 May 2026, 3:10:00 pm',
    topic: 'Launch readiness review',
    speaker: 'Speaker'
  }),
  createScrollFixtureTranscriptSession({
    id: 'scroll-fixture-transcript-2',
    startedAt: '2026-05-26T05:42:00.000Z',
    title: 'Transcript started: 26 May 2026, 3:42:00 pm',
    topic: 'Support handover',
    speaker: 'Microphone'
  }),
  createScrollFixtureTranscriptSession({
    id: 'scroll-fixture-transcript-3',
    startedAt: '2026-05-26T06:18:00.000Z',
    title: 'Transcript started: 26 May 2026, 4:18:00 pm',
    topic: 'Incident follow-up',
    speaker: 'Speaker'
  })
];

const scrollFixtureAiResponses: AiResponseSectionData[] = [
  {
    id: 'scroll-fixture-ai-1',
    requestedAt: '2026-05-26T05:28:00.000Z',
    response: createScrollFixtureAiResponse('Launch readiness review', [
      'Call out the remaining release risks by owner.',
      'Summarise the decisions around rollout timing.',
      'List any follow-up work that should happen before the next checkpoint.'
    ])
  },
  {
    id: 'scroll-fixture-ai-2',
    requestedAt: '2026-05-26T05:58:00.000Z',
    response: createScrollFixtureAiResponse('Support handover', [
      'Confirm which escalation paths should be visible to support.',
      'Draft customer-safe wording for known issues.',
      'Extract unanswered questions that need engineering input.'
    ])
  },
  {
    id: 'scroll-fixture-ai-3',
    requestedAt: '2026-05-26T06:35:00.000Z',
    response: createScrollFixtureAiResponse('Incident follow-up', [
      'Separate facts from assumptions.',
      'Identify where the timeline has gaps.',
      'Suggest the next three actions for the incident owner.'
    ])
  }
];

export function App() {
  useSystemColourScheme();

  const surface = getSusuraSurface();
  const runtimeContext = useRuntimeContext();
  const isMac = runtimeContext?.isMac ?? isNavigatorMac();

  useEffect(() => {
    document.documentElement.dataset.susuraSurface = surface;

    return () => {
      delete document.documentElement.dataset.susuraSurface;
    };
  }, [surface]);

  if (surface === 'handle') {
    return <PrivateOverlayHandleSurface />;
  }

  const transcription = useLiveTranscription();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [listenToMicrophone, setListenToMicrophone] = useState(defaultListenToMicrophone);
  const [listenToSystemAudio, setListenToSystemAudio] = useState(defaultListenToSystemAudio);
  const [sendToAiWhenListeningStops, setSendToAiWhenListeningStops] = useState(defaultSendToAiWhenListeningStops);
  const [llmModel, setLlmModel] = useState<LlmModel>(defaultLlmModel);
  const [llmReasoning, setLlmReasoning] = useState<LlmReasoning>(defaultLlmReasoning);
  const [isLlmReady, setIsLlmReady] = useState(false);
  const [permissionsStatus, setPermissionsStatus] = useState<PermissionsStatus | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(starterPromptTemplates);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<string | null>(null);
  const [isPromptTemplateDialogOpen, setIsPromptTemplateDialogOpen] = useState(false);
  const privateOverlayStatus = usePrivateOverlayStatus();
  const overlayEdge = getPrivateOverlayHandleEdge(privateOverlayStatus);
  const outputRef = useRef<HTMLDivElement>(null);
  const llmOutputRef = useRef<HTMLDivElement>(null);

  const isListening = transcription.isListening;
  const isBusy = transcription.isStarting;
  const hasAudioSource = listenToMicrophone || listenToSystemAudio;
  const missingSelectedPermissions = getMissingSelectedPermissionItems({
    listenToMicrophone,
    listenToSystemAudio,
    permissionsStatus
  });
  const canStartListening = hasAudioSource && isLlmReady && missingSelectedPermissions.length === 0;
  const isTranscriptPlaceholder = transcription.output === transcriptPlaceholder;
  const isAiResponsePlaceholder = transcription.llmOutput === aiResponsePlaceholder
    || transcription.llmOutput === legacyAiResponsePlaceholder
    || transcription.llmOutput === shortAiResponsePlaceholder;
  const selectedPromptTemplate = promptTemplates.find((template) => template.id === selectedPromptTemplateId) ?? null;

  const audioSources = [
    {
      checked: listenToSystemAudio,
      disabled: isListening || isBusy,
      id: 'listen-to-system-audio',
      label: 'Speaker',
      onCheckedChange: setListenToSystemAudio
    },
    {
      checked: listenToMicrophone,
      disabled: isListening || isBusy,
      id: 'listen-to-microphone',
      label: 'Microphone',
      onCheckedChange: setListenToMicrophone
    }
  ];

  useEffect(() => {
    const output = outputRef.current;

    if (output) {
      output.scrollTop = output.scrollHeight;
    }
  }, [transcription.output]);

  useEffect(() => {
    const output = llmOutputRef.current;

    if (output) {
      output.scrollTop = output.scrollHeight;
    }
  }, [transcription.llmOutput]);

  useEffect(() => {
    if (isListening || !hasAudioSource) {
      return;
    }

    const sources = [
      listenToSystemAudio ? 'system' : null,
      listenToMicrophone ? 'microphone' : null
    ].filter((source): source is 'system' | 'microphone' => source !== null);

    void getTranscriptionBridge()?.prepare?.({ sources });
  }, [hasAudioSource, isListening, listenToMicrophone, listenToSystemAudio]);

  useEffect(() => {
    const bridge = getLlmBridge();

    if (!bridge) {
      setIsLlmReady(true);
      return;
    }

    let isMounted = true;

    void bridge.status()
      .then((status) => {
        if (isMounted) {
          setIsLlmReady(isLlmReadyOrSettled(status));
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsLlmReady(true);
        }
      });

    const unsubscribe = bridge.onStatus((status) => {
      setIsLlmReady(isLlmReadyOrSettled(status));
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void refreshPermissionsStatus();
  }, []);

  useEffect(() => {
    void loadPromptTemplates();
  }, []);

  useEffect(() => {
    if (!permissionsStatus || window.localStorage.getItem(initialPermissionRequestKey) === '1') {
      return;
    }

    const initialPermissions = permissionsStatus.permissions.filter((permission) => {
      return permission.status === 'not-determined';
    });

    if (initialPermissions.length === 0) {
      return;
    }

    window.localStorage.setItem(initialPermissionRequestKey, '1');

    void Promise.all(initialPermissions.map((permission) => requestPermission(permission.id)))
      .then(() => refreshPermissionsStatus());
  }, [permissionsStatus]);

  async function refreshPermissionsStatus() {
    const bridge = getPermissionsBridge();

    if (!bridge) {
      setPermissionsStatus({
        ok: false,
        permissions: [
          {
            description: 'Required when listening to your microphone.',
            id: 'microphone',
            label: 'Microphone',
            status: 'unknown'
          },
          {
            description: 'Required when listening to speaker audio output.',
            id: 'screen-recording',
            label: 'Screen & System Audio Recording',
            status: 'unknown'
          }
        ],
        platform: 'browser'
      });
      return;
    }

    setPermissionsStatus(await bridge.status());
  }

  async function requestPermission(permission: PermissionItem['id']) {
    const bridge = getPermissionsBridge();

    if (!bridge) {
      return;
    }

    await (bridge.request?.(permission) ?? bridge.open(permission));
    await refreshPermissionsStatus();
  }

  async function loadPromptTemplates() {
    const state = await getSettingsBridge()?.promptTemplates?.list();
    applyPromptTemplateState(state ?? {
      ok: true,
      selectedTemplateId: null,
      templates: starterPromptTemplates
    });
  }

  function applyPromptTemplateState(state: PromptTemplateState) {
    setPromptTemplates(state.templates.length > 0 ? state.templates : starterPromptTemplates);
    setSelectedPromptTemplateId(state.selectedTemplateId);
  }

  async function savePromptTemplate(template: PromptTemplate) {
    const bridge = getSettingsBridge()?.promptTemplates;

    if (!bridge) {
      const templates = promptTemplates.some((item) => item.id === template.id)
        ? promptTemplates.map((item) => (item.id === template.id ? template : item))
        : [...promptTemplates, template];
      setPromptTemplates(templates);
      return;
    }

    applyPromptTemplateState(await bridge.save(template));
  }

  async function deletePromptTemplate(id: string) {
    const bridge = getSettingsBridge()?.promptTemplates;

    if (!bridge) {
      setPromptTemplates((templates) => templates.filter((template) => template.id !== id));
      setSelectedPromptTemplateId((selectedId) => (selectedId === id ? null : selectedId));
      return;
    }

    applyPromptTemplateState(await bridge.delete(id));
  }

  async function choosePromptTemplateAttachments() {
    const bridge = getSettingsBridge()?.promptTemplates;

    if (!bridge?.chooseAttachments) {
      return [];
    }

    const response = await bridge.chooseAttachments();

    return response.ok ? response.attachments : [];
  }

  async function selectPromptTemplate(id: string | null) {
    const bridge = getSettingsBridge()?.promptTemplates;

    setSelectedPromptTemplateId(id);

    if (!bridge) {
      return;
    }

    const state = await bridge.setSelected(id);
    const templates = state.templates.length > 0 ? state.templates : starterPromptTemplates;
    const selectedTemplateId = id && (
      promptTemplates.some((template) => template.id === id)
      || templates.some((template) => template.id === id)
    )
      ? id
      : state.selectedTemplateId;

    setPromptTemplates(templates);
    setSelectedPromptTemplateId(selectedTemplateId);
  }

  async function copyTranscript() {
    if (!isTranscriptTextCopyable(transcription.output)) {
      return;
    }

    await navigator.clipboard?.writeText(transcription.output);
  }

  function downloadTranscript(format: TranscriptDownloadFormat) {
    if (!isTranscriptTextCopyable(transcription.output)) {
      return;
    }

    downloadTranscriptFile(transcription.output, format);
  }

  function askAiFromTranscript() {
    void transcription.ask({
      llmModel,
      llmReasoning,
      promptTemplateAttachments: selectedPromptTemplate?.attachments,
      promptTemplateText: selectedPromptTemplate?.prompt
    });
  }

  function askAiFromSpecificTranscript(transcript: string) {
    void transcription.ask({
      llmModel,
      llmReasoning,
      promptTemplateAttachments: selectedPromptTemplate?.attachments,
      promptTemplateText: selectedPromptTemplate?.prompt,
      transcript
    });
  }

  function toggleListening() {
    if (isListening) {
      void transcription.stop({
        llmModel,
        llmReasoning,
        promptTemplateAttachments: selectedPromptTemplate?.attachments,
        promptTemplateText: selectedPromptTemplate?.prompt,
        sendToLlm: sendToAiWhenListeningStops
      });
      return;
    }

    void transcription.start({
      listenToMicrophone,
      listenToSystemAudio
    });
  }

  async function resetSettings() {
    if (isListening || isBusy) {
      return;
    }

    window.localStorage.clear();
    setListenToMicrophone(defaultListenToMicrophone);
    setListenToSystemAudio(defaultListenToSystemAudio);
    setSendToAiWhenListeningStops(defaultSendToAiWhenListeningStops);
    setLlmModel(defaultLlmModel);
    setLlmReasoning(defaultLlmReasoning);
    setPromptTemplates(starterPromptTemplates);
    setSelectedPromptTemplateId(null);
    await getSettingsBridge()?.reset();
  }

  return (
    <main className={layout.main}>
      <TooltipProvider>
        <PrivateOverlayWindowTitleBar
          isMac={isMac}
          isSettingsOpen={isSettingsOpen}
          onToggleSettings={() => setIsSettingsOpen((isOpen) => !isOpen)}
        />
        <div
          className={layout.appBody}
          data-overlay-edge={overlayEdge}
        >
          <form className={layout.page} aria-label="Susura setup">
            <HomePage
              canStartListening={canStartListening}
              edge={overlayEdge}
              isAiResponsePlaceholder={isAiResponsePlaceholder}
              isBusy={isBusy}
              isListening={isListening}
              isLlmReady={isLlmReady}
              isTranscriptPlaceholder={isTranscriptPlaceholder}
              llmOutputRef={llmOutputRef}
              missingSelectedPermissions={missingSelectedPermissions}
              onAskAiFromTranscript={askAiFromTranscript}
              onAskAiFromSpecificTranscript={askAiFromSpecificTranscript}
              onCopyTranscript={copyTranscript}
              onDownloadTranscript={downloadTranscript}
              onOpenPromptTemplateSettings={() => setIsPromptTemplateDialogOpen(true)}
              onOpenPermissionSettings={() => setIsSettingsOpen(true)}
              onSelectPromptTemplate={(id) => void selectPromptTemplate(id)}
              outputRef={outputRef}
              promptTemplates={promptTemplates}
              sendToAiWhenListeningStops={sendToAiWhenListeningStops}
              selectedPromptTemplateId={selectedPromptTemplateId}
              setSendToAiWhenListeningStops={setSendToAiWhenListeningStops}
              toggleListening={toggleListening}
              transcription={transcription}
            />
            {isSettingsOpen ? (
              <SettingsPage
                audioSources={audioSources}
                isBusy={isBusy}
                isListening={isListening}
                llmModel={llmModel}
                llmReasoning={llmReasoning}
                isMac={isMac}
                onClose={() => setIsSettingsOpen(false)}
                onRequestPermission={requestPermission}
                permissionsStatus={permissionsStatus}
                resetSettings={resetSettings}
                setLlmModel={setLlmModel}
                setLlmReasoning={setLlmReasoning}
              />
            ) : null}
          </form>
        </div>
        <PromptTemplateDialog
          currentModel={llmModel}
          isMac={isMac}
          onChooseAttachments={() => choosePromptTemplateAttachments()}
          onDelete={(id) => void deletePromptTemplate(id)}
          onOpenChange={setIsPromptTemplateDialogOpen}
          onSave={(template) => void savePromptTemplate(template)}
          open={isPromptTemplateDialogOpen}
          templates={promptTemplates}
        />
      </TooltipProvider>
    </main>
  );
}

function isLlmReadyOrSettled(status: { ready: boolean; status: string }) {
  return status.ready || status.status === 'error' || status.status === 'disabled';
}

type SusuraSurface = 'app' | 'handle';

function getSusuraSurface(): SusuraSurface {
  const surface = new URLSearchParams(window.location.search).get('susura-surface');

  return surface === 'handle' ? surface : 'app';
}

function usePrivateOverlayStatus() {
  const [status, setStatus] = useState<PrivateOverlayState | null>(null);

  useEffect(() => {
    const bridge = getPrivateOverlayBridge();

    if (!bridge) {
      return;
    }

    let isMounted = true;

    void bridge.status()
      .then((state) => {
        if (isMounted) {
          setStatus(state);
        }
      })
      .catch(() => undefined);

    const unsubscribe = bridge.onState((state) => {
      setStatus(state);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return status;
}

function getPrivateOverlayHandleEdge(status: PrivateOverlayState | null): OverlayEdge {
  if (!status || (!status.overlay.visible && !status.overlayWindowVisible)) {
    return 'right';
  }

  const handleRight = status.handle.x + privateOverlayHandleSizePx;
  const handleBottom = status.handle.y + privateOverlayHandleSizePx;
  const overlayRight = status.overlay.x + status.overlay.width;
  const overlayBottom = status.overlay.y + status.overlay.height;
  const distances: Array<{ edge: OverlayEdge; value: number }> = [
    { edge: 'left', value: Math.abs(handleRight - status.overlay.x) },
    { edge: 'right', value: Math.abs(status.handle.x - overlayRight) },
    { edge: 'top', value: Math.abs(handleBottom - status.overlay.y) },
    { edge: 'bottom', value: Math.abs(status.handle.y - overlayBottom) }
  ];

  return distances.reduce((best, item) => (item.value < best.value ? item : best), distances[0]).edge;
}

function getHomeContentClassName(edge: OverlayEdge) {
  if (edge === 'top') {
    return layout.contentTopToolbar;
  }

  if (edge === 'right') {
    return layout.contentRightToolbar;
  }

  if (edge === 'bottom') {
    return layout.contentBottomToolbar;
  }

  return layout.contentLeftToolbar;
}

function getHomeToolbarClassName(edge: OverlayEdge) {
  const edgeClass = {
    bottom: layout.homeToolbarBottom,
    left: layout.homeToolbarLeft,
    right: layout.homeToolbarRight,
    top: layout.homeToolbarTop
  }[edge];

  return `${layout.homeToolbar} ${edgeClass}`;
}

function getHomePanelGridClassName(edge: OverlayEdge) {
  return edge === 'left' || edge === 'right'
    ? layout.panelGridStacked
    : layout.panelGrid;
}

function getButtonTooltipSideForEdge(edge: OverlayEdge): TooltipSide {
  const sideByEdge = {
    bottom: 'top',
    left: 'right',
    right: 'left',
    top: 'bottom'
  } as const satisfies Record<OverlayEdge, TooltipSide>;

  return sideByEdge[edge];
}

function isLeadingToolbarEdge(edge: OverlayEdge) {
  return edge === 'left' || edge === 'top';
}

function PrivateOverlayWindowTitleBar({
  isMac,
  isSettingsOpen,
  onToggleSettings
}: {
  isMac: boolean;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const dragStateRef = useRef<{
    didStartDrag: boolean;
    isDragging: boolean;
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
  } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      didStartDrag: false,
      isDragging: false,
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.screenX - dragState.startScreenX,
      event.screenY - dragState.startScreenY
    );

    if (!dragState.isDragging && distance < handleDragThresholdPx) {
      return;
    }

    const bridge = getPrivateOverlayBridge();

    if (!bridge) {
      return;
    }

    dragState.isDragging = true;

    if (!dragState.didStartDrag) {
      dragState.didStartDrag = true;
      void bridge.dragWindowStart({
        screenX: dragState.startScreenX,
        screenY: dragState.startScreenY
      });
    }

    void bridge.dragWindowMove({
      screenX: event.screenX,
      screenY: event.screenY
    });
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;

    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!dragState.isDragging) {
      return;
    }

    const bridge = getPrivateOverlayBridge();

    if (!bridge) {
      return;
    }

    void bridge.dragWindowEnd({
      screenX: event.screenX,
      screenY: event.screenY
    });
  }

  return (
    <header className={layout.windowTitleBar}>
      <div
        aria-label="Move Susura window"
        className={layout.windowTitleBarDragArea}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
      >
        <span className={layout.windowTitleBarTitle}>Susura</span>
      </div>
      {isMac ? (
        <button
          aria-label="Hide Susura app"
          className={layout.windowTitleBarMacCloseButton}
          data-platform="macos"
          onClick={() => void getPrivateOverlayBridge()?.hide()}
          title="Hide Susura app"
          type="button"
        />
      ) : (
        <Button
          aria-label="Hide Susura app"
          className={layout.windowTitleBarButton}
          data-platform="desktop"
          onClick={() => void getPrivateOverlayBridge()?.hide()}
          size="icon"
          title="Hide Susura app"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
      <button
        aria-label="Susura Settings"
        aria-pressed={isSettingsOpen}
        className={`${layout.windowTitleBarSettingsButton} ${isMac ? layout.windowTitleBarSettingsButtonMac : layout.windowTitleBarSettingsButtonDesktop} ${isSettingsOpen ? 'bg-muted text-foreground' : ''}`}
        onClick={onToggleSettings}
        title="Susura Settings"
        type="button"
      >
        <SettingsIcon className="mx-auto size-4" />
      </button>
    </header>
  );
}

function isNavigatorMac() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /\bMac/i.test(navigator.platform);
}

function PrivateOverlayHandleSurface() {
  const privateOverlayStatus = usePrivateOverlayStatus();
  const isOverlayOpen = Boolean(privateOverlayStatus?.overlay.visible || privateOverlayStatus?.overlayWindowVisible);
  const [handleMotion, setHandleMotion] = useState<'dragging' | 'idle' | 'snapping'>('idle');
  const dragStateRef = useRef<{
    didStartDrag: boolean;
    isDragging: boolean;
    pointerId: number;
    startScreenX: number;
    startScreenY: number;
  } | null>(null);
  const snapVisualTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (snapVisualTimerRef.current !== null) {
      window.clearTimeout(snapVisualTimerRef.current);
    }
  }, []);

  function clearSnapVisualTimer() {
    if (snapVisualTimerRef.current === null) {
      return;
    }

    window.clearTimeout(snapVisualTimerRef.current);
    snapVisualTimerRef.current = null;
  }

  function scheduleSnapVisualReset() {
    clearSnapVisualTimer();
    snapVisualTimerRef.current = window.setTimeout(() => {
      snapVisualTimerRef.current = null;
      setHandleMotion('idle');
    }, handleSnapVisualDurationMs);
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    clearSnapVisualTimer();
    setHandleMotion('idle');
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      didStartDrag: false,
      isDragging: false,
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.screenX - dragState.startScreenX,
      event.screenY - dragState.startScreenY
    );

    if (!dragState.isDragging && distance < handleDragThresholdPx) {
      return;
    }

    const bridge = getPrivateOverlayBridge();

    if (!bridge) {
      return;
    }

    dragState.isDragging = true;
    setHandleMotion('dragging');

    if (!dragState.didStartDrag) {
      dragState.didStartDrag = true;
      void bridge.dragHandleStart({
        screenX: dragState.startScreenX,
        screenY: dragState.startScreenY
      });
    }

    void bridge.dragHandleMove({
      screenX: event.screenX,
      screenY: event.screenY
    });
  }

  function handlePointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;

    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const bridge = getPrivateOverlayBridge();

    if (!bridge) {
      return;
    }

    if (dragState.isDragging) {
      setHandleMotion('snapping');
      scheduleSnapVisualReset();
      void bridge.dragHandleEnd({
        screenX: event.screenX,
        screenY: event.screenY
      });
      return;
    }

    setHandleMotion('idle');
    void bridge.toggle();
  }

  return (
    <main className={layout.handleRoot} aria-label="Susura overlay handle">
      <button
        aria-label="Toggle Susura app"
        className={`${layout.handleButton} ${isOverlayOpen ? layout.handleButtonOpen : ''}`.trim()}
        data-motion={handleMotion}
        data-open={isOverlayOpen ? 'true' : 'false'}
        onContextMenu={(event) => {
          event.preventDefault();
          void getPrivateOverlayBridge()?.showHandleMenu();
        }}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        title="Toggle Susura app"
        type="button"
      >
        <span aria-hidden="true" className="susura-handle-icon" style={handleIconStyle} />
      </button>
    </main>
  );
}

function HomePage({
  canStartListening,
  edge,
  isAiResponsePlaceholder,
  isBusy,
  isListening,
  isLlmReady,
  isTranscriptPlaceholder,
  llmOutputRef,
  missingSelectedPermissions,
  onAskAiFromTranscript,
  onAskAiFromSpecificTranscript,
  onCopyTranscript,
  onDownloadTranscript,
  onOpenPermissionSettings,
  onOpenPromptTemplateSettings,
  onSelectPromptTemplate,
  outputRef,
  promptTemplates,
  sendToAiWhenListeningStops,
  selectedPromptTemplateId,
  setSendToAiWhenListeningStops,
  toggleListening,
  transcription
}: {
  canStartListening: boolean;
  edge: OverlayEdge;
  isAiResponsePlaceholder: boolean;
  isBusy: boolean;
  isListening: boolean;
  isLlmReady: boolean;
  isTranscriptPlaceholder: boolean;
  llmOutputRef: RefObject<HTMLDivElement | null>;
  missingSelectedPermissions: PermissionItem[];
  onAskAiFromTranscript: () => void;
  onAskAiFromSpecificTranscript: (transcript: string) => void;
  onCopyTranscript: () => void;
  onDownloadTranscript: (format: TranscriptDownloadFormat) => void;
  onOpenPermissionSettings: () => void;
  onOpenPromptTemplateSettings: () => void;
  onSelectPromptTemplate: (id: string | null) => void;
  outputRef: RefObject<HTMLDivElement | null>;
  promptTemplates: PromptTemplate[];
  sendToAiWhenListeningStops: boolean;
  selectedPromptTemplateId: string | null;
  setSendToAiWhenListeningStops: (sendToAi: boolean) => void;
  toggleListening: () => void;
  transcription: ReturnType<typeof useLiveTranscription>;
}) {
  const showScrollFixture = isScrollFixtureEnabled();
  const visibleTranscriptSessions = showScrollFixture
    ? scrollFixtureTranscriptSessions
    : transcription.sessions;
  const visibleAiResponses = showScrollFixture
    ? scrollFixtureAiResponses
    : getVisibleAiResponses({
      isAsking: transcription.isAsking,
      llmOutput: transcription.llmOutput,
      llmRequestedAt: transcription.llmRequestedAt
    });
  const isTranscriptPanelPlaceholder = !showScrollFixture && isTranscriptPlaceholder;
  const isAiResponsePanelPlaceholder = !showScrollFixture && isAiResponsePlaceholder;
  const isBlockedByPermissions = missingSelectedPermissions.length > 0;
  const hasTranscript = isTranscriptTextCopyable(transcription.output);
  const startButtonLabel = isListening
    ? 'Stop Listening'
    : isBusy
      ? 'Starting...'
      : isLlmReady
        ? 'Start Listening'
        : 'Preparing...';
  const autoSendLabel = 'Auto Send';
  const autoSendTooltip = sendToAiWhenListeningStops
    ? 'Sends to AI when listening stops'
    : 'Manual send only';
  const hasTranscriptSessions = visibleTranscriptSessions.length > 0;

  return (
    <div className={layout.form}>
      <div
        aria-label="Home layout"
        className={getHomeContentClassName(edge)}
        data-home-toolbar-edge={edge}
      >
        {isLeadingToolbarEdge(edge) ? (
          <HomeActionToolbar
            autoSendLabel={autoSendLabel}
            autoSendTooltip={autoSendTooltip}
            canStartListening={canStartListening}
            edge={edge}
            hasTranscript={hasTranscript}
            isBlockedByPermissions={isBlockedByPermissions}
            isBusy={isBusy}
            isListening={isListening}
            missingSelectedPermissions={missingSelectedPermissions}
            onAskAiFromTranscript={onAskAiFromTranscript}
            onCopyTranscript={onCopyTranscript}
            onDownloadTranscript={onDownloadTranscript}
            onOpenPermissionSettings={onOpenPermissionSettings}
            onOpenPromptTemplateSettings={onOpenPromptTemplateSettings}
            onSelectPromptTemplate={onSelectPromptTemplate}
            promptTemplates={promptTemplates}
            sendToAiWhenListeningStops={sendToAiWhenListeningStops}
            selectedPromptTemplateId={selectedPromptTemplateId}
            setSendToAiWhenListeningStops={setSendToAiWhenListeningStops}
            startButtonLabel={startButtonLabel}
            toggleListening={toggleListening}
            transcriptionIsAsking={transcription.isAsking}
          />
        ) : null}

        <div
          aria-label="Transcript and AI panels"
          className={getHomePanelGridClassName(edge)}
          data-testid="home-panels"
          data-panel-flow={edge === 'left' || edge === 'right' ? 'stacked' : 'side-by-side'}
        >
        <section className={layout.panelPlain} aria-label="Listening">
          <div
            ref={outputRef}
            id="transcript-output"
            aria-label="Transcription output"
            className={`${layout.panelScroller} ${
              isTranscriptPanelPlaceholder
                ? layout.placeholder
                : hasTranscriptSessions
                  ? layout.transcriptSessionOutput
                  : layout.output
            }`}
          >
            {isTranscriptPanelPlaceholder ? (
              transcriptPlaceholder
            ) : !hasTranscriptSessions ? (
              transcription.output
            ) : (
              <TranscriptSessionList
                isAsking={transcription.isAsking}
                onAskAi={onAskAiFromSpecificTranscript}
                sessions={visibleTranscriptSessions}
              />
            )}
          </div>
        </section>

        <section className={layout.panelPlain} aria-label="AI response panel">
          <div
            ref={llmOutputRef}
            id="llm-output"
            aria-label="AI response"
            className={`${layout.panelScroller} ${isAiResponsePanelPlaceholder ? layout.placeholder : layout.transcriptSessionOutput}`}
          >
            {isAiResponsePanelPlaceholder ? (
              sendToAiWhenListeningStops ? aiResponsePlaceholder : aiResponseDisabledPlaceholder
            ) : visibleAiResponses.length > 0 ? (
              <AiResponseSectionList responses={visibleAiResponses} />
            ) : null}
          </div>
        </section>
        </div>

        {!isLeadingToolbarEdge(edge) ? (
          <HomeActionToolbar
            autoSendLabel={autoSendLabel}
            autoSendTooltip={autoSendTooltip}
            canStartListening={canStartListening}
            edge={edge}
            hasTranscript={hasTranscript}
            isBlockedByPermissions={isBlockedByPermissions}
            isBusy={isBusy}
            isListening={isListening}
            missingSelectedPermissions={missingSelectedPermissions}
            onAskAiFromTranscript={onAskAiFromTranscript}
            onCopyTranscript={onCopyTranscript}
            onDownloadTranscript={onDownloadTranscript}
            onOpenPermissionSettings={onOpenPermissionSettings}
            onOpenPromptTemplateSettings={onOpenPromptTemplateSettings}
            onSelectPromptTemplate={onSelectPromptTemplate}
            promptTemplates={promptTemplates}
            sendToAiWhenListeningStops={sendToAiWhenListeningStops}
            selectedPromptTemplateId={selectedPromptTemplateId}
            setSendToAiWhenListeningStops={setSendToAiWhenListeningStops}
            startButtonLabel={startButtonLabel}
            toggleListening={toggleListening}
            transcriptionIsAsking={transcription.isAsking}
          />
        ) : null}
      </div>
    </div>
  );
}

function HomeActionToolbar({
  autoSendLabel,
  autoSendTooltip,
  canStartListening,
  edge,
  hasTranscript,
  isBlockedByPermissions,
  isBusy,
  isListening,
  missingSelectedPermissions,
  onAskAiFromTranscript,
  onCopyTranscript,
  onDownloadTranscript,
  onOpenPermissionSettings,
  onOpenPromptTemplateSettings,
  onSelectPromptTemplate,
  promptTemplates,
  sendToAiWhenListeningStops,
  selectedPromptTemplateId,
  setSendToAiWhenListeningStops,
  startButtonLabel,
  toggleListening,
  transcriptionIsAsking
}: {
  autoSendLabel: string;
  autoSendTooltip: string;
  canStartListening: boolean;
  edge: OverlayEdge;
  hasTranscript: boolean;
  isBlockedByPermissions: boolean;
  isBusy: boolean;
  isListening: boolean;
  missingSelectedPermissions: PermissionItem[];
  onAskAiFromTranscript: () => void;
  onCopyTranscript: () => void;
  onDownloadTranscript: (format: TranscriptDownloadFormat) => void;
  onOpenPermissionSettings: () => void;
  onOpenPromptTemplateSettings: () => void;
  onSelectPromptTemplate: (id: string | null) => void;
  promptTemplates: PromptTemplate[];
  sendToAiWhenListeningStops: boolean;
  selectedPromptTemplateId: string | null;
  setSendToAiWhenListeningStops: (sendToAi: boolean) => void;
  startButtonLabel: string;
  toggleListening: () => void;
  transcriptionIsAsking: boolean;
}) {
  const isVertical = edge === 'left' || edge === 'right';
  const tooltipSide = getButtonTooltipSideForEdge(edge);
  const primaryControls = (
    <div className={isVertical ? layout.transcriptPrimaryActionsVertical : layout.transcriptPrimaryActions}>
      {!isBlockedByPermissions ? (
        <div className={isVertical ? layout.sideToolbarRow : undefined}>
          <TooltipButton
            aria-label={startButtonLabel}
            className={`${isVertical ? layout.sideToolbarButton : layout.listeningButton} ${isListening ? '' : layout.startButton} ${layout.compactToolbarButton}`.trim()}
            disabled={isBusy || !canStartListening}
            onClick={toggleListening}
            size="lg"
            tooltip={isListening ? 'Stop listening and finish the transcript' : 'Start listening to the selected audio sources'}
            tooltipSide={tooltipSide}
            type="button"
            variant={isListening ? 'destructive' : 'default'}
          >
            {isListening ? (
              <>
                <SquareIcon />
                <span className={isVertical ? layout.sideToolbarButtonLabel : layout.compactToolbarButtonLabel}>{startButtonLabel}</span>
              </>
            ) : (
              <>
                <PlayIcon />
                <span className={isVertical ? layout.sideToolbarButtonLabel : layout.compactToolbarButtonLabel}>{startButtonLabel}</span>
              </>
            )}
          </TooltipButton>
        </div>
      ) : null}
      {missingSelectedPermissions.length > 0 ? (
        <div className={isVertical ? layout.sideToolbarRow : undefined}>
          <TooltipButton
            aria-label="Open Settings for permissions required"
            className={`${layout.permissionButton} ${isVertical ? layout.sideToolbarButton : ''}`.trim()}
            onClick={onOpenPermissionSettings}
            tooltip="Open Settings to review required permissions"
            tooltipSide={tooltipSide}
            type="button"
            variant="destructive"
          >
            {isVertical ? '!' : 'Permissions required'}
          </TooltipButton>
        </div>
      ) : null}
      <div className={isVertical ? layout.sideToolbarRow : undefined}>
        <TooltipButton
          aria-label={autoSendLabel}
          aria-pressed={sendToAiWhenListeningStops}
          className={`${isVertical ? layout.sideToolbarButton : ''} ${layout.compactToolbarButton}`.trim()}
          onClick={() => setSendToAiWhenListeningStops(!sendToAiWhenListeningStops)}
          size="lg"
          tooltip={autoSendTooltip}
          tooltipSide={tooltipSide}
          type="button"
          variant="outline"
        >
          <CheckboxDisplay
            aria-hidden="true"
            checked={sendToAiWhenListeningStops}
          />
          <span className={isVertical ? layout.sideToolbarButtonLabel : layout.compactToolbarButtonLabel}>{autoSendLabel}</span>
        </TooltipButton>
      </div>
    </div>
  );
  const transcriptControls = (
    <div className={isVertical ? layout.transcriptActionsVertical : layout.transcriptActions}>
      <div className={isVertical ? layout.sideToolbarRow : undefined}>
        <TooltipButton
          aria-label="Copy full transcript"
          className={isVertical ? layout.sideToolbarIconButton : undefined}
          disabled={!hasTranscript}
          onClick={onCopyTranscript}
          size="icon-lg"
          tooltip="Copy full transcript to clipboard"
          tooltipSide={tooltipSide}
          type="button"
          variant="outline"
        >
          <CopyIcon />
        </TooltipButton>
      </div>
      <div className={isVertical ? layout.sideToolbarRow : undefined}>
        <DownloadTranscriptPopover
          disabled={!hasTranscript}
          label="Download full transcript"
          onDownload={onDownloadTranscript}
          actionTooltipSide={tooltipSide}
          tooltipSide={tooltipSide}
          triggerClassName={isVertical ? layout.sideToolbarIconButton : undefined}
        />
      </div>
      <div className={isVertical ? layout.sideToolbarRow : undefined}>
        <TooltipButton
          aria-label="Send full transcript to AI"
          className={isVertical ? layout.sideToolbarIconButton : undefined}
          disabled={!hasTranscript || transcriptionIsAsking}
          onClick={onAskAiFromTranscript}
          size="icon-lg"
          tooltip="Send full transcript to AI now"
          tooltipSide={tooltipSide}
          type="button"
          variant="outline"
        >
          <SendIcon />
        </TooltipButton>
      </div>
    </div>
  );
  const aiControls = (
    <div className={isVertical ? layout.aiToolbarActionsVertical : layout.aiToolbarActions}>
      <PromptTemplateSelector
        isCompact={isVertical}
        onOpenSettings={onOpenPromptTemplateSettings}
        onSelect={onSelectPromptTemplate}
        selectedTemplateId={selectedPromptTemplateId}
        templates={promptTemplates}
        tooltipSide={tooltipSide}
      />
    </div>
  );

  if (isVertical) {
    return (
      <div className={getHomeToolbarClassName(edge)} aria-label="Home actions">
        <div className={`${layout.homeToolbarVerticalSection} ${layout.homeToolbarVerticalSectionTop}`} data-toolbar-section="transcript">
          {primaryControls}
          {transcriptControls}
        </div>
        <div className={`${layout.homeToolbarVerticalSection} ${layout.homeToolbarVerticalSectionBottom}`} data-toolbar-section="ai">
          {aiControls}
        </div>
      </div>
    );
  }

  return (
    <div className={getHomeToolbarClassName(edge)} aria-label="Home actions">
      <div className={layout.homeToolbarHorizontalSection} data-toolbar-section="transcript">
        {primaryControls}
        {transcriptControls}
      </div>
      <div className={`${layout.homeToolbarHorizontalSection} ${layout.homeToolbarHorizontalSectionAi}`} data-toolbar-section="ai">
        {aiControls}
      </div>
    </div>
  );
}

function AiResponseSectionList({
  responses
}: {
  responses: AiResponseSectionData[];
}) {
  return (
    <div className={layout.transcriptList}>
      {responses.map((response) => (
        <AiResponseSection
          key={response.id}
          isWaiting={response.isWaiting}
          requestedAt={response.requestedAt}
          response={response.response}
        />
      ))}
    </div>
  );
}

function AiResponseSection({
  isWaiting = false,
  requestedAt,
  response = ''
}: {
  isWaiting?: boolean;
  requestedAt: string | null;
  response?: string;
}) {
  const hasResponse = response.trim().length > 0;

  return (
    <article className={layout.transcriptSection}>
      <div className={layout.transcriptSectionHeader}>
        <div className={layout.transcriptSectionTitle}>
          <ResponsiveSectionTitle
            compactTitle={getAiResponseSectionCompactTitle(requestedAt)}
            title={getAiResponseSectionTitle(requestedAt)}
          />
        </div>
        <div className={layout.transcriptActions}>
          <TooltipButton
            aria-label="Copy this AI response"
            disabled={!hasResponse}
            onClick={() => void navigator.clipboard?.writeText(response)}
            size="icon"
            tooltip="Copy this AI response to clipboard"
            tooltipSide="bottom"
            type="button"
            variant="outline"
          >
            <CopyIcon />
          </TooltipButton>
          <DownloadTranscriptPopover
            disabled={!hasResponse}
            label="Download this AI response"
            onDownload={(format) => downloadTranscriptFile(response, format)}
            textTooltip="Download this AI response as a plain text file"
            tooltipSide="bottom"
            triggerSize="icon"
            wordTooltip="Download this AI response as a Word document"
          />
        </div>
      </div>
      <div className={layout.aiSectionBody}>
        {isWaiting ? (
          <LoaderCircleIcon
            aria-label="Waiting for response"
            className="size-4 animate-spin text-muted-foreground"
          />
        ) : (
          <ReactMarkdown>{response}</ReactMarkdown>
        )}
      </div>
    </article>
  );
}

function getAiResponseSectionTitle(requestedAt: string | null) {
  return requestedAt ? formatUserDateTime(new Date(requestedAt)) : 'AI response';
}

function getAiResponseSectionCompactTitle(requestedAt: string | null) {
  return requestedAt ? formatCompactUserDateTime(new Date(requestedAt)) : null;
}

function getVisibleAiResponses({
  isAsking,
  llmOutput,
  llmRequestedAt
}: {
  isAsking: boolean;
  llmOutput: string;
  llmRequestedAt: string | null;
}): AiResponseSectionData[] {
  if (isAsking && !llmOutput) {
    return [{
      id: 'live-ai-response-waiting',
      isWaiting: true,
      requestedAt: llmRequestedAt,
      response: ''
    }];
  }

  if (llmOutput) {
    return [{
      id: 'live-ai-response',
      requestedAt: llmRequestedAt,
      response: llmOutput
    }];
  }

  return [];
}

function isScrollFixtureEnabled() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has(scrollFixtureQueryParam);
}

function createScrollFixtureTranscriptSession({
  id,
  speaker,
  startedAt,
  title,
  topic
}: {
  id: string;
  speaker: string;
  startedAt: string;
  title: string;
  topic: string;
}): TranscriptSession {
  const lines = Array.from({ length: 34 }, (_, index) => {
    const minute = String(index % 60).padStart(2, '0');
    const marker = index % 2 === 0 ? speaker : 'Other speaker';

    return `[3:${minute} pm] [${marker}] ${topic} fixture line ${index + 1}. This deliberately runs long so the section body scrolls under the sticky titlebar while the panel stays visually stable.`;
  });

  return {
    id,
    output: [title, ...lines].join('\n'),
    startedAt
  };
}

function createScrollFixtureAiResponse(topic: string, actions: string[]) {
  const sections = Array.from({ length: 10 }, (_, index) => {
    const action = actions[index % actions.length];

    return `### ${topic} section ${index + 1}

The key point for this fixture is to make the response long enough to scroll inside the AI panel. This paragraph repeats realistic assistant output so the titlebar behaviour is visible while content moves underneath it.

- ${action}
- Keep privacy boundaries explicit when describing call context.
- Note which items are decisions, open questions or follow-up work.

The final sentence in this section gives the browser enough vertical content to test section boundaries and sticky positioning together.`;
  });

  return `## ${topic}\n\n${sections.join('\n\n')}`;
}

function formatUserDateTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(date);
}

function formatCompactUserDateTime(date: Date) {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0')
  ].join('/') + ' ' + [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join(':');
}

function AudioSourceCheckbox({
  checked,
  disabled,
  id,
  label,
  onCheckedChange
}: {
  checked: boolean;
  disabled: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field className="!w-auto" orientation="horizontal">
      <Checkbox
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
    </Field>
  );
}

function TranscriptSessionList({
  isAsking,
  onAskAi,
  sessions
}: {
  isAsking: boolean;
  onAskAi: (transcript: string) => void;
  sessions: TranscriptSession[];
}) {
  return (
    <div className={layout.transcriptList}>
      {sessions.map((session) => (
        <article key={session.id} className={layout.transcriptSection}>
          <div className={layout.transcriptSectionHeader}>
            <div className={layout.transcriptSectionTitle}>
              <ResponsiveSectionTitle
                compactTitle={getTranscriptSectionCompactTitle(session.output)}
                title={getTranscriptSectionTitle(session.output)}
              />
            </div>
            <div className={layout.transcriptActions}>
              <TooltipButton
                aria-label="Copy this transcript"
                onClick={() => void navigator.clipboard?.writeText(session.output)}
                size="icon"
                tooltip="Copy this transcript to clipboard"
                tooltipSide="bottom"
                type="button"
                variant="outline"
              >
                <CopyIcon />
              </TooltipButton>
              <DownloadTranscriptPopover
                disabled={false}
                label="Download this transcript"
                onDownload={(format) => downloadTranscriptFile(session.output, format)}
                tooltipSide="bottom"
                triggerSize="icon"
              />
              <TooltipButton
                aria-label="Send this transcript to AI"
                disabled={isAsking}
                onClick={() => onAskAi(session.output)}
                size="icon"
                tooltip="Send this transcript to AI now"
                tooltipSide="bottom"
                type="button"
                variant="outline"
              >
                <SendIcon />
              </TooltipButton>
            </div>
          </div>
          <div className={layout.transcriptSectionBody}>
            {getTranscriptSectionBody(session.output)}
          </div>
        </article>
      ))}
    </div>
  );
}

function getTranscriptSectionTitle(transcript: string) {
  const title = transcript.split('\n', 1)[0] || 'Transcript';
  const prefix = 'Transcript started: ';

  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

function getTranscriptSectionCompactTitle(transcript: string) {
  const startedAt = parseTranscriptStartedAt(transcript);

  return startedAt ? formatCompactUserDateTime(startedAt) : null;
}

function ResponsiveSectionTitle({
  compactTitle,
  title
}: {
  compactTitle: string | null;
  title: string;
}) {
  if (!compactTitle || compactTitle === title) {
    return title;
  }

  return (
    <>
      <span className={layout.sectionTitleFull}>{title}</span>
      <span aria-hidden="true" className={layout.sectionTitleCompact}>{compactTitle}</span>
    </>
  );
}

function getTranscriptSectionBody(transcript: string) {
  const lines = transcript.split('\n');

  if (/^Transcript started:/.test(lines[0] ?? '')) {
    return lines.slice(1).join('\n').trimStart();
  }

  return transcript;
}

function PromptTemplateSelector({
  isCompact = false,
  onOpenSettings,
  onSelect,
  selectedTemplateId,
  templates,
  tooltipSide
}: {
  isCompact?: boolean;
  onOpenSettings: () => void;
  onSelect: (id: string | null) => void;
  selectedTemplateId: string | null;
  templates: PromptTemplate[];
  tooltipSide?: TooltipSide;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [isTooltipSuppressed, setIsTooltipSuppressed] = useState(false);
  const [search, setSearch] = useState('');
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedTemplateName = selectedTemplate?.name ?? 'No template';
  const filteredTemplates = templates.filter((template) => (
    template.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  ));

  function suppressTooltip() {
    setIsTooltipOpen(false);
    setIsTooltipSuppressed(true);
  }

  function selectTemplate(id: string | null) {
    onSelect(id);
    setSearch('');
    suppressTooltip();
    setIsOpen(false);
  }

  return (
    <>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          suppressTooltip();
        }}
      >
        <Tooltip
          open={isTooltipOpen && !isOpen && !isTooltipSuppressed}
          onOpenChange={(open) => setIsTooltipOpen(open && !isOpen && !isTooltipSuppressed)}
        >
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                aria-label="Prompt template"
                className={isCompact ? layout.promptTemplateTriggerVertical : `${layout.promptTemplateTrigger} ${layout.compactPromptTemplateTrigger}`}
                onPointerEnter={() => {
                  setIsTooltipSuppressed(false);

                  if (!isOpen) {
                    setIsTooltipOpen(true);
                  }
                }}
                onPointerMove={() => {
                  setIsTooltipSuppressed(false);

                  if (!isOpen) {
                    setIsTooltipOpen(true);
                  }
                }}
                onPointerLeave={() => {
                  setIsTooltipOpen(false);
                  setIsTooltipSuppressed(false);
                }}
                size={isCompact ? 'icon-lg' : 'lg'}
                type="button"
                variant="outline"
              >
                <FileTextIcon />
                <span className={`${isCompact ? layout.sideToolbarButtonLabel : 'min-w-0 flex-1 truncate text-left'} ${layout.compactToolbarButtonLabel}`}>
                  {selectedTemplateName}
                </span>
                {!isCompact ? <ChevronDownIcon /> : null}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 whitespace-normal break-words leading-4" collisionPadding={8} side={tooltipSide}>
            Prompt template: {selectedTemplateName}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-80">
          <div className={layout.promptTemplateSearch}>
            <SearchIcon className={layout.promptTemplateSearchIcon} />
            <Input
              aria-label="Search prompt templates"
              className={layout.promptTemplateSearchInput}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search prompt templates"
              value={search}
            />
          </div>
          <div className={layout.promptTemplateList}>
            <button
              aria-current={selectedTemplateId === null ? 'true' : undefined}
              className={layout.promptTemplateItem}
              onClick={() => selectTemplate(null)}
              onPointerDown={(event) => {
                event.preventDefault();
                selectTemplate(null);
              }}
              type="button"
            >
              <span>No template</span>
            </button>
            {filteredTemplates.map((template) => (
              <button
                key={template.id}
                aria-current={selectedTemplateId === template.id ? 'true' : undefined}
                className={layout.promptTemplateItem}
                onClick={() => selectTemplate(template.id)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  selectTemplate(template.id);
                }}
                type="button"
              >
                <span className="truncate">{template.name}</span>
              </button>
            ))}
            {filteredTemplates.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">No templates found.</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <TooltipButton
        aria-label="Manage prompt templates"
        className={isCompact ? layout.sideToolbarIconButton : undefined}
        onClick={onOpenSettings}
        size="icon-lg"
        tooltip="Manage prompt templates"
        tooltipSide={tooltipSide}
        type="button"
        variant="outline"
      >
        <PencilIcon />
      </TooltipButton>
    </>
  );
}

function PromptTemplateDialog({
  currentModel,
  isMac,
  onChooseAttachments,
  onDelete,
  onOpenChange,
  onSave,
  open,
  templates
}: {
  currentModel: LlmModel;
  isMac: boolean;
  onChooseAttachments: () => Promise<PromptTemplateAttachment[]>;
  onDelete: (id: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: (template: PromptTemplate) => void;
  open: boolean;
  templates: PromptTemplate[];
}) {
  const [activeId, setActiveId] = useState<string | null>(templates[0]?.id ?? null);
  const activeTemplate = templates.find((template) => template.id === activeId) ?? templates[0] ?? null;
  const [draft, setDraft] = useState<PromptTemplate>(() => activeTemplate ?? createPromptTemplate({ name: '', prompt: '' }));
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const isDeleteConfirming = Boolean(activeId && deleteConfirmationId === activeId);
  const canSave = draft.name.trim().length > 0 && draft.prompt.trim().length > 0;
  const draftAttachments = draft.attachments ?? [];
  const supportedAttachments = draftAttachments.filter((attachment) => attachment.support === 'supported');
  const modelAttachmentSupport = getLlmModelAttachmentSupport(currentModel);

  useEffect(() => {
    if (!open) {
      setDeleteConfirmationId(null);
      return;
    }

    if (activeId && !templates.some((template) => template.id === activeId)) {
      return;
    }

    const nextTemplate = templates.find((template) => template.id === activeId) ?? templates[0] ?? createPromptTemplate({ name: '', prompt: '' });
    setActiveId(nextTemplate.id);
    setDraft(nextTemplate);
    setDeleteConfirmationId((id) => (id && templates.some((template) => template.id === id) ? id : null));
  }, [activeId, draft.id, open, templates]);

  function createNewTemplate() {
    const template = createPromptTemplate({ name: '', prompt: '' });
    setActiveId(template.id);
    setDraft(template);
    setDeleteConfirmationId(null);
  }

  function saveDraft() {
    if (!canSave) {
      return;
    }

    onSave({
      ...draft,
      attachments: draftAttachments,
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      updatedAt: new Date().toISOString()
    });
  }

  async function addAttachments() {
    const attachments = await onChooseAttachments();

    if (attachments.length === 0) {
      return;
    }

    setDraft((template) => ({
      ...template,
      attachments: mergePromptTemplateAttachments(template.attachments ?? [], attachments)
    }));
  }

  function removeAttachment(id: string) {
    setDraft((template) => ({
      ...template,
      attachments: (template.attachments ?? []).filter((attachment) => attachment.id !== id)
    }));
  }

  function deleteActiveTemplate() {
    if (!activeId) {
      return;
    }

    if (deleteConfirmationId !== activeId) {
      setDeleteConfirmationId(activeId);
      return;
    }

    onDelete(activeId);
    const nextTemplate = templates.find((template) => template.id !== activeId) ?? null;
    setActiveId(nextTemplate?.id ?? null);
    setDeleteConfirmationId(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={layout.promptTemplateDialog} showCloseButton={false}>
        <PlatformDialogCloseButton isMac={isMac} label="Close prompt templates" />
        <DialogHeader className={`${layout.promptTemplateHeader} ${isMac ? layout.promptTemplateHeaderMac : ''}`}>
          <DialogTitle className={layout.modalHeaderTitle}>Prompt templates</DialogTitle>
          <DialogDescription className="sr-only">
            Save reusable instructions that are prepended to transcript requests.
          </DialogDescription>
        </DialogHeader>
        <div className={layout.promptTemplateEditor}>
          <div className={layout.promptTemplateSidebar}>
            <Button onClick={createNewTemplate} type="button" variant="outline">
              New template
            </Button>
            <div className={layout.promptTemplateList}>
              {templates.map((template) => (
                <button
                  key={template.id}
                  aria-current={activeId === template.id ? 'true' : undefined}
                  className={layout.promptTemplateItem}
                  onClick={() => {
                    setActiveId(template.id);
                    setDraft(template);
                    setDeleteConfirmationId(null);
                  }}
                  type="button"
                >
                  <span className="truncate">{template.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={layout.promptTemplateEditorForm}>
            <Field>
              <FieldLabel htmlFor="prompt-template-name">Name</FieldLabel>
              <Input
                id="prompt-template-name"
                onChange={(event) => setDraft((template) => ({ ...template, name: event.target.value }))}
                placeholder="Summarise this phone call"
                value={draft.name}
              />
            </Field>
            <div className={layout.promptTemplateBody}>
              <Field className="min-h-0">
                <FieldLabel htmlFor="prompt-template-prompt">Prompt</FieldLabel>
                <Textarea
                  className="min-h-0 flex-1 resize-none"
                  id="prompt-template-prompt"
                  onChange={(event) => setDraft((template) => ({ ...template, prompt: event.target.value }))}
                  placeholder="Summarise this transcript..."
                  value={draft.prompt}
                />
              </Field>
              <div className={layout.promptTemplateAttachmentPane}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <FieldLabel>Attachments</FieldLabel>
                    <p className={layout.settingsDescription}>
                      {modelAttachmentSupport.description}
                    </p>
                  </div>
                  <Button onClick={() => void addAttachments()} type="button" variant="outline">
                    <PaperclipIcon />
                    Add files
                  </Button>
                </div>
                <div className={layout.promptTemplateAttachmentList} aria-label="Prompt template attachments">
                  {draftAttachments.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No attachments.</p>
                  ) : (
                    draftAttachments.map((attachment) => (
                      <div key={attachment.id} className={layout.promptTemplateAttachmentItem}>
                        {attachment.kind === 'image' ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileIcon className="size-4 text-muted-foreground" />}
                        <div className={layout.promptTemplateAttachmentName}>
                          <div className="truncate text-sm">{attachment.name}</div>
                          <div className={layout.promptTemplateAttachmentMeta}>
                            {formatAttachmentMetadata(attachment)}
                          </div>
                        </div>
                        <TooltipButton
                          aria-label={`Remove ${attachment.name}`}
                          onClick={() => removeAttachment(attachment.id)}
                          size="icon-sm"
                          tooltip={`Remove ${attachment.name}`}
                          type="button"
                          variant="ghost"
                        >
                          <XIcon />
                        </TooltipButton>
                      </div>
                    ))
                  )}
                </div>
                {supportedAttachments.length > 0 && (
                  <p className={layout.settingsDescription}>
                    Supported attachments are sent with this prompt template when you ask AI.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className={layout.promptTemplateFooter}>
          {isDeleteConfirming && (
            <Button onClick={() => setDeleteConfirmationId(null)} type="button" variant="outline">
              Cancel
            </Button>
          )}
          <Button disabled={!activeId} onClick={deleteActiveTemplate} type="button" variant="destructive">
            {isDeleteConfirming ? 'Confirm delete' : 'Delete'}
          </Button>
          <Button disabled={!canSave} onClick={saveDraft} type="button">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlatformDialogCloseButton({
  isMac,
  label,
  onClick
}: {
  isMac: boolean;
  label: string;
  onClick?: () => void;
}) {
  const closeButton = isMac ? (
    <button
      aria-label={label}
      className={`${layout.modalCloseButton} ${layout.modalCloseButtonMac}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="sr-only">{label}</span>
    </button>
  ) : (
    <Button
      aria-label={label}
      className={`${layout.modalCloseButton} ${layout.modalCloseButtonDesktop}`}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      <XIcon />
      <span className="sr-only">{label}</span>
    </Button>
  );

  return onClick ? closeButton : (
    <DialogClose asChild>
      {closeButton}
    </DialogClose>
  );
}

function mergePromptTemplateAttachments(
  existing: PromptTemplateAttachment[],
  incoming: PromptTemplateAttachment[]
) {
  const byPath = new Map(existing.map((attachment) => [attachment.path, attachment]));

  for (const attachment of incoming) {
    byPath.set(attachment.path, attachment);
  }

  return [...byPath.values()];
}

function getLlmModelAttachmentSupport(_model: LlmModel) {
  return {
    description: 'Current model accepts local file attachments.',
    supportedKinds: ['file', 'image', 'text']
  };
}

function formatAttachmentMetadata(attachment: PromptTemplateAttachment) {
  const support = attachment.support === 'supported' ? 'Supported' : 'Unsupported';
  const type = attachment.kind[0].toLocaleUpperCase() + attachment.kind.slice(1);

  return `${support} ${type} · ${formatBytes(attachment.sizeBytes)}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function DownloadTranscriptPopover({
  actionTooltipSide,
  disabled,
  label = 'Download transcript',
  onDownload,
  textTooltip = 'Download full transcript as a plain text file',
  triggerClassName,
  tooltipSide,
  triggerSize = 'icon-lg',
  wordTooltip = 'Download full transcript as a Word document'
}: {
  actionTooltipSide?: TooltipSide;
  disabled: boolean;
  label?: string;
  onDownload: (format: TranscriptDownloadFormat) => void;
  textTooltip?: string;
  triggerClassName?: string;
  tooltipSide?: TooltipSide;
  triggerSize?: React.ComponentProps<typeof Button>['size'];
  wordTooltip?: string;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={label}
              className={triggerClassName}
              disabled={disabled}
              size={triggerSize}
              type="button"
              variant="outline"
            >
              <DownloadIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-48">
        <TooltipButton
          className="justify-start"
          onClick={() => onDownload('txt')}
          tooltipSide={actionTooltipSide ?? 'right'}
          tooltip={textTooltip}
          type="button"
          variant="ghost"
        >
          <FileTextIcon />
          Text file
        </TooltipButton>
        <TooltipButton
          className="justify-start"
          onClick={() => onDownload('docx')}
          tooltipSide={actionTooltipSide ?? 'right'}
          tooltip={wordTooltip}
          type="button"
          variant="ghost"
        >
          <FileTextIcon />
          Word document
        </TooltipButton>
      </PopoverContent>
    </Popover>
  );
}

function TooltipButton({
  tooltip,
  tooltipSide,
  ...props
}: React.ComponentProps<typeof Button> & {
  tooltip: React.ReactNode;
  tooltipSide?: TooltipSide;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} />
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function downloadTranscriptFile(transcript: string, format: TranscriptDownloadFormat) {
  const isWord = format === 'docx';
  const blob = new Blob(
    [isWord ? createDocxTranscriptDocument(transcript) : transcript],
    { type: isWord ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain;charset=utf-8' }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `susura-transcript-${getTranscriptDownloadTimestamp(transcript)}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createDocxTranscriptDocument(transcript: string) {
  const files = new Map<string, string>([
    ['[Content_Types].xml', [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '</Types>'
    ].join('')],
    ['_rels/.rels', [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>'
    ].join('')],
    ['word/document.xml', getDocxDocumentXml(transcript)]
  ]);

  return createZip(files);
}

function getDocxDocumentXml(transcript: string) {
  const paragraphs = transcript
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>`,
    '</w:document>'
  ].join('');
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createZip(files: Map<string, string>) {
  const encoder = new TextEncoder();
  const fileRecords: Array<{ crc: number; data: Uint8Array; name: Uint8Array; offset: number }> = [];
  const parts: Uint8Array[] = [];
  let offset = 0;

  for (const [path, content] of files) {
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    const crc = getCrc32(data);
    const header = createZipLocalFileHeader(name, data, crc);

    fileRecords.push({ crc, data, name, offset });
    parts.push(header, data);
    offset += header.byteLength + data.byteLength;
  }

  const centralDirectoryOffset = offset;

  for (const record of fileRecords) {
    const header = createZipCentralDirectoryHeader(record);
    parts.push(header);
    offset += header.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  parts.push(createZipEndOfCentralDirectory(fileRecords.length, centralDirectorySize, centralDirectoryOffset));

  return new Blob([concatUint8Arrays(parts).buffer]);
}

function createZipLocalFileHeader(name: Uint8Array, data: Uint8Array, crc: number) {
  const header = new Uint8Array(30 + name.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, name.byteLength, true);
  header.set(name, 30);

  return header;
}

function createZipCentralDirectoryHeader(record: { crc: number; data: Uint8Array; name: Uint8Array; offset: number }) {
  const header = new Uint8Array(46 + record.name.byteLength);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint32(16, record.crc, true);
  view.setUint32(20, record.data.byteLength, true);
  view.setUint32(24, record.data.byteLength, true);
  view.setUint16(28, record.name.byteLength, true);
  view.setUint32(42, record.offset, true);
  header.set(record.name, 46);

  return header;
}

function createZipEndOfCentralDirectory(fileCount: number, directorySize: number, directoryOffset: number) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, directoryOffset, true);

  return header;
}

function getCrc32(data: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(parts: Uint8Array[]) {
  const totalLength = parts.reduce((length, part) => length + part.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }

  return combined;
}

function createPromptTemplate({
  attachments = [],
  id = `prompt-template-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  name,
  prompt
}: {
  attachments?: PromptTemplateAttachment[];
  id?: string;
  name: string;
  prompt: string;
}): PromptTemplate {
  const now = new Date().toISOString();

  return {
    attachments,
    createdAt: now,
    id,
    name,
    prompt,
    updatedAt: now
  };
}

function getTranscriptDownloadTimestamp(transcript: string) {
  const headerDate = parseTranscriptStartedAt(transcript);
  const date = headerDate ?? new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('');
}

function parseTranscriptStartedAt(transcript: string) {
  const firstLine = transcript.split('\n', 1)[0] ?? '';
  const prefix = 'Transcript started: ';

  if (!firstLine.startsWith(prefix)) {
    return null;
  }

  const date = new Date(firstLine.slice(prefix.length));

  return Number.isNaN(date.getTime()) ? null : date;
}

function SettingsPage({
  audioSources,
  isMac,
  isBusy,
  isListening,
  llmModel,
  llmReasoning,
  onClose,
  onRequestPermission,
  permissionsStatus,
  resetSettings,
  setLlmModel,
  setLlmReasoning
}: {
  audioSources: AudioSource[];
  isMac: boolean;
  isBusy: boolean;
  isListening: boolean;
  llmModel: LlmModel;
  llmReasoning: LlmReasoning;
  onClose: () => void;
  onRequestPermission: (permission: PermissionItem['id']) => void;
  permissionsStatus: PermissionsStatus | null;
  resetSettings: () => void;
  setLlmModel: (model: LlmModel) => void;
  setLlmReasoning: (reasoning: LlmReasoning) => void;
}) {
  const missingAudioPermissions = getMissingSelectedAudioPermissionItems(audioSources, permissionsStatus);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);

  function confirmResetSettings() {
    resetSettings();
    setIsResetDialogOpen(false);
  }

  return (
    <>
      <button
        aria-label="Close settings backdrop"
        className={layout.settingsBackdrop}
        onClick={onClose}
        type="button"
      />
      <section
        aria-describedby="settings-dialog-description"
        aria-labelledby="settings-dialog-title"
        aria-modal="false"
        className={layout.settingsDialog}
        role="dialog"
      >
        <PlatformDialogCloseButton isMac={isMac} label="Close settings" onClick={onClose} />
        <div className={`${layout.settingsHeader} ${isMac ? layout.settingsHeaderMac : ''}`}>
          <h2 id="settings-dialog-title" className={layout.modalHeaderTitle}>Settings</h2>
          <p id="settings-dialog-description" className="sr-only">
            Configure Susura listening, model and reset settings.
          </p>
        </div>
        <div className={layout.settingsContent}>
        <FieldGroup>
          <FieldSet>
            <FieldLegend>Listen to your:</FieldLegend>
            <FieldGroup className={layout.settingsInlineGroup} data-slot="checkbox-group">
              {audioSources.map((source) => (
                <AudioSourceCheckbox key={source.id} {...source} />
              ))}
            </FieldGroup>
            {missingAudioPermissions.length > 0 && (
              <div className={layout.settingsPermissionActions}>
                {missingAudioPermissions.map((permission) => (
                  <TooltipButton
                    key={permission.id}
                    aria-label={`Permissions required: ${permission.label}`}
                    className={layout.permissionButton}
                    onClick={() => onRequestPermission(permission.id)}
                    tooltip={`Permissions required: ${permission.label}`}
                    type="button"
                    variant="destructive"
                  >
                    {getPermissionActionLabel(permission)}
                  </TooltipButton>
                ))}
              </div>
            )}
          </FieldSet>

          <FieldSet>
            <FieldLegend>AI settings</FieldLegend>
            <FieldGroup className={layout.settingsInlineGroup}>
              <Field className="w-auto">
                <FieldLabel htmlFor="llm-model">Model</FieldLabel>
                <Select
                  disabled={isListening || isBusy}
                  name="llm-model"
                  value={llmModel}
                  onValueChange={(value) => setLlmModel(value as LlmModel)}
                >
                  <div>
                    <SelectTrigger id="llm-model">
                      <SelectValue />
                    </SelectTrigger>
                  </div>
                  <SelectContent>
                    <SelectGroup>
                      {llmModels.map((model) => (
                        <SelectItem key={model.value} value={model.value}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field className="w-auto">
                <FieldLabel htmlFor="llm-reasoning">Reasoning</FieldLabel>
                <Select
                  disabled={isListening || isBusy}
                  name="llm-reasoning"
                  value={llmReasoning}
                  onValueChange={(value) => setLlmReasoning(value as LlmReasoning)}
                >
                  <div>
                    <SelectTrigger id="llm-reasoning">
                      <SelectValue />
                    </SelectTrigger>
                  </div>
                  <SelectContent>
                    <SelectGroup>
                      {llmReasoningLevels.map((reasoning) => (
                        <SelectItem key={reasoning.value} value={reasoning.value}>
                          {reasoning.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Reset Susura</FieldLegend>
            <FieldGroup>
              <div className="flex max-w-2xl flex-col items-start gap-2">
                <p className={layout.settingsDescription}>
                  Restore the default window size, location, model, listening sources and the original three prompt templates. This deletes saved prompt templates.
                </p>
                <TooltipButton
                  disabled={isListening || isBusy}
                  onClick={() => setIsResetDialogOpen(true)}
                  size="default"
                  tooltip="Reset Settings"
                  type="button"
                  variant="outline"
                >
                  Reset Settings
                </TooltipButton>
              </div>
            </FieldGroup>
          </FieldSet>
        </FieldGroup>
      </div>
      <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset settings?</DialogTitle>
            <DialogDescription>
              This will restore the default window size, location, model, listening sources and starter prompt templates. Saved prompt templates will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={confirmResetSettings} type="button" variant="destructive">
              Reset Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </section>
    </>
  );
}

function getMissingSelectedAudioPermissionItems(
  audioSources: AudioSource[],
  permissionsStatus: PermissionsStatus | null
) {
  if (permissionsStatus?.platform !== 'darwin') {
    return [];
  }

  const permissionsById = new Map(
    (permissionsStatus?.permissions ?? []).map((permission) => [permission.id, permission])
  );

  return audioSources
    .filter((source) => source.checked)
    .map((source) => {
      if (source.id === 'listen-to-system-audio') {
        return permissionsById.get('screen-recording');
      }

      if (source.id === 'listen-to-microphone') {
        return permissionsById.get('microphone');
      }

      return undefined;
    })
    .filter((permission): permission is PermissionItem => {
      return permission !== undefined && permission.status !== 'granted';
    });
}

function getPermissionActionLabel(permission: PermissionItem) {
  if (permission.id === 'screen-recording') {
    return 'Click here to grant permission for Speaker: Screen & System Audio Recording';
  }

  if (permission.id === 'microphone') {
    return 'Click here to grant permission for Microphone: Microphone access';
  }

  return `Click here to grant permission for ${permission.label}`;
}

function getMissingSelectedPermissionItems({
  listenToMicrophone,
  listenToSystemAudio,
  permissionsStatus
}: {
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
  permissionsStatus: PermissionsStatus | null;
}) {
  return getMissingSelectedAudioPermissionItems(
    [
      {
        checked: listenToSystemAudio,
        disabled: false,
        id: 'listen-to-system-audio',
        label: 'Speaker',
        onCheckedChange: () => undefined
      },
      {
        checked: listenToMicrophone,
        disabled: false,
        id: 'listen-to-microphone',
        label: 'Microphone',
        onCheckedChange: () => undefined
      }
    ],
    permissionsStatus
  );
}

function isTranscriptTextCopyable(output: string) {
  return output.trim().length > 0
    && output !== transcriptPlaceholder
    && output !== 'Listening. Waiting for speech...'
    && output !== 'Speech detected...'
    && !output.startsWith('Live transcription is unavailable')
    && !output.startsWith('Select at least one audio source');
}

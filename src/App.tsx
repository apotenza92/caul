import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle
} from '@/components/ui/field';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import {
  ToggleGroup,
  ToggleGroupItem
} from '@/components/ui/toggle-group';
import { ArrowUpIcon, BellIcon, CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, CircleAlertIcon, CopyIcon, DownloadIcon, FastForwardIcon, FileIcon, FileInputIcon, FileTextIcon, FolderOpenIcon, HistoryIcon, ImageIcon, InfoIcon, ListChecksIcon, LogOutIcon, MicIcon, MicOffIcon, PaperclipIcon, PencilIcon, PlayIcon, PowerIcon, RotateCcwIcon, SearchIcon, SendIcon, SettingsIcon, ShieldCheckIcon, SquareIcon, StarIcon, Trash2Icon, Volume2Icon, VolumeXIcon, XCircleIcon, XIcon } from 'lucide-react';
import caulAppIconUrl from '../assets/icons/icon-rounded.png?url';
import caulBetaAppIconUrl from '../assets/icons/beta/icon-rounded.png?url';
import caulIconUrl from '../assets/caul-icon.svg?url';
import { cn } from '@/lib/utils';
import {
  getLlmBridge,
  getPermissionsBridge,
  getPrivateOverlayBridge,
  getSettingsBridge,
  getTranscriptionBridge,
  type AiRecommendation,
  type AiProvider,
  type CloudApiKeyProviderId,
  type HistoryStatus,
  type LocalLlmStatus,
  type LocalTranscriptionModelId,
  type LlmModel,
  type LlmReasoning,
  type ModelCatalogueRefreshResult,
  type ModelCatalogueRefreshStatus,
  type OnboardingStatus,
  type ParakeetStatus,
  type PermissionItem,
  type PermissionsStatus,
  type PiStatus,
  type PortablePreferences,
  type PrivateOverlayHandleSize,
  type PrivateOverlayState,
  type PromptTemplate,
  type PromptTemplateAttachment,
  type PromptTemplateState,
  type UpdateFrequency,
  type UpdateStatus
} from './foundation/desktopBridge';
import { useLiveTranscription, type AiResponseSession, type TranscriptSession } from './hooks/useLiveTranscription';
import { useRuntimeContext } from './hooks/useRuntimeContext';
import { useSystemColourScheme } from './hooks/useSystemColourScheme';
import { MacosWindowButton } from '@/components/domain-ui/macos-window-button';
import { OverlayHandleButton } from '@/components/domain-ui/overlay-handle-button';
import { OverlayResizeHandles } from '@/components/domain-ui/overlay-resize-handles';
import { AppTooltipContent as TooltipContent } from '@/components/domain-ui/app-tooltip-content';
import { VerticalToggleGroup } from '@/components/domain-ui/vertical-toggle-group';
import { SafeMarkdown } from '@/components/safe-markdown';
import cloudLlmConfig from '../electron/llmConfig.json';

const layout = {
  overlayWindowOuter: 'relative h-screen w-screen bg-transparent p-2 text-foreground',
  main: 'relative grid h-full grid-rows-[32px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/70 bg-background',
  appBody: 'relative min-h-0 overflow-hidden',
  windowTitleBar: 'relative z-[60] flex h-8 select-none items-center justify-center border-b border-border/70 bg-background/95 text-muted-foreground',
  windowTitleBarDragArea: 'absolute inset-0 flex min-w-0 cursor-default items-center justify-center px-12 active:cursor-default',
  windowTitleBarTitle: 'truncate text-sm font-medium text-foreground',
  windowTitleBarButton: 'absolute right-1 top-1/2 z-10 size-7 -translate-y-1/2',
  windowTitleBarQuitButton: 'absolute right-9 top-1/2 z-10 size-7 -translate-y-1/2',
  windowTitleBarSettingsButton: 'absolute top-1/2 z-[70] size-7 -translate-y-1/2 p-0',
  windowTitleBarSettingsButtonMac: 'right-1.5',
  windowTitleBarSettingsButtonDesktop: 'left-1.5',
  windowTitleBarHistoryButtonMac: 'right-9',
  windowTitleBarHistoryButtonDesktop: 'left-9',
  windowTitleBarNotificationButtonMac: 'right-[4.125rem]',
  windowTitleBarNotificationButtonDesktop: 'left-[4.125rem]',
  page: 'h-full min-h-0 overflow-hidden',
  form: 'h-full w-full',
  contentTopToolbar: 'grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]',
  contentBottomToolbar: 'grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]',
  panelGrid: 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border',
  panelTitleBars: 'z-20 grid h-8 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border border-b border-border/70 bg-background/95 text-muted-foreground',
  panelTitleBar: 'flex min-w-0 select-none items-center justify-center px-3',
  panelTitleBarTitle: 'truncate text-sm font-medium text-foreground',
  panelPlain: 'panel-background h-full min-h-0 overflow-hidden',
  panelWithBottomActions: 'panel-background grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden',
  aiPanelWithManualPrompt: 'panel-background grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_auto] overflow-hidden',
  aiManualPromptBar: 'z-10 flex min-h-12 items-end gap-2 border-t border-border bg-background px-3 py-1.5',
  aiManualPromptInput: 'max-h-[50%] min-h-9 flex-1 overflow-hidden py-2',
  homeToolbar: 'z-10 overflow-hidden bg-background',
  homeToolbarTop: 'grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center divide-x divide-border border-b border-border',
  homeToolbarBottom: 'grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center divide-x divide-border border-t border-border',
  homeToolbarHorizontalSection: 'caul-home-toolbar-section flex min-w-0 items-center gap-2 px-3 py-1.5',
  homeToolbarHorizontalSectionAi: 'justify-center',
  homeToolbarBottomActions: 'z-10 grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center divide-x divide-border border-t border-border bg-background',
  homeToolbarBottomActionSection: 'flex min-w-0 items-center justify-center gap-2 px-3 py-1.5',
  homeToolbarBottomActionGroup: 'flex min-w-0 items-center gap-2',
  expandedToolbarButtonLabel: 'compact-toolbar-button-label min-w-0 truncate',
  panelBottomActions: 'z-10 flex h-12 items-center justify-center gap-2 border-t border-border bg-background px-3 py-1.5',
  homeToolbarVerticalSection: 'flex min-h-0 flex-col items-center justify-between gap-2 overflow-hidden px-1.5 py-3',
  homeToolbarVerticalSectionTop: '',
  homeToolbarVerticalSectionBottom: '',
  panelScroller: 'panel-background relative -mt-px box-border h-full min-h-0 overflow-y-auto [overflow-anchor:none]',
  settingsContent: 'grid min-h-0 grid-cols-[9rem_minmax(0,1fr)] overflow-hidden',
  settingsSidebar: 'flex min-h-0 flex-col border-r border-border p-4',
  settingsPanel: 'min-h-0 overflow-y-auto p-4',
  modalCloseButton: 'absolute z-20',
  modalCloseButtonDesktop: 'right-3 top-2 size-8',
  settingsInlineGroup: 'flex-row flex-wrap items-start gap-3',
  settingsPageStack: 'gap-6',
  settingsSection: 'gap-2',
  settingsSectionBody: 'gap-3',
  settingsDescription: 'w-full max-w-xl text-sm leading-5 text-muted-foreground',
  transcriptPrimaryActions: 'flex min-w-0 flex-1 items-center justify-between gap-2',
  transcriptSourceActions: 'flex min-w-0 flex-1 items-center justify-center gap-2',
  transcriptPrimaryActionsVertical: 'flex min-h-0 min-w-0 flex-1 flex-col items-center justify-between gap-2',
  listeningSourceIndicators: 'flex shrink-0 items-center justify-center gap-2',
  listeningSourceIndicatorsVertical: 'flex shrink-0 flex-col items-center gap-1',
  aiToolbarActions: 'flex w-full min-w-0 flex-1 items-center justify-start',
  aiResponseActions: 'ml-auto flex items-center gap-2',
  aiToolbarActionsVertical: 'flex min-h-0 min-w-0 flex-1 flex-col items-center justify-between gap-2',
  transcriptActions: 'ml-auto flex items-center gap-2',
  sectionCollapseButton: 'size-8 shrink-0',
  sectionPreviewTooltip: 'pointer-events-auto max-h-[min(28rem,70vh)] w-[clamp(18rem,25vw,36rem)] max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden p-4 pr-3',
  listeningButton: 'w-[140px]',
  sideToolbarRow: 'flex w-full items-center justify-center',
  sideToolbarButton: 'size-9 min-h-9 min-w-9 px-0',
  sideToolbarIconButton: 'size-9 min-h-9 min-w-9',
  sideToolbarButtonLabel: 'sr-only',
  compactToolbarButton: 'compact-toolbar-button',
  compactToolbarButtonLabel: 'compact-toolbar-button-label',
  output: 'box-border h-full min-h-0 overflow-y-auto px-6 py-6 whitespace-pre-wrap text-sm leading-6',
  transcriptSessionOutput: 'transcript-session-output box-border h-full min-h-0 overflow-y-auto',
  historyVirtualSpacer: 'pointer-events-none h-[var(--caul-history-virtual-height,100%)]',
  transcriptList: 'absolute inset-x-0 top-0',
  transcriptSection: '-mt-px bg-card text-card-foreground first:mt-0',
  transcriptSectionActive: '',
  transcriptSectionHeader: 'transcript-section-header flex min-h-12 items-center gap-2 border-y border-border bg-card px-3 py-1.5',
  transcriptSectionHeaderActive: 'sticky top-0 z-30',
  transcriptSectionTitle: 'min-w-0 flex-1 truncate text-sm font-medium text-card-foreground',
  sectionTitleFull: 'section-title-full',
  sectionTitleCompact: 'section-title-compact',
  transcriptSectionBody: 'whitespace-pre-wrap px-3 py-3 text-sm leading-6',
  aiSectionBody: 'markdown-output px-3 py-3 text-sm leading-6',
  promptTemplateTrigger: 'prompt-template-trigger min-w-0 w-full justify-between',
  promptTemplateSelectorRoot: 'prompt-template-selector-root flex min-w-0 flex-[0_1_50%] items-center gap-2',
  promptTemplateSelectorPicker: 'prompt-template-selector-picker flex min-w-0 flex-1 items-center',
  promptTemplateSelectorEdit: '',
  promptTemplateSelectorRootVertical: 'flex min-h-0 min-w-0 flex-col items-center gap-2',
  promptTemplateSelectorPickerVertical: 'flex flex-col items-center gap-2',
  promptTemplateSelectorEditVertical: '',
  promptTemplateTriggerVertical: 'size-9 min-h-9 min-w-9 justify-center px-0',
  promptTemplateCompactIcon: 'prompt-template-trigger-icon',
  pickerList: 'flex flex-col',
  pickerListScrollable: 'max-h-64 overflow-y-auto',
  pickerItemLabel: 'min-w-0 flex-1 truncate',
  pickerRow: 'group/picker-row relative min-w-0',
  generalInstructionsEditor: 'grid min-h-0 p-4',
  promptTemplateEditor: 'grid min-h-0 flex-1 gap-0 md:grid-cols-[220px_minmax(0,1fr)]',
  promptTemplateSidebar: 'flex flex-col gap-3 border-b border-border p-4 md:border-b-0 md:border-r',
  promptTemplateEditorForm: 'grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 p-4',
  promptTemplateBody: 'grid min-h-0 gap-4 md:grid-cols-2',
  promptTemplateAttachmentPane: 'grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3',
  promptTemplateAttachmentList: 'min-h-0 overflow-y-auto rounded-md border border-border',
  promptTemplateAttachmentItem: 'flex min-h-12 items-center gap-2 border-b border-border px-3 py-2 last:border-b-0',
  promptTemplateAttachmentName: 'min-w-0 flex-1',
  promptTemplateAttachmentMeta: 'truncate text-xs text-muted-foreground',
  handleRoot: 'grid h-screen w-screen overflow-hidden place-items-center bg-transparent text-foreground',
  placeholder: 'box-border flex h-full min-h-0 items-center justify-center overflow-y-auto whitespace-pre-wrap px-6 py-6 text-center text-sm text-muted-foreground',
  startHereHint: 'caul-start-here-nudge caul-primary-glow-nudge pointer-events-none absolute left-2 top-4 z-20 flex w-[74%] max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-primary/35 bg-background/95 px-3 py-2 text-left shadow-lg ring-1 ring-primary/10 backdrop-blur',
  startHereArrow: 'size-5 shrink-0 text-[#34424A] dark:text-[#8EA6AD]',
  startHereDescription: 'min-w-0 max-w-full text-sm leading-5 text-foreground',
  aiPromptTemplateHint: 'caul-prompt-template-nudge caul-primary-glow-nudge pointer-events-none absolute left-2 top-4 z-20 flex w-[74%] max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-primary/35 bg-background/95 px-3 py-2 text-left shadow-lg ring-1 ring-primary/10 backdrop-blur',
  aiPromptTemplateHintIcon: 'size-5 shrink-0 text-[#34424A] dark:text-[#8EA6AD]',
  aiPromptTemplateHintDescription: 'min-w-0 max-w-full text-sm leading-5 text-foreground'
};

const transcriptPlaceholder = 'Your live transcript will appear here once you start listening.';
const legacyAiResponsePlaceholder = 'The AI response will appear here after you stop listening with transcript text.';
const shortAiResponsePlaceholder = 'Stop listening to send transcript to AI';
const aiResponsePlaceholder = 'Auto Send is on.\nStop listening to send transcript to AI';
const aiResponseDisabledPlaceholder = 'Auto Send is off.\nManually send a transcript.';
const defaultListenToMicrophone = false;
const defaultListenToSystemAudio = true;
const defaultSendToAiWhenListeningStops = true;
const defaultAutoCollapse = true;
const defaultLlmModel: LlmModel = cloudLlmConfig.defaultModel;
const defaultLlmReasoning: LlmReasoning = cloudLlmConfig.defaultReasoning as LlmReasoning;
const defaultLocalLlmReasoning: LlmReasoning = cloudLlmConfig.defaultLocalReasoning as LlmReasoning;
const autoCollapsePreferenceKey = 'caul.auto-collapse';
const autoCollapseAiResponsesPreferenceKey = 'caul.auto-collapse.ai-responses';
const autoCollapseTranscriptionPreferenceKey = 'caul.auto-collapse.transcription';
const generalInstructionsPreferenceKey = 'caul.general-instructions';
const defaultGeneralInstructions = '';
const generalInstructionsPlaceholder = 'e.g. Always answer in British English.';
const recommendedLocalAiPillMessage = 'Based on this computer’s power, Caul recommends Local because you should still get acceptable private AI results on this machine.';
const recommendedCloudAiPillMessage = 'Based on this computer’s power, Caul recommends Cloud because local AI probably will not give acceptable results on this machine.';
const recommendedPillLabel = 'Recommended';
type CloudSignInResult = { ok: boolean; message?: string };
type CloudSignInHandler = () => Promise<CloudSignInResult>;
type CloudSubscriptionProviderId = 'openai-codex' | 'anthropic' | 'github-copilot' | 'google' | 'xai';
const cloudSubscriptionProviders: Array<{
  available: boolean;
  description: string;
  id: CloudSubscriptionProviderId;
  name: string;
  product: string;
}> = [
  {
    available: true,
    description: 'Use the ChatGPT subscription already linked to your OpenAI account.',
    id: 'openai-codex',
    name: 'OpenAI',
    product: 'ChatGPT'
  },
  {
    available: false,
    description: 'Connect a Claude subscription through Anthropic.',
    id: 'anthropic',
    name: 'Anthropic',
    product: 'Claude'
  },
  {
    available: false,
    description: 'Connect models included with GitHub Copilot.',
    id: 'github-copilot',
    name: 'GitHub',
    product: 'Copilot'
  },
  {
    available: false,
    description: 'Connect a Gemini subscription through Google.',
    id: 'google',
    name: 'Google',
    product: 'Gemini'
  },
  {
    available: false,
    description: 'Connect a Grok subscription through xAI.',
    id: 'xai',
    name: 'xAI',
    product: 'Grok'
  }
];
const cloudApiKeyProviders: Array<{
  id: CloudApiKeyProviderId;
  name: string;
  product: string;
}> = [
  { id: 'openai', name: 'OpenAI', product: 'GPT' },
  { id: 'anthropic', name: 'Anthropic', product: 'Claude' },
  { id: 'google', name: 'Google', product: 'Gemini' },
  { id: 'xai', name: 'xAI', product: 'Grok' }
];

function getChatGptSignInError(result: CloudSignInResult) {
  if (result.ok) {
    return '';
  }

  return result.message?.toLowerCase().includes('cancel')
    ? 'ChatGPT sign in was cancelled.'
    : 'Couldn’t sign in with ChatGPT. Try again.';
}

async function requestChatGptSignIn(refreshStatus: () => Promise<void>): Promise<CloudSignInResult> {
  const signIn = getSettingsBridge()?.ai?.openChatGptLogin;

  if (!signIn) {
    return { ok: false, message: 'ChatGPT sign in is unavailable.' };
  }

  try {
    const result = await signIn();
    await refreshStatus();

    return result;
  } catch {
    return { ok: false, message: 'ChatGPT sign in failed.' };
  }
}
const handleDragThresholdPx = 6;
const handlePressVisualDurationMs = 520;
const handleSnapVisualDurationMs = 280;
const overlayOpenTooltipSuppressionMs = 700;
const privateOverlayHandleSizePixels: Record<PrivateOverlayHandleSize, number> = {
  small: 32,
  medium: 48,
  large: 64
};
const privateOverlayHandleSizeOptions: Array<{ label: string; value: PrivateOverlayHandleSize }> = [
  { label: 'Small (32 px)', value: 'small' },
  { label: 'Medium (48 px)', value: 'medium' },
  { label: 'Large (64 px)', value: 'large' }
];

const dialogFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function useManagedDialogFocus(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const siblingInertStates = new Map<HTMLElement, boolean>();
    let activeBranch = dialogRef.current;

    while (activeBranch?.parentElement && activeBranch.parentElement !== document.body) {
      const branchParent: HTMLElement = activeBranch.parentElement;

      for (const sibling of Array.from(branchParent.children)) {
        if (
          sibling instanceof HTMLElement
          && sibling !== activeBranch
          && !sibling.hasAttribute('data-dialog-backdrop')
          && !sibling.hasAttribute('data-dialog-interaction-preserved')
        ) {
          siblingInertStates.set(sibling, sibling.hasAttribute('inert'));
          sibling.setAttribute('inert', '');
        }
      }

      activeBranch = branchParent;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(dialogFocusableSelector);
      (firstFocusable ?? dialogRef.current)?.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const eventTarget = event.target instanceof Element ? event.target : null;
      const isInPortalledControl = Boolean(eventTarget?.closest('[data-base-ui-portal]'));

      if (event.key === 'Escape') {
        if (event.defaultPrevented || isInPortalledControl) {
          return;
        }

        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || isInPortalledControl) {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector))
        .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0);

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);

      for (const [sibling, wasInert] of siblingInertStates) {
        if (!wasInert) {
          sibling.removeAttribute('inert');
        }
      }

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return dialogRef;
}
const handleIconStyle = {
  '--caul-handle-icon-url': `url("${caulIconUrl}")`
} as React.CSSProperties;

type OverlayEdge = 'bottom' | 'left' | 'right' | 'top';
type SettingsSection = 'general' | 'transcription' | 'ai';
type SettingsTarget = SettingsSection | 'models:transcription' | 'models:ai' | 'permissions';
type TooltipSide = NonNullable<React.ComponentProps<typeof TooltipContent>['side']>;
type MainNotification = {
  id: string;
  label: string;
  target: SettingsTarget;
  tone: 'action' | 'error' | 'progress';
};
type PanelIssue = {
  id: string;
  kind: 'cloud-ai' | 'local-ai' | 'permissions' | 'transcription-model';
  message: string;
  target: SettingsTarget;
};

const starterPromptTemplates: PromptTemplate[] = [
  createPromptTemplate({
    id: 'starter-answer-with-star',
    name: 'STAR',
    prompt: 'Use STAR when answering interview-style questions.\n\nStructure the answer as:\nSituation: brief context\nTask: what needed to be done\nAction: what I did\nResult: outcome or lesson\n\nKeep it concise and natural to say aloud.'
  }),
  createPromptTemplate({
    id: 'starter-use-my-cv',
    name: 'CV',
    prompt: 'Use my CV as background context.\n\nPrefer specific experience, projects, achievements and skills from the CV. If no CV content or readable CV attachment is provided, say you cannot review the CV until it is attached. Do not invent details, use placeholders or give a generic CV review.'
  }),
  createPromptTemplate({
    id: 'starter-job-description',
    name: 'PD',
    prompt: 'Use the position description as role context.\n\nConnect answers to the role duties, skills and selection criteria where useful.'
  })
];
const defaultSelectedPromptTemplateIds: string[] = [];

const llmModels: Array<{ label: string; value: LlmModel }> = cloudLlmConfig.models;

const llmReasoningLevels: Array<{ label: string; value: LlmReasoning }> = cloudLlmConfig.reasoningLevels as Array<{ label: string; value: LlmReasoning }>;

const llmModelValues = new Set<LlmModel>(llmModels.map((model) => model.value));
const llmReasoningValues = new Set<LlmReasoning>(llmReasoningLevels.map((reasoning) => reasoning.value));

function getAvailableCloudLlmModels(piStatus: PiStatus | null) {
  const configuredProviders = new Set<string>();

  if (piStatus?.chatGptConnected) {
    configuredProviders.add('openai-codex');
  }

  for (const provider of piStatus?.apiKeys.providers ?? []) {
    if (provider.configured) {
      configuredProviders.add(provider.id);
    }
  }

  return llmModels.filter((model) => configuredProviders.has(model.value.split('/', 1)[0]));
}

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
  request?: string;
  requestedAt: string | null;
  response: string;
};
type CollapseOverrides = Record<string, boolean>;

const scrollFixtureQueryParam = 'caul-scroll-fixture';
const streamFixtureQueryParam = 'caul-stream-fixture';

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
const streamFixtureAiResponses: AiResponseSectionData[] = [
  scrollFixtureAiResponses[0],
  scrollFixtureAiResponses[1],
  {
    id: 'stream-fixture-ai-active',
    isWaiting: true,
    requestedAt: new Date('2026-05-31T05:32:00Z').toISOString(),
    response: createScrollFixtureAiResponse('Streaming response under test', [
      'The active response should pin here at the top of the AI panel while it streams.',
      'This content is intentionally shorter than the panel so the temporary generation spacer is required.',
      'If the fixture works, the panel scrollTop should match this article offsetTop.'
    ])
  }
];

export function App() {
  useSystemColourScheme();

  const surface = getCaulSurface();
  const runtimeContext = useRuntimeContext();
  const isMac = runtimeContext?.isMac ?? isNavigatorMac();
  const appWindowTitle = runtimeContext?.appName ?? 'Caul';

  useLayoutEffect(() => {
    document.documentElement.dataset.caulSurface = surface;

    return () => {
      delete document.documentElement.dataset.caulSurface;
    };
  }, [surface]);

  useEffect(() => {
    document.title = appWindowTitle;
  }, [appWindowTitle]);

  if (surface === 'handle') {
    return <PrivateOverlayHandleSurface />;
  }

  if (surface === 'onboarding') {
    return <OnboardingSurface />;
  }

  const transcription = useLiveTranscription();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget>('general');
  const [listenToMicrophone, setListenToMicrophone] = useState(defaultListenToMicrophone);
  const [listenToSystemAudio, setListenToSystemAudio] = useState(defaultListenToSystemAudio);
  const [sendToAiWhenListeningStops, setSendToAiWhenListeningStops] = useState(defaultSendToAiWhenListeningStops);
  const [autoCollapseAiResponses, setAutoCollapseAiResponsesState] = useState(() => readBooleanPreference(
    autoCollapseAiResponsesPreferenceKey,
    readBooleanPreference(autoCollapsePreferenceKey, defaultAutoCollapse)
  ));
  const [autoCollapseTranscription, setAutoCollapseTranscriptionState] = useState(() => readBooleanPreference(
    autoCollapseTranscriptionPreferenceKey,
    readBooleanPreference(autoCollapsePreferenceKey, defaultAutoCollapse)
  ));
  const [llmModel, setLlmModel] = useState<LlmModel>(defaultLlmModel);
  const [llmReasoning, setLlmReasoning] = useState<LlmReasoning>(defaultLlmReasoning);
  const [localLlmReasoning, setLocalLlmReasoning] = useState<LlmReasoning>(defaultLocalLlmReasoning);
  const [selectedAiProvider, setSelectedAiProvider] = useState<AiProvider>('local');
  const [isLlmReady, setIsLlmReady] = useState(false);
  const [localLlmStatus, setLocalLlmStatus] = useState<LocalLlmStatus | null>(null);
  const [localAiSetupPhase, setLocalAiSetupPhase] = useState<'requesting' | 'downloading' | 'idle'>('idle');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [permissionsStatus, setPermissionsStatus] = useState<PermissionsStatus | null>(null);
  const [parakeetStatus, setParakeetStatus] = useState<ParakeetStatus | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [selectedTranscriptionModelId, setSelectedTranscriptionModelId] = useState<LocalTranscriptionModelId>('parakeet');
  const [isChatGptSigningIn, setIsChatGptSigningIn] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(starterPromptTemplates);
  const [selectedPromptTemplateIds, setSelectedPromptTemplateIds] = useState<string[]>([]);
  const [isPromptTemplateDialogOpen, setIsPromptTemplateDialogOpen] = useState(false);
  const [generalInstructions, setGeneralInstructions] = useState(() => (
    window.localStorage.getItem(generalInstructionsPreferenceKey) ?? defaultGeneralInstructions
  ));
  const [isGeneralInstructionsDialogOpen, setIsGeneralInstructionsDialogOpen] = useState(false);
  const privateOverlayStatus = usePrivateOverlayStatus();
  const overlayEdge = getPrivateOverlayHandleEdge(privateOverlayStatus);
  const outputRef = useRef<HTMLDivElement>(null);
  const llmOutputRef = useRef<HTMLDivElement>(null);
  const hasInitialisedTranscriptionModelRef = useRef(false);
  const autoSelectingReadyModelRef = useRef<LocalTranscriptionModelId | null>(null);
  const promptTemplateSaveRevisionRef = useRef(0);

  const isListening = transcription.isListening;
  const isBusy = transcription.isStarting;
  const hasAudioSource = listenToMicrophone || listenToSystemAudio;
  const missingSelectedPermissions = getMissingSelectedPermissionItems({
    listenToMicrophone,
    listenToSystemAudio,
    permissionsStatus
  });
  const transcriptIssue = getTranscriptPanelIssue({
    missingSelectedPermissions,
    parakeetStatus
  });
  const recommendedLocalAiModel = onboardingStatus?.ai.recommended === 'local' ? onboardingStatus.ai.recommendedModel : null;
  const recommendedLocalAiModelReady = Boolean(
    localLlmStatus?.runtime.installed
    && localLlmStatus.model?.installed
    && (!recommendedLocalAiModel || localLlmStatus.model.id === recommendedLocalAiModel.id)
  );
  const isCloudAiReady = isLlmReady || Boolean(onboardingStatus?.pi.connected);
  const aiIssue = getAiPanelIssue({
    isCloudAiReady,
    isLocalAiReady: recommendedLocalAiModelReady,
    localLlmStatus,
    selectedAiProvider
  });
  const canUseAi = !aiIssue;
  const canStartListening = hasAudioSource && !transcriptIssue;
  const isTranscriptPlaceholder = transcription.output === transcriptPlaceholder;
  const isAiResponsePlaceholder = transcription.llmOutput === aiResponsePlaceholder
    || transcription.llmOutput === legacyAiResponsePlaceholder
    || transcription.llmOutput === shortAiResponsePlaceholder;
  const aiResponseText = getAiResponseText(transcription.llmResponses);
  const hasAiResponse = aiResponseText.length > 0;
  const selectedPromptTemplates = selectedPromptTemplateIds
    .map((id) => promptTemplates.find((template) => template.id === id))
    .filter((template): template is PromptTemplate => Boolean(template))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const selectedPromptTemplatePrompt = selectedPromptTemplates.map((template) => template.prompt).join('\n\n');
  const selectedPromptTemplateAttachments = selectedPromptTemplates.flatMap((template) => template.attachments ?? []);
  const mainNotifications = getMainNotifications({
    aiIssue,
    missingSelectedPermissions,
    parakeetStatus,
    transcriptIssue,
    updateStatus
  });
  useSuppressTooltipsAfterOverlayOpen(Boolean(privateOverlayStatus?.overlay.visible || privateOverlayStatus?.overlayWindowVisible));

  useLayoutEffect(() => {
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
    if (!isListening) {
      return;
    }

    void transcription.updateSources({
      listenToMicrophone,
      listenToSystemAudio
    });
  }, [isListening, listenToMicrophone, listenToSystemAudio]);

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
    const bridge = getSettingsBridge()?.ai;

    if (!bridge) {
      return;
    }

    let isMounted = true;

    void bridge.localStatus()
      .then((status) => {
        if (isMounted) {
          setLocalLlmStatus(status);
        }
      })
      .catch(() => undefined);

    const unsubscribe = bridge.onLocalStatus((status) => {
      setLocalLlmStatus(status);
      setLocalAiSetupPhase((current) => {
        if (status.status === 'downloading') {
          return 'downloading';
        }

        return current === 'downloading' || current === 'requesting' ? 'idle' : current;
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const updates = getSettingsBridge()?.updates;

    if (!updates) {
      return;
    }

    let isMounted = true;
    const unsubscribe = updates.onStatus?.((status) => {
      setUpdateStatus(status);
    });

    void updates.status?.()
      .then((status) => {
        if (isMounted) {
          setUpdateStatus(status);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    void refreshOnboardingStatus();
  }, []);

  useEffect(() => {
    void refreshPermissionsStatus();
  }, []);

  useEffect(() => {
    void refreshParakeetStatus();

    return getSettingsBridge()?.parakeet?.onStatus?.((status) => {
      setParakeetStatus(status);
      setOnboardingStatus((current) => current ? {
        ...current,
        parakeet: status
      } : current);
    });
  }, []);

  useEffect(() => {
    if (
      !onboardingStatus
      || onboardingStatus.parakeet.status !== 'installed'
      || onboardingStatus.parakeet.modelId !== selectedTranscriptionModelId
      || onboardingStatus.selectedLocalTranscriptionModel === selectedTranscriptionModelId
      || autoSelectingReadyModelRef.current === selectedTranscriptionModelId
    ) {
      return;
    }

    autoSelectingReadyModelRef.current = selectedTranscriptionModelId;

    void getSettingsBridge()?.parakeet?.setModel(selectedTranscriptionModelId)
      .then(() => refreshOnboardingStatus())
      .catch((error) => {
        console.error('Failed to use ready transcription model:', error);
      })
      .finally(() => {
        autoSelectingReadyModelRef.current = null;
      });
  }, [selectedTranscriptionModelId, onboardingStatus]);

  useEffect(() => {
    void loadPromptTemplates();
  }, []);

  useEffect(() => {
    void loadPortablePreferences();
  }, []);

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
          },
          {
            description: 'Required when listening to audio from other apps.',
            id: 'system-audio',
            label: 'System Audio',
            status: 'unknown'
          }
        ],
        platform: 'browser'
      });
      return;
    }

    setPermissionsStatus(await bridge.status());
  }

  async function refreshParakeetStatus() {
    const state = await getSettingsBridge()?.parakeet?.status();

    if (state) {
      setParakeetStatus(state);
    }
  }

  async function refreshOnboardingStatus() {
    const nextStatus = await getSettingsBridge()?.onboarding?.status();

    if (!nextStatus) {
      return;
    }

    setOnboardingStatus(nextStatus);
    setLocalLlmStatus(getCaulLocalLlmStatus(nextStatus));

    if (nextStatus.pi.selectedModel && llmModelValues.has(nextStatus.pi.selectedModel)) {
      setLlmModel(nextStatus.pi.selectedModel);
    }

    if (!hasInitialisedTranscriptionModelRef.current) {
      hasInitialisedTranscriptionModelRef.current = true;
      setSelectedTranscriptionModelId(getInitialTranscriptionModelId(nextStatus));
    }
  }

  async function downloadTranscriptionModel(modelId: LocalTranscriptionModelId) {
    try {
      const nextStatus = await getSettingsBridge()?.parakeet?.download(modelId);
      if (nextStatus) {
        setParakeetStatus(nextStatus);
        setOnboardingStatus((current) => current ? {
          ...current,
          parakeet: nextStatus
        } : current);
      }
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to download transcription model:', error);
    }
  }

  async function cancelTranscriptionModelDownload() {
    try {
      const nextStatus = await getSettingsBridge()?.parakeet?.cancelDownload?.();
      if (nextStatus) {
        setParakeetStatus(nextStatus);
        setOnboardingStatus((current) => current ? {
          ...current,
          parakeet: nextStatus
        } : current);
      }
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to cancel transcription model download:', error);
    }
  }

  async function downloadLocalAi(modelId?: string) {
    try {
      setLocalAiSetupPhase('requesting');
      const nextStatus = await getSettingsBridge()?.ai?.downloadLocal?.(modelId);
      if (nextStatus) {
        setLocalLlmStatus(nextStatus);
      }
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to download local AI:', error);
    } finally {
      setLocalAiSetupPhase('idle');
    }
  }

  async function cancelLocalAiDownload() {
    try {
      const nextStatus = await getSettingsBridge()?.ai?.cancelLocalDownload?.();
      if (nextStatus) {
        setLocalLlmStatus(nextStatus);
      }
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to cancel local AI download:', error);
    }
  }

  async function selectAiProvider(provider: AiProvider) {
    setSelectedAiProvider(provider);

    try {
      const nextStatus = await getSettingsBridge()?.ai?.setProvider?.(provider);
      if (nextStatus) {
        setOnboardingStatus(nextStatus);
        setLocalLlmStatus(getCaulLocalLlmStatus(nextStatus));
      }
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to update AI provider:', error);
    }
  }

  async function signInWithChatGpt(): Promise<CloudSignInResult> {
    setIsChatGptSigningIn(true);

    try {
      return await requestChatGptSignIn(refreshOnboardingStatus);
    } finally {
      setIsChatGptSigningIn(false);
    }
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
      selectedTemplateIds: defaultSelectedPromptTemplateIds,
      templates: starterPromptTemplates
    });
  }

  async function loadPortablePreferences() {
    const legacyAutoCollapse = readBooleanPreference(autoCollapsePreferenceKey, defaultAutoCollapse);
    const legacyPreferences: PortablePreferences = {
      autoCollapse: legacyAutoCollapse,
      autoCollapseAiResponses: readBooleanPreference(autoCollapseAiResponsesPreferenceKey, legacyAutoCollapse),
      autoCollapseTranscription: readBooleanPreference(autoCollapseTranscriptionPreferenceKey, legacyAutoCollapse),
      generalInstructions: window.localStorage.getItem(generalInstructionsPreferenceKey) ?? defaultGeneralInstructions
    };

    const result = await getSettingsBridge()?.preferences?.load(legacyPreferences);
    const preferences = result?.preferences;

    if (!preferences) {
      return;
    }

    applyPortablePreferences(preferences);
  }

  function applyPortablePreferences(preferences: PortablePreferences) {
    const legacyAutoCollapse = typeof preferences.autoCollapse === 'boolean'
      ? preferences.autoCollapse
      : undefined;

    setAutoCollapseAiResponsesState(
      typeof preferences.autoCollapseAiResponses === 'boolean'
        ? preferences.autoCollapseAiResponses
        : legacyAutoCollapse ?? defaultAutoCollapse
    );
    setAutoCollapseTranscriptionState(
      typeof preferences.autoCollapseTranscription === 'boolean'
        ? preferences.autoCollapseTranscription
        : legacyAutoCollapse ?? defaultAutoCollapse
    );

    if (typeof preferences.generalInstructions === 'string') {
      setGeneralInstructions(preferences.generalInstructions);
    }

    if (preferences.llmModel && llmModelValues.has(preferences.llmModel)) {
      setLlmModel(preferences.llmModel);
    }

    if (preferences.llmReasoning && llmReasoningValues.has(preferences.llmReasoning)) {
      setLlmReasoning(preferences.llmReasoning);
    }

    if (preferences.localLlmReasoning && llmReasoningValues.has(preferences.localLlmReasoning)) {
      setLocalLlmReasoning(preferences.localLlmReasoning);
    }

    if (preferences.selectedAiProvider === 'cloud' || preferences.selectedAiProvider === 'local') {
      setSelectedAiProvider(preferences.selectedAiProvider);
    }
  }

  function applyPromptTemplateState(state: PromptTemplateState) {
    const templates = mergeStarterPromptTemplates(state.templates);
    setPromptTemplates(templates);
    setSelectedPromptTemplateIds(getSelectedPromptTemplateIds(state, templates));
  }

  async function savePromptTemplate(template: PromptTemplate) {
    const bridge = getSettingsBridge()?.promptTemplates;

    if (!bridge) {
      const starterTemplate = starterPromptTemplates.find((item) => item.id === template.id);
      const templateToSave = starterTemplate && isStarterPromptTemplateCustomised(template, starterTemplate)
        ? asCustomStarterPromptTemplate(template, promptTemplates)
        : template;
      const uniqueTemplateToSave = {
        ...templateToSave,
        name: getAvailablePromptTemplateName(
          templateToSave.name,
          promptTemplates.filter((item) => item.id !== templateToSave.id)
        )
      };
      const templates = promptTemplates.some((item) => item.id === templateToSave.id)
        ? promptTemplates.map((item) => (item.id === uniqueTemplateToSave.id ? uniqueTemplateToSave : item))
        : [...promptTemplates, uniqueTemplateToSave];
      setPromptTemplates(resolvePromptTemplateNameCollisions(templates));
      return;
    }

    const saveRevision = promptTemplateSaveRevisionRef.current + 1;
    promptTemplateSaveRevisionRef.current = saveRevision;
    setPromptTemplates((currentTemplates) => resolvePromptTemplateNameCollisions(
      currentTemplates.some((item) => item.id === template.id)
        ? currentTemplates.map((item) => (item.id === template.id ? template : item))
        : [...currentTemplates, template]
    ));

    const state = await bridge.save(template);
    if (saveRevision === promptTemplateSaveRevisionRef.current) {
      applyPromptTemplateState(state);
    }
  }

  async function deletePromptTemplate(id: string) {
    const bridge = getSettingsBridge()?.promptTemplates;

    if (!bridge) {
      setPromptTemplates((templates) => templates.filter((template) => template.id !== id));
      setSelectedPromptTemplateIds((selectedIds) => selectedIds.filter((selectedId) => selectedId !== id));
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

  async function selectPromptTemplates(ids: string[]) {
    const bridge = getSettingsBridge()?.promptTemplates;
    const nextIds = ids.filter((id, index) => (
      ids.indexOf(id) === index
      && promptTemplates.some((template) => template.id === id)
    ));

    setSelectedPromptTemplateIds(nextIds);

    if (!bridge) {
      return;
    }

    const state = await bridge.setSelected(nextIds);
    const templates = mergeStarterPromptTemplates(state.templates);
    const selectedTemplateIds = nextIds.filter((id) => templates.some((template) => template.id === id));

    setPromptTemplates(templates);
    setSelectedPromptTemplateIds(selectedTemplateIds);
  }

  async function copyTranscript() {
    if (!isTranscriptTextCopyable(transcription.confirmedOutput)) {
      return;
    }

    await navigator.clipboard?.writeText(transcription.confirmedOutput);
  }

  function downloadTranscript(format: TranscriptDownloadFormat) {
    if (!isTranscriptTextCopyable(transcription.confirmedOutput)) {
      return;
    }

    downloadTranscriptFile(transcription.confirmedOutput, format);
  }

  async function copyAiResponse() {
    if (!hasAiResponse) {
      return;
    }

    await navigator.clipboard?.writeText(aiResponseText);
  }

  function downloadAiResponse(format: TranscriptDownloadFormat) {
    if (!hasAiResponse) {
      return;
    }

    downloadTextFile(aiResponseText, format, 'ai-response');
  }

  function clearTranscript() {
    transcription.clearTranscript();
  }

  function clearAiResponses() {
    transcription.clearAiResponses();
  }

  function setAutoCollapseAiResponses(autoCollapseAiResponses: boolean) {
    setAutoCollapseAiResponsesState(autoCollapseAiResponses);
    void getSettingsBridge()?.preferences?.save({ autoCollapseAiResponses });
  }

  function setAutoCollapseTranscription(autoCollapseTranscription: boolean) {
    setAutoCollapseTranscriptionState(autoCollapseTranscription);
    void getSettingsBridge()?.preferences?.save({ autoCollapseTranscription });
  }

  function saveGeneralInstructions(instructions: string) {
    const nextInstructions = instructions;
    setGeneralInstructions(nextInstructions);
    void getSettingsBridge()?.preferences?.save({ generalInstructions: nextInstructions });
  }

  function saveLlmModel(model: LlmModel) {
    setLlmModel(model);
    void getSettingsBridge()?.preferences?.save({ llmModel: model });
    void getSettingsBridge()?.ai?.saveModel(model);
  }

  function saveLlmReasoning(reasoning: LlmReasoning) {
    setLlmReasoning(reasoning);
    void getSettingsBridge()?.preferences?.save({ llmReasoning: reasoning });
  }

  function saveLocalLlmReasoning(reasoning: LlmReasoning) {
    setLocalLlmReasoning(reasoning);
    void getSettingsBridge()?.preferences?.save({ localLlmReasoning: reasoning });
  }

  function getSelectedLlmReasoning() {
    return selectedAiProvider === 'local' ? localLlmReasoning : llmReasoning;
  }

  function askAiFromTranscript() {
    if (!canUseAi) {
      return;
    }

    void transcription.ask({
      generalInstructionsText: generalInstructions,
      llmModel,
      llmReasoning: getSelectedLlmReasoning(),
      aiProvider: selectedAiProvider,
      promptTemplateAttachments: selectedPromptTemplateAttachments,
      promptTemplateText: selectedPromptTemplatePrompt
    });
  }

  function askAiFromSpecificTranscript(transcript: string) {
    if (!canUseAi) {
      return;
    }

    void transcription.ask({
      generalInstructionsText: generalInstructions,
      llmModel,
      llmReasoning: getSelectedLlmReasoning(),
      aiProvider: selectedAiProvider,
      promptTemplateAttachments: selectedPromptTemplateAttachments,
      promptTemplateText: selectedPromptTemplatePrompt,
      transcript
    });
  }

  function askAiFromManualPrompt(prompt: string) {
    if (!canUseAi) {
      return;
    }

    void transcription.ask({
      generalInstructionsText: generalInstructions,
      llmModel,
      llmReasoning: getSelectedLlmReasoning(),
      aiProvider: selectedAiProvider,
      promptTemplateAttachments: selectedPromptTemplateAttachments,
      promptTemplateText: selectedPromptTemplatePrompt,
      transcript: prompt
    });
  }

  function toggleListening() {
    if (isListening) {
      void transcription.stop({
        generalInstructionsText: generalInstructions,
        llmModel,
        llmReasoning: getSelectedLlmReasoning(),
        aiProvider: selectedAiProvider,
        promptTemplateAttachments: selectedPromptTemplateAttachments,
        promptTemplateText: selectedPromptTemplatePrompt,
        sendToLlm: sendToAiWhenListeningStops && canUseAi
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

    setListenToMicrophone(defaultListenToMicrophone);
    setListenToSystemAudio(defaultListenToSystemAudio);
    setSendToAiWhenListeningStops(defaultSendToAiWhenListeningStops);
    setAutoCollapseAiResponsesState(defaultAutoCollapse);
    setAutoCollapseTranscriptionState(defaultAutoCollapse);
    setLlmModel(defaultLlmModel);
    setLlmReasoning(defaultLlmReasoning);
    setLocalLlmReasoning(defaultLocalLlmReasoning);
    setGeneralInstructions(defaultGeneralInstructions);
    window.localStorage.clear();
    await getSettingsBridge()?.preferences?.save({
      autoCollapseAiResponses: defaultAutoCollapse,
      autoCollapseTranscription: defaultAutoCollapse,
      generalInstructions: defaultGeneralInstructions,
      localLlmReasoning: defaultLocalLlmReasoning,
      llmModel: defaultLlmModel,
      llmReasoning: defaultLlmReasoning
    });
    const reset = await getSettingsBridge()?.reset();
    const promptTemplateState = await getSettingsBridge()?.promptTemplates?.list();

    if (promptTemplateState) {
      applyPromptTemplateState(promptTemplateState);
    } else if (reset) {
      applyPromptTemplateState({
        ok: true,
        selectedTemplateIds: defaultSelectedPromptTemplateIds,
        templates: starterPromptTemplates
      });
    }
  }

  async function setPrivateOverlayHandleSize(size: PrivateOverlayHandleSize) {
    const nextStatus = await getPrivateOverlayBridge()?.setHandleSize(size);

    return nextStatus;
  }

  function openSettings(target: SettingsTarget = 'general') {
    const section = getSettingsSectionForTarget(target);
    setSettingsTarget(target);
    setSettingsSection(section);
    setIsSettingsOpen(true);
  }

  function openHistoryFolder() {
    void getSettingsBridge()?.history?.openFolder();
  }

  return (
    <div className={layout.overlayWindowOuter}>
      <main className={layout.main}>
        <TooltipProvider>
        <PrivateOverlayWindowTitleBar
          appTitle={appWindowTitle}
          isMac={isMac}
          isSettingsOpen={isSettingsOpen}
          notifications={mainNotifications}
          onOpenHistoryFolder={openHistoryFolder}
          onOpenSettingsTarget={openSettings}
          onToggleSettings={() => {
            setSettingsSection('general');
            setIsSettingsOpen((isOpen) => !isOpen);
          }}
        />
        <div
          className={layout.appBody}
          data-overlay-edge={overlayEdge}
        >
          <form className={layout.page} aria-label="Caul setup">
            <HomePage
              autoCollapseAiResponses={autoCollapseAiResponses}
              autoCollapseTranscription={autoCollapseTranscription}
              canStartListening={canStartListening}
              edge={overlayEdge}
              isAiResponsePlaceholder={isAiResponsePlaceholder}
              isBusy={isBusy}
              isListening={isListening}
              aiIssue={aiIssue}
              canUseAi={canUseAi}
              isTranscriptPlaceholder={isTranscriptPlaceholder}
              listenToMicrophone={listenToMicrophone}
              listenToSystemAudio={listenToSystemAudio}
              localLlmStatus={localLlmStatus}
              localAiSetupPhase={localAiSetupPhase}
              llmOutputRef={llmOutputRef}
              missingSelectedPermissions={missingSelectedPermissions}
              onAskAiFromTranscript={askAiFromTranscript}
              onAskAiFromManualPrompt={askAiFromManualPrompt}
              onAskAiFromSpecificTranscript={askAiFromSpecificTranscript}
              onClearAiResponses={clearAiResponses}
              onClearTranscript={clearTranscript}
              onCopyAiResponse={copyAiResponse}
              onCopyTranscript={copyTranscript}
              onDownloadAiResponse={downloadAiResponse}
              onDownloadTranscript={downloadTranscript}
              onCancelLocalAiDownload={() => void cancelLocalAiDownload()}
              onCancelTranscriptionModelDownload={() => void cancelTranscriptionModelDownload()}
              onDownloadLocalAi={() => void downloadLocalAi(recommendedLocalAiModel?.id)}
              onDownloadTranscriptionModel={(modelId) => void downloadTranscriptionModel(modelId)}
              onOpenGeneralInstructions={() => setIsGeneralInstructionsDialogOpen(true)}
              onOpenPromptTemplateSettings={() => setIsPromptTemplateDialogOpen(true)}
              onRequestPermission={requestPermission}
              onSelectPromptTemplates={(ids) => void selectPromptTemplates(ids)}
              onSelectAiProvider={(provider) => void selectAiProvider(provider)}
              onSelectTranscriptionModel={setSelectedTranscriptionModelId}
              onSetListenToMicrophone={setListenToMicrophone}
              onSetListenToSystemAudio={setListenToSystemAudio}
              onSignInWithChatGpt={signInWithChatGpt}
              onboardingStatus={onboardingStatus}
              outputRef={outputRef}
              promptTemplates={promptTemplates}
              recommendedLocalAiModelReady={recommendedLocalAiModelReady}
              isCloudAiReady={isCloudAiReady}
              sendToAiWhenListeningStops={sendToAiWhenListeningStops}
              selectedAiProvider={selectedAiProvider}
              selectedPromptTemplateIds={selectedPromptTemplateIds}
              selectedTranscriptionModelId={selectedTranscriptionModelId}
              setSendToAiWhenListeningStops={setSendToAiWhenListeningStops}
              isChatGptSigningIn={isChatGptSigningIn}
              toggleListening={toggleListening}
              transcriptIssue={transcriptIssue}
              transcription={transcription}
            />
            {isSettingsOpen ? (
              <SettingsPage
                isBusy={isBusy}
                isListening={isListening}
                initialSection={settingsSection}
                initialTarget={settingsTarget}
                listenToMicrophone={listenToMicrophone}
                localLlmReasoning={localLlmReasoning}
                llmModel={llmModel}
                llmReasoning={llmReasoning}
                onSelectedAiProviderChange={setSelectedAiProvider}
                isMac={isMac}
                onClose={() => setIsSettingsOpen(false)}
                onQuit={() => void getSettingsBridge()?.quit?.()}
                onRequestPermission={requestPermission}
                onSetPrivateOverlayHandleSize={(size) => void setPrivateOverlayHandleSize(size)}
                autoCollapseAiResponses={autoCollapseAiResponses}
                autoCollapseTranscription={autoCollapseTranscription}
                permissionsStatus={permissionsStatus}
                privateOverlayStatus={privateOverlayStatus}
                resetSettings={resetSettings}
                setAutoCollapseAiResponses={setAutoCollapseAiResponses}
                setAutoCollapseTranscription={setAutoCollapseTranscription}
                setLlmModel={saveLlmModel}
                setLlmReasoning={saveLlmReasoning}
                setLocalLlmReasoning={saveLocalLlmReasoning}
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
        <GeneralInstructionsDialog
          instructions={generalInstructions}
          isMac={isMac}
          onOpenChange={setIsGeneralInstructionsDialogOpen}
          onSave={saveGeneralInstructions}
          open={isGeneralInstructionsDialogOpen}
        />
        </TooltipProvider>
      </main>
      <TooltipProvider>
        <OverlayResizeHandles />
      </TooltipProvider>
    </div>
  );
}

function isLlmReadyOrSettled(status: { ready: boolean; status: string }) {
  return status.ready || status.status === 'error' || status.status === 'disabled';
}

type CaulSurface = 'app' | 'handle' | 'onboarding';

function getCaulSurface(): CaulSurface {
  const surface = new URLSearchParams(window.location.search).get('caul-surface');

  return surface === 'handle' || surface === 'onboarding' ? surface : 'app';
}

type OnboardingStep = 'permissions' | 'parakeet' | 'ai';
type OnboardingPage = {
  id: OnboardingStep;
  stepLabel: string;
  title: string;
};
function OnboardingSurface() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [localLlmStatus, setLocalLlmStatus] = useState<LocalLlmStatus | null>(null);
  const [localAiSetupPhase, setLocalAiSetupPhase] = useState<'requesting' | 'downloading' | 'idle'>('idle');
  const [selectedAiProvider, setSelectedAiProviderState] = useState<AiProvider>('local');
  const [selectedTranscriptionModelId, setSelectedTranscriptionModelId] = useState<LocalTranscriptionModelId>('parakeet');
  const [activePageId, setActivePageId] = useState<OnboardingStep>('permissions');
  const [isChatGptSigningIn, setIsChatGptSigningIn] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const permissionsRef = useRef<HTMLElement | null>(null);
  const parakeetRef = useRef<HTMLElement | null>(null);
  const aiRef = useRef<HTMLElement | null>(null);
  const hasInitialisedAiProviderRef = useRef(false);
  const hasInitialisedTranscriptionModelRef = useRef(false);
  const hasUserSelectedAiProviderRef = useRef(false);
  const runtimeContext = useRuntimeContext();
  const appName = runtimeContext?.appName ?? 'Caul';
  const appIconUrl = runtimeContext?.appChannel === 'beta' || runtimeContext?.appChannel === 'dev'
    ? caulBetaAppIconUrl
    : caulAppIconUrl;

  useEffect(() => {
    void refresh({ refreshCatalogue: false });

    const unsubscribe = getSettingsBridge()?.parakeet?.onStatus?.((nextStatus) => {
      setStatus((current) => current ? {
        ...current,
        parakeet: nextStatus
      } : current);
    });
    const unsubscribeLocalLlm = getSettingsBridge()?.ai?.onLocalStatus?.((nextStatus) => {
      setLocalLlmStatus(nextStatus);
      setLocalAiSetupPhase((current) => {
        if (nextStatus.status === 'downloading') {
          return 'downloading';
        }
        return current === 'downloading' || current === 'requesting' ? 'idle' : current;
      });
    });

    const smokeStep = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (detail === 'permissions' || detail === 'parakeet' || detail === 'ai') {
        setActivePageId(detail as OnboardingStep);
      }
    };

    window.addEventListener('caul:onboarding-smoke-step', smokeStep);

    return () => {
      unsubscribe?.();
      unsubscribeLocalLlm?.();
      window.removeEventListener('caul:onboarding-smoke-step', smokeStep);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh();
    }, 1500);
    const refreshOnFocus = () => void refresh();

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, []);

  async function refresh(options?: { refreshCatalogue?: boolean }) {
    const nextStatus = await getSettingsBridge()?.onboarding?.status(options);

    if (nextStatus) {
      setStatus(nextStatus);
      if (!hasInitialisedTranscriptionModelRef.current) {
        hasInitialisedTranscriptionModelRef.current = true;
        setSelectedTranscriptionModelId(getInitialTranscriptionModelId(nextStatus));
      }
      if (!hasInitialisedAiProviderRef.current) {
        hasInitialisedAiProviderRef.current = true;
        const recommendedProvider = getOnboardingDefaultAiProvider(nextStatus);
        setSelectedAiProviderState(recommendedProvider);

        if (recommendedProvider !== nextStatus.ai?.provider) {
          void getSettingsBridge()?.ai?.setProvider?.(recommendedProvider)
            .then((updatedStatus) => {
              if (updatedStatus && !hasUserSelectedAiProviderRef.current) {
                setStatus(updatedStatus);
              }
            })
            .catch((error) => {
              console.error('Failed to apply recommended onboarding AI provider:', error);
            });
        }
      } else if (!hasUserSelectedAiProviderRef.current) {
        setSelectedAiProviderState(nextStatus.ai?.provider ?? getOnboardingDefaultAiProvider(nextStatus));
      }
      setLocalLlmStatus(getCaulLocalLlmStatus(nextStatus));
    }
  }

  async function requestOnboardingPermission(permission: PermissionItem['id']) {
    await requestOnboardingPermissions([permission]);
  }

  async function requestOnboardingPermissions(permissions: Array<PermissionItem['id']>) {
    const bridge = getPermissionsBridge();

    for (const permission of permissions) {
      await (bridge?.request?.(permission) ?? bridge?.open(permission));
    }

    await refresh();
  }

  async function downloadParakeet(modelId: LocalTranscriptionModelId) {
    try {
      const nextParakeetStatus = await getSettingsBridge()?.parakeet?.download(modelId);
      if (nextParakeetStatus) {
        setStatus((current) => current ? {
          ...current,
          parakeet: nextParakeetStatus
        } : current);
      }
      await refresh();
    } catch (error) {
      console.error('Failed to download transcription model:', error);
    }
  }

  async function selectTranscriptionModel(modelId: LocalTranscriptionModelId) {
    setSelectedTranscriptionModelId(modelId);

    if (
      !status
      || status.parakeet.status !== 'installed'
      || status.parakeet.modelId !== modelId
      || status.selectedLocalTranscriptionModel === modelId
    ) {
      return;
    }

    try {
      await getSettingsBridge()?.parakeet?.setModel(modelId);
      await refresh();
    } catch (error) {
      console.error('Failed to use ready transcription model:', error);
    }
  }

  async function cancelParakeetDownload() {
    try {
      const nextParakeetStatus = await getSettingsBridge()?.parakeet?.cancelDownload?.();
      if (nextParakeetStatus) {
        setStatus((current) => current ? {
          ...current,
          parakeet: nextParakeetStatus
        } : current);
      }
      await refresh();
    } catch (error) {
      console.error('Failed to cancel transcription model download:', error);
    }
  }

  async function signInWithChatGpt(): Promise<CloudSignInResult> {
    setIsChatGptSigningIn(true);

    try {
      return await requestChatGptSignIn(() => refresh({ refreshCatalogue: false }));
    } finally {
      setIsChatGptSigningIn(false);
    }
  }

  async function selectAiProvider(provider: AiProvider) {
    hasUserSelectedAiProviderRef.current = true;
    setSelectedAiProviderState(provider);

    try {
      const nextStatus = await getSettingsBridge()?.ai?.setProvider?.(provider);
      if (nextStatus) {
        setStatus(nextStatus);
      }
    } catch (error) {
      console.error('Failed to update AI provider:', error);
    }
  }

  async function downloadLocalAi(modelId?: string) {
    try {
      setLocalAiSetupPhase('requesting');
      const nextStatus = await getSettingsBridge()?.ai?.downloadLocal?.(modelId);
      if (nextStatus) {
        setLocalLlmStatus(nextStatus);
      }
      await refresh();
    } catch (error) {
      console.error('Failed to download local AI:', error);
    } finally {
      setLocalAiSetupPhase('idle');
    }
  }

  async function cancelLocalAiDownload() {
    try {
      const nextStatus = await getSettingsBridge()?.ai?.cancelLocalDownload?.();
      if (nextStatus) {
        setLocalLlmStatus(nextStatus);
      }
      await refresh();
    } catch (error) {
      console.error('Failed to cancel local AI download:', error);
    }
  }

  useEffect(() => {
    const startLocalAiDownloadSmoke = () => {
      void downloadLocalAi();
    };

    window.addEventListener('caul:onboarding-smoke-download-local-ai', startLocalAiDownloadSmoke);

    return () => {
      window.removeEventListener('caul:onboarding-smoke-download-local-ai', startLocalAiDownloadSmoke);
    };
  }, []);

  async function finish() {
    if (isCompleting) {
      return;
    }

    setIsCompleting(true);

    try {
      const nextStatus = await getSettingsBridge()?.onboarding?.complete();

      if (nextStatus) {
        setStatus(nextStatus);
        setSelectedAiProviderState(nextStatus.ai?.provider ?? 'local');
        setLocalLlmStatus(getCaulLocalLlmStatus(nextStatus));
      }

      if (nextStatus && !nextStatus.complete) {
        setIsCompleting(false);
      }
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      setIsCompleting(false);
      await refresh();
    }
  }

  const missingItems = getMissingOnboardingItems({
    localLlmStatus,
    selectedAiProvider,
    selectedTranscriptionModelId,
    status
  });
  const visiblePermissions = getOnboardingVisiblePermissionItems(status?.permissions);
  const onboardingPermissionRows = getOnboardingPermissionRows(visiblePermissions);
  const showPermissionsStep = onboardingPermissionRows.length > 0;
  const pages: OnboardingPage[] = [
    ...(showPermissionsStep ? [{ id: 'permissions' as const, stepLabel: 'Step 1', title: 'Permissions' }] : []),
    {
      id: 'parakeet',
      stepLabel: showPermissionsStep ? 'Step 2' : 'Step 1',
      title: 'Local transcription'
    },
    {
      id: 'ai',
      stepLabel: showPermissionsStep ? 'Step 3' : 'Step 2',
      title: 'AI responses'
    }
  ];
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0]!;
  const activePageIndex = pages.findIndex((page) => page.id === activePage.id);
  const isFirstPage = activePageIndex <= 0;
  const isLastPage = activePageIndex === pages.length - 1;

  useEffect(() => {
    if (status && !showPermissionsStep && activePageId === 'permissions') {
      setActivePageId('parakeet');
    }
  }, [activePageId, showPermissionsStep, status]);

  function goToPreviousPage() {
    const previousPage = pages[Math.max(0, activePageIndex - 1)];
    if (previousPage) {
      setActivePageId(previousPage.id);
    }
  }

  function goToNextPage() {
    const nextPage = pages[Math.min(pages.length - 1, activePageIndex + 1)];
    if (nextPage) {
      setActivePageId(nextPage.id);
    }
  }

  function renderOnboardingPanel(page: OnboardingPage) {
    const sectionRef = page.id === 'permissions'
      ? permissionsRef
      : page.id === 'parakeet'
        ? parakeetRef
        : aiRef;

    if (page.id === 'permissions') {
      return (
        <OnboardingPanel sectionRef={sectionRef} title="Permissions">
          <div className="grid">
            {onboardingPermissionRows.map((permission) => (
              <PermissionSetupRow
                key={permission.id}
                actionSize="default"
                issuePanel
                onChange={() => void requestOnboardingPermission(permission.id)}
                permission={permission}
              />
            ))}
          </div>
        </OnboardingPanel>
      );
    }

    if (page.id === 'parakeet') {
      return (
        <OnboardingPanel sectionRef={sectionRef} title="Local transcription">
          <p className="text-sm text-muted-foreground">Local and private. Audio is transcribed on this computer.</p>
          <TranscriptionModelRow
            onCancel={() => void cancelParakeetDownload()}
            onDownload={(modelId) => void downloadParakeet(modelId)}
            onSelectModel={(modelId) => void selectTranscriptionModel(modelId)}
            selectedModelId={selectedTranscriptionModelId}
            status={status}
          />
        </OnboardingPanel>
      );
    }

    return (
      <OnboardingPanel sectionRef={sectionRef} title="AI responses">
        <AiProviderSetup
          isChatGptSigningIn={isChatGptSigningIn}
          isCloudAiReady={Boolean(status?.pi.connected)}
          localLlmStatus={localLlmStatus}
          localAiSetupPhase={localAiSetupPhase}
          onCancelLocalDownload={() => void cancelLocalAiDownload()}
          onDownloadLocalAi={(modelId) => void downloadLocalAi(modelId)}
          onCloudStatusChange={() => refresh({ refreshCatalogue: false })}
          onSelectProvider={(provider) => void selectAiProvider(provider)}
          onSignInWithChatGpt={signInWithChatGpt}
          selectedProvider={selectedAiProvider}
          showCloudProviderCards
          status={status}
        />
      </OnboardingPanel>
    );
  }

  return (
    <TooltipProvider>
      <main aria-label="Caul setup" className="h-screen overflow-y-auto bg-background text-foreground">
        <div className="mx-auto grid min-h-full w-full max-w-[38rem] content-start grid-rows-[auto_auto_auto_auto] gap-4 px-6 py-6">
          <header className="flex flex-col items-center gap-2 text-center">
            <img alt={appName} className="size-20 rounded-[1.1rem]" src={appIconUrl} />
            <h1 className="text-xl font-semibold">Welcome to {appName}</h1>
          </header>

          <OnboardingSteps
            activePageId={activePage.id}
            onSelect={setActivePageId}
            pages={pages}
          />

          <div>
            {renderOnboardingPanel(activePage)}
          </div>

          <OnboardingFooter
            isCompleting={isCompleting}
            isFirstPage={isFirstPage}
            isLastPage={isLastPage}
            missingItems={missingItems}
            onBack={goToPreviousPage}
            onFinish={() => void finish()}
            onNext={goToNextPage}
          />
        </div>
      </main>
    </TooltipProvider>
  );
}

function OnboardingSteps({
  activePageId,
  onSelect,
  pages
}: {
  activePageId: OnboardingPage['id'];
  onSelect: (pageId: OnboardingPage['id']) => void;
  pages: OnboardingPage[];
}) {
  return (
    <nav aria-label="Onboarding steps">
      <ToggleGroup
        aria-label="Choose onboarding step"
        className={cn('grid w-full', pages.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}
        onValueChange={(value) => {
          const nextPage = value.at(-1);
          if (nextPage) {
            onSelect(nextPage as OnboardingPage['id']);
          }
        }}
        spacing={2}
        value={[activePageId]}
        variant="outline"
      >
        {pages.map((page, index) => (
          <ToggleGroupItem
            key={page.id}
            aria-current={page.id === activePageId ? 'step' : undefined}
            aria-label={`${page.stepLabel}: ${page.title}`}
            className="w-full"
            value={page.id}
          >
            <span>{index + 1}. {page.title.replace('Local ', '')}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </nav>
  );
}

function OnboardingFooter({
  isCompleting,
  isFirstPage,
  isLastPage,
  missingItems,
  onBack,
  onFinish,
  onNext
}: {
  isCompleting: boolean;
  isFirstPage: boolean;
  isLastPage: boolean;
  missingItems: string[];
  onBack: () => void;
  onFinish: () => void;
  onNext: () => void;
}) {
  const disabled = isCompleting || missingItems.length > 0;

  return (
    <div className="grid min-h-11 grid-cols-3 items-end gap-3">
      <Button className={cn('min-w-24 justify-self-start', isFirstPage && 'invisible')} disabled={isCompleting || isFirstPage} onClick={onBack} size="lg" type="button" variant="outline">
        Back
      </Button>

      {isLastPage ? (
        <Tooltip>
          <TooltipTrigger
            render={<span
              className={cn('inline-flex justify-self-center', disabled && 'cursor-not-allowed')}
              tabIndex={disabled && !isCompleting ? 0 : -1}
            />}
          >
            <Button
              disabled={disabled}
              onClick={onFinish}
              size="lg"
              type="button"
            >
              {isCompleting ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              {isCompleting ? 'Starting Caul' : 'Start using Caul'}
            </Button>
          </TooltipTrigger>
          {disabled && !isCompleting ? (
            <TooltipContent className="max-w-64" side="top">
              <p className="font-medium">Still needed</p>
              <ul className="mt-1 list-disc pl-4">
                {missingItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </TooltipContent>
          ) : null}
        </Tooltip>
      ) : (
        <span aria-hidden="true" />
      )}

      {!isLastPage ? (
        <Button className="min-w-24 justify-self-end" disabled={isCompleting} onClick={onNext} size="lg" type="button">
          Next
        </Button>
      ) : <span aria-hidden="true" />}
    </div>
  );
}

function getMissingOnboardingItems({
  localLlmStatus,
  selectedAiProvider,
  selectedTranscriptionModelId,
  status
}: {
  localLlmStatus: LocalLlmStatus | null;
  selectedAiProvider: AiProvider;
  selectedTranscriptionModelId: LocalTranscriptionModelId;
  status: OnboardingStatus | null;
}) {
  if (!status) {
    return ['Setup checks'];
  }

  const missing: string[] = [];
  const missingPermissions = getOnboardingRequiredPermissionItems(status.permissions).filter((permission) => (
    permission.status !== 'granted' && permission.status !== 'unsupported'
  ));

  if (missingPermissions.length > 0) {
    missing.push(...missingPermissions.map((permission) => permission.label));
  }

  if (!isOnboardingSelectedTranscriptionModelReady(status, selectedTranscriptionModelId)) {
    missing.push('Local transcription');
  }

  if (!isOnboardingSelectedAiProviderReady({
    localLlmStatus,
    selectedAiProvider,
    status
  })) {
    missing.push(selectedAiProvider === 'cloud' ? 'ChatGPT sign in' : 'Local AI');
  }

  return missing;
}

function getOnboardingDefaultAiProvider(status: OnboardingStatus): AiProvider {
  if (status.ai?.recommended === 'local' || status.ai?.recommended === 'cloud') {
    return status.ai.recommended;
  }

  return status.ai?.provider ?? 'local';
}

function isOnboardingTranscriptionModelReady(status: OnboardingStatus) {
  return Boolean(
    status.selectedLocalTranscriptionModel
    && status.parakeet.installed
    && status.parakeet.modelId === status.selectedLocalTranscriptionModel
  );
}

function isOnboardingSelectedTranscriptionModelReady(status: OnboardingStatus, selectedModelId: LocalTranscriptionModelId) {
  return Boolean(
    status.selectedLocalTranscriptionModel === selectedModelId
    && status.parakeet.status === 'installed'
    && status.parakeet.modelId === selectedModelId
  );
}

function isOnboardingSelectedAiProviderReady({
  localLlmStatus,
  selectedAiProvider,
  status
}: {
  localLlmStatus: LocalLlmStatus | null;
  selectedAiProvider: AiProvider;
  status: OnboardingStatus;
}) {
  if (selectedAiProvider === 'cloud') {
    return Boolean(status.pi.connected);
  }

  const localRecommendedModel = status.ai?.recommended === 'local' ? status.ai.recommendedModel : null;
  const caulLocalStatus = localLlmStatus ?? getCaulLocalLlmStatus(status);

  return Boolean(
    caulLocalStatus?.runtime.installed
    && caulLocalStatus.model?.installed
    && (!localRecommendedModel || caulLocalStatus.model.id === localRecommendedModel.id)
  );
}

function OnboardingPanel({
  children,
  description,
  sectionRef,
  title
}: {
  children: ReactNode;
  description?: string;
  sectionRef?: RefObject<HTMLElement | null>;
  title: string;
}) {
  const titleId = useId();

  return (
    <section ref={sectionRef} aria-labelledby={titleId} className="h-full">
      <Card className="h-full" size="sm">
        <CardHeader>
          <CardTitle aria-level={2} id={titleId} role="heading">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

function StatusRow({
  action,
  label,
  ready,
  value
}: {
  action?: ReactNode;
  label: string;
  ready: boolean;
  value?: string;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 py-2 text-sm last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {value ? <div aria-live="polite" className="text-xs text-muted-foreground">{value}</div> : null}
      </div>
      {action ?? (
        <Badge variant={ready ? 'default' : 'destructive'}>
          {ready ? <CheckCircle2Icon data-icon="inline-start" /> : <XCircleIcon data-icon="inline-start" />}
          {ready ? 'Ready' : 'Needs attention'}
        </Badge>
      )}
    </div>
  );
}

function AiProviderSetup({
  isChatGptSigningIn,
  isCloudAiReady,
  llmModel = defaultLlmModel,
  llmReasoning = defaultLlmReasoning,
  localAiSetupPhase,
  localLlmStatus,
  onCancelLocalDownload,
  onCloudStatusChange,
  onDownloadLocalAi,
  onSelectProvider,
  onSignInWithChatGpt,
  selectedProvider,
  showCloudProviderCards = false,
  status
}: {
  isChatGptSigningIn: boolean;
  isCloudAiReady: boolean;
  llmModel?: LlmModel;
  llmReasoning?: LlmReasoning;
  localAiSetupPhase: 'requesting' | 'downloading' | 'idle';
  localLlmStatus: LocalLlmStatus | null;
  onCancelLocalDownload: () => void;
  onCloudStatusChange?: () => Promise<void> | void;
  onDownloadLocalAi: (modelId?: string) => void;
  onSelectProvider: (provider: AiProvider) => void;
  onSignInWithChatGpt: CloudSignInHandler;
  selectedProvider: AiProvider;
  showCloudProviderCards?: boolean;
  status: OnboardingStatus | null;
}) {
  const ai = status?.ai;
  const localRecommendedModel = ai?.recommended === 'local' ? ai.recommendedModel : null;
  const caulLocalStatus = localLlmStatus ?? getCaulLocalLlmStatus(status);
  const localModelInstalled = Boolean(
    caulLocalStatus?.runtime.installed
    && caulLocalStatus.model?.installed
    && (!localRecommendedModel || caulLocalStatus.model.id === localRecommendedModel.id)
  );
  const localAiInfo = localRecommendedModel || caulLocalStatus?.model
    ? <LocalAiRecommendationInfoButton embedded recommendation={ai} status={caulLocalStatus} />
    : null;
  const cloudAiInfo = <CloudAiInfoButton llmModel={llmModel} llmReasoning={llmReasoning} />;

  return (
    <Tabs className="grid gap-3" value={selectedProvider}>
      <div className="flex min-w-0 items-center gap-2">
        <TabsList aria-label="AI provider" className="h-auto w-full p-0.5">
          {(['local', 'cloud'] as AiProvider[]).map((provider) => (
            <TabsTrigger
              key={provider}
              aria-label={provider === 'local' ? 'Local' : 'Cloud'}
              className="h-9 px-3"
              onClick={() => onSelectProvider(provider)}
              value={provider}
            >
              <span>{provider === 'local' ? 'Local' : 'Cloud'}</span>
              {ai?.recommended === provider ? (
                <RecommendedMarker selected={selectedProvider === provider} />
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {ai?.recommended && ai.recommended !== 'none' ? (
          <SettingInfoButton
            label="Why this is recommended"
            message={getAiProviderRecommendationMessage(ai.recommended)}
          />
        ) : null}
      </div>

      <TabsContent className="grid gap-3" value="local">
        {selectedProvider === 'local' ? (
          <>
          <p className="text-sm leading-5 text-muted-foreground">
            Data stays local and private. Slower and less intelligent than Cloud.
          </p>
          <LocalAiDownloadControl
            align="start"
            info={localAiInfo}
            isInstalled={localModelInstalled}
            localAiSetupPhase={localAiSetupPhase}
            onCancel={onCancelLocalDownload}
            onDownload={() => onDownloadLocalAi(localRecommendedModel?.id)}
            setupLabel="Local AI setup"
            statusPlacement="inline"
            status={caulLocalStatus}
          />
          </>
        ) : null}
      </TabsContent>
      <TabsContent className="grid gap-3" value="cloud">
        {selectedProvider === 'cloud' ? (
          showCloudProviderCards ? (
            <CloudProviderOnboarding
              compact
              info={cloudAiInfo}
              isChatGptReady={Boolean(status?.pi.chatGptConnected)}
              isChatGptSigningIn={isChatGptSigningIn}
              onCloudStatusChange={onCloudStatusChange}
              onSignInWithChatGpt={onSignInWithChatGpt}
              piStatus={status?.pi ?? null}
            />
          ) : (
            <>
              <p className="text-sm leading-5 text-muted-foreground">
                Sends to a cloud model like ChatGPT. Faster and smarter than Local.
              </p>
              <CloudSignInControl
                align="start"
                info={cloudAiInfo}
                isReady={isCloudAiReady}
                isSigningIn={isChatGptSigningIn}
                onSignIn={onSignInWithChatGpt}
                setupLabel="Cloud AI setup"
                statusPlacement="inline"
              />
            </>
          )
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

function CloudProviderOnboarding({
  compact = false,
  info,
  isChatGptReady,
  isChatGptSigningIn,
  onCloudStatusChange,
  onSignInWithChatGpt,
  piStatus
}: {
  compact?: boolean;
  info?: ReactNode;
  isChatGptReady: boolean;
  isChatGptSigningIn: boolean;
  onCloudStatusChange?: () => Promise<void> | void;
  onSignInWithChatGpt: CloudSignInHandler;
  piStatus: PiStatus | null;
}) {
  const [apiKey, setApiKey] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');
  const [apiKeyProviderId, setApiKeyProviderId] = useState<CloudApiKeyProviderId | null>(null);
  const [apiKeyProviderIdToRemove, setApiKeyProviderIdToRemove] = useState<CloudApiKeyProviderId | null>(null);
  const [isRemovingApiKey, setIsRemovingApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [signInError, setSignInError] = useState('');
  const [selectedCloudSetupMethod, setSelectedCloudSetupMethod] = useState<'api-key' | 'sign-in'>('sign-in');
  const [selectedApiKeyProviderId, setSelectedApiKeyProviderId] = useState<CloudApiKeyProviderId>('openai');
  const [selectedSubscriptionProviderId, setSelectedSubscriptionProviderId] = useState<CloudSubscriptionProviderId>('openai-codex');
  const apiKeyProviderSelectId = useId();
  const subscriptionProviderSelectId = useId();
  const apiKeyProvider = cloudApiKeyProviders.find((provider) => provider.id === apiKeyProviderId) ?? null;
  const apiKeyProviderToRemove = cloudApiKeyProviders.find((provider) => provider.id === apiKeyProviderIdToRemove) ?? null;
  const apiKeyStatus = piStatus?.apiKeys;
  const selectedApiKeyProvider = cloudApiKeyProviders.find((provider) => provider.id === selectedApiKeyProviderId)
    ?? cloudApiKeyProviders[0];
  const selectedApiKeyProviderStatus = apiKeyStatus?.providers.find((provider) => provider.id === selectedApiKeyProviderId);
  const selectedApiKeyConfigured = Boolean(selectedApiKeyProviderStatus?.configured);
  const selectedApiKeyActive = selectedApiKeyConfigured
    && piStatus?.connected
    && piStatus.selectedProvider === selectedApiKeyProviderId;
  const selectedSubscriptionProvider = cloudSubscriptionProviders.find((provider) => provider.id === selectedSubscriptionProviderId)
    ?? cloudSubscriptionProviders[0];
  const selectedSubscriptionIsChatGpt = selectedSubscriptionProvider.id === 'openai-codex';
  const selectedSubscriptionConnected = selectedSubscriptionIsChatGpt && isChatGptReady;
  const selectedSubscriptionActive = selectedSubscriptionConnected
    && piStatus?.connected
    && piStatus.selectedProvider === selectedSubscriptionProvider.id;
  const subscriptionProviderItems = cloudSubscriptionProviders.map((provider) => ({
    label: `${provider.name} · ${provider.product}`,
    value: provider.id
  }));
  const apiKeyProviderItems = cloudApiKeyProviders.map((provider) => ({
    label: `${provider.name} · ${provider.product}`,
    value: provider.id
  }));

  useEffect(() => {
    const selectedProvider = piStatus?.selectedProvider;

    if (cloudApiKeyProviders.some((provider) => provider.id === selectedProvider)) {
      setSelectedApiKeyProviderId(selectedProvider as CloudApiKeyProviderId);
      return;
    }

    const configuredProvider = apiKeyStatus?.providers.find((provider) => provider.configured);

    if (configuredProvider) {
      setSelectedApiKeyProviderId(configuredProvider.id);
    }
  }, [apiKeyStatus?.providers, piStatus?.selectedProvider]);

  function closeApiKeyDialog() {
    setApiKey('');
    setApiKeyError('');
    setApiKeyProviderId(null);
    setIsSavingApiKey(false);
  }

  async function signInWithChatGpt() {
    setSignInError('');
    const result = await onSignInWithChatGpt();
    setSignInError(getChatGptSignInError(result));
  }

  async function saveApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!apiKeyProviderId || isSavingApiKey) {
      return;
    }

    setApiKeyError('');
    setIsSavingApiKey(true);

    try {
      await getSettingsBridge()?.ai?.saveApiKey(apiKeyProviderId, apiKey);
      await onCloudStatusChange?.();
      closeApiKeyDialog();
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : String(error));
      setIsSavingApiKey(false);
    }
  }

  async function useCloudModel(providerId: string, defaultModel: string) {
    try {
      await getSettingsBridge()?.ai?.saveModel(defaultModel);
      await onCloudStatusChange?.();
    } catch (error) {
      console.error(`Failed to select ${providerId} API key:`, error);
    }
  }

  async function removeSavedApiKey(providerId: CloudApiKeyProviderId) {
    setIsRemovingApiKey(true);

    try {
      await getSettingsBridge()?.ai?.removeApiKey(providerId);
      await onCloudStatusChange?.();
      setApiKeyProviderIdToRemove(null);
    } catch (error) {
      console.error(`Failed to remove ${providerId} API key:`, error);
    } finally {
      setIsRemovingApiKey(false);
    }
  }

  return (
    <>
      {compact ? (
        <FieldGroup aria-label="Cloud AI setup" className="gap-3" role="group">
          <ToggleGroup
            aria-label="Cloud setup method"
            className="grid w-full grid-cols-2"
            onValueChange={(value) => {
              const nextMethod = value.at(-1);
              if (nextMethod) {
                setSelectedCloudSetupMethod(nextMethod as 'api-key' | 'sign-in');
              }
            }}
            spacing={2}
            value={[selectedCloudSetupMethod]}
            variant="outline"
          >
            <ToggleGroupItem className="w-full" value="sign-in">Sign in</ToggleGroupItem>
            <ToggleGroupItem className="w-full" value="api-key">API key</ToggleGroupItem>
          </ToggleGroup>

          {selectedCloudSetupMethod === 'sign-in' ? (
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel className="sr-only" htmlFor={subscriptionProviderSelectId}>Sign-in provider</FieldLabel>
                <Select
                  items={subscriptionProviderItems}
                  name="subscription-provider"
                  onValueChange={(value) => setSelectedSubscriptionProviderId(value as CloudSubscriptionProviderId)}
                  value={selectedSubscriptionProviderId}
                >
                  <SelectTrigger aria-label="Sign-in provider" className="w-full" id={subscriptionProviderSelectId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {subscriptionProviderItems.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Button
                  className="w-full"
                  disabled={!selectedSubscriptionProvider.available || isChatGptSigningIn || selectedSubscriptionActive}
                  onClick={selectedSubscriptionConnected
                    ? () => void useCloudModel('openai-codex', defaultLlmModel)
                    : () => void signInWithChatGpt()}
                  type="button"
                >
                  {isChatGptSigningIn ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
                  {isChatGptSigningIn
                    ? 'Opening'
                    : selectedSubscriptionActive
                      ? 'ChatGPT is ready'
                      : selectedSubscriptionConnected
                        ? 'Use ChatGPT'
                        : `Sign in with ${selectedSubscriptionProvider.product}`}
                </Button>
              </Field>
              {signInError ? (
                <Alert role="alert" variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>{signInError}</AlertTitle>
                </Alert>
              ) : null}
            </FieldGroup>
          ) : (
            <FieldGroup className="gap-3">
              <Field data-disabled={!apiKeyStatus?.available || undefined}>
                <FieldLabel className="sr-only" htmlFor={apiKeyProviderSelectId}>API provider</FieldLabel>
                <Select
                  disabled={!apiKeyStatus?.available}
                  items={apiKeyProviderItems}
                  name="api-key-provider"
                  onValueChange={(value) => setSelectedApiKeyProviderId(value as CloudApiKeyProviderId)}
                  value={selectedApiKeyProviderId}
                >
                  <SelectTrigger aria-label="API provider" className="w-full" id={apiKeyProviderSelectId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {apiKeyProviderItems.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Button
                  className="w-full"
                  disabled={!apiKeyStatus?.available}
                  onClick={selectedApiKeyConfigured && !selectedApiKeyActive
                    ? () => void useCloudModel(
                      selectedApiKeyProvider.id,
                      selectedApiKeyProviderStatus?.defaultModel ?? ''
                    )
                    : () => setApiKeyProviderId(selectedApiKeyProvider.id)}
                  type="button"
                >
                  {selectedApiKeyConfigured
                    ? selectedApiKeyActive
                      ? `Replace ${selectedApiKeyProvider.name} API key`
                      : `Use ${selectedApiKeyProvider.name}`
                    : `Add ${selectedApiKeyProvider.name} API key`}
                </Button>
              </Field>
            </FieldGroup>
          )}
        </FieldGroup>
      ) : (
        <FieldGroup aria-label="Cloud AI setup" className="gap-4" role="group">
          <FieldDescription>
            Sends to a cloud model like ChatGPT. Faster and smarter than Local.
          </FieldDescription>
          <FieldDescription>
            Connect a subscription first, or use an API key from a supported first-party provider.
          </FieldDescription>
          <Alert>
            <ShieldCheckIcon />
            <AlertTitle>Your credentials stay on this computer</AlertTitle>
            <AlertDescription>
              Sign-in opens in your browser. API keys are encrypted with the operating system and are never shown again.
            </AlertDescription>
          </Alert>

          <FieldSet className="gap-3">
            <FieldLegend variant="label">Sign in with a subscription</FieldLegend>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor={subscriptionProviderSelectId}>Subscription provider</FieldLabel>
                <Select
                  items={subscriptionProviderItems}
                  name="subscription-provider"
                  onValueChange={(value) => setSelectedSubscriptionProviderId(value as CloudSubscriptionProviderId)}
                  value={selectedSubscriptionProviderId}
                >
                  <SelectTrigger className="w-full" id={subscriptionProviderSelectId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {subscriptionProviderItems.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{selectedSubscriptionProvider.description}</FieldDescription>
                <div className="flex items-center gap-2" aria-live="polite">
                  {selectedSubscriptionActive ? (
                    <Badge>
                      <CheckCircle2Icon data-icon="inline-start" />
                      Ready
                    </Badge>
                  ) : selectedSubscriptionConnected ? (
                    <Badge variant="secondary">Connected</Badge>
                  ) : selectedSubscriptionProvider.available ? (
                    <FieldDescription>
                      {isChatGptSigningIn ? 'Opening ChatGPT sign in...' : 'Not signed in'}
                    </FieldDescription>
                  ) : (
                    <Badge variant="secondary">Coming next</Badge>
                  )}
                  {selectedSubscriptionIsChatGpt ? info : null}
                </div>
              </Field>
              <Field>
                <Button
                  className="w-full"
                  disabled={!selectedSubscriptionProvider.available || isChatGptSigningIn || selectedSubscriptionActive}
                  onClick={selectedSubscriptionConnected
                    ? () => void useCloudModel('openai-codex', defaultLlmModel)
                    : () => void signInWithChatGpt()}
                  type="button"
                >
                  {isChatGptSigningIn ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
                  {isChatGptSigningIn
                    ? 'Opening'
                    : selectedSubscriptionActive
                      ? 'ChatGPT is ready'
                      : selectedSubscriptionConnected
                        ? 'Use ChatGPT'
                        : `Sign in with ${selectedSubscriptionProvider.product}`}
                </Button>
              </Field>
              {signInError ? (
                <Alert role="alert" variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>{signInError}</AlertTitle>
                </Alert>
              ) : null}
            </FieldGroup>
          </FieldSet>

          <Separator />

          <FieldSet className="gap-3">
            <FieldLegend variant="label">Use an API key</FieldLegend>
            <FieldDescription>
              API usage is billed separately by the provider. GitHub Copilot is not included because it does not use a first-party model API key.
            </FieldDescription>
            <FieldGroup className="gap-3">
              <Field data-disabled={!apiKeyStatus?.available || undefined}>
                <FieldLabel htmlFor={apiKeyProviderSelectId}>API provider</FieldLabel>
                <Select
                  disabled={!apiKeyStatus?.available}
                  items={apiKeyProviderItems}
                  name="api-key-provider"
                  onValueChange={(value) => setSelectedApiKeyProviderId(value as CloudApiKeyProviderId)}
                  value={selectedApiKeyProviderId}
                >
                  <SelectTrigger className="w-full" id={apiKeyProviderSelectId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {apiKeyProviderItems.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2" aria-live="polite">
                  {selectedApiKeyActive ? (
                    <Badge>In use</Badge>
                  ) : selectedApiKeyConfigured ? (
                    <Badge variant="secondary">Saved</Badge>
                  ) : null}
                  <FieldDescription>
                    {selectedApiKeyActive
                      ? 'This API key is in use.'
                      : selectedApiKeyConfigured
                        ? 'API key saved securely.'
                        : 'No API key saved.'}
                  </FieldDescription>
                </div>
              </Field>
              <Field>
                <div
                  aria-label={`${selectedApiKeyProvider.name} ${selectedApiKeyProvider.product} API key controls`}
                  className="flex flex-wrap gap-2"
                  role="group"
                >
                  {selectedApiKeyConfigured && !selectedApiKeyActive ? (
                    <Button
                      onClick={() => void useCloudModel(
                        selectedApiKeyProvider.id,
                        selectedApiKeyProviderStatus?.defaultModel ?? ''
                      )}
                      type="button"
                    >
                      Use {selectedApiKeyProvider.name}
                    </Button>
                  ) : null}
                  <Button
                    className={cn(!selectedApiKeyConfigured && 'w-full')}
                    disabled={!apiKeyStatus?.available}
                    onClick={() => setApiKeyProviderId(selectedApiKeyProvider.id)}
                    type="button"
                    variant={selectedApiKeyConfigured ? 'outline' : 'default'}
                  >
                    {selectedApiKeyConfigured
                      ? `Replace ${selectedApiKeyProvider.name} API key`
                      : `Add ${selectedApiKeyProvider.name} API key`}
                  </Button>
                  {selectedApiKeyConfigured ? (
                    <Button
                      onClick={() => setApiKeyProviderIdToRemove(selectedApiKeyProvider.id)}
                      type="button"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </Field>
            </FieldGroup>
            {!apiKeyStatus?.available && apiKeyStatus?.message ? (
              <FieldDescription role="alert">{apiKeyStatus.message}</FieldDescription>
            ) : null}
          </FieldSet>
        </FieldGroup>
      )}

      <Dialog
        open={Boolean(apiKeyProvider)}
        onOpenChange={(open) => {
          if (!open) {
            closeApiKeyDialog();
          }
        }}
      >
        <DialogContent>
          <form className="flex flex-col gap-6" onSubmit={(event) => void saveApiKey(event)}>
            <DialogHeader>
              <DialogTitle>{apiKeyProvider ? `${apiKeyProvider.name} API key` : 'API key'}</DialogTitle>
              {!compact ? (
                <DialogDescription>
                  The key is encrypted using this computer’s operating-system credential storage. Caul will not display it after saving.
                </DialogDescription>
              ) : null}
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={Boolean(apiKeyError) || undefined}>
                <FieldLabel htmlFor="cloud-api-key">API key</FieldLabel>
                <Input
                  aria-invalid={Boolean(apiKeyError) || undefined}
                  autoComplete="off"
                  autoFocus
                  id="cloud-api-key"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste API key"
                  required
                  spellCheck={false}
                  type="password"
                  value={apiKey}
                />
                {!compact ? (
                  <FieldDescription>The key goes directly to the selected provider when Caul makes a request.</FieldDescription>
                ) : null}
                <FieldError>{apiKeyError}</FieldError>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <DialogClose render={<Button disabled={isSavingApiKey} type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button disabled={isSavingApiKey || !apiKey.trim()} type="submit">
                {isSavingApiKey ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
                {isSavingApiKey ? 'Saving' : 'Save API key'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(apiKeyProviderToRemove)}
        onOpenChange={(open) => {
          if (!open && !isRemovingApiKey) {
            setApiKeyProviderIdToRemove(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {apiKeyProviderToRemove ? `Remove ${apiKeyProviderToRemove.name} API key?` : 'Remove API key?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Caul will permanently delete the encrypted key from this computer. This does not revoke or delete the key in your provider account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemovingApiKey}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemovingApiKey || !apiKeyProviderIdToRemove}
              onClick={() => apiKeyProviderIdToRemove && void removeSavedApiKey(apiKeyProviderIdToRemove)}
              variant="destructive"
            >
              {isRemovingApiKey ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              {isRemovingApiKey ? 'Removing' : 'Remove key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LocalAiDownloadControl({
  align = 'center',
  info,
  isInstalled,
  localAiSetupPhase,
  onCancel,
  onDownload,
  setupLabel,
  showIdleStatus = true,
  statusPlacement = 'below',
  status
}: {
  align?: 'center' | 'start';
  info?: ReactNode;
  isInstalled: boolean;
  localAiSetupPhase: 'requesting' | 'downloading' | 'idle';
  onCancel: () => void;
  onDownload: () => void;
  setupLabel?: string;
  showIdleStatus?: boolean;
  statusPlacement?: 'below' | 'inline';
  status: LocalLlmStatus | null;
}) {
  const isDownloading = status?.status === 'downloading' || localAiSetupPhase === 'requesting' || localAiSetupPhase === 'downloading';
  const lastDetailedProgressRef = useRef<{ accessibleLabel: string; label: string } | null>(null);
  const progress = getLocalAiDownloadProgressLabel(status?.progress, localAiSetupPhase);
  if (isDownloading && status?.progress && typeof status.progress.percent === 'number') {
    lastDetailedProgressRef.current = progress;
  } else if (!isDownloading) {
    lastDetailedProgressRef.current = null;
  }
  const displayProgress = isDownloading && !status?.progress && lastDetailedProgressRef.current
    ? lastDetailedProgressRef.current
    : progress;
  const alignmentClassName = align === 'start' ? 'justify-items-start text-left' : 'justify-items-center text-center';
  const progressClassName = align === 'start'
    ? 'max-w-sm text-sm leading-5 text-muted-foreground'
    : 'max-w-sm text-center text-sm leading-5 text-muted-foreground';
  const actionClassName = `inline-flex items-center gap-1.5 ${align === 'start' ? '' : 'justify-center'}`;
  const rootClassName = statusPlacement === 'inline'
    ? `flex min-h-10 flex-wrap items-center gap-3 ${align === 'start' ? 'justify-start text-left' : 'justify-center text-center'}`
    : !showIdleStatus && !isDownloading && !isInstalled && status?.runtime.supported !== false
      ? `inline-flex min-h-10 items-center ${align === 'start' ? '' : 'justify-center'}`
    : `grid min-h-10 gap-1 ${alignmentClassName}`;
  const inlineProgressClassName = align === 'start'
    ? 'min-w-0 text-sm leading-5 text-muted-foreground'
    : 'min-w-0 text-center text-sm leading-5 text-muted-foreground';

  if (isInstalled) {
    return (
      <div aria-label={setupLabel} className={rootClassName} role={setupLabel ? 'group' : undefined}>
        <div className={actionClassName}>
          <ReadySetupPill info={info} />
        </div>
      </div>
    );
  }

  if (status?.runtime.supported === false) {
    return (
      <div aria-label={setupLabel} className={rootClassName} role={setupLabel ? 'group' : undefined}>
        <div className={actionClassName}>
          <UnavailableSetupPill info={info} />
        </div>
      </div>
    );
  }

  if (isDownloading) {
    return (
      <div aria-label={setupLabel} className={rootClassName} role={setupLabel ? 'group' : undefined}>
        <div className={actionClassName}>
          <Button onClick={onCancel} size="default" type="button" variant="outline">
            Cancel
          </Button>
          {info}
        </div>
        <Progress
          aria-label={displayProgress.accessibleLabel}
          className="w-full max-w-sm"
          value={status?.progress?.percent ?? null}
        >
          <ProgressLabel className="sr-only">Download local AI</ProgressLabel>
          <ProgressValue>{() => displayProgress.label}</ProgressValue>
        </Progress>
      </div>
    );
  }

  return (
    <div aria-label={setupLabel} className={rootClassName} role={setupLabel ? 'group' : undefined}>
      <div className={actionClassName}>
        <LocalAiDownloadAction
          disabled={!status?.runtime.supported && Boolean(status)}
          info={info}
          onDownload={onDownload}
          tradeoffInfo={!showIdleStatus ? {
            label: 'Local AI tradeoff details',
            message: 'Local AI keeps prompts and transcript context on this computer, but it needs a model download and may be slower than Cloud.'
          } : undefined}
        />
      </div>
      {showIdleStatus ? (
        <p aria-live="polite" className={statusPlacement === 'inline' ? inlineProgressClassName : progressClassName}>
          Not downloaded yet
        </p>
      ) : null}
    </div>
  );
}

function LocalAiDownloadAction({
  disabled = false,
  info,
  onDownload,
  tradeoffInfo
}: {
  disabled?: boolean;
  info?: ReactNode;
  onDownload?: () => void;
  tradeoffInfo?: {
    label: string;
    message: string;
  };
}) {
  const combinedInfo = getCombinedLocalAiDownloadInfo(info, tradeoffInfo);

  return (
    <div className="relative inline-flex shrink-0 items-center gap-1.5">
      <Button
        aria-label="Download local AI"
        disabled={disabled}
        onClick={onDownload}
        type="button"
      >
        <span>Download local AI</span>
      </Button>
      {combinedInfo}
      {!combinedInfo && tradeoffInfo ? (
        <IssueActionInfoIcon label={tradeoffInfo.label} message={tradeoffInfo.message} />
      ) : null}
    </div>
  );
}

function getCombinedLocalAiDownloadInfo(
  info: ReactNode,
  tradeoffInfo?: {
    label: string;
    message: string;
  }
) {
  if (!tradeoffInfo) {
    return info;
  }

  if (isValidElement<{ extraContent?: ReactNode }>(info) && info.type === LocalAiRecommendationInfoButton) {
    return cloneElement(info, {
      extraContent: (
        <LocalAiTradeoffInfoContent
          label="Why Local"
          message={tradeoffInfo.message}
        />
      )
    });
  }

  return info;
}

function LocalAiIssueRecovery({
  localAiSetupPhase,
  localLlmStatus,
  onCancelLocalDownload,
  onDownloadLocalAi,
  status
}: {
  localAiSetupPhase: 'requesting' | 'downloading' | 'idle';
  localLlmStatus: LocalLlmStatus | null;
  onCancelLocalDownload: () => void;
  onDownloadLocalAi: () => void;
  status: OnboardingStatus | null;
}) {
  const localRecommendedModel = status?.ai?.recommended === 'local' ? status.ai.recommendedModel : null;
  const caulLocalStatus = localLlmStatus ?? getCaulLocalLlmStatus(status);
  const localModelInstalled = Boolean(
    caulLocalStatus?.runtime.installed
    && caulLocalStatus.model?.installed
    && (!localRecommendedModel || caulLocalStatus.model.id === localRecommendedModel.id)
  );
  const localAiInfo = localRecommendedModel || caulLocalStatus?.model
    ? <LocalAiRecommendationInfoButton embedded recommendation={status?.ai} status={caulLocalStatus} />
    : null;

  return (
    <LocalAiDownloadControl
      align="center"
      info={localAiInfo}
      isInstalled={localModelInstalled}
      localAiSetupPhase={localAiSetupPhase}
      onCancel={onCancelLocalDownload}
      onDownload={onDownloadLocalAi}
      setupLabel="Local AI setup"
      showIdleStatus={false}
      status={caulLocalStatus}
    />
  );
}

function IssueActionInfoIcon({
  label,
  message
}: {
  label: string;
  message: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button
          aria-label={label}
          size="icon-xs"
          type="button"
          variant="ghost"
        />}
      >
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent className="w-72" side="top">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

function CloudSignInControl({
  align = 'center',
  disabled = false,
  info,
  isReady,
  isSigningIn,
  onSignIn,
  setupLabel,
  statusPlacement = 'below'
}: {
  align?: 'center' | 'start';
  disabled?: boolean;
  info?: ReactNode;
  isReady: boolean;
  isSigningIn: boolean;
  onSignIn: CloudSignInHandler;
  setupLabel?: string;
  statusPlacement?: 'below' | 'inline';
}) {
  const [signInError, setSignInError] = useState('');
  const alignmentClassName = align === 'start' ? 'justify-items-start text-left' : 'justify-items-center text-center';
  const statusClassName = align === 'start'
    ? 'max-w-sm text-sm leading-5 text-muted-foreground'
    : 'max-w-sm text-center text-sm leading-5 text-muted-foreground';
  const actionClassName = `inline-flex items-center gap-1.5 ${align === 'start' ? '' : 'justify-center'}`;
  const rootClassName = statusPlacement === 'inline'
    ? `flex min-h-10 flex-wrap items-center gap-3 ${align === 'start' ? 'justify-start text-left' : 'justify-center text-center'}`
    : `grid min-h-10 gap-1 ${alignmentClassName}`;
  const inlineStatusClassName = align === 'start'
    ? 'min-w-0 text-sm leading-5 text-muted-foreground'
    : 'min-w-0 text-center text-sm leading-5 text-muted-foreground';

  async function signIn() {
    setSignInError('');
    const result = await onSignIn();
    setSignInError(getChatGptSignInError(result));
  }

  if (isReady) {
    return (
      <div aria-label={setupLabel} className={rootClassName} role={setupLabel ? 'group' : undefined}>
        <div className={actionClassName}>
          <ReadySetupPill info={info} />
        </div>
      </div>
    );
  }

  return (
    <div aria-label={setupLabel} className={rootClassName} role={setupLabel ? 'group' : undefined}>
      <div className={actionClassName}>
        <Button disabled={disabled || isSigningIn} onClick={() => void signIn()} type="button">
          {isSigningIn ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
          {isSigningIn ? 'Opening' : 'Sign in with ChatGPT'}
        </Button>
        {info}
      </div>
      <p aria-live="polite" className={statusPlacement === 'inline' ? inlineStatusClassName : statusClassName}>
        {isSigningIn ? 'Opening ChatGPT sign in...' : 'Not signed in'}
      </p>
      {signInError ? (
        <Alert className="max-w-sm" role="alert" variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{signInError}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}

function ModelAutoUpdateCheckbox({
  checked,
  description,
  id,
  info,
  label,
  onCheckedChange
}: {
  checked: boolean;
  description?: string;
  id: string;
  info?: string;
  label: string;
  onCheckedChange: (enabled: boolean) => void;
}) {
  return (
    <Field className="w-auto self-start" orientation="horizontal">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
      <FieldContent>
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {info ? <SettingInfoButton label={`${label} info`} message={info} /> : null}
        </div>
        {description ? (
          <FieldDescription className="max-w-xl">
            {description}
          </FieldDescription>
        ) : null}
      </FieldContent>
    </Field>
  );
}

function SettingInfoButton({
  label,
  message
}: {
  label: string;
  message: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button
          aria-label={label}
          size="icon-xs"
          type="button"
          variant="ghost"
        />}
      >
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent className="w-64" side="bottom">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

function EmbeddedInfoTooltip({
  children,
  label,
  side = 'top'
}: {
  children: ReactNode;
  label: string;
  side?: TooltipSide;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button
          aria-label={label}
          size="icon-xs"
          type="button"
          variant="ghost"
        />}
      >
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent className="w-72" side={side}>
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function RecommendedMarker({
  selected = false
}: {
  selected?: boolean;
}) {
  return (
    <Badge aria-label={recommendedPillLabel} className="size-5 p-0" variant={selected ? 'default' : 'secondary'}>
      <StarIcon aria-hidden="true" fill="currentColor" />
    </Badge>
  );
}

function TruncatedTextTooltip({
  children,
  className,
  tooltip
}: {
  children: ReactNode;
  className?: string;
  tooltip: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  function updateTruncation() {
    const element = textRef.current;

    if (!element) {
      return;
    }

    setIsTruncated(element.scrollWidth > element.clientWidth + 1);
  }

  useLayoutEffect(() => {
    const element = textRef.current;

    if (!element) {
      return;
    }

    updateTruncation();

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateTruncation);
    resizeObserver?.observe(element);
    window.addEventListener('resize', updateTruncation);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateTruncation);
    };
  }, [children]);

  const label = (
    <span
      ref={textRef}
      className={className}
      onFocus={updateTruncation}
      onMouseEnter={updateTruncation}
      onPointerEnter={updateTruncation}
    >
      {children}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={label} />
      {isTruncated ? (
        <TooltipContent className="max-w-64 truncate" side="bottom">
          {tooltip}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

function getAiProviderRecommendationMessage(provider: AiProvider) {
  return provider === 'local' ? recommendedLocalAiPillMessage : recommendedCloudAiPillMessage;
}

function LocalAiRecommendationInfoButton({
  embedded = false,
  extraContent,
  recommendation,
  status
}: {
  embedded?: boolean;
  extraContent?: ReactNode;
  recommendation: AiRecommendation | null | undefined;
  status?: LocalLlmStatus | null;
}) {
  const model = recommendation?.recommended === 'local' ? recommendation.recommendedModel : null;
  const runtime = recommendation?.resources.localRuntimes?.caulLlamaCpp ?? recommendation?.localRuntime ?? status;
  const modelName = model?.name ?? runtime?.model?.name ?? status?.model?.name ?? 'Recommended local AI';
  const sizeGb = model?.downloadSizeGb ?? runtime?.model?.sizeGb ?? status?.model?.sizeGb;
  const trigger = embedded ? (
    null
  ) : (
    <Button
      aria-label="Local AI recommendation details"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      <InfoIcon />
    </Button>
  );
  const content = (
    <dl className="grid gap-2 text-xs">
      <div className="grid gap-0.5">
        <dt className="font-medium text-primary-foreground">Model</dt>
        <dd className="text-primary-foreground/80">{modelName}</dd>
      </div>
      <div className="grid gap-0.5">
        <dt className="font-medium text-primary-foreground">Download size</dt>
        <dd className="text-primary-foreground/80">{typeof sizeGb === 'number' ? `About ${sizeGb.toFixed(1)} GB` : 'Shown when available'}</dd>
      </div>
      {extraContent}
    </dl>
  );

  if (embedded) {
    return (
      <EmbeddedInfoTooltip label="Local AI recommendation details" side="top">
        {content}
      </EmbeddedInfoTooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={trigger!} />
      <TooltipContent align="end" className="w-72" side="top">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function LocalAiTradeoffInfoContent({
  label,
  message
}: {
  label: string;
  message: string;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="font-medium text-primary-foreground">{label}</dt>
      <dd className="text-primary-foreground/80">{message}</dd>
    </div>
  );
}

function CloudAiInfoButton({
  llmModel,
  llmReasoning
}: {
  llmModel: LlmModel;
  llmReasoning: LlmReasoning;
}) {
  const modelLabel = llmModels.find((model) => model.value === llmModel)?.label ?? llmModel;
  const reasoningLabel = llmReasoningLevels.find((reasoning) => reasoning.value === llmReasoning)?.label ?? llmReasoning;

  return (
    <EmbeddedInfoTooltip label="Cloud AI model details" side="top">
      <dl className="grid gap-2 text-xs">
        <div className="grid gap-0.5">
          <dt className="font-medium text-primary-foreground">Model</dt>
          <dd className="text-primary-foreground/80">{modelLabel}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="font-medium text-primary-foreground">Reasoning</dt>
          <dd className="text-primary-foreground/80">{reasoningLabel}</dd>
        </div>
      </dl>
    </EmbeddedInfoTooltip>
  );
}

function formatReviewedDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatCatalogueRefreshStatus(result: ModelCatalogueRefreshResult | null) {
  if (!result) {
    return 'Refresh available local transcription and local AI model recommendations.';
  }

  const failedSources = result.sourceReports.filter((report) => !report.ok).length;
  const checkedSources = result.sourceReports.length;
  const sourceText = checkedSources === 1 ? '1 source checked' : `${checkedSources} sources checked`;
  const failureText = failedSources > 0
    ? `, ${failedSources} could not be reached`
    : '';

  return `Local AI Catalogue refreshed ${formatReviewedDate(result.reviewedAt)}. ${sourceText}${failureText}.`;
}

function getCaulLocalLlmStatus(status: OnboardingStatus | null): LocalLlmStatus | null {
  const runtime = status?.ai.resources.localRuntimes?.caulLlamaCpp;

  return runtime?.provider === 'caul-llama.cpp' || runtime?.provider === 'caul-mlx' ? runtime : null;
}

function getLocalAiPlaceholderStatusText(status: LocalLlmStatus | null) {
  if (!status) {
    return null;
  }

  if (status.status === 'warming') {
    return 'Preparing local AI...';
  }

  if (status.status === 'warm' || status.status === 'ready') {
    return 'Local AI ready';
  }

  if (status.status === 'error') {
    return 'Local AI warm-up failed';
  }

  if (status.status === 'missing') {
    return 'Local AI needs setup';
  }

  return null;
}

function OnboardingTranscriptionStatus({ status }: { status: OnboardingStatus | null }) {
  if (!status) {
    return (
      <StatusRow
        action={<Spinner />}
        label="Checking transcription setup"
        ready={false}
      />
    );
  }

  const isReady = isOnboardingTranscriptionModelReady(status);
  const downloadProgress = getLocalModelDownloadProgressLabel(status.parakeet.progress);
  const canAutoDownload = status.transcription.recommended !== 'cloud'
    && Boolean(status.transcription.recommendedModel?.id)
    && status.transcription.autoDownloadModel !== false
    && status.transcription.autoDownloadParakeet !== false;

  if (isReady) {
    return (
      <StatusRow
        action={<ReadySetupPill size="action" />}
        label="Local transcription"
        ready
      />
    );
  }

  if (status.parakeet.status === 'downloading') {
    return (
      <StatusRow
        action={(
          <span aria-label={downloadProgress.accessibleLabel} aria-live="polite" className="min-w-0 max-w-32 truncate text-right text-xs tabular-nums text-muted-foreground" title={downloadProgress.accessibleLabel}>
            {downloadProgress.label}
          </span>
        )}
        label="Downloading local transcription"
        ready={false}
      />
    );
  }

  if (status.parakeet.status === 'installed') {
    return (
      <StatusRow
        action={<Spinner />}
        label="Finishing transcription setup"
        ready={false}
      />
    );
  }

  return (
    <StatusRow
      action={canAutoDownload
        ? <Spinner />
        : <Badge className="h-8 px-2.5" variant="destructive">Not ready</Badge>}
      label={canAutoDownload ? 'Preparing local transcription' : 'Transcription setup needs attention'}
      ready={false}
    />
  );
}

const transcriptionModelRecommendationMessage = 'Recommended for this computer based on accuracy, memory use and supported local audio models.';

const localTranscriptionModelOptions: Array<{
  detail: string;
  label: string;
  modelDetail: string;
  modelName: string;
  title: string;
  value: LocalTranscriptionModelId;
}> = [
  {
    detail: 'Uses more memory and processing power.',
    label: 'Best accuracy',
    modelDetail: 'Parakeet v3 is best when accuracy matters most. It can be harder on your computer because it uses more memory and processing power.',
    modelName: 'Parakeet v3',
    title: 'Best accuracy - harder on your computer',
    value: 'parakeet'
  },
  {
    detail: 'Lighter load. May be less accurate.',
    label: 'Lower memory use',
    modelDetail: 'Moonshine tiny is best when you want lower memory use or a lighter load on your computer. It may be less accurate than Parakeet v3.',
    modelName: 'Moonshine tiny',
    title: 'Lower memory use - easier on your computer',
    value: 'moonshine-tiny'
  }
];

function getInitialTranscriptionModelId(status: OnboardingStatus): LocalTranscriptionModelId {
  return status.selectedLocalTranscriptionModel ?? status.parakeet.modelId ?? status.transcription.recommendedModel?.id ?? 'parakeet';
}

function getLocalTranscriptionModelOption(modelId: LocalTranscriptionModelId) {
  return localTranscriptionModelOptions.find((option) => option.value === modelId) ?? localTranscriptionModelOptions[0]!;
}

function TranscriptionModelRow({
  onCancel,
  onDownload,
  onSelectModel,
  selectedModelId,
  status,
  variant = 'compact'
}: {
  onCancel: () => void;
  onDownload: (modelId: LocalTranscriptionModelId) => void;
  onSelectModel: (modelId: LocalTranscriptionModelId) => void;
  selectedModelId: LocalTranscriptionModelId;
  status: OnboardingStatus | null;
  variant?: 'compact' | 'settings';
}) {
  const isDownloading = status?.parakeet.status === 'downloading';
  const isSelectedModelReady = status?.parakeet.status === 'installed' && status.parakeet.modelId === selectedModelId;
  const isSelectedModelInUse = isSelectedModelReady && status?.selectedLocalTranscriptionModel === selectedModelId;
  const canDownload = Boolean(status && !isDownloading && status.transcription.recommended !== 'cloud');
  const recommendedModelId = status?.transcription.recommendedModel?.id;
  const selectedModel = getLocalTranscriptionModelOption(selectedModelId);
  const downloadProgress = getLocalModelDownloadProgressLabel(status?.parakeet.progress);
  const rootGapClassName = variant === 'settings' ? 'gap-4' : 'gap-3';
  const widthClassName = variant === 'settings' ? 'max-w-xl' : 'max-w-sm';
  const controlWidthClassName = variant === 'settings' ? 'w-fit max-w-full' : 'w-full max-w-full';
  const controlWrapperClassName = variant === 'settings'
    ? `grid ${controlWidthClassName} items-center gap-2`
    : `grid min-h-10 ${controlWidthClassName} items-center gap-2`;
  const optionButtonClassName = variant === 'settings'
    ? 'h-8 shrink-0 gap-1.5 px-3 whitespace-nowrap'
    : 'h-9 min-w-0 flex-1 gap-1.5 overflow-hidden px-3 whitespace-nowrap';
  const optionLabelClassName = variant === 'settings'
    ? 'block shrink-0 whitespace-nowrap'
    : 'block min-w-0 truncate';
  const downloadButtonSize = 'default';
  const downloadRowClassName = variant === 'settings'
    ? 'flex min-w-0 flex-wrap items-center gap-3'
    : 'flex min-w-0 items-center gap-2';
  const selectedModelInfo = (
    <TranscriptionModelInfoButton
      detail={selectedModel.modelDetail}
      modelName={selectedModel.modelName}
    />
  );

  return (
    <Tabs className={`grid ${rootGapClassName}`} value={selectedModelId}>
      <div className={controlWrapperClassName}>
        <div className="flex min-w-0 items-center gap-2">
          <TabsList className={`h-auto ${controlWidthClassName} min-w-0 p-0.5`} aria-label="Transcription model">
            {localTranscriptionModelOptions.map((option) => {
              const isSelected = selectedModelId === option.value;
              const isRecommended = recommendedModelId === option.value;

              return (
                <TabsTrigger
                  key={option.value}
                  aria-label={`${option.label}${isRecommended ? ` ${recommendedPillLabel}` : ''}`}
                  className={optionButtonClassName}
                  onClick={() => onSelectModel(option.value)}
                  value={option.value}
                >
                  <TruncatedTextTooltip className={optionLabelClassName} tooltip={option.label}>
                    {option.label}
                  </TruncatedTextTooltip>
                  {isRecommended ? <RecommendedMarker selected={isSelected} /> : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {recommendedModelId ? (
            <SettingInfoButton
              label="Why this is recommended"
              message={transcriptionModelRecommendationMessage}
            />
          ) : null}
        </div>
        <input name="transcription-model" readOnly type="hidden" value={selectedModelId} />
      </div>
      {localTranscriptionModelOptions.map((option) => (
        <TabsContent key={option.value} className={`grid ${widthClassName} ${rootGapClassName}`} value={option.value}>
          {selectedModelId === option.value ? (
            <>
              <p className={layout.settingsDescription}>{selectedModel.detail}</p>
              <div className={downloadRowClassName}>
                {isDownloading ? (
                  <>
                    <Button onClick={onCancel} size={downloadButtonSize} type="button" variant="outline">Cancel</Button>
                    <span aria-label={downloadProgress.accessibleLabel} aria-live="polite" className="min-w-0 truncate text-sm tabular-nums text-muted-foreground" title={downloadProgress.accessibleLabel}>
                      {downloadProgress.label}
                    </span>
                  </>
                ) : isSelectedModelReady || isSelectedModelInUse ? (
                  <ReadySetupPill info={selectedModelInfo} />
                ) : (
                  <>
                    <Button aria-label="Download" disabled={!canDownload} onClick={() => onDownload(selectedModelId)} size={downloadButtonSize} type="button">
                      Download
                    </Button>
                    {selectedModelInfo}
                    <span aria-live="polite" className="text-sm text-muted-foreground">Not downloaded yet</span>
                  </>
                )}
              </div>
            </>
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function TranscriptionModelInfoButton({
  detail,
  modelName
}: {
  detail: string;
  modelName: string;
}) {
  return (
    <EmbeddedInfoTooltip label={`${modelName} details`} side="top">
      <dl className="grid gap-2 text-xs">
        <div className="grid gap-0.5">
          <dt className="font-medium text-primary-foreground">Model</dt>
          <dd className="text-primary-foreground/80">{modelName}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="font-medium text-primary-foreground">Tradeoff</dt>
          <dd className="text-primary-foreground/80">{detail}</dd>
        </div>
      </dl>
    </EmbeddedInfoTooltip>
  );
}

function ReadySetupPill({
  info,
  label = 'Ready',
  size = 'action'
}: {
  info?: ReactNode;
  label?: string;
  size?: 'action' | 'default';
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <Badge className={cn(size === 'action' && 'h-8 px-2.5')} variant="default">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2Icon data-icon="inline-start" />
          {label}
          {info}
        </span>
      </Badge>
    </div>
  );
}

function UnavailableSetupPill({
  info
}: {
  info?: ReactNode;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <Badge variant="destructive">Unavailable</Badge>
      {info}
    </div>
  );
}

function getLocalModelDownloadProgressLabel(progress: ParakeetStatus['progress']) {
  const percent = progress?.percent ?? 0;

  if (!progress) {
    return {
      accessibleLabel: `Downloading ${percent}%`,
      label: `${percent}%`
    };
  }

  if (typeof progress.totalBytes === 'number' && progress.totalBytes > 0) {
    const downloaded = formatBytes(progress.downloadedBytes);
    const total = formatBytes(progress.totalBytes);

    return {
      accessibleLabel: `Downloading ${percent}% · ${downloaded} of ${total}`,
      label: `${percent}% · ${downloaded}/${total}`
    };
  }

  const downloaded = formatBytes(progress.downloadedBytes);

  return {
    accessibleLabel: `Downloading ${percent}% · ${downloaded}`,
    label: `${percent}% · ${downloaded}`
  };
}

function getLocalAiDownloadProgressLabel(
  progress: LocalLlmStatus['progress'],
  phase: 'requesting' | 'downloading' | 'idle' = 'idle'
) {
  if (!progress) {
    if (phase === 'requesting') {
      return {
        accessibleLabel: 'Requesting local AI download',
        label: 'Requesting local AI download...'
      };
    }

    return {
      accessibleLabel: 'Downloading local AI model · 0%',
      label: 'Downloading local AI model · 0%'
    };
  }

  const phaseLabel = progress.phase === 'runtime'
    ? 'Downloading local AI runtime'
    : 'Downloading local AI model';

  if (progress.totalBytes === null) {
    const downloaded = formatBytes(progress.downloadedBytes);

    if (progress.downloadedBytes > 0) {
      return {
        accessibleLabel: `${phaseLabel} · ${downloaded} downloaded`,
        label: `${phaseLabel} · ${downloaded} downloaded`
      };
    }

    return {
      accessibleLabel: phaseLabel,
      label: phaseLabel
    };
  }

  const downloaded = formatBytes(progress.downloadedBytes);
  const total = formatBytes(progress.totalBytes);

  return {
    accessibleLabel: `${phaseLabel} · ${progress.percent}% · ${downloaded} of ${total}`,
    label: `${phaseLabel} · ${progress.percent}% · ${downloaded} of ${total}`
  };
}

function getOnboardingPermissionRows(permissions: PermissionItem[]) {
  return permissions;
}

function PermissionSetupRow({
  actionSize,
  contextLabel,
  issuePanel = false,
  onChange,
  permission,
  showDivider = true
}: {
  actionSize?: 'default' | 'sm';
  contextLabel?: string;
  issuePanel?: boolean;
  onChange: () => void;
  permission: PermissionItem;
  showDivider?: boolean;
}) {
  const ready = permission.status === 'granted' || permission.status === 'unsupported';
  const statusLabel = getPermissionStatusLabel(permission.status);
  const macosPermissionName = getMacosPermissionName(permission.id);
  const permissionButtonSize = actionSize ?? (issuePanel ? 'default' : 'sm');

  return (
    <div className={cn('text-sm', showDivider && 'border-b border-border/70 last:border-b-0')}>
      <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-sm font-medium">{permission.label}</h3>
          {contextLabel ? (
            <Badge variant="outline">{contextLabel}</Badge>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={<Button
                aria-label={`${permission.label} permission info`}
                size="icon-sm"
                type="button"
                variant="ghost"
              />}
            >
              <InfoIcon />
            </TooltipTrigger>
            <TooltipContent>
              <span className="block max-w-72">
                {permission.description} macOS permission: {macosPermissionName}.
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge className={cn(issuePanel && 'h-7 px-2.5')} variant={ready ? 'secondary' : 'destructive'}>
            {statusLabel}
          </Badge>
          {!ready ? (
            <Button
              aria-label={`Grant ${permission.label}`}
              onClick={onChange}
              size={permissionButtonSize}
              type="button"
            >
              Grant
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getMacosPermissionName(permissionId: PermissionItem['id']) {
  if (permissionId === 'screen-recording') {
    return 'ScreenCapture';
  }

  if (permissionId === 'system-audio') {
    return 'AudioCapture';
  }

  return 'Microphone';
}

function getPermissionStatusLabel(status: PermissionItem['status']) {
  if (status === 'granted') {
    return 'Granted';
  }

  if (status === 'unsupported') {
    return 'Unsupported';
  }

  if (status === 'not-determined' || status === 'denied' || status === 'restricted') {
    return 'Not granted';
  }

  return 'Unknown';
}

function getDisplayErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
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

function useSuppressTooltipsAfterOverlayOpen(isOverlayOpen: boolean) {
  const wasOverlayOpenRef = useRef(false);

  useEffect(() => {
    if (!isOverlayOpen || wasOverlayOpenRef.current) {
      wasOverlayOpenRef.current = isOverlayOpen;
      return undefined;
    }

    wasOverlayOpenRef.current = isOverlayOpen;
    document.documentElement.dataset.caulSuppressTooltips = 'true';
    document.documentElement.dataset.caulSuppressTooltipsAt = String(Date.now());

    const timeout = window.setTimeout(() => {
      delete document.documentElement.dataset.caulSuppressTooltips;
      delete document.documentElement.dataset.caulSuppressTooltipsAt;
    }, overlayOpenTooltipSuppressionMs);

    return () => {
      window.clearTimeout(timeout);
      delete document.documentElement.dataset.caulSuppressTooltips;
      delete document.documentElement.dataset.caulSuppressTooltipsAt;
    };
  }, [isOverlayOpen]);
}

function getPrivateOverlayHandleEdge(status: PrivateOverlayState | null): OverlayEdge {
  if (!status || (!status.overlay.visible && !status.overlayWindowVisible)) {
    return 'right';
  }

  const handleSizePx = privateOverlayHandleSizePixels[status.handle.size] ?? privateOverlayHandleSizePixels.small;
  const handleRight = status.handle.x + handleSizePx;
  const handleBottom = status.handle.y + handleSizePx;
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
  if (edge === 'bottom' || edge === 'right') {
    return layout.contentBottomToolbar;
  }

  return layout.contentTopToolbar;
}

function getHomeToolbarClassName(edge: OverlayEdge) {
  const edgeClass = {
    bottom: layout.homeToolbarBottom,
    left: layout.homeToolbarTop,
    right: layout.homeToolbarBottom,
    top: layout.homeToolbarTop
  }[edge];

  return `${layout.homeToolbar} ${edgeClass}`;
}

function getHomePanelGridClassName(edge: OverlayEdge) {
  return layout.panelGrid;
}

const homeTopToolbarTooltipSide = 'bottom' satisfies TooltipSide;
const homeBottomToolbarTooltipSide = 'top' satisfies TooltipSide;


function isLeadingToolbarEdge(edge: OverlayEdge) {
  return edge === 'top';
}

function isVerticalToolbarEdge(edge: OverlayEdge) {
  return false;
}

function PrivateOverlayWindowTitleBar({
  appTitle,
  isMac,
  isSettingsOpen,
  notifications,
  onOpenHistoryFolder,
  onOpenSettingsTarget,
  onToggleSettings
}: {
  appTitle: string;
  isMac: boolean;
  isSettingsOpen: boolean;
  notifications: MainNotification[];
  onOpenHistoryFolder: () => void;
  onOpenSettingsTarget: (target: SettingsTarget) => void;
  onToggleSettings: () => void;
}) {
  const [isQuitConfirmationOpen, setIsQuitConfirmationOpen] = useState(false);
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

  function confirmQuit() {
    setIsQuitConfirmationOpen(false);
    void getSettingsBridge()?.quit?.();
  }

  return (
    <>
      <header className={layout.windowTitleBar}>
        <div
          aria-label={`Move ${appTitle} window`}
          className={layout.windowTitleBarDragArea}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
        >
          <span className={layout.windowTitleBarTitle}>{appTitle}</span>
        </div>
        {isMac ? (
          <>
            <MacosWindowButton
              action="close"
              aria-label="Hide Caul app"
              onClick={() => void getPrivateOverlayBridge()?.hide()}
              placement="titlebar"
              title="Hide Caul app"
            />
            <AlertDialog open={isQuitConfirmationOpen} onOpenChange={setIsQuitConfirmationOpen}>
              <AlertDialogTrigger
                render={<MacosWindowButton
                  action="quit"
                  aria-label="Quit Caul"
                  placement="titlebar"
                  title="Quit Caul completely"
                />}
              >
                <PowerIcon />
              </AlertDialogTrigger>
              <QuitCaulAlertDialog onConfirm={confirmQuit} />
            </AlertDialog>
          </>
        ) : (
          <>
            <Button
              aria-label="Hide Caul app"
              className={layout.windowTitleBarButton}
              data-platform="desktop"
              onClick={() => void getPrivateOverlayBridge()?.hide()}
              size="icon"
              title="Hide Caul app"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
            <AlertDialog open={isQuitConfirmationOpen} onOpenChange={setIsQuitConfirmationOpen}>
              <AlertDialogTrigger
                render={<Button
                  aria-label="Quit Caul"
                  className={layout.windowTitleBarQuitButton}
                  data-platform="desktop"
                  size="icon"
                  title="Quit Caul completely"
                  type="button"
                  variant="ghost"
                />}
              >
                <PowerIcon />
              </AlertDialogTrigger>
              <QuitCaulAlertDialog onConfirm={confirmQuit} />
            </AlertDialog>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Button
              aria-label="Open history folder"
              className={`${layout.windowTitleBarSettingsButton} ${isMac ? layout.windowTitleBarHistoryButtonMac : layout.windowTitleBarHistoryButtonDesktop}`}
              onClick={onOpenHistoryFolder}
              size="icon"
              type="button"
              variant="ghost"
            />}
          >
            <HistoryIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">Open history folder</TooltipContent>
        </Tooltip>
        {notifications.length > 0 ? (
          <MainNotificationButton
            className={`${layout.windowTitleBarSettingsButton} ${isMac ? layout.windowTitleBarNotificationButtonMac : layout.windowTitleBarNotificationButtonDesktop}`}
            notifications={notifications}
            onOpenSettingsTarget={onOpenSettingsTarget}
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={<Toggle
              aria-label="Caul Settings"
              className={`${layout.windowTitleBarSettingsButton} ${isMac ? layout.windowTitleBarSettingsButtonMac : layout.windowTitleBarSettingsButtonDesktop}`}
              onPressedChange={onToggleSettings}
              pressed={isSettingsOpen}
              size="default"
            />}
          >
            <SettingsIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Caul settings</TooltipContent>
        </Tooltip>
      </header>
    </>
  );
}

function QuitCaulAlertDialog({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Quit Caul?</AlertDialogTitle>
        <AlertDialogDescription>This will stop Caul and close the app completely.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm} variant="destructive">Quit Caul</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

function MainNotificationButton({
  className,
  notifications,
  onOpenSettingsTarget
}: {
  className: string;
  notifications: MainNotification[];
  onOpenSettingsTarget: (target: SettingsTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasError = notifications.some((notification) => notification.tone === 'error');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button
          aria-label="Caul notifications"
          className={className}
          data-notification-tone={hasError ? 'error' : 'attention'}
          size="icon"
          type="button"
          variant="ghost"
        />}
      >
        <BellIcon />
        <span className={`absolute right-1 top-1 size-1.5 rounded-full ${hasError ? 'bg-destructive' : 'bg-primary'}`} />
      </PopoverTrigger>
      <PopoverContent aria-label="Caul notifications" align="end" className="w-64 gap-2" side="bottom" sideOffset={8}>
        <h2 className="text-sm font-medium text-foreground">Needs attention</h2>
        <div className="grid gap-1">
          {notifications.map((notification) => (
            <Button
              key={notification.id}
              className="w-full justify-between gap-2"
              onClick={() => {
                setOpen(false);
                onOpenSettingsTarget(notification.target);
              }}
              type="button"
              variant="ghost"
            >
              <span>{notification.label}</span>
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
  const [handleMotion, setHandleMotion] = useState<'dragging' | 'idle' | 'pressing' | 'snapping'>('idle');
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

  function schedulePressVisualReset() {
    clearSnapVisualTimer();
    snapVisualTimerRef.current = window.setTimeout(() => {
      snapVisualTimerRef.current = null;
      setHandleMotion('idle');
    }, handlePressVisualDurationMs);
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    clearSnapVisualTimer();
    setHandleMotion('pressing');
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

    setHandleMotion('pressing');
    schedulePressVisualReset();
    void bridge.toggle();
  }

  return (
    <main className={layout.handleRoot} aria-label="Caul overlay handle">
      <OverlayHandleButton
        aria-label="Toggle Caul app"
        data-motion={handleMotion}
        onContextMenu={(event) => {
          event.preventDefault();
          void getPrivateOverlayBridge()?.showHandleMenu();
        }}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        open={isOverlayOpen}
        title="Toggle Caul app"
      >
        <span aria-hidden="true" className="caul-handle-icon" style={handleIconStyle} />
      </OverlayHandleButton>
    </main>
  );
}

function HomePage({
  autoCollapseAiResponses,
  autoCollapseTranscription,
  aiIssue,
  canStartListening,
  canUseAi,
  edge,
  isAiResponsePlaceholder,
  isBusy,
  isChatGptSigningIn,
  isCloudAiReady,
  isListening,
  isTranscriptPlaceholder,
  listenToMicrophone,
  listenToSystemAudio,
  localAiSetupPhase,
  localLlmStatus,
  llmOutputRef,
  missingSelectedPermissions,
  onAskAiFromTranscript,
  onAskAiFromManualPrompt,
  onAskAiFromSpecificTranscript,
  onCancelLocalAiDownload,
  onCancelTranscriptionModelDownload,
  onClearAiResponses,
  onClearTranscript,
  onCopyAiResponse,
  onCopyTranscript,
  onDownloadAiResponse,
  onDownloadLocalAi,
  onDownloadTranscript,
  onDownloadTranscriptionModel,
  onOpenGeneralInstructions,
  onOpenPromptTemplateSettings,
  onRequestPermission,
  onSelectAiProvider,
  onSelectPromptTemplates,
  onSelectTranscriptionModel,
  onSetListenToMicrophone,
  onSetListenToSystemAudio,
  onSignInWithChatGpt,
  onboardingStatus,
  outputRef,
  promptTemplates,
  recommendedLocalAiModelReady,
  sendToAiWhenListeningStops,
  selectedAiProvider,
  selectedPromptTemplateIds,
  selectedTranscriptionModelId,
  setSendToAiWhenListeningStops,
  toggleListening,
  transcriptIssue,
  transcription
}: {
  autoCollapseAiResponses: boolean;
  autoCollapseTranscription: boolean;
  aiIssue: PanelIssue | null;
  canStartListening: boolean;
  canUseAi: boolean;
  edge: OverlayEdge;
  isAiResponsePlaceholder: boolean;
  isBusy: boolean;
  isChatGptSigningIn: boolean;
  isCloudAiReady: boolean;
  isListening: boolean;
  isTranscriptPlaceholder: boolean;
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
  localAiSetupPhase: 'requesting' | 'downloading' | 'idle';
  localLlmStatus: LocalLlmStatus | null;
  llmOutputRef: RefObject<HTMLDivElement | null>;
  missingSelectedPermissions: PermissionItem[];
  onAskAiFromTranscript: () => void;
  onAskAiFromManualPrompt: (prompt: string) => void;
  onAskAiFromSpecificTranscript: (transcript: string) => void;
  onCancelLocalAiDownload: () => void;
  onCancelTranscriptionModelDownload: () => void;
  onClearAiResponses: () => void;
  onClearTranscript: () => void;
  onCopyAiResponse: () => void;
  onCopyTranscript: () => void;
  onDownloadAiResponse: (format: TranscriptDownloadFormat) => void;
  onDownloadLocalAi: () => void;
  onDownloadTranscript: (format: TranscriptDownloadFormat) => void;
  onDownloadTranscriptionModel: (modelId: LocalTranscriptionModelId) => void;
  onOpenGeneralInstructions: () => void;
  onOpenPromptTemplateSettings: () => void;
  onRequestPermission: (permission: PermissionItem['id']) => void;
  onSelectAiProvider: (provider: AiProvider) => void;
  onSelectPromptTemplates: (ids: string[]) => void;
  onSelectTranscriptionModel: (modelId: LocalTranscriptionModelId) => void;
  onSetListenToMicrophone: (listen: boolean) => void;
  onSetListenToSystemAudio: (listen: boolean) => void;
  onSignInWithChatGpt: CloudSignInHandler;
  onboardingStatus: OnboardingStatus | null;
  outputRef: RefObject<HTMLDivElement | null>;
  promptTemplates: PromptTemplate[];
  recommendedLocalAiModelReady: boolean;
  sendToAiWhenListeningStops: boolean;
  selectedAiProvider: AiProvider;
  selectedPromptTemplateIds: string[];
  selectedTranscriptionModelId: LocalTranscriptionModelId;
  setSendToAiWhenListeningStops: (sendToAi: boolean) => void;
  toggleListening: () => void;
  transcriptIssue: PanelIssue | null;
  transcription: ReturnType<typeof useLiveTranscription>;
}) {
  const showScrollFixture = isScrollFixtureEnabled();
  const showStreamFixture = isStreamFixtureEnabled();
  const [collapsedTranscriptIds, setCollapsedTranscriptIds] = useState<Set<string>>(() => new Set());
  const [collapsedAiResponseIds, setCollapsedAiResponseIds] = useState<Set<string>>(() => new Set());
  const [transcriptCollapseOverrides, setTranscriptCollapseOverrides] = useState<CollapseOverrides>({});
  const [aiResponseCollapseOverrides, setAiResponseCollapseOverrides] = useState<CollapseOverrides>({});
  const [manualAiPrompt, setManualAiPrompt] = useState('');
  const [manualAiPromptMaxHeight, setManualAiPromptMaxHeight] = useState<number | null>(null);
  const manualAiPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const visibleTranscriptSessions = showScrollFixture
    ? scrollFixtureTranscriptSessions
    : transcription.sessions;
  const visibleAiResponses = showStreamFixture
    ? streamFixtureAiResponses
    : showScrollFixture
    ? scrollFixtureAiResponses
    : getVisibleAiResponses({
      aiResponses: transcription.llmResponses,
      isAsking: transcription.isAsking,
      llmOutput: transcription.llmOutput,
      llmRequestedAt: transcription.llmRequestedAt
    });
  const isTranscriptPanelPlaceholder = !showScrollFixture && !showStreamFixture && isTranscriptPlaceholder;
  const isAiResponsePanelPlaceholder = !showScrollFixture && !showStreamFixture && isAiResponsePlaceholder;
  const localAiPlaceholderStatusText = selectedAiProvider === 'local' && !aiIssue
    ? getLocalAiPlaceholderStatusText(localLlmStatus)
    : null;
  const hasTranscript = isTranscriptTextCopyable(transcription.confirmedOutput);
  const hasAiResponse = visibleAiResponses.some((response) => isAiResponseTextCopyable(response.response));
  const startButtonLabel = isListening
    ? 'Stop Listening'
    : isBusy
      ? 'Starting...'
      : 'Start Listening';
  const autoSendLabel = 'Auto Send';
  const autoSendTooltip = 'Sends the transcript to AI when listening stops.';
  const hasTranscriptSessions = visibleTranscriptSessions.length > 0;
  const isVerticalToolbar = isVerticalToolbarEdge(edge);
  const bottomActionTooltipSide = homeBottomToolbarTooltipSide;
  const activeTranscriptSessionId = visibleTranscriptSessions.at(-1)?.id ?? null;
  const activeAiResponseId = visibleAiResponses.at(-1)?.id ?? null;
  const lastScrolledTranscriptSessionIdRef = useRef<string | null>(null);
  const lastScrolledAiResponseIdRef = useRef<string | null>(null);
  const aiResponsePanelRef = useRef<HTMLElement | null>(null);
  const promptTemplateEditAnchorRef = useRef<HTMLDivElement | null>(null);
  const setAiResponsePanelRef = (node: HTMLElement | null) => {
    aiResponsePanelRef.current = node;
  };
  const setPromptTemplateEditAnchorRef = (node: HTMLDivElement | null) => {
    promptTemplateEditAnchorRef.current = node;
  };

  useLayoutEffect(() => {
    const panel = aiResponsePanelRef.current;

    if (!panel) {
      setManualAiPromptMaxHeight(null);
      return;
    }

    const updateManualPromptMaxHeight = () => {
      setManualAiPromptMaxHeight(Math.max(44, Math.floor(panel.getBoundingClientRect().height / 2)));
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateManualPromptMaxHeight);

    updateManualPromptMaxHeight();
    resizeObserver?.observe(panel);
    window.addEventListener('resize', updateManualPromptMaxHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateManualPromptMaxHeight);
    };
  }, [edge]);

  useLayoutEffect(() => {
    const input = manualAiPromptRef.current;

    if (!input) {
      return;
    }

    input.style.height = 'auto';
    const maxHeight = manualAiPromptMaxHeight ?? Number.POSITIVE_INFINITY;
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [manualAiPrompt, manualAiPromptMaxHeight]);

  useLayoutEffect(() => {
    setCollapsedTranscriptIds((current) => reconcileCollapsedSectionIds({
      activeId: activeTranscriptSessionId,
      autoCollapse: autoCollapseTranscription,
      current,
      ids: visibleTranscriptSessions.map((session) => session.id),
      overrides: transcriptCollapseOverrides
    }));
  }, [activeTranscriptSessionId, autoCollapseTranscription, transcriptCollapseOverrides, visibleTranscriptSessions]);

  useLayoutEffect(() => {
    setCollapsedAiResponseIds((current) => reconcileCollapsedSectionIds({
      activeId: activeAiResponseId,
      autoCollapse: autoCollapseAiResponses,
      current,
      ids: visibleAiResponses.map((response) => response.id),
      overrides: aiResponseCollapseOverrides
    }));
  }, [activeAiResponseId, aiResponseCollapseOverrides, autoCollapseAiResponses, visibleAiResponses]);

  useLayoutEffect(() => {
    if (activeTranscriptSessionId === lastScrolledTranscriptSessionIdRef.current) {
      return undefined;
    }

    lastScrolledTranscriptSessionIdRef.current = activeTranscriptSessionId;
    return scrollSectionToPanelTopAfterRender(outputRef.current, activeTranscriptSessionId, 'data-transcript-session-id');
  }, [activeTranscriptSessionId, outputRef]);

  useLayoutEffect(() => {
    updateHistoryVirtualGeometry(outputRef.current, activeTranscriptSessionId, 'data-transcript-session-id');
  }, [activeTranscriptSessionId, collapsedTranscriptIds, outputRef, visibleTranscriptSessions]);

  useLayoutEffect(() => {
    if (activeAiResponseId === lastScrolledAiResponseIdRef.current) {
      return undefined;
    }

    lastScrolledAiResponseIdRef.current = activeAiResponseId;
    return scrollSectionToPanelTopAfterRender(llmOutputRef.current, activeAiResponseId, 'data-ai-response-id');
  }, [activeAiResponseId, llmOutputRef]);

  useLayoutEffect(() => {
    updateHistoryVirtualGeometry(llmOutputRef.current, activeAiResponseId, 'data-ai-response-id');
  }, [activeAiResponseId, collapsedAiResponseIds, llmOutputRef, visibleAiResponses]);

  function toggleTranscriptSessionCollapsed(id: string) {
    setCollapsedTranscriptIds((current) => {
      const next = new Set(current);
      const isCollapsed = next.has(id);

      if (isCollapsed) {
        next.delete(id);
      } else {
        next.add(id);
      }

      setTranscriptCollapseOverrides((overrides) => ({
        ...overrides,
        [id]: !isCollapsed
      }));

      return next;
    });
  }

  function toggleAiResponseCollapsed(id: string) {
    setCollapsedAiResponseIds((current) => {
      const next = new Set(current);
      const isCollapsed = next.has(id);

      if (isCollapsed) {
        next.delete(id);
      } else {
        next.add(id);
      }

      setAiResponseCollapseOverrides((overrides) => ({
        ...overrides,
        [id]: !isCollapsed
      }));

      return next;
    });
  }

  function handleTranscriptPanelScroll(event: React.UIEvent<HTMLDivElement>) {
    updateHistoryVirtualGeometry(event.currentTarget, activeTranscriptSessionId, 'data-transcript-session-id');
  }

  function handleAiResponsePanelScroll(event: React.UIEvent<HTMLDivElement>) {
    updateHistoryVirtualGeometry(event.currentTarget, activeAiResponseId, 'data-ai-response-id');
  }

  function sendManualAiPrompt() {
    const prompt = manualAiPrompt.trim();

    if (!prompt || transcription.isAsking) {
      return;
    }

    onAskAiFromManualPrompt(prompt);
    setManualAiPrompt('');
  }

  function handleManualAiPromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    sendManualAiPrompt();
  }

  return (
    <div className={layout.form}>
      <div
        aria-label="Home layout"
        className={getHomeContentClassName(edge)}
        data-home-toolbar-edge={edge}
      >
        <HomePanelTitleBars />

        {!isVerticalToolbar || isLeadingToolbarEdge(edge) ? (
          <HomeActionToolbar
            autoSendLabel={autoSendLabel}
            autoSendTooltip={autoSendTooltip}
            canUseAi={canUseAi}
            canStartListening={canStartListening}
            edge={edge}
            isBusy={isBusy}
            isListening={isListening}
            listenToMicrophone={listenToMicrophone}
            listenToSystemAudio={listenToSystemAudio}
            onOpenGeneralInstructions={onOpenGeneralInstructions}
            onOpenPromptTemplateSettings={onOpenPromptTemplateSettings}
            onSelectPromptTemplates={onSelectPromptTemplates}
            onSetListenToMicrophone={onSetListenToMicrophone}
            onSetListenToSystemAudio={onSetListenToSystemAudio}
            promptTemplateEditAnchorRef={setPromptTemplateEditAnchorRef}
            promptTemplates={promptTemplates}
            sendToAiWhenListeningStops={sendToAiWhenListeningStops}
            selectedPromptTemplateIds={selectedPromptTemplateIds}
            setSendToAiWhenListeningStops={setSendToAiWhenListeningStops}
            startButtonLabel={startButtonLabel}
            toggleListening={toggleListening}
          />
        ) : null}

        <div
          aria-label="Transcript and AI panels"
          className={getHomePanelGridClassName(edge)}
          data-testid="home-panels"
          data-panel-flow="side-by-side"
        >
        <section className={isVerticalToolbar ? layout.panelWithBottomActions : layout.panelPlain} aria-label="Listening">
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
            onScroll={handleTranscriptPanelScroll}
          >
            {transcriptIssue ? (
              <PanelIssueRecovery
                isChatGptSigningIn={isChatGptSigningIn}
                isCloudAiReady={isCloudAiReady}
                issue={transcriptIssue}
                localAiSetupPhase={localAiSetupPhase}
                localLlmStatus={localLlmStatus}
                missingSelectedPermissions={missingSelectedPermissions}
                onCancelLocalAiDownload={onCancelLocalAiDownload}
                onCancelTranscriptionModelDownload={onCancelTranscriptionModelDownload}
                onDownloadLocalAi={onDownloadLocalAi}
                onDownloadTranscriptionModel={onDownloadTranscriptionModel}
                onRequestPermission={onRequestPermission}
                onSelectAiProvider={onSelectAiProvider}
                onSelectTranscriptionModel={onSelectTranscriptionModel}
                onSignInWithChatGpt={onSignInWithChatGpt}
                onboardingStatus={onboardingStatus}
                recommendedLocalAiModelReady={recommendedLocalAiModelReady}
                selectedAiProvider={selectedAiProvider}
                selectedTranscriptionModelId={selectedTranscriptionModelId}
              />
            ) : isTranscriptPanelPlaceholder ? (
              <>
                {transcriptPlaceholder}
                <StartHereHint
                  listenToMicrophone={listenToMicrophone}
                  listenToSystemAudio={listenToSystemAudio}
                />
              </>
            ) : !hasTranscriptSessions ? (
              transcription.output
            ) : (
              <TranscriptSessionList
                activeSessionId={activeTranscriptSessionId}
                canUseAi={canUseAi}
                collapsedIds={collapsedTranscriptIds}
                isAsking={transcription.isAsking}
                onAskAi={onAskAiFromSpecificTranscript}
                onToggleCollapsed={toggleTranscriptSessionCollapsed}
                sessions={visibleTranscriptSessions}
              />
            )}
          </div>
          {isVerticalToolbar ? (
            <div className={layout.panelBottomActions} data-toolbar-section="transcript-bottom">
              <TranscriptBottomActionControls
                canUseAi={canUseAi}
                hasTranscript={hasTranscript}
                onAskAiFromTranscript={onAskAiFromTranscript}
                onClearTranscript={onClearTranscript}
                onCopyTranscript={onCopyTranscript}
                onDownloadTranscript={onDownloadTranscript}
                showLabels={false}
                tooltipSide={bottomActionTooltipSide}
                transcriptionIsAsking={transcription.isAsking}
              />
            </div>
          ) : null}
        </section>

        <section
          ref={setAiResponsePanelRef}
          className={layout.aiPanelWithManualPrompt}
          aria-label="AI response panel"
        >
          <div
            ref={llmOutputRef}
            id="llm-output"
            aria-label="AI response"
            className={`${layout.panelScroller} ${isAiResponsePanelPlaceholder ? layout.placeholder : layout.transcriptSessionOutput}`}
            onScroll={handleAiResponsePanelScroll}
          >
            {aiIssue ? (
              <PanelIssueRecovery
                isChatGptSigningIn={isChatGptSigningIn}
                isCloudAiReady={isCloudAiReady}
                issue={aiIssue}
                localAiSetupPhase={localAiSetupPhase}
                localLlmStatus={localLlmStatus}
                missingSelectedPermissions={missingSelectedPermissions}
                onCancelLocalAiDownload={onCancelLocalAiDownload}
                onCancelTranscriptionModelDownload={onCancelTranscriptionModelDownload}
                onDownloadLocalAi={onDownloadLocalAi}
                onDownloadTranscriptionModel={onDownloadTranscriptionModel}
                onRequestPermission={onRequestPermission}
                onSelectAiProvider={onSelectAiProvider}
                onSelectTranscriptionModel={onSelectTranscriptionModel}
                onSignInWithChatGpt={onSignInWithChatGpt}
                onboardingStatus={onboardingStatus}
                recommendedLocalAiModelReady={recommendedLocalAiModelReady}
                selectedAiProvider={selectedAiProvider}
                selectedTranscriptionModelId={selectedTranscriptionModelId}
              />
            ) : isAiResponsePanelPlaceholder ? (
              <div className="grid justify-items-center gap-2">
                {localAiPlaceholderStatusText ? (
                  <span aria-live="polite" className="text-xs font-medium text-foreground">
                    {localAiPlaceholderStatusText}
                  </span>
                ) : null}
                <span>{sendToAiWhenListeningStops ? aiResponsePlaceholder : aiResponseDisabledPlaceholder}</span>
                <AiPromptTemplateHint />
              </div>
            ) : visibleAiResponses.length > 0 ? (
              <AiResponseSectionList
                activeResponseId={activeAiResponseId}
                collapsedIds={collapsedAiResponseIds}
                onToggleCollapsed={toggleAiResponseCollapsed}
                responses={visibleAiResponses}
              />
            ) : null}
          </div>
          <div className={layout.aiManualPromptBar}>
            <Textarea
              ref={manualAiPromptRef}
              aria-label="Ask AI"
              className={layout.aiManualPromptInput}
              disabled={!canUseAi || transcription.isAsking}
              onChange={(event) => setManualAiPrompt(event.target.value)}
              onKeyDown={handleManualAiPromptKeyDown}
              placeholder="Ask anything"
              rows={1}
              style={manualAiPromptMaxHeight === null ? undefined : { maxHeight: `${manualAiPromptMaxHeight}px` }}
              value={manualAiPrompt}
            />
            <TooltipButton
              aria-label="Send manual prompt to AI"
              disabled={!canUseAi || !manualAiPrompt.trim() || transcription.isAsking}
              onClick={sendManualAiPrompt}
              size="icon-lg"
              tooltip="Send manual prompt to AI"
              tooltipSide={bottomActionTooltipSide}
              type="button"
              variant="outline"
            >
              <SendIcon />
            </TooltipButton>
          </div>
          {isVerticalToolbar ? (
            <div className={layout.panelBottomActions} data-toolbar-section="ai-bottom">
              <AiResponseBottomActionControls
                hasAiResponse={hasAiResponse}
                onClearAiResponses={onClearAiResponses}
                onCopyAiResponse={onCopyAiResponse}
                onDownloadAiResponse={onDownloadAiResponse}
                showLabels={false}
                tooltipSide={bottomActionTooltipSide}
              />
            </div>
          ) : null}
        </section>
        </div>

        {!isVerticalToolbar ? (
          <HomeBottomActionToolbar
            edge={edge}
            hasAiResponse={hasAiResponse}
            hasTranscript={hasTranscript}
            canUseAi={canUseAi}
            onAskAiFromTranscript={onAskAiFromTranscript}
            onClearAiResponses={onClearAiResponses}
            onClearTranscript={onClearTranscript}
            onCopyAiResponse={onCopyAiResponse}
            onCopyTranscript={onCopyTranscript}
            onDownloadAiResponse={onDownloadAiResponse}
            onDownloadTranscript={onDownloadTranscript}
            transcriptionIsAsking={transcription.isAsking}
          />
        ) : null}

        {!isLeadingToolbarEdge(edge) && isVerticalToolbar ? (
          <HomeActionToolbar
            autoSendLabel={autoSendLabel}
            autoSendTooltip={autoSendTooltip}
            canUseAi={canUseAi}
            canStartListening={canStartListening}
            edge={edge}
            isBusy={isBusy}
            isListening={isListening}
            listenToMicrophone={listenToMicrophone}
            listenToSystemAudio={listenToSystemAudio}
            onOpenGeneralInstructions={onOpenGeneralInstructions}
            onOpenPromptTemplateSettings={onOpenPromptTemplateSettings}
            onSelectPromptTemplates={onSelectPromptTemplates}
            onSetListenToMicrophone={onSetListenToMicrophone}
            onSetListenToSystemAudio={onSetListenToSystemAudio}
            promptTemplateEditAnchorRef={setPromptTemplateEditAnchorRef}
            promptTemplates={promptTemplates}
            sendToAiWhenListeningStops={sendToAiWhenListeningStops}
            selectedPromptTemplateIds={selectedPromptTemplateIds}
            setSendToAiWhenListeningStops={setSendToAiWhenListeningStops}
            startButtonLabel={startButtonLabel}
            toggleListening={toggleListening}
          />
        ) : null}
      </div>
    </div>
  );
}

function getStartListeningSourceDescription({
  listenToMicrophone,
  listenToSystemAudio
}: {
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
}) {
  if (listenToMicrophone && listenToSystemAudio) {
    return 'Click Start Listening while playing something through your speakers, headphones, or speaking into your microphone.';
  }

  if (listenToMicrophone) {
    return 'Click Start Listening while speaking into your microphone.';
  }

  if (listenToSystemAudio) {
    return 'Click Start Listening while playing something through your speakers or headphones.';
  }

  return 'Select Input, Output or both before starting.';
}

function StartHereHint({
  listenToMicrophone,
  listenToSystemAudio
}: {
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
}) {
  return (
    <div className={layout.startHereHint} aria-label="Start Listening hint">
      <ArrowUpIcon className={layout.startHereArrow} aria-hidden="true" />
      <div className={layout.startHereDescription}>
        {getStartListeningSourceDescription({ listenToMicrophone, listenToSystemAudio })}
      </div>
    </div>
  );
}

function PanelIssueRecovery({
  isChatGptSigningIn,
  isCloudAiReady,
  issue,
  localAiSetupPhase,
  localLlmStatus,
  missingSelectedPermissions,
  onCancelLocalAiDownload,
  onCancelTranscriptionModelDownload,
  onDownloadLocalAi,
  onDownloadTranscriptionModel,
  onRequestPermission,
  onSelectAiProvider,
  onSelectTranscriptionModel,
  onSignInWithChatGpt,
  onboardingStatus,
  recommendedLocalAiModelReady,
  selectedAiProvider,
  selectedTranscriptionModelId
}: {
  isChatGptSigningIn: boolean;
  isCloudAiReady: boolean;
  issue: PanelIssue;
  localAiSetupPhase: 'requesting' | 'downloading' | 'idle';
  localLlmStatus: LocalLlmStatus | null;
  missingSelectedPermissions: PermissionItem[];
  onCancelLocalAiDownload: () => void;
  onCancelTranscriptionModelDownload: () => void;
  onDownloadLocalAi: () => void;
  onDownloadTranscriptionModel: (modelId: LocalTranscriptionModelId) => void;
  onRequestPermission: (permission: PermissionItem['id']) => void;
  onSelectAiProvider: (provider: AiProvider) => void;
  onSelectTranscriptionModel: (modelId: LocalTranscriptionModelId) => void;
  onSignInWithChatGpt: CloudSignInHandler;
  onboardingStatus: OnboardingStatus | null;
  recommendedLocalAiModelReady: boolean;
  selectedAiProvider: AiProvider;
  selectedTranscriptionModelId: LocalTranscriptionModelId;
}) {
  let recoveryControl: ReactNode = null;
  let swapControl: ReactNode = null;
  const isLocalAiDownloading = localLlmStatus?.status === 'downloading'
    || localAiSetupPhase === 'requesting'
    || localAiSetupPhase === 'downloading';

  if (issue.kind === 'permissions') {
    recoveryControl = (
      <div className="grid w-full gap-1 text-left">
        {missingSelectedPermissions.map((permission) => (
          <PermissionSetupRow
            issuePanel
            key={permission.id}
            onChange={() => onRequestPermission(permission.id)}
            permission={permission}
            showDivider={false}
          />
        ))}
      </div>
    );
  } else if (issue.kind === 'transcription-model') {
    recoveryControl = (
      <TranscriptionModelRow
        onCancel={onCancelTranscriptionModelDownload}
        onDownload={onDownloadTranscriptionModel}
        onSelectModel={onSelectTranscriptionModel}
        selectedModelId={selectedTranscriptionModelId}
        status={onboardingStatus}
      />
    );
  } else if (issue.kind === 'local-ai') {
    if (isCloudAiReady && !isLocalAiDownloading) {
      swapControl = (
        <div className="inline-flex items-center gap-1.5">
          <Button aria-label="Swap to Cloud" onClick={() => onSelectAiProvider('cloud')} type="button">
            <span>Swap to Cloud</span>
          </Button>
          <IssueActionInfoIcon
            label="Cloud AI tradeoff details"
            message="Cloud AI is usually faster and more capable, but prompts and transcript context are sent to the cloud provider."
          />
        </div>
      );
    }
    recoveryControl = (
      <LocalAiIssueRecovery
        localAiSetupPhase={localAiSetupPhase}
        localLlmStatus={localLlmStatus}
        onCancelLocalDownload={onCancelLocalAiDownload}
        onDownloadLocalAi={onDownloadLocalAi}
        status={onboardingStatus}
      />
    );
  } else if (issue.kind === 'cloud-ai') {
    if (recommendedLocalAiModelReady) {
      swapControl = (
        <div className="inline-flex items-center gap-1.5">
          <Button aria-label="Swap to Local" onClick={() => onSelectAiProvider('local')} type="button">
            <span>Swap to Local</span>
          </Button>
          <IssueActionInfoIcon
            label="Local AI tradeoff details"
            message="Local AI keeps prompts and transcript context on this computer, but it may be slower than Cloud."
          />
        </div>
      );
    }
    recoveryControl = (
      <AiProviderSetup
        isChatGptSigningIn={isChatGptSigningIn}
        isCloudAiReady={isCloudAiReady}
        localAiSetupPhase={localAiSetupPhase}
        localLlmStatus={localLlmStatus}
        onCancelLocalDownload={onCancelLocalAiDownload}
        onDownloadLocalAi={() => onDownloadLocalAi()}
        onSelectProvider={onSelectAiProvider}
        onSignInWithChatGpt={onSignInWithChatGpt}
        selectedProvider={selectedAiProvider}
        status={onboardingStatus}
      />
    );
  }

  return (
    <div className="grid h-full min-h-0 items-start justify-items-center px-4 py-6 text-center text-sm">
      <div className="grid w-full max-w-xl justify-items-center gap-3 rounded-lg border border-destructive/45 bg-destructive/[0.04] px-5 py-4 shadow-[0_0_28px_rgba(239,68,68,0.12)] dark:border-destructive/40 dark:bg-destructive/[0.08] dark:shadow-[0_0_30px_rgba(248,113,113,0.12)]">
        <div className="text-sm font-medium text-foreground">
          <span>{issue.message}</span>
        </div>
        {issue.kind === 'local-ai' ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {recoveryControl}
            {recoveryControl && swapControl ? (
              <span className="text-sm font-medium text-muted-foreground">or</span>
            ) : null}
            {swapControl}
          </div>
        ) : (
          <>
            {swapControl}
            {recoveryControl}
          </>
        )}
      </div>
    </div>
  );
}

function AiPromptTemplateHint() {
  return (
    <div className={layout.aiPromptTemplateHint} aria-label="Prompt template hint">
      <ArrowUpIcon className={layout.aiPromptTemplateHintIcon} aria-hidden="true" />
      <div className={layout.aiPromptTemplateHintDescription}>
        Pick a prompt template or customise one to change how AI responds.
      </div>
    </div>
  );
}

function GeneralInstructionsDialog({
  instructions,
  isMac,
  onOpenChange,
  onSave,
  open
}: {
  instructions: string;
  isMac: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (instructions: string) => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[85vh] w-[85vw] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-[85vw]"
        showCloseButton={false}
      >
        <PlatformDialogCloseButton isMac={isMac} label="Close general instructions" onClick={() => onOpenChange(false)} />
        <DialogHeader className="h-12 items-center justify-center px-12">
          <DialogTitle>Instructions</DialogTitle>
          <DialogDescription className="sr-only">
            Add preferences you want every AI reply to follow, like spelling, tone, format or how concise to be.
          </DialogDescription>
        </DialogHeader>
        <div className={layout.generalInstructionsEditor}>
          <Field className="min-h-0">
            <FieldLabel htmlFor="general-instructions">
              Add preferences you want every AI reply to follow, like spelling, tone, format or how concise to be.
            </FieldLabel>
            <Textarea
              aria-label="Instructions"
              className="min-h-0 flex-1"
              id="general-instructions"
              onChange={(event) => onSave(event.target.value)}
              placeholder={generalInstructionsPlaceholder}
              value={instructions}
            />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HomePanelTitleBars() {
  return (
    <div className={layout.panelTitleBars} aria-label="Panel titles">
      <div className={layout.panelTitleBar}>
        <span className={layout.panelTitleBarTitle}>Transcript</span>
      </div>
      <div className={layout.panelTitleBar}>
        <span className={layout.panelTitleBarTitle}>AI Chat</span>
      </div>
    </div>
  );
}

function HomeActionToolbar({
  autoSendLabel,
  autoSendTooltip,
  canStartListening,
  canUseAi,
  edge,
  isBusy,
  isListening,
  listenToMicrophone,
  listenToSystemAudio,
  onOpenGeneralInstructions,
  onOpenPromptTemplateSettings,
  onSelectPromptTemplates,
  onSetListenToMicrophone,
  onSetListenToSystemAudio,
  promptTemplateEditAnchorRef,
  promptTemplates,
  sendToAiWhenListeningStops,
  selectedPromptTemplateIds,
  setSendToAiWhenListeningStops,
  startButtonLabel,
  toggleListening
}: {
  autoSendLabel: string;
  autoSendTooltip: string;
  canStartListening: boolean;
  canUseAi: boolean;
  edge: OverlayEdge;
  isBusy: boolean;
  isListening: boolean;
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
  onOpenGeneralInstructions: () => void;
  onOpenPromptTemplateSettings: () => void;
  onSelectPromptTemplates: (ids: string[]) => void;
  onSetListenToMicrophone: (listen: boolean) => void;
  onSetListenToSystemAudio: (listen: boolean) => void;
  promptTemplateEditAnchorRef: (node: HTMLDivElement | null) => void;
  promptTemplates: PromptTemplate[];
  sendToAiWhenListeningStops: boolean;
  selectedPromptTemplateIds: string[];
  setSendToAiWhenListeningStops: (sendToAi: boolean) => void;
  startButtonLabel: string;
  toggleListening: () => void;
}) {
  const isVertical = isVerticalToolbarEdge(edge);
  const tooltipSide = homeTopToolbarTooltipSide;
  const hasAudioSource = listenToMicrophone || listenToSystemAudio;
  const startButtonDisabled = isBusy || !canStartListening;
  const startListeningTooltip = isListening
    ? 'Stop listening and finish the transcript'
    : hasAudioSource
      ? getStartListeningSourceDescription({ listenToMicrophone, listenToSystemAudio })
      : 'Select a sound input or output source to listen to using the source buttons.';
  const autoSendControl = (
    <div className={isVertical ? layout.sideToolbarRow : undefined}>
      <TooltipToggle
        aria-label={autoSendLabel}
        className={isVertical ? layout.sideToolbarButton : layout.compactToolbarButton}
        disabled={!canUseAi}
        flashTooltipOnClick
        onPressedChange={setSendToAiWhenListeningStops}
        pressed={sendToAiWhenListeningStops}
        size="lg"
        tooltip={autoSendTooltip}
        tooltipSide={tooltipSide}
        variant="outline"
      >
        <span className="relative inline-flex size-4 items-center justify-center" data-icon="inline-start">
          <FastForwardIcon className="size-4" data-icon="inline-start" />
          {!sendToAiWhenListeningStops && (
            <span
              aria-hidden="true"
              className="caul-auto-send-off-slash absolute left-1/2 top-1/2 h-0.5 w-[1.1rem] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-current"
            />
          )}
        </span>
        <span className={isVertical ? 'sr-only' : layout.expandedToolbarButtonLabel}>{autoSendLabel}</span>
      </TooltipToggle>
    </div>
  );
  const primaryControls = (
    <div className={isVertical ? layout.transcriptPrimaryActionsVertical : layout.transcriptPrimaryActions}>
      <div className={isVertical ? layout.sideToolbarRow : undefined}>
        <TooltipButton
          aria-label={startButtonLabel}
          className={isVertical ? layout.sideToolbarButton : `${layout.listeningButton} ${layout.compactToolbarButton}`}
          disabled={startButtonDisabled}
          onClick={toggleListening}
          size="lg"
          tooltip={startListeningTooltip}
          tooltipSide={tooltipSide}
          type="button"
          variant={isListening ? 'destructive' : 'default'}
        >
          {isListening ? (
            <>
              <SquareIcon data-icon="inline-start" />
              <span className={isVertical ? layout.sideToolbarButtonLabel : layout.compactToolbarButtonLabel}>{startButtonLabel}</span>
            </>
          ) : (
            <>
              <PlayIcon data-icon="inline-start" />
              <span className={isVertical ? layout.sideToolbarButtonLabel : layout.compactToolbarButtonLabel}>{startButtonLabel}</span>
            </>
          )}
        </TooltipButton>
      </div>
      <div className={isVertical ? layout.transcriptPrimaryActionsVertical : layout.transcriptSourceActions}>
        <ListeningSourceIndicators
          isListening={isListening}
          isVertical={isVertical}
          listenToMicrophone={listenToMicrophone}
          listenToSystemAudio={listenToSystemAudio}
          onSetListenToMicrophone={onSetListenToMicrophone}
          onSetListenToSystemAudio={onSetListenToSystemAudio}
          showLabels={!isVertical}
          tooltipSide={tooltipSide}
        />
        {isVertical ? autoSendControl : null}
      </div>
      {!isVertical ? autoSendControl : null}
    </div>
  );
  const aiControls = (
    <div className={isVertical ? layout.aiToolbarActionsVertical : layout.aiToolbarActions}>
      <PromptTemplateSelector
        isCompact={isVertical}
        onOpenSettings={onOpenPromptTemplateSettings}
        onSelect={onSelectPromptTemplates}
        editAnchorRef={promptTemplateEditAnchorRef}
        selectedTemplateIds={selectedPromptTemplateIds}
        templates={promptTemplates}
        tooltipSide={tooltipSide}
      />
      <div className={isVertical ? layout.sideToolbarRow : layout.aiResponseActions}>
        <TooltipButton
          aria-label="Instructions"
          className={isVertical ? layout.sideToolbarButton : layout.compactToolbarButton}
          onClick={onOpenGeneralInstructions}
          size={isVertical ? 'icon-lg' : 'lg'}
          tooltip="Edit general AI instructions, such as spelling or grammar preferences"
          tooltipSide={tooltipSide}
          type="button"
          variant="outline"
        >
          <FileTextIcon data-icon="inline-start" />
          <span className={isVertical ? 'sr-only' : layout.expandedToolbarButtonLabel}>Instructions</span>
        </TooltipButton>
      </div>
    </div>
  );

  if (isVertical) {
    return (
      <div className={getHomeToolbarClassName(edge)} aria-label="Home actions">
        <div className={`${layout.homeToolbarVerticalSection} ${layout.homeToolbarVerticalSectionTop}`} data-toolbar-section="transcript">
          {primaryControls}
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
      </div>
      <div className={`${layout.homeToolbarHorizontalSection} ${layout.homeToolbarHorizontalSectionAi}`} data-toolbar-section="ai">
        {aiControls}
      </div>
    </div>
  );
}

function HomeBottomActionToolbar({
  canUseAi,
  edge,
  hasAiResponse,
  hasTranscript,
  onAskAiFromTranscript,
  onClearTranscript,
  onCopyAiResponse,
  onCopyTranscript,
  onClearAiResponses,
  onDownloadAiResponse,
  onDownloadTranscript,
  transcriptionIsAsking
}: {
  canUseAi: boolean;
  edge: OverlayEdge;
  hasAiResponse: boolean;
  hasTranscript: boolean;
  onAskAiFromTranscript: () => void;
  onClearTranscript: () => void;
  onClearAiResponses: () => void;
  onCopyAiResponse: () => void;
  onCopyTranscript: () => void;
  onDownloadAiResponse: (format: TranscriptDownloadFormat) => void;
  onDownloadTranscript: (format: TranscriptDownloadFormat) => void;
  transcriptionIsAsking: boolean;
}) {
  const tooltipSide = homeBottomToolbarTooltipSide;

  return (
    <div className={layout.homeToolbarBottomActions} aria-label="Bottom transcript actions">
      <div className={layout.homeToolbarBottomActionSection} data-toolbar-section="transcript-bottom">
        <TranscriptBottomActionControls
          canUseAi={canUseAi}
          hasTranscript={hasTranscript}
          onAskAiFromTranscript={onAskAiFromTranscript}
          onClearTranscript={onClearTranscript}
          onCopyTranscript={onCopyTranscript}
          onDownloadTranscript={onDownloadTranscript}
          showLabels
          tooltipSide={tooltipSide}
          transcriptionIsAsking={transcriptionIsAsking}
        />
      </div>
      <div className={layout.homeToolbarBottomActionSection} data-toolbar-section="ai-bottom">
        <AiResponseBottomActionControls
          hasAiResponse={hasAiResponse}
          onClearAiResponses={onClearAiResponses}
          onCopyAiResponse={onCopyAiResponse}
          onDownloadAiResponse={onDownloadAiResponse}
          showLabels
          tooltipSide={tooltipSide}
        />
      </div>
    </div>
  );
}

function TranscriptBottomActionControls({
  canUseAi,
  hasTranscript,
  onAskAiFromTranscript,
  onClearTranscript,
  onCopyTranscript,
  onDownloadTranscript,
  showLabels = false,
  tooltipSide,
  transcriptionIsAsking
}: {
  canUseAi: boolean;
  hasTranscript: boolean;
  onAskAiFromTranscript: () => void;
  onClearTranscript: () => void;
  onCopyTranscript: () => void;
  onDownloadTranscript: (format: TranscriptDownloadFormat) => void;
  showLabels?: boolean;
  tooltipSide: TooltipSide;
  transcriptionIsAsking: boolean;
}) {
  return (
    <>
      <ButtonGroup className={layout.homeToolbarBottomActionGroup}>
        <TooltipButton
          aria-label="Copy full transcript"
          className={showLabels ? layout.compactToolbarButton : undefined}
          disabled={!hasTranscript}
          onClick={onCopyTranscript}
          size={showLabels ? 'lg' : 'icon-lg'}
          tooltip="Copy full transcript to clipboard"
          tooltipSide={tooltipSide}
          type="button"
          variant="outline"
        >
          <CopyIcon data-icon="inline-start" />
          <span className={showLabels ? layout.expandedToolbarButtonLabel : 'sr-only'}>Copy</span>
        </TooltipButton>
        <DownloadTranscriptPopover
          disabled={!hasTranscript}
          label="Download full transcript"
          onDownload={onDownloadTranscript}
          actionTooltipSide={tooltipSide}
          showTriggerLabel={showLabels}
          tooltipSide={tooltipSide}
          triggerClassName={showLabels ? layout.compactToolbarButton : undefined}
          triggerLabel="Download"
          triggerSize={showLabels ? 'lg' : 'icon-lg'}
        />
        <ConfirmClearButton
          actionLabel="Clear transcript"
          ariaLabel="Clear transcript feed"
          className={showLabels ? layout.compactToolbarButton : undefined}
          description="This removes the transcript from this session."
          disabled={!hasTranscript}
          onConfirm={onClearTranscript}
          showLabels={showLabels}
          size={showLabels ? 'lg' : 'icon-lg'}
          title="Clear transcript?"
          tooltip="Clear transcript feed"
          tooltipSide={tooltipSide}
        />
      </ButtonGroup>
      <TooltipButton
        aria-label="Send full transcript to AI"
        disabled={!canUseAi || !hasTranscript || transcriptionIsAsking}
        className={showLabels ? layout.compactToolbarButton : undefined}
        onClick={onAskAiFromTranscript}
        size={showLabels ? 'lg' : 'icon-lg'}
        tooltip="Send full transcript to AI now"
        tooltipSide={tooltipSide}
        type="button"
        variant="outline"
      >
        <SendIcon data-icon="inline-start" />
        <span className={showLabels ? layout.expandedToolbarButtonLabel : 'sr-only'}>Send</span>
      </TooltipButton>
    </>
  );
}

function AiResponseBottomActionControls({
  hasAiResponse,
  onClearAiResponses,
  onCopyAiResponse,
  onDownloadAiResponse,
  showLabels = false,
  tooltipSide
}: {
  hasAiResponse: boolean;
  onClearAiResponses: () => void;
  onCopyAiResponse: () => void;
  onDownloadAiResponse: (format: TranscriptDownloadFormat) => void;
  showLabels?: boolean;
  tooltipSide: TooltipSide;
}) {
  return (
    <ButtonGroup className={layout.homeToolbarBottomActionGroup}>
      <TooltipButton
      aria-label="Copy all AI responses"
      className={showLabels ? layout.compactToolbarButton : undefined}
      disabled={!hasAiResponse}
      onClick={onCopyAiResponse}
      size={showLabels ? 'lg' : 'icon-lg'}
        tooltip="Copy all AI responses to clipboard"
        tooltipSide={tooltipSide}
        type="button"
        variant="outline"
    >
      <CopyIcon data-icon="inline-start" />
      <span className={showLabels ? layout.expandedToolbarButtonLabel : 'sr-only'}>Copy</span>
    </TooltipButton>
    <DownloadTranscriptPopover
      actionTooltipSide={tooltipSide}
      disabled={!hasAiResponse}
      label="Download all AI responses"
      onDownload={onDownloadAiResponse}
      showTriggerLabel={showLabels}
      textTooltip="Download all AI responses as a plain text file"
      tooltipSide={tooltipSide}
      triggerClassName={showLabels ? layout.compactToolbarButton : undefined}
      triggerLabel="Download"
      triggerSize={showLabels ? 'lg' : 'icon-lg'}
      wordTooltip="Download all AI responses as a Word document"
    />
    <ConfirmClearButton
      actionLabel="Clear responses"
      ariaLabel="Clear AI response feed"
      className={showLabels ? layout.compactToolbarButton : undefined}
      description="This removes all AI responses from this session."
      disabled={!hasAiResponse}
      onConfirm={onClearAiResponses}
      showLabels={showLabels}
      size={showLabels ? 'lg' : 'icon-lg'}
      title="Clear AI responses?"
      tooltip="Clear AI response feed"
      tooltipSide={tooltipSide}
    />
    </ButtonGroup>
  );
}

function ConfirmClearButton({
  actionLabel,
  ariaLabel,
  className,
  description,
  disabled,
  onConfirm,
  showLabels,
  size,
  title,
  tooltip,
  tooltipSide
}: {
  actionLabel: string;
  ariaLabel: string;
  className?: string;
  description: string;
  disabled: boolean;
  onConfirm: () => void;
  showLabels: boolean;
  size: 'lg' | 'icon-lg';
  title: string;
  tooltip: string;
  tooltipSide: TooltipSide;
}) {
  const [open, setOpen] = useState(false);

  function confirm() {
    onConfirm();
    setOpen(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<TooltipButton
          aria-label={ariaLabel}
          className={className}
          disabled={disabled}
          size={size}
          tooltip={tooltip}
          tooltipSide={tooltipSide}
          type="button"
          variant="outline"
        />}
      >
        <Trash2Icon data-icon="inline-start" />
        <span className={showLabels ? layout.expandedToolbarButtonLabel : 'sr-only'}>Clear</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} variant="destructive">{actionLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AiResponseSectionList({
  activeResponseId = null,
  collapsedIds,
  onToggleCollapsed,
  responses
}: {
  activeResponseId?: string | null;
  collapsedIds: Set<string>;
  onToggleCollapsed: (id: string) => void;
  responses: AiResponseSectionData[];
}) {
  return (
    <>
      <div aria-hidden="true" className={layout.historyVirtualSpacer} />
      <div className={layout.transcriptList}>
        {responses.map((response) => (
          <AiResponseSection
            key={response.id}
            id={response.id}
            isCollapsed={collapsedIds.has(response.id)}
            isActive={response.id === activeResponseId}
            onToggleCollapsed={onToggleCollapsed}
            isWaiting={response.isWaiting}
            request={response.request}
            requestedAt={response.requestedAt}
            response={response.response}
          />
        ))}
      </div>
    </>
  );
}

function ListeningSourceIndicators({
  isListening,
  isVertical,
  listenToMicrophone,
  listenToSystemAudio,
  onSetListenToMicrophone,
  onSetListenToSystemAudio,
  showLabels,
  tooltipSide
}: {
  isListening: boolean;
  isVertical: boolean;
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
  onSetListenToMicrophone: (listen: boolean) => void;
  onSetListenToSystemAudio: (listen: boolean) => void;
  showLabels: boolean;
  tooltipSide?: TooltipSide;
}) {
  return (
    <div
      aria-label="Listening sources"
      className={isVertical ? layout.listeningSourceIndicatorsVertical : layout.listeningSourceIndicators}
    >
      <ListeningSourceIndicator
        active={listenToSystemAudio}
        icon={listenToSystemAudio ? <Volume2Icon /> : <VolumeXIcon />}
        label="Speaker"
        onToggle={() => onSetListenToSystemAudio(!listenToSystemAudio)}
        showLabel={showLabels}
        tooltip={getListeningSourceTooltip({
          active: listenToSystemAudio,
          isListening,
          label: 'speaker'
        })}
        title={getListeningSourceTitle({
          active: listenToSystemAudio,
          isListening,
          label: 'speaker'
        })}
        tooltipSide={tooltipSide}
        visibleLabel="Output"
      />
      <ListeningSourceIndicator
        active={listenToMicrophone}
        icon={listenToMicrophone ? <MicIcon /> : <MicOffIcon />}
        label="Microphone"
        onToggle={() => onSetListenToMicrophone(!listenToMicrophone)}
        showLabel={showLabels}
        tooltip={getListeningSourceTooltip({
          active: listenToMicrophone,
          isListening,
          label: 'microphone'
        })}
        title={getListeningSourceTitle({
          active: listenToMicrophone,
          isListening,
          label: 'microphone'
        })}
        tooltipSide={tooltipSide}
        visibleLabel="Input"
      />
    </div>
  );
}

function ListeningSourceIndicator({
  active,
  icon,
  label,
  onToggle,
  showLabel,
  title,
  tooltip,
  tooltipSide,
  visibleLabel
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onToggle: () => void;
  showLabel: boolean;
  title: string;
  tooltip: ReactNode;
  tooltipSide?: TooltipSide;
  visibleLabel: string;
}) {
  return (
    <TooltipToggle
      aria-label={`${label} ${active ? 'on' : 'off'}`}
      className={showLabel ? layout.compactToolbarButton : undefined}
      flashTooltipOnClick
      onPressedChange={onToggle}
      pressed={active}
      size="lg"
      title={title}
      tooltip={tooltip}
      tooltipSide={tooltipSide}
      variant="outline"
    >
      {icon}
      <span className={showLabel ? layout.expandedToolbarButtonLabel : 'sr-only'}>
        {showLabel ? visibleLabel : `${label} ${active ? 'on' : 'off'}`}
      </span>
    </TooltipToggle>
  );
}

function getListeningSourceTooltip({
  label
}: {
  active: boolean;
  isListening: boolean;
  label: string;
}) {
  const source = label === 'speaker'
    ? {
      detail: 'Captures what you hear on your speakers or headphones.',
      name: 'sound output'
    }
    : {
      detail: 'Captures what you say into your microphone.',
      name: 'sound input'
    };

  return (
    <span className="block">
      <span className="block">{source.detail}</span>
    </span>
  );
}

function getListeningSourceTitle({
  label
}: {
  active: boolean;
  isListening: boolean;
  label: string;
}) {
  const source = label === 'speaker'
    ? {
      detail: 'Captures what you hear on your speakers or headphones.',
      name: 'sound output'
    }
    : {
      detail: 'Captures what you say into your microphone.',
      name: 'sound input'
    };

  return source.detail;
}

function AiResponseSection({
  id,
  isActive = false,
  isCollapsed,
  isWaiting = false,
  onToggleCollapsed,
  request = '',
  requestedAt,
  response = ''
}: {
  id: string;
  isActive?: boolean;
  isCollapsed: boolean;
  isWaiting?: boolean;
  onToggleCollapsed: (id: string) => void;
  request?: string;
  requestedAt: string | null;
  response?: string;
}) {
  const hasResponse = response.trim().length > 0;
  const hasRequest = request.trim().length > 0;
  const headerClassName = `${layout.transcriptSectionHeader} ${isActive ? layout.transcriptSectionHeaderActive : ''}`.trim();
  const collapsedPreview = isCollapsed ? response || 'Waiting for response' : null;

  return (
    <article className={`${layout.transcriptSection} ${isActive ? layout.transcriptSectionActive : ''}`.trim()} data-ai-response-active={isActive ? 'true' : undefined} data-ai-response-id={id}>
      <div className={headerClassName}>
        <SectionCollapseButton
          isCollapsed={isCollapsed}
          label="AI response"
          onToggle={() => onToggleCollapsed(id)}
          preview={collapsedPreview}
        />
        <div className={layout.transcriptSectionTitle}>
          <ResponsiveSectionTitle
            compactTitle={getAiResponseSectionCompactTitle(requestedAt)}
            title={getAiResponseSectionTitle(requestedAt)}
          />
        </div>
        <div className={layout.transcriptActions}>
          <TooltipButton
            aria-label="Show AI input"
            disabled={!hasRequest}
            size="icon"
            tooltip={getAiInputTooltip(request)}
            tooltipClassName={layout.sectionPreviewTooltip}
            tooltipInteractive
            tooltipScrollable
            tooltipSide="bottom"
            type="button"
            variant="outline"
          >
            <FileInputIcon />
          </TooltipButton>
          <TooltipButton
            aria-label="Copy this AI response"
            disabled={!hasResponse}
            onClick={() => void navigator.clipboard?.writeText(response)}
            size="icon"
            tooltip={getActionTooltipWithPreview('Copy this AI response to clipboard', collapsedPreview)}
            tooltipClassName={collapsedPreview ? layout.sectionPreviewTooltip : undefined}
            tooltipInteractive={collapsedPreview !== null}
            tooltipScrollable={collapsedPreview !== null}
            tooltipSide="bottom"
            type="button"
            variant="outline"
          >
            <CopyIcon />
          </TooltipButton>
          <DownloadTranscriptPopover
            disabled={!hasResponse}
            label="Download this AI response"
            onDownload={(format) => downloadTextFile(response, format, 'ai-response')}
            preview={collapsedPreview}
            textTooltip="Download this AI response as a plain text file"
            tooltipSide="bottom"
            triggerSize="icon"
            wordTooltip="Download this AI response as a Word document"
          />
        </div>
      </div>
      {!isCollapsed ? (
      <div className={layout.aiSectionBody}>
        {isWaiting && !hasResponse ? (
          <Spinner aria-label="Waiting for response" />
        ) : (
          <SafeMarkdown>{response}</SafeMarkdown>
        )}
      </div>
      ) : null}
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
  aiResponses,
  isAsking,
  llmOutput,
  llmRequestedAt
}: {
  aiResponses: AiResponseSession[];
  isAsking: boolean;
  llmOutput: string;
  llmRequestedAt: string | null;
}): AiResponseSectionData[] {
  const savedResponses = aiResponses.filter((response) => response.response.trim().length > 0 || response.isWaiting);

  if (savedResponses.length > 0) {
    return savedResponses;
  }

  if (isAsking && llmOutput) {
    return [{
      id: 'live-ai-response',
      requestedAt: llmRequestedAt,
      request: '',
      response: llmOutput
    }];
  }

  if (isAsking) {
    return [{
      id: 'live-ai-response-waiting',
      isWaiting: true,
      requestedAt: llmRequestedAt,
      request: '',
      response: ''
    }];
  }

  if (llmOutput) {
    return [{
      id: 'live-ai-response',
      requestedAt: llmRequestedAt,
      request: '',
      response: llmOutput
    }];
  }

  return [];
}

function getAiResponseText(aiResponses: AiResponseSession[]) {
  return aiResponses
    .map((response) => response.response.trim())
    .filter(Boolean)
    .join('\n\n');
}

function reconcileCollapsedSectionIds({
  activeId,
  autoCollapse,
  current,
  ids,
  overrides
}: {
  activeId: string | null;
  autoCollapse: boolean;
  current: Set<string>;
  ids: string[];
  overrides: CollapseOverrides;
}) {
  const visibleIds = new Set(ids);
  const next = new Set<string>();

  for (const id of ids) {
    const override = overrides[id];

    if (override !== undefined) {
      if (override) {
        next.add(id);
      }
      continue;
    }

    if (autoCollapse && id !== activeId) {
      next.add(id);
      continue;
    }

    if (!autoCollapse && current.has(id)) {
      next.add(id);
    }
  }

  for (const id of [...next]) {
    if (!visibleIds.has(id)) {
      next.delete(id);
    }
  }

  return areSetsEqual(current, next) ? current : next;
}

function areSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }

  return true;
}

function scrollSectionToPanelTop(
  scrollElement: HTMLElement | null,
  sectionId: string | null,
  dataAttribute: 'data-ai-response-id' | 'data-transcript-session-id'
) {
  if (!sectionId || !scrollElement) {
    return;
  }

  const nextScrollTop = updateHistoryVirtualGeometry(scrollElement, sectionId, dataAttribute);

  if (nextScrollTop === null) {
    return;
  }

  scrollElement.scrollTop = nextScrollTop;
}

function updateHistoryVirtualGeometry(
  scrollElement: HTMLElement | null,
  sectionId: string | null,
  dataAttribute: 'data-ai-response-id' | 'data-transcript-session-id'
) {
  if (!sectionId || !scrollElement) {
    return null;
  }

  const activeSection = Array.from(scrollElement.querySelectorAll<HTMLElement>(`[${dataAttribute}]`))
    .find((element) => element.getAttribute(dataAttribute) === sectionId);

  if (!activeSection) {
    return null;
  }

  const activeOffsetTop = getOffsetTopWithinScrollElement(activeSection, scrollElement);
  const activeHeight = activeSection.offsetHeight;
  const virtualHeight = Math.max(
    scrollElement.clientHeight,
    activeOffsetTop + Math.max(activeHeight, scrollElement.clientHeight)
  );

  scrollElement.style.setProperty('--caul-history-virtual-height', `${virtualHeight}px`);

  return activeOffsetTop;
}

function getOffsetTopWithinScrollElement(element: HTMLElement, scrollElement: HTMLElement) {
  let offsetTop = element.offsetTop;
  let parent = element.offsetParent as HTMLElement | null;

  while (parent && parent !== scrollElement) {
    offsetTop += parent.offsetTop;
    parent = parent.offsetParent as HTMLElement | null;
  }

  if (parent === scrollElement) {
    return offsetTop;
  }

  const elementBounds = element.getBoundingClientRect();
  const scrollBounds = scrollElement.getBoundingClientRect();

  return scrollElement.scrollTop + elementBounds.top - scrollBounds.top;
}

function scrollSectionToPanelTopAfterRender(
  scrollElement: HTMLElement | null,
  sectionId: string | null,
  dataAttribute: 'data-ai-response-id' | 'data-transcript-session-id'
) {
  scrollSectionToPanelTop(scrollElement, sectionId, dataAttribute);

  if (!sectionId || !scrollElement) {
    return undefined;
  }

  let firstAnimationFrame = 0;
  let secondAnimationFrame = 0;

  firstAnimationFrame = window.requestAnimationFrame(() => {
    scrollSectionToPanelTop(scrollElement, sectionId, dataAttribute);
    secondAnimationFrame = window.requestAnimationFrame(() => {
      scrollSectionToPanelTop(scrollElement, sectionId, dataAttribute);
    });
  });

  return () => {
    window.cancelAnimationFrame(firstAnimationFrame);
    window.cancelAnimationFrame(secondAnimationFrame);
  };
}

function readBooleanPreference(key: string, fallback: boolean) {
  const value = window.localStorage.getItem(key);

  if (value === null) {
    return fallback;
  }

  return value === '1';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isScrollFixtureEnabled() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has(scrollFixtureQueryParam);
}

function isStreamFixtureEnabled() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has(streamFixtureQueryParam);
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
    confirmedOutput: [title, ...lines].join('\n'),
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

function TranscriptSessionList({
  activeSessionId = null,
  canUseAi,
  collapsedIds,
  isAsking,
  onAskAi,
  onToggleCollapsed,
  sessions
}: {
  activeSessionId?: string | null;
  canUseAi: boolean;
  collapsedIds: Set<string>;
  isAsking: boolean;
  onAskAi: (transcript: string) => void;
  onToggleCollapsed: (id: string) => void;
  sessions: TranscriptSession[];
}) {
  return (
    <>
      <div aria-hidden="true" className={layout.historyVirtualSpacer} />
      <div className={layout.transcriptList}>
        {sessions.map((session) => (
          <TranscriptSessionSection
            key={session.id}
            isActive={session.id === activeSessionId}
            isAsking={isAsking}
            canUseAi={canUseAi}
            isCollapsed={collapsedIds.has(session.id)}
            onAskAi={onAskAi}
            onToggleCollapsed={onToggleCollapsed}
            session={session}
          />
        ))}
      </div>
    </>
  );
}

function TranscriptSessionSection({
  canUseAi,
  isActive = false,
  isAsking,
  isCollapsed,
  onAskAi,
  onToggleCollapsed,
  session
}: {
  canUseAi: boolean;
  isActive?: boolean;
  isAsking: boolean;
  isCollapsed: boolean;
  onAskAi: (transcript: string) => void;
  onToggleCollapsed: (id: string) => void;
  session: TranscriptSession;
}) {
  const headerClassName = `${layout.transcriptSectionHeader} ${isActive ? layout.transcriptSectionHeaderActive : ''}`.trim();
  const confirmedTranscript = session.confirmedOutput ?? session.output;
  const confirmedBody = getTranscriptSectionBody(confirmedTranscript);
  const draftBody = session.draftOutput ? getTranscriptSectionBody(session.draftOutput) : '';
  const statusBody = !confirmedBody && !draftBody ? getTranscriptSectionBody(session.output) : '';
  const collapsedPreview = isCollapsed ? confirmedBody : null;
  const hasConfirmedTranscript = isTranscriptTextCopyable(confirmedTranscript);

  return (
        <article className={`${layout.transcriptSection} ${isActive ? layout.transcriptSectionActive : ''}`.trim()} data-transcript-session-active={isActive ? 'true' : undefined} data-transcript-session-id={session.id}>
          <div className={headerClassName}>
            <SectionCollapseButton
              isCollapsed={isCollapsed}
              label="transcript section"
              onToggle={() => onToggleCollapsed(session.id)}
              preview={collapsedPreview}
            />
            <div className={layout.transcriptSectionTitle}>
              <ResponsiveSectionTitle
                compactTitle={getTranscriptSectionCompactTitle(session.output)}
                title={getTranscriptSectionTitle(session.output)}
              />
            </div>
            <div className={layout.transcriptActions}>
              <TooltipButton
                aria-label="Copy this transcript"
                disabled={!hasConfirmedTranscript}
                onClick={() => void navigator.clipboard?.writeText(confirmedTranscript)}
                size="icon"
                tooltip={getActionTooltipWithPreview('Copy this transcript to clipboard', collapsedPreview)}
                tooltipClassName={collapsedPreview ? layout.sectionPreviewTooltip : undefined}
                tooltipInteractive={collapsedPreview !== null}
                tooltipScrollable={collapsedPreview !== null}
                tooltipSide="bottom"
                type="button"
                variant="outline"
              >
                <CopyIcon />
              </TooltipButton>
              <DownloadTranscriptPopover
                disabled={!hasConfirmedTranscript}
                label="Download this transcript"
                onDownload={(format) => downloadTranscriptFile(confirmedTranscript, format)}
                preview={collapsedPreview}
                tooltipSide="bottom"
                triggerSize="icon"
              />
              <TooltipButton
                aria-label="Send this transcript to AI"
                disabled={!canUseAi || isAsking || !hasConfirmedTranscript}
                onClick={() => onAskAi(confirmedTranscript)}
                size="icon"
                tooltip={getActionTooltipWithPreview('Send this transcript to AI now', collapsedPreview)}
                tooltipClassName={collapsedPreview ? layout.sectionPreviewTooltip : undefined}
                tooltipInteractive={collapsedPreview !== null}
                tooltipScrollable={collapsedPreview !== null}
                tooltipSide="bottom"
                type="button"
                variant="outline"
              >
                <SendIcon />
              </TooltipButton>
            </div>
          </div>
          {!isCollapsed ? (
          <div className={layout.transcriptSectionBody}>
            {statusBody}
            {confirmedBody}
            {draftBody ? (
              <div className="transcript-draft-tail">{draftBody}</div>
            ) : null}
          </div>
          ) : null}
        </article>
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

function SectionCollapseButton({
  isCollapsed,
  label,
  onToggle,
  preview = null
}: {
  isCollapsed: boolean;
  label: string;
  onToggle: () => void;
  preview?: string | null;
}) {
  const button = (
    <Button
      aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${label}`}
      className={layout.sectionCollapseButton}
      onClick={onToggle}
      size="icon"
      type="button"
      variant="ghost"
    >
      {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
    </Button>
  );

  if (!preview) {
    return button;
  }

  return (
    <Tooltip disableHoverablePopup={false}>
      <TooltipTrigger render={button} />
      <TooltipContent className={layout.sectionPreviewTooltip} previewScrollable side="bottom">
        <div className="markdown-output">
          <SafeMarkdown>{formatPreviewMarkdown(preview)}</SafeMarkdown>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function formatPreviewMarkdown(markdown: string) {
  return markdown.replace(/(?<!\n)\n(?!\n)/g, '  \n');
}

function getActionTooltipWithPreview(label: string, preview: string | null) {
  if (!preview) {
    return label;
  }

  return (
    <div>
      <div className="mb-3 font-medium">{label}</div>
      <div className="markdown-output border-t border-primary-foreground/20 pt-3">
        <SafeMarkdown>{formatPreviewMarkdown(preview)}</SafeMarkdown>
      </div>
    </div>
  );
}

function getAiInputTooltip(request: string) {
  return (
    <div>
      <div className="mb-3 font-medium">AI input</div>
      <div className="markdown-output border-t border-primary-foreground/20 pt-3">
        <SafeMarkdown>{formatPreviewMarkdown(request)}</SafeMarkdown>
      </div>
    </div>
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
  editAnchorRef,
  isCompact = false,
  onOpenSettings,
  onSelect,
  selectedTemplateIds,
  templates,
  tooltipSide
}: {
  editAnchorRef: (node: HTMLDivElement | null) => void;
  isCompact?: boolean;
  onOpenSettings: () => void;
  onSelect: (ids: string[]) => void;
  selectedTemplateIds: string[];
  templates: PromptTemplate[];
  tooltipSide?: TooltipSide;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selectedTemplates = selectedTemplateIds
    .map((id) => templates.find((template) => template.id === id))
    .filter((template): template is PromptTemplate => Boolean(template));
  const selectedTemplateName = selectedTemplates.length === 0
    ? 'No template'
    : selectedTemplates.length === 1
      ? selectedTemplates[0].name
      : selectedTemplates.map((template) => template.name).join(' + ');
  const selectedTemplateTooltip = selectedTemplates.length === 0
    ? 'Selected prompt templates:\nNo template'
    : `Selected prompt templates:\n${selectedTemplates.map((template) => template.name).join('\n')}`;
  const filteredTemplates = templates.filter((template) => (
    template.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  ));

  return (
    <div className={isCompact ? layout.promptTemplateSelectorRootVertical : layout.promptTemplateSelectorRoot}>
      <div className={isCompact ? layout.promptTemplateSelectorPickerVertical : layout.promptTemplateSelectorPicker}>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={<PopoverTrigger
              render={<Button
                aria-label="Prompt template"
                className={isCompact ? layout.promptTemplateTriggerVertical : layout.promptTemplateTrigger}
                size={isCompact ? 'icon-lg' : 'lg'}
                type="button"
                variant="outline"
              />}
            >
              <ListChecksIcon className={layout.promptTemplateCompactIcon} />
              <span className={isCompact ? 'sr-only' : 'prompt-template-trigger-label min-w-0 flex-1 truncate text-left'}>
                {selectedTemplateName}
              </span>
              <ChevronDownIcon className="prompt-template-trigger-chevron" />
            </PopoverTrigger>}
          />
          <TooltipContent className="max-w-64 whitespace-pre-line" side={tooltipSide}>
            {selectedTemplateTooltip}
          </TooltipContent>
        </Tooltip>
        <PopoverContent aria-label="Prompt templates" align="start" className="w-80">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search prompt templates"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search prompt templates"
              value={search}
            />
          </InputGroup>
          <div className={`${layout.pickerList} ${layout.pickerListScrollable}`}>
            <VerticalToggleGroup
              aria-label="Selected prompt templates"
              className="w-full"
              multiple
              onValueChange={(value) => {
                if (value.includes('__none__') && selectedTemplateIds.length > 0) {
                  onSelect([]);
                  setSearch('');
                  return;
                }
                onSelect(value.filter((id) => id !== '__none__'));
              }}
              value={selectedTemplateIds.length === 0 ? ['__none__'] : selectedTemplateIds}
            >
            <ToggleGroupItem className="w-full justify-start" value="__none__">
              <span className={layout.pickerItemLabel}>No template</span>
            </ToggleGroupItem>
            {filteredTemplates.map((template) => {
              const isSelected = selectedTemplateIds.includes(template.id);

              return (
                <ToggleGroupItem
                  key={template.id}
                  className="w-full justify-start"
                  value={template.id}
                >
                  {isSelected ? <CheckCircle2Icon aria-hidden="true" data-icon="inline-start" /> : null}
                  <span className={layout.pickerItemLabel}>{template.name}</span>
                </ToggleGroupItem>
              );
            })}
            {filteredTemplates.length === 0 ? (
              <Empty className="py-4">
                <EmptyHeader>
                  <EmptyTitle>No templates found</EmptyTitle>
                  <EmptyDescription>Try a different search.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            </VerticalToggleGroup>
          </div>
        </PopoverContent>
      </Popover>
      </div>
      <div
        ref={editAnchorRef}
        className={isCompact ? layout.promptTemplateSelectorEditVertical : layout.promptTemplateSelectorEdit}
      >
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
          <span className="sr-only">Edit</span>
        </TooltipButton>
      </div>
    </div>
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
  const [visibleTemplates, setVisibleTemplates] = useState<PromptTemplate[]>(templates);
  const [activeId, setActiveId] = useState<string | null>(templates[0]?.id ?? null);
  const activeTemplate = visibleTemplates.find((template) => template.id === activeId) ?? visibleTemplates[0] ?? null;
  const [draft, setDraft] = useState<PromptTemplate>(() => activeTemplate ?? createPromptTemplate({ name: '', prompt: '' }));
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const draftAttachments = draft.attachments ?? [];
  const modelAttachmentSupport = getLlmModelAttachmentSupport(currentModel);

  useEffect(() => {
    if (open) {
      setVisibleTemplates(templates);
    }
  }, [open, templates]);

  useEffect(() => {
    if (!open) {
      setDeleteConfirmationId(null);
      return;
    }

    const nextTemplate = templates.find((template) => template.id === activeId) ?? templates[0] ?? createPromptTemplate({ name: '', prompt: '' });
    setActiveId(nextTemplate.id);
    setDraft(nextTemplate);
  }, [open]);

  function createNewTemplate() {
    const template = withPromptTemplateTimestamp(createPromptTemplate({ name: '', prompt: '' }));
    setVisibleTemplates((items) => [...items, template]);
    selectTemplate(template);
    setDeleteConfirmationId(null);
  }

  function selectTemplate(template: PromptTemplate) {
    setActiveId(template.id);
    setDraft(template);
    setDeleteConfirmationId(null);
  }

  function updateDraft(updates: Partial<PromptTemplate>) {
    setDraft((template) => {
      const nextTemplate = withPromptTemplateTimestamp({
        ...template,
        ...updates
      });

      setVisibleTemplates((items) => (
        items.some((item) => item.id === nextTemplate.id)
          ? items.map((item) => (item.id === nextTemplate.id ? nextTemplate : item))
          : [...items, nextTemplate]
      ));
      if (nextTemplate.name.trim()) {
        onSave(normalisePromptTemplateDraft(nextTemplate));
      }
      return nextTemplate;
    });
  }

  async function addAttachments() {
    const attachments = await onChooseAttachments();

    if (attachments.length === 0) {
      return;
    }

    updateDraft({
      attachments: mergePromptTemplateAttachments(draftAttachments, attachments)
    });
  }

  function removeAttachment(id: string) {
    updateDraft({
      attachments: draftAttachments.filter((attachment) => attachment.id !== id)
    });
  }

  function deleteTemplate(id: string) {
    onDelete(id);
    const nextTemplates = visibleTemplates.filter((template) => template.id !== id);
    setVisibleTemplates(nextTemplates);
    const nextTemplate = nextTemplates.find((template) => template.id !== activeId) ?? nextTemplates[0] ?? null;
    setActiveId(nextTemplate?.id ?? null);
    setDraft(nextTemplate ?? createPromptTemplate({ name: '', prompt: '' }));
    setDeleteConfirmationId(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[85vh] w-[85vw] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-[85vw]"
        showCloseButton={false}
      >
        <PlatformDialogCloseButton isMac={isMac} label="Close prompt templates" onClick={() => onOpenChange(false)} />
        <DialogHeader className="h-12 items-center justify-center px-12">
          <DialogTitle>Prompt templates</DialogTitle>
          <DialogDescription className="sr-only">
            Save reusable instructions that are prepended to transcript requests.
          </DialogDescription>
        </DialogHeader>
        <div className={layout.promptTemplateEditor}>
          <div className={layout.promptTemplateSidebar}>
            <Button onClick={createNewTemplate} type="button" variant="outline">
              New template
            </Button>
            <VerticalToggleGroup
              aria-label="Prompt template"
              className={`${layout.pickerList} ${layout.pickerListScrollable} w-full`}
              onValueChange={(value) => {
                const nextId = value.at(-1);
                const nextTemplate = visibleTemplates.find((template) => template.id === nextId);
                if (nextTemplate) selectTemplate(nextTemplate);
              }}
              value={activeId ? [activeId] : []}
            >
              {visibleTemplates.map((template) => (
                <div key={template.id} className={layout.pickerRow}>
                  <ToggleGroupItem
                    aria-current={activeId === template.id ? 'true' : undefined}
                    className="w-full justify-start pr-8"
                    value={template.id}
                  >
                    <span className={layout.pickerItemLabel}>{getPromptTemplateDisplayName(template)}</span>
                  </ToggleGroupItem>
                  <AlertDialog
                    open={deleteConfirmationId === template.id}
                    onOpenChange={(nextOpen) => setDeleteConfirmationId(nextOpen ? template.id : null)}
                  >
                    <AlertDialogTrigger
                      render={<Button
                        aria-label={`Delete ${getPromptTemplateDisplayName(template)}`}
                        className="absolute right-1 top-1/2 -translate-y-1/2"
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      />}
                    >
                      <XIcon />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this template?</AlertDialogTitle>
                        <AlertDialogDescription>This removes it from your saved prompt templates.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteTemplate(template.id)} variant="destructive">
                          Confirm delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </VerticalToggleGroup>
          </div>
          <div className={layout.promptTemplateEditorForm}>
            <Field>
              <FieldLabel htmlFor="prompt-template-name">Name</FieldLabel>
              <Input
                id="prompt-template-name"
                onChange={(event) => updateDraft({ name: event.target.value })}
                placeholder="Summarise this phone call"
                value={draft.name}
              />
            </Field>
            <div className={layout.promptTemplateBody}>
              <Field className="min-h-0">
                <FieldLabel htmlFor="prompt-template-prompt">Prompt</FieldLabel>
                <Textarea
                  className="min-h-0 flex-1"
                  id="prompt-template-prompt"
                  onChange={(event) => updateDraft({ prompt: event.target.value })}
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
                    <PaperclipIcon data-icon="inline-start" />
                    Add files
                  </Button>
                </div>
                <div className={layout.promptTemplateAttachmentList} aria-label="Prompt template attachments">
                  {draftAttachments.length === 0 ? (
                    <Empty className="py-4">
                      <EmptyHeader>
                        <EmptyTitle>No attachments</EmptyTitle>
                        <EmptyDescription>Add a supported file to include it with this template.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
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
                {draftAttachments.length > 0 && (
                  <p className={layout.settingsDescription}>
                    Local reads supported document text. Cloud sends the file to ChatGPT.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getPromptTemplateDisplayName(template: PromptTemplate) {
  return template.name.trim() || 'Untitled';
}

function formatUpdateVersionLine(status: UpdateStatus | null) {
  if (!status) {
    return 'Loading update status.';
  }

  const channel = formatAppChannelLabel(status.appChannel);

  return `${status.appName} ${status.appVersion} · ${channel}`;
}

function formatAppChannelLabel(channel: string) {
  if (channel === 'beta') {
    return 'Beta';
  }

  if (channel === 'dev') {
    return 'Dev';
  }

  if (channel === 'dev-private') {
    return 'Dev-Private';
  }

  return 'Stable';
}

function formatUpdateStatusLine(status: UpdateStatus | null) {
  if (!status) {
    return 'Last checked: Not available yet.';
  }

  if (!status.enabled) {
    return 'Update checks are disabled for this build.';
  }

  const lastChecked = status.lastCheckedAt
    ? new Date(status.lastCheckedAt).toLocaleString()
    : 'Never';

  if (status.downloading) {
    return `Last checked: ${lastChecked}.`;
  }

  const message = status.lastResult?.message ?? 'Automatic checks are ready.';

  return `Last checked: ${lastChecked}. ${message}`;
}

function isUpdateDownloaded(status: UpdateStatus | null) {
  return status?.lastResult?.status === 'ready' || status?.lastResult?.status === 'downloaded';
}

function isUpdateInstalling(status: UpdateStatus | null) {
  return status?.lastResult?.status === 'installing';
}

function getSettingsSectionForTarget(target: SettingsTarget): SettingsSection {
  if (target === 'models:transcription') {
    return 'transcription';
  }

  if (target === 'models:ai') {
    return 'ai';
  }

  if (target === 'permissions') {
    return 'general';
  }

  return target;
}

function getTranscriptPanelIssue({
  missingSelectedPermissions,
  parakeetStatus
}: {
  missingSelectedPermissions: PermissionItem[];
  parakeetStatus: ParakeetStatus | null;
}): PanelIssue | null {
  if (missingSelectedPermissions.length > 0) {
    return {
      id: 'missing-permissions',
      kind: 'permissions',
      message: 'Permissions are needed before listening.',
      target: 'permissions'
    };
  }

  if (parakeetStatus?.status === 'downloading') {
    return {
      id: 'transcription-model-downloading',
      kind: 'transcription-model',
      message: 'Finish downloading the transcription model before listening.',
      target: 'models:transcription'
    };
  }

  if (parakeetStatus && !parakeetStatus.installed) {
    return {
      id: 'transcription-model-missing',
      kind: 'transcription-model',
      message: 'Download a transcription model before listening.',
      target: 'models:transcription'
    };
  }

  return null;
}

function getAiPanelIssue({
  isCloudAiReady,
  isLocalAiReady,
  localLlmStatus,
  selectedAiProvider
}: {
  isCloudAiReady: boolean;
  isLocalAiReady: boolean;
  localLlmStatus: LocalLlmStatus | null;
  selectedAiProvider: AiProvider;
}): PanelIssue | null {
  if (
    selectedAiProvider === 'local'
    && localLlmStatus
    && !isLocalAiReady
  ) {
    const localStatus = localLlmStatus?.status ?? 'missing';

    return {
      id: 'local-ai-setup',
      kind: 'local-ai',
      message: localStatus === 'error'
        ? 'Local AI needs attention before AI responses can work.'
        : localStatus === 'downloading'
          ? 'Local AI is downloading before AI responses can work.'
          : 'Local AI needs setup before AI responses can work.',
      target: 'models:ai'
    };
  }

  if (selectedAiProvider === 'cloud' && !isCloudAiReady) {
    return {
      id: 'cloud-ai-setup',
      kind: 'cloud-ai',
      message: 'Cloud AI needs sign-in before AI responses can work.',
      target: 'models:ai'
    };
  }

  return null;
}

function getMainNotifications({
  aiIssue,
  missingSelectedPermissions,
  parakeetStatus,
  transcriptIssue,
  updateStatus
}: {
  aiIssue: PanelIssue | null;
  missingSelectedPermissions: PermissionItem[];
  parakeetStatus: ParakeetStatus | null;
  transcriptIssue: PanelIssue | null;
  updateStatus: UpdateStatus | null;
}): MainNotification[] {
  const notifications: MainNotification[] = [];

  if (updateStatus?.lastResult?.status === 'error') {
    notifications.push({
      id: 'app-update-error',
      label: 'App update needs attention',
      target: 'general',
      tone: 'error'
    });
  } else if (isUpdateInstalling(updateStatus)) {
    notifications.push({
      id: 'app-update-installing',
      label: 'App update installing',
      target: 'general',
      tone: 'progress'
    });
  } else if (isUpdateDownloaded(updateStatus)) {
    notifications.push({
      id: 'app-update-ready',
      label: 'App update ready',
      target: 'general',
      tone: 'action'
    });
  } else if (updateStatus?.availableUpdate) {
    notifications.push({
      id: 'app-update-available',
      label: 'App update available',
      target: 'general',
      tone: updateStatus.downloading ? 'progress' : 'action'
    });
  }

  if (missingSelectedPermissions.length > 0 && transcriptIssue?.id === 'missing-permissions') {
    notifications.push({
      id: 'permissions-setup',
      label: 'Permissions need setup',
      target: 'permissions',
      tone: 'error'
    });
  }

  if (aiIssue) {
    notifications.push({
      id: aiIssue.id,
      label: aiIssue.id === 'cloud-ai-setup' ? 'Cloud AI needs setup' : 'Local AI needs setup',
      target: aiIssue.target,
      tone: 'error'
    });
  }

  if (parakeetStatus?.status === 'missing') {
    notifications.push({
      id: 'transcription-model-setup',
      label: 'Transcription model needs setup',
      target: 'models:transcription',
      tone: 'error'
    });
  } else if (parakeetStatus?.status === 'downloading') {
    notifications.push({
      id: 'transcription-model-downloading',
      label: 'Transcription model downloading',
      target: 'models:transcription',
      tone: 'error'
    });
  }

  return notifications;
}

function normalisePromptTemplateDraft(template: PromptTemplate) {
  return {
    ...template,
    attachments: template.attachments ?? [],
    name: getPromptTemplateDisplayName(template),
    updatedAt: template.updatedAt
  };
}

function withPromptTemplateTimestamp(template: PromptTemplate) {
  return {
    ...template,
    attachments: template.attachments ?? [],
    updatedAt: new Date().toISOString()
  };
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
    <MacosWindowButton
      action="close"
      aria-label={label}
      onClick={onClick}
      placement="dialog"
      title={label}
    />
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

  return onClick ? closeButton : <DialogClose render={closeButton} />;
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
    description: 'Text, DOCX and RTF work locally. Cloud can use PDFs and images through ChatGPT.',
    supportedKinds: ['file', 'image', 'text']
  };
}

function formatAttachmentMetadata(attachment: PromptTemplateAttachment) {
  const type = attachment.kind[0].toLocaleUpperCase() + attachment.kind.slice(1);

  return `${type} · ${formatBytes(attachment.sizeBytes)}`;
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
  preview = null,
  showTriggerLabel = false,
  textTooltip = 'Download full transcript as a plain text file',
  triggerClassName,
  triggerLabel = 'Download',
  tooltipSide,
  triggerSize = 'icon-lg',
  wordTooltip = 'Download full transcript as a Word document'
}: {
  actionTooltipSide?: TooltipSide;
  disabled: boolean;
  label?: string;
  onDownload: (format: TranscriptDownloadFormat) => void;
  preview?: string | null;
  showTriggerLabel?: boolean;
  textTooltip?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  tooltipSide?: TooltipSide;
  triggerSize?: React.ComponentProps<typeof Button>['size'];
  wordTooltip?: string;
}) {
  return (
    <Popover>
      <Tooltip disableHoverablePopup={preview ? false : undefined}>
        <TooltipTrigger
          render={<PopoverTrigger
            render={<Button
              aria-label={label}
              className={triggerClassName}
              disabled={disabled}
              size={triggerSize}
              type="button"
              variant="outline"
            />}
          >
            <DownloadIcon data-icon="inline-start" />
            <span className={showTriggerLabel ? layout.expandedToolbarButtonLabel : 'sr-only'}>{triggerLabel}</span>
          </PopoverTrigger>}
        />
        <TooltipContent
          className={preview ? layout.sectionPreviewTooltip : undefined}
          previewScrollable={Boolean(preview)}
          side={tooltipSide}
        >
          {getActionTooltipWithPreview(label, preview)}
        </TooltipContent>
      </Tooltip>
      <PopoverContent aria-label={label ?? 'Download options'} align="end" className="w-48">
        <TooltipButton
          className="justify-start"
          onClick={() => onDownload('txt')}
          tooltipSide={actionTooltipSide ?? 'right'}
          tooltip={textTooltip}
          type="button"
          variant="ghost"
        >
          <FileTextIcon data-icon="inline-start" />
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
          <FileTextIcon data-icon="inline-start" />
          Word document
        </TooltipButton>
      </PopoverContent>
    </Popover>
  );
}

function TooltipButton({
  flashTooltipOnClick = false,
  onClick,
  tooltip,
  tooltipClassName,
  tooltipInteractive = false,
  tooltipScrollable = false,
  tooltipSide,
  ...props
}: React.ComponentProps<typeof Button> & {
  flashTooltipOnClick?: boolean;
  tooltip: React.ReactNode;
  tooltipClassName?: string;
  tooltipInteractive?: boolean;
  tooltipScrollable?: boolean;
  tooltipSide?: TooltipSide;
}) {
  const [isTooltipFlashed, setIsTooltipFlashed] = useState(false);
  const flashTimeoutRef = useRef<number | null>(null);
  const shouldUseNativeTitle = props['aria-disabled'] === true || props['aria-disabled'] === 'true';
  const buttonTitle = shouldUseNativeTitle && typeof tooltip === 'string' && typeof props.title === 'undefined'
    ? tooltip
    : props.title;
  const button = <Button {...props} title={buttonTitle} onClick={handleClick} />;

  useEffect(() => () => {
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
  }, []);

  function handleClick(
    event: Parameters<NonNullable<React.ComponentProps<typeof Button>['onClick']>>[0]
  ) {
    onClick?.(event);

    if (!flashTooltipOnClick || event.defaultPrevented) {
      return;
    }

    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
    }

    setIsTooltipFlashed(true);
    flashTimeoutRef.current = window.setTimeout(() => {
      setIsTooltipFlashed(false);
      flashTimeoutRef.current = null;
    }, 1400);
  }

  const tooltipProps = isTooltipFlashed
    ? {
      onOpenChange: (open: boolean) => {
        if (!open) {
          setIsTooltipFlashed(false);
        }
      },
      open: true
    }
    : {};

  if (props.disabled) {
    return button;
  }

  return (
    <Tooltip disableHoverablePopup={tooltipInteractive ? false : undefined} {...tooltipProps}>
      <TooltipTrigger render={button} />
      <TooltipContent className={tooltipClassName} previewScrollable={tooltipScrollable} side={tooltipSide}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function TooltipToggle({
  flashTooltipOnClick = false,
  onPressedChange,
  tooltip,
  tooltipSide,
  ...props
}: React.ComponentProps<typeof Toggle> & {
  flashTooltipOnClick?: boolean;
  tooltip: React.ReactNode;
  tooltipSide?: TooltipSide;
}) {
  const [isTooltipFlashed, setIsTooltipFlashed] = useState(false);
  const flashTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
  }, []);

  function handlePressedChange(
    pressed: boolean,
    eventDetails: Parameters<NonNullable<React.ComponentProps<typeof Toggle>['onPressedChange']>>[1]
  ) {
    onPressedChange?.(pressed, eventDetails);
    if (!flashTooltipOnClick) return;

    if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
    setIsTooltipFlashed(true);
    flashTimeoutRef.current = window.setTimeout(() => {
      setIsTooltipFlashed(false);
      flashTimeoutRef.current = null;
    }, 1400);
  }

  const toggle = <Toggle {...props} onPressedChange={handlePressedChange} />;
  if (props.disabled) return toggle;
  return (
    <Tooltip open={isTooltipFlashed} onOpenChange={setIsTooltipFlashed}>
      <TooltipTrigger render={toggle} />
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function downloadTranscriptFile(transcript: string, format: TranscriptDownloadFormat) {
  downloadTextFile(transcript, format, 'transcript');
}

function downloadTextFile(text: string, format: TranscriptDownloadFormat, kind: 'ai-response' | 'transcript') {
  const isWord = format === 'docx';
  const blob = new Blob(
    [isWord ? createDocxTranscriptDocument(text) : text],
    { type: isWord ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain;charset=utf-8' }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `caul-${kind}-${getTranscriptDownloadTimestamp(text)}.${format}`;
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

function mergeStarterPromptTemplates(templates: PromptTemplate[]) {
  const starterTemplatesById = new Map(starterPromptTemplates.map((template) => [template.id, template]));
  const customTemplates = templates.filter((template) => !starterTemplatesById.has(template.id));

  return resolvePromptTemplateNameCollisions([
    ...starterPromptTemplates,
    ...customTemplates
  ]);
}

function getCustomStarterPromptTemplateId(id: string) {
  return `custom-${id}`;
}

function isStarterPromptTemplateCustomised(template: PromptTemplate, starterTemplate: PromptTemplate) {
  return template.name !== starterTemplate.name
    || template.prompt !== starterTemplate.prompt
    || (template.attachments ?? []).length > 0;
}

function asCustomStarterPromptTemplate(template: PromptTemplate, existingTemplates: PromptTemplate[] = []) {
  const customId = getCustomStarterPromptTemplateId(template.id);
  const existingCustom = existingTemplates.find((item) => item.id === customId);
  const collisionTemplates = existingTemplates.filter((item) => item.id !== customId && item.id !== template.id);

  return {
    ...template,
    createdAt: existingCustom?.createdAt ?? template.createdAt,
    id: customId,
    name: getAvailablePromptTemplateName(template.name, collisionTemplates),
    updatedAt: template.updatedAt
  };
}

function getAvailablePromptTemplateName(name: string, templates: PromptTemplate[]) {
  const baseName = name.trim() || 'Untitled';
  const usedNames = new Set(templates
    .map((template) => template.name.trim().toLocaleLowerCase())
    .filter(Boolean));

  if (!usedNames.has(baseName.toLocaleLowerCase())) {
    return baseName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName} ${index}`;

    if (!usedNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  return `${baseName} ${Date.now()}`;
}

function resolvePromptTemplateNameCollisions(templates: PromptTemplate[]) {
  const starterTemplateIds = new Set(starterPromptTemplates.map((template) => template.id));

  return templates.reduce<PromptTemplate[]>((items, template) => {
    if (starterTemplateIds.has(template.id)) {
      return [...items, template];
    }

    return [
      ...items,
      {
        ...template,
        name: getAvailablePromptTemplateName(template.name, items)
      }
    ];
  }, []);
}

function preserveCustomisedStarterPromptTemplates(templates: PromptTemplate[]) {
  const starterTemplatesById = new Map(starterPromptTemplates.map((template) => [template.id, template]));
  const preservedCustomStarters = templates
    .filter((template) => {
      const starterTemplate = starterTemplatesById.get(template.id);
      return starterTemplate && isStarterPromptTemplateCustomised(template, starterTemplate);
    })
    .map((template) => asCustomStarterPromptTemplate(template, templates));
  const existingCustomTemplates = templates.filter((template) => !starterTemplatesById.has(template.id));
  const customTemplatesById = new Map([...existingCustomTemplates, ...preservedCustomStarters].map((template) => [template.id, template]));

  return resolvePromptTemplateNameCollisions([
    ...starterPromptTemplates,
    ...customTemplatesById.values()
  ]);
}

function getCanonicalPromptTemplateState(state: PromptTemplateState): PromptTemplateState {
  const templates = mergeStarterPromptTemplates(state.templates);

  return {
    ok: true,
    selectedTemplateIds: getSelectedPromptTemplateIds(state, templates),
    templates
  };
}

function getSelectedPromptTemplateIds(state: PromptTemplateState, templates: PromptTemplate[]) {
  const requestedIds = state.selectedTemplateIds;

  return requestedIds.filter((id, index) => (
    requestedIds.indexOf(id) === index
    && templates.some((template) => template.id === id)
  ));
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

function SettingsSectionBlock({
  children,
  sectionRef,
  title
}: {
  children: ReactNode;
  sectionRef?: RefObject<HTMLElement | null>;
  title: string;
}) {
  const titleId = useId();

  return (
    <section ref={sectionRef} aria-labelledby={titleId} className={layout.settingsSection} role="group" tabIndex={-1}>
      <h3 id={titleId} className="text-base font-medium text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SettingsPage({
  autoCollapseAiResponses,
  autoCollapseTranscription,
  initialSection,
  initialTarget,
  isMac,
  isBusy,
  isListening,
  listenToMicrophone,
  localLlmReasoning,
  llmModel,
  llmReasoning,
  onClose,
  onQuit,
  onRequestPermission,
  onSelectedAiProviderChange,
  onSetPrivateOverlayHandleSize,
  permissionsStatus,
  privateOverlayStatus,
  resetSettings,
  setAutoCollapseAiResponses,
  setAutoCollapseTranscription,
  setLlmModel,
  setLlmReasoning,
  setLocalLlmReasoning
}: {
  autoCollapseAiResponses: boolean;
  autoCollapseTranscription: boolean;
  initialSection: SettingsSection;
  initialTarget: SettingsTarget;
  isMac: boolean;
  isBusy: boolean;
  isListening: boolean;
  listenToMicrophone: boolean;
  localLlmReasoning: LlmReasoning;
  llmModel: LlmModel;
  llmReasoning: LlmReasoning;
  onClose: () => void;
  onQuit: () => void;
  onRequestPermission: (permission: PermissionItem['id']) => void;
  onSelectedAiProviderChange: (provider: AiProvider) => void;
  onSetPrivateOverlayHandleSize: (size: PrivateOverlayHandleSize) => void;
  permissionsStatus: PermissionsStatus | null;
  privateOverlayStatus: PrivateOverlayState | null;
  resetSettings: () => Promise<void>;
  setAutoCollapseAiResponses: (autoCollapseAiResponses: boolean) => void;
  setAutoCollapseTranscription: (autoCollapseTranscription: boolean) => void;
  setLlmModel: (model: LlmModel) => void;
  setLlmReasoning: (reasoning: LlmReasoning) => void;
  setLocalLlmReasoning: (reasoning: LlmReasoning) => void;
}) {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isQuitConfirmationOpen, setIsQuitConfirmationOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [localLlmStatus, setLocalLlmStatus] = useState<LocalLlmStatus | null>(null);
  const [localAiSetupPhase, setLocalAiSetupPhase] = useState<'requesting' | 'downloading' | 'idle'>('idle');
  const [catalogueRefreshResult, setCatalogueRefreshResult] = useState<ModelCatalogueRefreshResult | null>(null);
  const [catalogueRefreshStatus, setCatalogueRefreshStatus] = useState<ModelCatalogueRefreshStatus | null>(null);
  const [isRefreshingCatalogue, setIsRefreshingCatalogue] = useState(false);
  const [isChatGptSigningIn, setIsChatGptSigningIn] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus | null>(null);
  const [selectedAiProvider, setSelectedAiProviderState] = useState<AiProvider>('local');
  const [selectedTranscriptionModelId, setSelectedTranscriptionModelId] = useState<LocalTranscriptionModelId>('parakeet');
  const localTranscriptionSettingsRef = useRef<HTMLElement | null>(null);
  const aiResponseSettingsRef = useRef<HTMLElement | null>(null);
  const permissionsSettingsRef = useRef<HTMLElement | null>(null);
  const hasInitialisedTranscriptionModelRef = useRef(false);
  const autoSelectingReadyModelRef = useRef<LocalTranscriptionModelId | null>(null);
  const hasDownloadedUpdate = isUpdateDownloaded(updateStatus);
  const automaticallyInstallsUpdates = updateStatus?.automaticInstall !== false;
  const isRestartingForUpdate = automaticallyInstallsUpdates
    && (isInstallingUpdate || isUpdateInstalling(updateStatus));
  const isCloudAiReady = Boolean(onboardingStatus?.pi.connected);
  const availableCloudLlmModels = getAvailableCloudLlmModels(onboardingStatus?.pi ?? null);
  const selectedCloudLlmModel = availableCloudLlmModels.some((model) => model.value === llmModel)
    ? llmModel
    : availableCloudLlmModels[0]?.value;
  const recommendedLocalAiModel = onboardingStatus?.ai.recommended === 'local' ? onboardingStatus.ai.recommendedModel : null;
  const recommendedLocalAiModelReady = Boolean(
    localLlmStatus?.runtime.installed
    && localLlmStatus.model?.installed
    && (!recommendedLocalAiModel || localLlmStatus.model.id === recommendedLocalAiModel.id)
  );
  const settingsSections: Array<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'transcription', label: 'Transcription' },
    { id: 'ai', label: 'AI responses' }
  ];
  const updateFrequencyOptions: Array<{ value: UpdateFrequency; label: string }> = [
    { value: 'never', label: 'Never' },
    { value: 'startup', label: 'On startup' },
    { value: 'hourly', label: 'Every hour' },
    { value: 'sixHours', label: 'Every 6 hours' },
    { value: 'twelveHours', label: 'Every 12 hours' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' }
  ];

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    const targetRef = initialTarget === 'models:transcription'
      ? localTranscriptionSettingsRef
      : initialTarget === 'models:ai'
        ? aiResponseSettingsRef
        : initialTarget === 'permissions'
          ? permissionsSettingsRef
          : null;

    if (!targetRef?.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      targetRef.current?.scrollIntoView({ block: 'start' });
      targetRef.current?.focus({ preventScroll: true });
    });
  }, [activeSection, initialTarget]);

  useEffect(() => {
    void refreshOnboardingStatus();

    const unsubscribe = getSettingsBridge()?.parakeet?.onStatus?.((nextStatus) => {
      setOnboardingStatus((current) => current ? {
        ...current,
        parakeet: nextStatus
      } : current);
    });
    const unsubscribeLocalLlm = getSettingsBridge()?.ai?.onLocalStatus?.((nextStatus) => {
      setLocalLlmStatus(nextStatus);
      setLocalAiSetupPhase((current) => {
        if (nextStatus.status === 'downloading') {
          return 'downloading';
        }
        return current === 'downloading' || current === 'requesting' ? 'idle' : current;
      });
    });

    return () => {
      unsubscribe?.();
      unsubscribeLocalLlm?.();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const updates = getSettingsBridge()?.updates;
    const unsubscribe = updates?.onStatus?.((status) => {
      setUpdateStatus(status);
    });

    updates?.status?.()
      .then((status) => {
        if (isMounted) {
          setUpdateStatus(status);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load update status:', error);
      });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    getSettingsBridge()?.ai?.refreshCatalogueStatus?.()
      .then((status) => {
        if (isMounted) {
          setCatalogueRefreshStatus(status);
        }
      })
      .catch((error) => {
        console.error('Failed to load Local AI Catalogue refresh status:', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void refreshHistoryStatus();
  }, []);

  useEffect(() => {
    if (
      !onboardingStatus
      || onboardingStatus.parakeet.status !== 'installed'
      || onboardingStatus.parakeet.modelId !== selectedTranscriptionModelId
      || onboardingStatus.selectedLocalTranscriptionModel === selectedTranscriptionModelId
      || autoSelectingReadyModelRef.current === selectedTranscriptionModelId
    ) {
      return;
    }

    autoSelectingReadyModelRef.current = selectedTranscriptionModelId;

    void getSettingsBridge()?.parakeet?.setModel(selectedTranscriptionModelId)
      .then(() => refreshOnboardingStatus())
      .catch((error) => {
        console.error('Failed to use ready transcription model:', error);
      })
      .finally(() => {
        autoSelectingReadyModelRef.current = null;
      });
  }, [selectedTranscriptionModelId, onboardingStatus]);

  async function refreshOnboardingStatus() {
    const nextStatus = await getSettingsBridge()?.onboarding?.status();

    if (!nextStatus) {
      return;
    }

    setOnboardingStatus(nextStatus);
    setSelectedAiProviderState(nextStatus.ai?.provider ?? 'local');
    setLocalLlmStatus(getCaulLocalLlmStatus(nextStatus));

    if (nextStatus.pi.selectedModel && llmModelValues.has(nextStatus.pi.selectedModel)) {
      setLlmModel(nextStatus.pi.selectedModel);
    }

    if (!hasInitialisedTranscriptionModelRef.current) {
      hasInitialisedTranscriptionModelRef.current = true;
      setSelectedTranscriptionModelId(getInitialTranscriptionModelId(nextStatus));
    }
  }

  async function downloadTranscriptionModel(modelId: LocalTranscriptionModelId) {
    try {
      await getSettingsBridge()?.parakeet?.download(modelId);
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to download transcription model:', error);
    }
  }

  async function selectAiProvider(provider: AiProvider) {
    setSelectedAiProviderState(provider);
    onSelectedAiProviderChange(provider);

    try {
      const nextStatus = await getSettingsBridge()?.ai?.setProvider?.(provider);
      if (nextStatus) {
        setOnboardingStatus(nextStatus);
        setLocalLlmStatus(getCaulLocalLlmStatus(nextStatus));
      }
    } catch (error) {
      console.error('Failed to update AI provider:', error);
    }
  }

  async function downloadLocalAi(modelId?: string) {
    try {
      setLocalAiSetupPhase('requesting');
      const nextStatus = await getSettingsBridge()?.ai?.downloadLocal?.(modelId);
      if (nextStatus) {
        setLocalLlmStatus(nextStatus);
      }
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to download local AI:', error);
    } finally {
      setLocalAiSetupPhase('idle');
    }
  }

  async function setAutoUpdateModel(kind: 'ai' | 'transcription', enabled: boolean) {
    const update: PortablePreferences = kind === 'ai'
      ? { autoUpdateAiModel: enabled }
      : { autoUpdateTranscriptionModel: enabled };

    try {
      await getSettingsBridge()?.preferences?.save(update);
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to update model auto-update setting:', error);
    }
  }

  async function refreshModelCatalogue() {
    setIsRefreshingCatalogue(true);

    try {
      const nextResult = await getSettingsBridge()?.ai?.refreshCatalogue?.();
      if (!nextResult) {
        return;
      }

      setCatalogueRefreshResult(nextResult);
      setCatalogueRefreshStatus(await getSettingsBridge()?.ai?.refreshCatalogueStatus?.() ?? null);
      setOnboardingStatus(nextResult.status);
      setSelectedAiProviderState(nextResult.status.ai?.provider ?? 'local');
      setLocalLlmStatus(getCaulLocalLlmStatus(nextResult.status));
      setSelectedTranscriptionModelId(getInitialTranscriptionModelId(nextResult.status));
    } catch (error) {
      console.error('Failed to refresh model catalogue:', error);
    } finally {
      setIsRefreshingCatalogue(false);
    }
  }

  async function setCatalogueRefreshFrequency(frequency: UpdateFrequency) {
    try {
      const nextStatus = await getSettingsBridge()?.ai?.setRefreshCatalogueFrequency?.(frequency);
      if (nextStatus) {
        setCatalogueRefreshStatus(nextStatus);
      }
    } catch (error) {
      console.error('Failed to update Local AI Catalogue refresh frequency:', error);
    }
  }

  async function cancelLocalAiDownload() {
    try {
      const nextStatus = await getSettingsBridge()?.ai?.cancelLocalDownload?.();
      if (nextStatus) {
        setLocalLlmStatus(nextStatus);
      }
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to cancel local AI download:', error);
    }
  }

  async function signInWithChatGptFromSettings(): Promise<CloudSignInResult> {
    setIsChatGptSigningIn(true);
    try {
      return await requestChatGptSignIn(refreshOnboardingStatus);
    } finally {
      setIsChatGptSigningIn(false);
    }
  }

  async function refreshHistoryStatus() {
    try {
      const nextStatus = await getSettingsBridge()?.history?.status();
      if (nextStatus) {
        setHistoryStatus(nextStatus);
      }
    } catch (error) {
      console.error('Failed to load history status:', error);
    }
  }

  async function setHistoryEnabled(enabled: boolean) {
    try {
      const nextStatus = await getSettingsBridge()?.history?.setEnabled(enabled);
      if (nextStatus) {
        setHistoryStatus(nextStatus);
      }
    } catch (error) {
      console.error('Failed to update history setting:', error);
    }
  }

  async function chooseHistoryFolder() {
    try {
      const nextStatus = await getSettingsBridge()?.history?.chooseFolder();
      if (nextStatus) {
        setHistoryStatus(nextStatus);
      }
    } catch (error) {
      console.error('Failed to choose history folder:', error);
    }
  }

  async function restartToInstallUpdate() {
    setIsInstallingUpdate(true);
    setUpdateStatus((current) => current ? {
      ...current,
      downloading: false,
      lastResult: {
        ok: true,
        status: 'installing',
        message: 'Restarting to install update.'
      }
    } : current);

    try {
      await getSettingsBridge()?.updates?.installDownloaded();
    } catch (error) {
      setIsInstallingUpdate(false);
      console.error('Failed to install downloaded update:', error);
    }
  }

  function confirmResetSettings() {
    void resetSettings()
      .then(() => {
        setIsResetDialogOpen(false);
      })
      .catch((error) => {
        console.error('Failed to reset settings:', error);
      });
  }

  function confirmQuit() {
    setIsQuitConfirmationOpen(false);
    onQuit();
  }

  const autoCollapse = autoCollapseAiResponses && autoCollapseTranscription;
  const promptTemplateBackupFolder = getPromptTemplateBackupFolderLabel(historyStatus?.folder);

  function setAutoCollapse(autoCollapseNext: boolean) {
    setAutoCollapseAiResponses(autoCollapseNext);
    setAutoCollapseTranscription(autoCollapseNext);
  }

  return (
    <>
      <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
        <DialogContent
          className="h-[85vh] w-[85vw] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-[85vw]"
          showCloseButton={false}
        >
        <PlatformDialogCloseButton isMac={isMac} label="Close settings" onClick={onClose} />
        <DialogHeader className="h-12 items-center justify-center px-12">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Configure Caul listening, model and reset settings.</DialogDescription>
        </DialogHeader>
        <div className={layout.settingsContent}>
          <nav aria-label="Settings sections" className={layout.settingsSidebar}>
            <VerticalToggleGroup
              aria-label="Settings section"
              className="w-full"
              onValueChange={(value) => {
                const nextSection = value.at(-1);
                if (nextSection) setActiveSection(nextSection as SettingsSection);
              }}
              value={[activeSection]}
            >
              {settingsSections.map((section) => (
                <ToggleGroupItem
                  key={section.id}
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  className="w-full justify-start"
                  value={section.id}
                >
                  <span className={layout.pickerItemLabel}>{section.label}</span>
                </ToggleGroupItem>
              ))}
            </VerticalToggleGroup>
          </nav>
          <div className={layout.settingsPanel}>
            {activeSection === 'general' ? (
              <FieldGroup className={layout.settingsPageStack}>
                <SettingsSectionBlock title="Floating button">
                  <FieldGroup className={layout.settingsInlineGroup}>
                    <Field className="w-auto">
                      <FieldLabel htmlFor="floating-button-size">Size</FieldLabel>
                      <Select
                        items={privateOverlayHandleSizeOptions}
                        name="floating-button-size"
                        value={privateOverlayStatus?.handle.size ?? 'medium'}
                        onValueChange={(value) => onSetPrivateOverlayHandleSize(value as PrivateOverlayHandleSize)}
                      >
                        <div>
                          <SelectTrigger id="floating-button-size">
                            <SelectValue />
                          </SelectTrigger>
                        </div>
                        <SelectContent>
                          <SelectGroup>
                            {privateOverlayHandleSizeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                </SettingsSectionBlock>

                <SettingsSectionBlock title="History and storage">
                  <FieldGroup className={layout.settingsSectionBody}>
                    <Field className="w-auto self-start" orientation="horizontal">
                      <Checkbox
                        id="save-html-history"
                        checked={historyStatus?.enabled ?? true}
                        onCheckedChange={(checked) => void setHistoryEnabled(checked === true)}
                      />
                      <FieldLabel htmlFor="save-html-history">Save HTML history</FieldLabel>
                    </Field>
                    <div className="flex max-w-2xl flex-col items-start gap-2">
                      <div className="max-w-full rounded-md border bg-muted/30 px-2 py-1 font-mono text-xs text-muted-foreground">
                        {historyStatus?.folder ?? 'Loading history folder...'}
                      </div>
                      {historyStatus?.message ? (
                        <p className={layout.settingsDescription}>{historyStatus.message}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <TooltipButton
                          onClick={() => void getSettingsBridge()?.history?.openFolder()}
                          size="default"
                          tooltip="Open Caul folder"
                          type="button"
                          variant="outline"
                        >
                          <FolderOpenIcon data-icon="inline-start" />
                          Open Caul Folder
                        </TooltipButton>
                        <TooltipButton
                          onClick={() => void chooseHistoryFolder()}
                          size="default"
                          tooltip="Choose a different history folder"
                          type="button"
                          variant="outline"
                        >
                          Change Folder
                        </TooltipButton>
                      </div>
                    </div>
                  </FieldGroup>
                </SettingsSectionBlock>

                <SettingsSectionBlock title="Caul updates">
                  <FieldGroup className={layout.settingsSectionBody}>
                    <div className="flex max-w-2xl flex-col items-start gap-3">
                      <div className="grid gap-1 text-sm">
                        <p>{formatUpdateVersionLine(updateStatus)}</p>
                        <p className={layout.settingsDescription}>{formatUpdateStatusLine(updateStatus)}</p>
                      </div>
                      <div className="flex w-full flex-wrap items-end gap-3">
                        <Field className="w-auto">
                          <FieldLabel htmlFor="update-frequency">Automatic checks</FieldLabel>
                          <Select
                            disabled={!updateStatus?.enabled || updateStatus.checking || updateStatus.downloading || isRestartingForUpdate}
                            items={updateFrequencyOptions}
                            name="update-frequency"
                            value={updateStatus?.frequency ?? 'weekly'}
                            onValueChange={(value) => void getSettingsBridge()?.updates?.setFrequency(value as UpdateFrequency)}
                          >
                            <div>
                              <SelectTrigger id="update-frequency" className="w-[8.5rem]">
                                <SelectValue />
                              </SelectTrigger>
                            </div>
                            <SelectContent>
                              <SelectGroup>
                                {updateFrequencyOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        {!updateStatus?.availableUpdate ? (
                          <TooltipButton
                            disabled={!updateStatus?.enabled || updateStatus?.checking || updateStatus?.downloading || isRestartingForUpdate}
                            onClick={() => void getSettingsBridge()?.updates?.checkNow()}
                            size="default"
                            tooltip="Check for updates"
                            type="button"
                            variant="outline"
                          >
                            {updateStatus?.checking ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
                            Check now
                          </TooltipButton>
                        ) : !hasDownloadedUpdate && !isRestartingForUpdate ? (
                          <TooltipButton
                            disabled={updateStatus.checking || updateStatus.downloading || isRestartingForUpdate}
                            onClick={() => void getSettingsBridge()?.updates?.downloadAndInstall()}
                            size="default"
                            tooltip="Download this update"
                            type="button"
                          >
                            {updateStatus.downloading ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
                            Download
                          </TooltipButton>
                        ) : automaticallyInstallsUpdates ? (
                          <TooltipButton
                            disabled={isRestartingForUpdate}
                            onClick={() => void restartToInstallUpdate()}
                            size="default"
                            tooltip="Restart Caul and install the update"
                            type="button"
                          >
                            {isRestartingForUpdate ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
                            {isRestartingForUpdate ? 'Restarting...' : 'Restart to update'}
                          </TooltipButton>
                        ) : (
                          <TooltipButton
                            disabled
                            size="default"
                            tooltip="The package is ready in Downloads"
                            type="button"
                          >
                            Downloaded
                          </TooltipButton>
                        )}
                        {updateStatus?.availableUpdate ? (
                          <TooltipButton
                            disabled={isRestartingForUpdate}
                            onClick={() => void getSettingsBridge()?.updates?.openDownloadPage()}
                            size="default"
                            tooltip="Open release page"
                            type="button"
                            variant="outline"
                          >
                            Release Page
                          </TooltipButton>
                        ) : null}
                      </div>
                      {updateStatus?.downloading && updateStatus.lastResult?.message ? (
                        <p className={layout.settingsDescription} aria-live="polite">
                          {updateStatus.lastResult.message}
                        </p>
                      ) : null}
                      {updateStatus?.availableUpdate?.releaseNotes ? (
                        <Card className="w-full max-w-2xl" size="sm">
                          <CardHeader>
                            <CardTitle aria-level={3} role="heading">
                              What&apos;s new in Caul {updateStatus.availableUpdate.version}
                            </CardTitle>
                            <CardDescription>
                              Review the changes before downloading and restarting.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="markdown-output max-h-48 overflow-y-auto">
                            <SafeMarkdown>
                              {updateStatus.availableUpdate.releaseNotes}
                            </SafeMarkdown>
                          </CardContent>
                        </Card>
                      ) : null}
                    </div>
                  </FieldGroup>
                </SettingsSectionBlock>

                <SettingsSectionBlock title="Local AI Catalogue">
                  <FieldGroup className={layout.settingsSectionBody}>
                    <div className="flex max-w-2xl flex-col items-start gap-3">
                      <p className={layout.settingsDescription} aria-live="polite">
                        {formatCatalogueRefreshStatus(catalogueRefreshResult)}
                      </p>
                      <div className="flex w-full flex-wrap items-end gap-3">
                        <Field className="w-auto">
                          <FieldLabel htmlFor="model-catalogue-refresh-frequency">Automatic refresh</FieldLabel>
                          <Select
                            disabled={!catalogueRefreshStatus?.enabled || isListening || isBusy || isRefreshingCatalogue}
                            items={updateFrequencyOptions}
                            name="model-catalogue-refresh-frequency"
                            value={catalogueRefreshStatus?.frequency ?? 'monthly'}
                            onValueChange={(value) => void setCatalogueRefreshFrequency(value as UpdateFrequency)}
                          >
                            <div>
                              <SelectTrigger id="model-catalogue-refresh-frequency" className="w-[8.5rem]">
                                <SelectValue />
                              </SelectTrigger>
                            </div>
                            <SelectContent>
                              <SelectGroup>
                                {updateFrequencyOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        <TooltipButton
                          disabled={isListening || isBusy || isRefreshingCatalogue}
                          onClick={() => void refreshModelCatalogue()}
                          size="default"
                          tooltip="Refresh Local AI Catalogue"
                          type="button"
                          variant="outline"
                        >
                          {isRefreshingCatalogue ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
                          Refresh catalogue
                        </TooltipButton>
                      </div>
                    </div>
                  </FieldGroup>
                </SettingsSectionBlock>

                <SettingsSectionBlock sectionRef={permissionsSettingsRef} title="Permissions">
                  <FieldGroup className={layout.settingsSectionBody}>
                    <div className="grid w-full max-w-[30rem]">
                      {permissionsStatus ? getOnboardingPermissionRows(getVisiblePermissionItems(permissionsStatus)).map((permission) => (
                        <PermissionSetupRow
                          key={permission.id}
                          actionSize="default"
                          contextLabel={permission.id === 'microphone' && listenToMicrophone ? 'Required now' : undefined}
                          onChange={() => onRequestPermission(permission.id)}
                          permission={permission}
                          showDivider={false}
                        />
                      )) : (
                        <StatusRow
                          label="Permissions"
                          ready={false}
                          value="Checking current permission status"
                        />
                      )}
                    </div>
                  </FieldGroup>
                </SettingsSectionBlock>

                <SettingsSectionBlock title="Advanced">
                  <FieldGroup className="gap-4">
                    <div className="flex w-fit max-w-full flex-col items-start gap-2">
                      <div className="flex">
                        <AlertDialog open={isQuitConfirmationOpen} onOpenChange={setIsQuitConfirmationOpen}>
                          <AlertDialogTrigger render={<Button size="default" type="button" variant="destructive" />}>
                            <LogOutIcon data-icon="inline-start" />
                            Quit Caul
                          </AlertDialogTrigger>
                          <QuitCaulAlertDialog onConfirm={confirmQuit} />
                        </AlertDialog>
                      </div>
                      <div className="flex">
                        <TooltipButton
                          disabled={isListening || isBusy}
                          onClick={() => setIsResetDialogOpen(true)}
                          size="default"
                          tooltip="Reset settings"
                          type="button"
                          variant="outline"
                        >
                          <RotateCcwIcon data-icon="inline-start" />
                          Reset Settings
                        </TooltipButton>
                      </div>
                    </div>
                  </FieldGroup>
                </SettingsSectionBlock>
              </FieldGroup>
            ) : null}

            {activeSection === 'transcription' || activeSection === 'ai' ? (
              <FieldGroup className={layout.settingsPageStack}>
                {activeSection === 'transcription' ? (
                  <SettingsSectionBlock sectionRef={localTranscriptionSettingsRef} title="Local transcription">
                  <FieldGroup>
                    <p className={layout.settingsDescription}>
                      Local and private. Audio is transcribed on this computer. Nothing is sent to the internet.
                    </p>
                    <TranscriptionModelRow
                      onCancel={() => void getSettingsBridge()?.parakeet?.cancelDownload()}
                      onDownload={(modelId) => void downloadTranscriptionModel(modelId)}
                      onSelectModel={setSelectedTranscriptionModelId}
                      selectedModelId={selectedTranscriptionModelId}
                      status={onboardingStatus}
                      variant="settings"
                    />
                    <FieldGroup className={layout.settingsSectionBody}>
                      <ModelAutoUpdateCheckbox
                        checked={onboardingStatus?.autoUpdate?.transcription ?? true}
                        id="settings-auto-update-transcription-model"
                        info="Caul can suggest and select a better supported local transcription model on your update schedule."
                        label="Auto update local transcription model"
                        onCheckedChange={(enabled) => void setAutoUpdateModel('transcription', enabled)}
                      />
                      <Field className="w-auto self-start" orientation="horizontal">
                        <Checkbox
                          id="auto-collapse-transcription"
                          checked={autoCollapseTranscription}
                          onCheckedChange={(checked) => setAutoCollapseTranscription(checked === true)}
                        />
                        <FieldContent>
                          <div className="flex items-center gap-1.5">
                            <FieldLabel htmlFor="auto-collapse-transcription">Auto-collapse</FieldLabel>
                            <SettingInfoButton
                              label="Auto-collapse info"
                              message="Automatically collapse previous transcriptions when a new transcript starts."
                            />
                          </div>
                        </FieldContent>
                      </Field>
                    </FieldGroup>
                  </FieldGroup>
                  </SettingsSectionBlock>
                ) : null}

                {activeSection === 'ai' ? (
                  <SettingsSectionBlock sectionRef={aiResponseSettingsRef} title="AI responses">
                  <FieldGroup>
                    <p className={layout.settingsDescription}>
                      Controls how Caul writes answers after it has a transcript.
                    </p>
                    <Tabs className="gap-3" value={selectedAiProvider}>
                      <div className="flex min-w-0 max-w-sm items-center gap-2">
                        <TabsList aria-label="AI provider" className="h-auto w-full p-0.5">
                          {(['local', 'cloud'] as AiProvider[]).map((provider) => (
                            <TabsTrigger
                              key={provider}
                              aria-label={`${provider === 'local' ? 'Local' : 'Cloud'}${onboardingStatus?.ai?.recommended === provider ? ` ${recommendedPillLabel}` : ''}`}
                              className="h-8 px-3"
                              disabled={isListening || isBusy}
                              onClick={() => void selectAiProvider(provider)}
                              value={provider}
                            >
                              <span>{provider === 'local' ? 'Local' : 'Cloud'}</span>
                              {onboardingStatus?.ai?.recommended === provider ? (
                                <RecommendedMarker selected={selectedAiProvider === provider} />
                              ) : null}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        {onboardingStatus?.ai?.recommended && onboardingStatus.ai.recommended !== 'none' ? (
                          <SettingInfoButton
                            label="Why this is recommended"
                            message={getAiProviderRecommendationMessage(onboardingStatus.ai.recommended)}
                          />
                        ) : null}
                      </div>

                      <TabsContent className="max-w-2xl" value="local">
                        {selectedAiProvider === 'local' ? (
                          <FieldGroup>
                          <p className={layout.settingsDescription}>Data stays local and private. Slower and less intelligent than Cloud.</p>
                          <LocalAiDownloadControl
                            align="start"
                            info={recommendedLocalAiModel || localLlmStatus?.model ? (
                              <LocalAiRecommendationInfoButton embedded recommendation={onboardingStatus?.ai} status={localLlmStatus} />
                            ) : null}
                            isInstalled={recommendedLocalAiModelReady}
                            localAiSetupPhase={localAiSetupPhase}
                            onCancel={() => void cancelLocalAiDownload()}
                            onDownload={() => void downloadLocalAi(recommendedLocalAiModel?.id)}
                            statusPlacement="inline"
                            status={localLlmStatus}
                          />
                          <FieldGroup className={layout.settingsInlineGroup}>
                            <Field className="w-auto">
                              <FieldLabel htmlFor="local-llm-reasoning">Thinking</FieldLabel>
                              <Select
                                disabled={isListening || isBusy}
                                items={llmReasoningLevels}
                                name="local-llm-reasoning"
                                value={localLlmReasoning}
                                onValueChange={(value) => setLocalLlmReasoning(value as LlmReasoning)}
                              >
                                <div>
                                  <SelectTrigger id="local-llm-reasoning">
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
                          </FieldGroup>
                        ) : null}
                      </TabsContent>
                      <TabsContent className="max-w-2xl" value="cloud">
                        {selectedAiProvider === 'cloud' ? (
                          <FieldGroup>
                          <CloudProviderOnboarding
                            info={<CloudAiInfoButton llmModel={llmModel} llmReasoning={llmReasoning} />}
                            isChatGptReady={Boolean(onboardingStatus?.pi.chatGptConnected)}
                            isChatGptSigningIn={isChatGptSigningIn}
                            onCloudStatusChange={refreshOnboardingStatus}
                            onSignInWithChatGpt={signInWithChatGptFromSettings}
                            piStatus={onboardingStatus?.pi ?? null}
                          />
                          {isCloudAiReady && selectedCloudLlmModel ? (
                            <>
                              <FieldGroup className={layout.settingsInlineGroup}>
                                <Field className="w-auto">
                                  <FieldLabel htmlFor="llm-model">Model</FieldLabel>
                                  <Select
                                    disabled={isListening || isBusy}
                                    items={availableCloudLlmModels}
                                    name="llm-model"
                                    value={selectedCloudLlmModel}
                                    onValueChange={(value) => setLlmModel(value as LlmModel)}
                                  >
                                    <div>
                                      <SelectTrigger id="llm-model" className="w-[9.5rem]">
                                        <SelectValue />
                                      </SelectTrigger>
                                    </div>
                                    <SelectContent>
                                      <SelectGroup>
                                        {availableCloudLlmModels.map((model) => (
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
                                    items={llmReasoningLevels}
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
                            </>
                          ) : null}
                          </FieldGroup>
                        ) : null}
                      </TabsContent>
                      <FieldGroup className={layout.settingsSectionBody}>
                        <ModelAutoUpdateCheckbox
                          checked={onboardingStatus?.autoUpdate?.ai ?? true}
                          id="settings-auto-update-ai-model"
                          info="Caul can suggest and download a better supported local AI model on your update schedule."
                          label="Auto update local AI model"
                          onCheckedChange={(enabled) => void setAutoUpdateModel('ai', enabled)}
                        />
                        <Field className="w-auto self-start" orientation="horizontal">
                          <Checkbox
                            id="auto-collapse-ai-responses"
                            checked={autoCollapseAiResponses}
                            onCheckedChange={(checked) => setAutoCollapseAiResponses(checked === true)}
                          />
                          <FieldContent>
                            <div className="flex items-center gap-1.5">
                              <FieldLabel htmlFor="auto-collapse-ai-responses">Auto-collapse</FieldLabel>
                              <SettingInfoButton
                                label="Auto-collapse info"
                                message="Automatically collapse previous AI responses when a new response starts."
                              />
                            </div>
                          </FieldContent>
                        </Field>
                      </FieldGroup>
                    </Tabs>
                  </FieldGroup>
                  </SettingsSectionBlock>
                ) : null}
              </FieldGroup>
            ) : null}

          </div>
        </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset settings?</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
                <p>This will restore:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Window size and location</li>
                  <li>Floating button position</li>
                  <li>Model and listening sources</li>
                  <li>Starter prompt templates</li>
                </ul>
                <p className="mt-3">
                  Your user prompt templates will be backed up to {promptTemplateBackupFolder}, then removed from active prompts.
                </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmResetSettings} variant="destructive">
              Reset Settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function getPromptTemplateBackupFolderLabel(folder?: string | null) {
  const profileFolder = typeof folder === 'string' && folder.trim()
    ? folder.trim()
    : 'Documents/Caul';
  const separator = profileFolder.endsWith('/') ? '' : '/';

  return `${profileFolder}${separator}Backups/prompts/`;
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
    .flatMap((source) => {
      if (source.id === 'listen-to-system-audio') {
        return [
          permissionsById.get('screen-recording'),
          permissionsById.get('system-audio')
        ];
      }

      if (source.id === 'listen-to-microphone') {
        return [permissionsById.get('microphone')];
      }

      return [];
    })
    .filter((permission): permission is PermissionItem => {
      return permission !== undefined && permission.status !== 'granted' && permission.status !== 'unsupported';
    });
}

function getVisiblePermissionItems(permissionsStatus: PermissionsStatus | null | undefined) {
  return permissionsStatus?.permissions.filter((permission) => permission.status !== 'unsupported') ?? [];
}

function getOnboardingVisiblePermissionItems(permissionsStatus: PermissionsStatus | null | undefined) {
  return getVisiblePermissionItems(permissionsStatus);
}

function getOnboardingRequiredPermissionItems(permissionsStatus: PermissionsStatus | null | undefined) {
  return getOnboardingVisiblePermissionItems(permissionsStatus);
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
  const body = getTranscriptSectionBody(output).trim();

  return output.trim().length > 0
    && body.length > 0
    && output !== transcriptPlaceholder
    && output !== 'Listening. Waiting for speech...'
    && output !== 'Speech detected...'
    && !output.startsWith('Live transcription is unavailable')
    && !output.startsWith('Select at least one audio source');
}

function isAiResponseTextCopyable(output: string) {
  return output.trim().length > 0
    && output !== aiResponsePlaceholder
    && output !== aiResponseDisabledPlaceholder
    && output !== legacyAiResponsePlaceholder
    && output !== shortAiResponsePlaceholder;
}

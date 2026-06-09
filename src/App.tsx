import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type WheelEvent } from 'react';
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
import { ArrowUpIcon, CheckCircle2Icon, ChevronDownIcon, ChevronRightIcon, CircleAlertIcon, CopyIcon, DownloadIcon, FastForwardIcon, FileIcon, FileInputIcon, FileTextIcon, FolderOpenIcon, HistoryIcon, ImageIcon, InfoIcon, ListChecksIcon, LoaderCircleIcon, LogOutIcon, MicIcon, MicOffIcon, PaperclipIcon, PencilIcon, PlayIcon, PowerIcon, SearchIcon, SendIcon, SettingsIcon, SquareIcon, Trash2Icon, Volume2Icon, VolumeXIcon, XCircleIcon, XIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import caulAppIconUrl from '../assets/icons/icon-rounded.png?url';
import caulBetaAppIconUrl from '../assets/icons/beta/icon-rounded.png?url';
import caulIconUrl from '../assets/caul-icon.svg?url';
import {
  getLlmBridge,
  getPermissionsBridge,
  getPrivateOverlayBridge,
  getSettingsBridge,
  getTranscriptionBridge,
  type AiRecommendation,
  type AiProvider,
  type HistoryStatus,
  type LocalLlmStatus,
  type LocalTranscriptionModelId,
  type LlmModel,
  type LlmReasoning,
  type ModelCatalogueRefreshResult,
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

const layout = {
  overlayWindowOuter: 'relative h-screen w-screen bg-transparent p-2 text-foreground',
  main: 'relative grid h-full grid-rows-[32px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/70 bg-background',
  appBody: 'relative min-h-0 overflow-hidden',
  overlayResizeHandle: 'absolute z-[80] bg-transparent',
  overlayResizeHandleN: 'inset-x-2 top-0 h-[11px] cursor-ns-resize',
  overlayResizeHandleE: 'right-0 top-2 bottom-2 w-[11px] cursor-ew-resize',
  overlayResizeHandleS: 'inset-x-2 bottom-0 h-[11px] cursor-ns-resize',
  overlayResizeHandleW: 'left-0 top-2 bottom-2 w-[11px] cursor-ew-resize',
  overlayResizeHandleNE: 'right-0 top-0 size-[11px] cursor-nesw-resize',
  overlayResizeHandleSE: 'right-0 bottom-0 size-[11px] cursor-nwse-resize',
  overlayResizeHandleSW: 'left-0 bottom-0 size-[11px] cursor-nesw-resize',
  overlayResizeHandleNW: 'left-0 top-0 size-[11px] cursor-nwse-resize',
  windowTitleBar: 'relative z-[60] flex h-8 select-none items-center justify-center border-b border-border/70 bg-background/95 text-muted-foreground',
  windowTitleBarDragArea: 'absolute inset-0 flex min-w-0 cursor-default items-center justify-center px-12 active:cursor-default',
  windowTitleBarTitle: 'truncate text-sm font-medium text-foreground',
  windowTitleBarButton: 'absolute right-1 top-1/2 z-10 size-7 -translate-y-1/2 cursor-default text-muted-foreground hover:text-foreground',
  windowTitleBarQuitButton: 'absolute right-9 top-1/2 z-10 size-7 -translate-y-1/2 cursor-default text-muted-foreground hover:text-foreground',
  windowTitleBarSettingsButton: 'absolute top-1/2 z-[70] flex size-7 -translate-y-1/2 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
  windowTitleBarSettingsButtonMac: 'right-1.5',
  windowTitleBarSettingsButtonDesktop: 'left-1.5',
  windowTitleBarHistoryButtonMac: 'right-9',
  windowTitleBarHistoryButtonDesktop: 'left-9',
  windowTitleBarNotificationButtonMac: 'right-[4.625rem]',
  windowTitleBarNotificationButtonDesktop: 'left-[4.625rem]',
  windowTitleBarMacCloseButton: 'caul-mac-close-button absolute left-3 top-1/2 z-10 size-[14px] -translate-y-1/2 cursor-default rounded-full border-[0.5px] border-[#FB1626] bg-[#FF5C60] p-0 shadow-none hover:bg-[#FF5C60] active:bg-[#D94D4F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5C60]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  windowTitleBarMacQuitButton: 'caul-mac-quit-button absolute left-8 top-1/2 z-10 flex size-[14px] -translate-y-1/2 cursor-default items-center justify-center rounded-full border-[0.5px] border-[#9B48D6] bg-[#BF5AF2] p-0 text-[#4F167D] shadow-none hover:bg-[#BF5AF2] active:bg-[#9B48D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BF5AF2]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-2.5 [&_svg]:stroke-[3]',
  page: 'h-full min-h-0 overflow-hidden',
  form: 'h-full w-full',
  contentTopToolbar: 'grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]',
  contentRightToolbar: 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto]',
  contentBottomToolbar: 'grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]',
  contentLeftToolbar: 'grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)]',
  panelGrid: 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border',
  panelGridStacked: 'grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] divide-y divide-border',
  panelTitleBars: 'z-20 grid h-8 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-border border-b border-border/70 bg-background/95 text-muted-foreground',
  panelTitleBar: 'flex min-w-0 select-none items-center justify-center px-3',
  panelTitleBarTitle: 'truncate text-sm font-medium text-foreground',
  panel: 'panel-background grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden',
  panelPlain: 'panel-background h-full min-h-0 overflow-hidden',
  panelWithBottomActions: 'panel-background grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden',
  aiPanelWithManualPrompt: 'panel-background grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_auto] overflow-hidden',
  aiManualPromptBar: 'z-10 flex min-h-12 items-end gap-2 border-t border-border bg-background px-3 py-1.5',
  aiManualPromptInput: 'max-h-[50%] min-h-9 flex-1 resize-none overflow-hidden rounded-md py-2 text-sm leading-5',
  homeToolbar: 'z-10 overflow-hidden bg-background',
  homeToolbarTop: 'grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center divide-x divide-border border-b border-border',
  homeToolbarRight: 'grid h-full w-12 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] items-stretch divide-y divide-border border-l border-border p-0',
  homeToolbarBottom: 'grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center divide-x divide-border border-t border-border',
  homeToolbarLeft: 'grid h-full w-12 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] items-stretch divide-y divide-border border-r border-border p-0',
  homeToolbarHorizontalSection: 'flex min-w-0 items-center gap-2 px-3 py-1.5',
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
  settingsBackdrop: 'absolute inset-0 z-40 cursor-default bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
  modalBlurBackdrop: 'fixed inset-0 z-40 pointer-events-none bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
  settingsDialog: 'caul-settings-dialog caul-large-modal-shell absolute z-50 grid h-[85vh] w-[85vw] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10',
  modalHeaderTitle: 'font-heading text-sm leading-none font-medium text-center',
  settingsHeader: 'flex h-12 items-center justify-center border-b border-border px-12',
  settingsHeaderMac: '',
  settingsContent: 'grid min-h-0 grid-cols-[9rem_minmax(0,1fr)] overflow-hidden',
  settingsSidebar: 'flex min-h-0 flex-col border-r border-border p-4',
  settingsPanel: 'min-h-0 overflow-y-auto p-4',
  modalCloseButton: 'absolute top-6 z-20 -translate-y-1/2',
  modalCloseButtonDesktop: 'right-3 size-8 rounded-md',
  modalCloseButtonMac: 'caul-mac-close-button left-3 size-[14px] cursor-default rounded-full border-[0.5px] border-[#FB1626] bg-[#FF5C60] p-0 text-[#802F31] shadow-none hover:bg-[#FF5C60] active:bg-[#D94D4F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5C60]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
  settingsInlineGroup: 'flex-row flex-wrap items-start gap-3',
  settingsPageStack: 'gap-0',
  settingsSection: 'gap-2 border-t border-border/70 pt-4 first:border-t-0 first:pt-0',
  settingsSectionBody: 'gap-3',
  settingsDescription: 'text-sm leading-5 text-muted-foreground',
  settingsPermissionActions: 'flex flex-wrap items-center gap-2',
  transcriptPrimaryActions: 'flex min-w-0 flex-1 items-center justify-between gap-2',
  transcriptSourceActions: 'flex min-w-0 flex-1 items-center justify-center gap-2',
  transcriptPrimaryActionsVertical: 'flex min-h-0 min-w-0 flex-1 flex-col items-center justify-between gap-2',
  listeningSourceIndicators: 'flex shrink-0 items-center justify-center gap-2',
  listeningSourceIndicatorsVertical: 'flex shrink-0 flex-col items-center gap-1',
  listeningSourceIndicatorActive: '!bg-primary !text-primary-foreground hover:!bg-primary/90 hover:!text-primary-foreground focus-visible:border-primary focus-visible:ring-primary/30 dark:!bg-primary dark:!text-primary-foreground dark:hover:!bg-primary/90 dark:hover:!text-primary-foreground',
  aiToolbarActions: 'flex w-full min-w-0 flex-1 items-center justify-start',
  aiResponseActions: 'ml-auto flex items-center gap-2',
  aiResponseActionsVertical: 'flex flex-col items-center gap-2',
  aiToolbarActionsVertical: 'flex min-h-0 min-w-0 flex-1 flex-col items-center justify-between gap-2',
  transcriptActions: 'ml-auto flex items-center gap-2',
  transcriptActionsVertical: 'flex flex-col items-center gap-2',
  sectionCollapseButton: 'size-8 shrink-0 rounded-md text-muted-foreground',
  sectionPreviewTooltip: 'caul-preview-tooltip pointer-events-auto max-h-[min(28rem,70vh)] w-[clamp(18rem,25vw,36rem)] max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden break-words p-4 pr-3 text-left text-sm leading-6 [overflow-wrap:anywhere]',
  listeningButton: 'w-[140px]',
  listeningButtonVertical: 'w-full',
  sideToolbarRow: 'flex w-full items-center justify-center',
  sideToolbarButton: 'size-9 min-h-9 min-w-9 rounded-md px-0',
  sideToolbarIconButton: 'size-9 min-h-9 min-w-9 rounded-md',
  sideToolbarButtonLabel: 'sr-only',
  compactToolbarButton: 'compact-toolbar-button',
  compactToolbarButtonLabel: 'compact-toolbar-button-label',
  permissionButton: 'h-auto min-h-9 max-w-full whitespace-normal break-words px-2.5 py-1.5 text-center text-xs leading-snug border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/60 focus-visible:ring-destructive/20 dark:border-destructive/40 dark:bg-destructive/20 dark:hover:bg-destructive/30',
  grantPermissionsButton: 'w-[140px] border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/60 focus-visible:ring-destructive/20 dark:border-destructive/40 dark:bg-destructive/20 dark:hover:bg-destructive/30',
  startButton: '!bg-primary !text-primary-foreground hover:!bg-primary/90 focus-visible:border-primary focus-visible:ring-primary/30 dark:!bg-primary dark:!text-primary-foreground dark:hover:!bg-primary/90',
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
  promptTemplateTriggerVertical: 'size-9 min-h-9 min-w-9 justify-center rounded-md px-0',
  promptTemplateCompactIcon: 'prompt-template-trigger-icon',
  promptTemplateSearch: 'relative',
  promptTemplateSearchIcon: 'pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
  promptTemplateSearchInput: 'pl-8',
  pickerList: 'flex flex-col',
  pickerListScrollable: 'max-h-64 overflow-y-auto',
  pickerItem: 'flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground [&>span:last-child]:truncate',
  pickerItemLabel: 'min-w-0 flex-1 truncate',
  pickerCheckboxItem: 'justify-start',
  pickerRow: 'group/picker-row relative min-w-0',
  pickerRowButton: 'pr-8',
  pickerRowDelete: 'absolute right-1 top-1/2 size-6 -translate-y-1/2 rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/picker-row:opacity-100',
  generalInstructionsDialog: 'caul-settings-dialog caul-large-modal-shell absolute z-50 grid h-[85vh] w-[85vw] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10',
  generalInstructionsEditor: 'grid min-h-0 p-4',
  promptTemplateDialog: 'caul-settings-dialog caul-large-modal-shell absolute z-50 grid h-[85vh] w-[85vw] max-w-[85vw] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10',
  promptTemplateHeader: 'flex h-12 items-center justify-center border-b border-border px-12',
  promptTemplateHeaderMac: '',
  promptTemplateEditor: 'grid min-h-0 flex-1 gap-0 md:grid-cols-[220px_minmax(0,1fr)]',
  promptTemplateSidebar: 'flex flex-col gap-3 border-b border-border p-4 md:border-b-0 md:border-r',
  promptTemplateEditorForm: 'grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 p-4',
  promptTemplateBody: 'grid min-h-0 gap-4 md:grid-cols-2',
  promptTemplateAttachmentPane: 'grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3',
  promptTemplateAttachmentList: 'min-h-0 overflow-y-auto rounded-md border border-border',
  promptTemplateAttachmentItem: 'flex min-h-12 items-center gap-2 border-b border-border px-3 py-2 last:border-b-0',
  promptTemplateAttachmentName: 'min-w-0 flex-1',
  promptTemplateAttachmentMeta: 'truncate text-xs text-muted-foreground',
  promptTemplateFooter: 'mx-0 mb-0',
  handleRoot: 'grid h-screen w-screen overflow-hidden place-items-center bg-transparent text-foreground',
  handleButton: 'caul-handle-button',
  handleButtonOpen: '',
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
const defaultLlmModel: LlmModel = 'openai-codex/gpt-5.4-mini';
const defaultLlmReasoning: LlmReasoning = 'off';
const autoCollapsePreferenceKey = 'caul.auto-collapse';
const generalInstructionsPreferenceKey = 'caul.general-instructions';
const defaultGeneralInstructions = '';
const generalInstructionsPlaceholder = 'e.g. Always answer in British English.';
const recommendedPillClassName = 'pointer-events-none shrink-0 rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary shadow-sm dark:border-primary/45 dark:bg-primary/15 dark:text-primary';
const selectedRecommendedPillClassName = 'pointer-events-none shrink-0 rounded-full border border-primary-foreground/40 bg-primary-foreground/15 px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-sm';
const handleDragThresholdPx = 6;
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
const handleIconStyle = {
  '--caul-handle-icon-url': `url("${caulIconUrl}")`
} as React.CSSProperties;

type OverlayEdge = 'bottom' | 'left' | 'right' | 'top';
type SettingsSection = 'general' | 'models' | 'updates' | 'storage' | 'permissions';
type TooltipSide = NonNullable<React.ComponentProps<typeof TooltipContent>['side']>;
type MainNotification = {
  id: string;
  label: string;
  section: SettingsSection;
  tone: 'action' | 'error' | 'progress';
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

const llmModelValues = new Set<LlmModel>(llmModels.map((model) => model.value));
const llmReasoningValues = new Set<LlmReasoning>(llmReasoningLevels.map((reasoning) => reasoning.value));

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
  const [listenToMicrophone, setListenToMicrophone] = useState(defaultListenToMicrophone);
  const [listenToSystemAudio, setListenToSystemAudio] = useState(defaultListenToSystemAudio);
  const [sendToAiWhenListeningStops, setSendToAiWhenListeningStops] = useState(defaultSendToAiWhenListeningStops);
  const [autoCollapse, setAutoCollapseState] = useState(() => readBooleanPreference(autoCollapsePreferenceKey, defaultAutoCollapse));
  const [llmModel, setLlmModel] = useState<LlmModel>(defaultLlmModel);
  const [llmReasoning, setLlmReasoning] = useState<LlmReasoning>(defaultLlmReasoning);
  const [selectedAiProvider, setSelectedAiProvider] = useState<AiProvider>('local');
  const [isLlmReady, setIsLlmReady] = useState(false);
  const [localLlmStatus, setLocalLlmStatus] = useState<LocalLlmStatus | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [permissionsStatus, setPermissionsStatus] = useState<PermissionsStatus | null>(null);
  const [parakeetStatus, setParakeetStatus] = useState<ParakeetStatus | null>(null);
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

  const isListening = transcription.isListening;
  const isBusy = transcription.isStarting;
  const hasAudioSource = listenToMicrophone || listenToSystemAudio;
  const missingSelectedPermissions = getMissingSelectedPermissionItems({
    listenToMicrophone,
    listenToSystemAudio,
    permissionsStatus
  });
  const isSelectedAiProviderReadyForListening = selectedAiProvider === 'local' || isLlmReady;
  const canStartListening = hasAudioSource && isSelectedAiProviderReadyForListening && (parakeetStatus?.installed ?? true) && missingSelectedPermissions.length === 0;
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
    localLlmStatus,
    selectedAiProvider,
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
    void refreshPermissionsStatus();
  }, []);

  useEffect(() => {
    void refreshParakeetStatus();

    return getSettingsBridge()?.parakeet?.onStatus?.((status) => {
      setParakeetStatus(status);
    });
  }, []);

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
    const legacyPreferences: PortablePreferences = {
      autoCollapse: readBooleanPreference(autoCollapsePreferenceKey, defaultAutoCollapse),
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
    if (typeof preferences.autoCollapse === 'boolean') {
      setAutoCollapseState(preferences.autoCollapse);
    }

    if (typeof preferences.generalInstructions === 'string') {
      setGeneralInstructions(preferences.generalInstructions);
    }

    if (preferences.llmModel && llmModelValues.has(preferences.llmModel)) {
      setLlmModel(preferences.llmModel);
    }

    if (preferences.llmReasoning && llmReasoningValues.has(preferences.llmReasoning)) {
      setLlmReasoning(preferences.llmReasoning);
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
      const templates = promptTemplates.some((item) => item.id === templateToSave.id)
        ? promptTemplates.map((item) => (item.id === templateToSave.id ? templateToSave : item))
        : [...promptTemplates, templateToSave];
      setPromptTemplates(templates);
      return;
    }

    applyPromptTemplateState(await bridge.save(template));
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

  function setAutoCollapse(autoCollapse: boolean) {
    setAutoCollapseState(autoCollapse);
    void getSettingsBridge()?.preferences?.save({ autoCollapse });
  }

  function saveGeneralInstructions(instructions: string) {
    const nextInstructions = instructions;
    setGeneralInstructions(nextInstructions);
    void getSettingsBridge()?.preferences?.save({ generalInstructions: nextInstructions });
  }

  function saveLlmModel(model: LlmModel) {
    setLlmModel(model);
    void getSettingsBridge()?.preferences?.save({ llmModel: model });
  }

  function saveLlmReasoning(reasoning: LlmReasoning) {
    setLlmReasoning(reasoning);
    void getSettingsBridge()?.preferences?.save({ llmReasoning: reasoning });
  }

  function askAiFromTranscript() {
    void transcription.ask({
      generalInstructionsText: generalInstructions,
      llmModel,
      llmReasoning,
      aiProvider: selectedAiProvider,
      promptTemplateAttachments: selectedPromptTemplateAttachments,
      promptTemplateText: selectedPromptTemplatePrompt
    });
  }

  function askAiFromSpecificTranscript(transcript: string) {
    void transcription.ask({
      generalInstructionsText: generalInstructions,
      llmModel,
      llmReasoning,
      aiProvider: selectedAiProvider,
      promptTemplateAttachments: selectedPromptTemplateAttachments,
      promptTemplateText: selectedPromptTemplatePrompt,
      transcript
    });
  }

  function askAiFromManualPrompt(prompt: string) {
    void transcription.ask({
      generalInstructionsText: generalInstructions,
      llmModel,
      llmReasoning,
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
        llmReasoning,
        aiProvider: selectedAiProvider,
        promptTemplateAttachments: selectedPromptTemplateAttachments,
        promptTemplateText: selectedPromptTemplatePrompt,
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

    setListenToMicrophone(defaultListenToMicrophone);
    setListenToSystemAudio(defaultListenToSystemAudio);
    setSendToAiWhenListeningStops(defaultSendToAiWhenListeningStops);
    setAutoCollapseState(defaultAutoCollapse);
    setLlmModel(defaultLlmModel);
    setLlmReasoning(defaultLlmReasoning);
    setPromptTemplates((templates) => preserveCustomisedStarterPromptTemplates(templates));
    setSelectedPromptTemplateIds(defaultSelectedPromptTemplateIds);
    setGeneralInstructions(defaultGeneralInstructions);
    window.localStorage.clear();
    await getSettingsBridge()?.preferences?.save({
      autoCollapse: defaultAutoCollapse,
      generalInstructions: defaultGeneralInstructions,
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
        templates: preserveCustomisedStarterPromptTemplates(promptTemplates)
      });
    }
  }

  async function setPrivateOverlayHandleSize(size: PrivateOverlayHandleSize) {
    const nextStatus = await getPrivateOverlayBridge()?.setHandleSize(size);

    return nextStatus;
  }

  function openSettings(section: SettingsSection = 'general') {
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
          onOpenSettingsSection={openSettings}
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
              autoCollapse={autoCollapse}
              canStartListening={canStartListening}
              edge={overlayEdge}
              isAiResponsePlaceholder={isAiResponsePlaceholder}
              isBusy={isBusy}
              isListening={isListening}
              isLlmReady={isSelectedAiProviderReadyForListening}
              isTranscriptPlaceholder={isTranscriptPlaceholder}
              listenToMicrophone={listenToMicrophone}
              listenToSystemAudio={listenToSystemAudio}
              localLlmStatus={localLlmStatus}
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
              onOpenGeneralInstructions={() => setIsGeneralInstructionsDialogOpen(true)}
              onOpenPromptTemplateSettings={() => setIsPromptTemplateDialogOpen(true)}
              onOpenPermissionSettings={() => openSettings('permissions')}
              onSelectPromptTemplates={(ids) => void selectPromptTemplates(ids)}
              onSetListenToMicrophone={setListenToMicrophone}
              onSetListenToSystemAudio={setListenToSystemAudio}
              outputRef={outputRef}
              promptTemplates={promptTemplates}
              sendToAiWhenListeningStops={sendToAiWhenListeningStops}
              selectedAiProvider={selectedAiProvider}
              selectedPromptTemplateIds={selectedPromptTemplateIds}
              setSendToAiWhenListeningStops={setSendToAiWhenListeningStops}
              toggleListening={toggleListening}
              transcription={transcription}
            />
            {isSettingsOpen ? (
              <SettingsPage
                isBusy={isBusy}
                isListening={isListening}
                initialSection={settingsSection}
                llmModel={llmModel}
                llmReasoning={llmReasoning}
                onSelectedAiProviderChange={setSelectedAiProvider}
                isMac={isMac}
                onClose={() => setIsSettingsOpen(false)}
                onQuit={() => void getSettingsBridge()?.quit?.()}
                onRequestPermission={requestPermission}
                onSetPrivateOverlayHandleSize={(size) => void setPrivateOverlayHandleSize(size)}
                autoCollapse={autoCollapse}
                permissionsStatus={permissionsStatus}
                privateOverlayStatus={privateOverlayStatus}
                resetSettings={resetSettings}
                setAutoCollapse={setAutoCollapse}
                setLlmModel={saveLlmModel}
                setLlmReasoning={saveLlmReasoning}
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
        <PrivateOverlayResizeHandles />
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

function OnboardingSurface() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [localLlmStatus, setLocalLlmStatus] = useState<LocalLlmStatus | null>(null);
  const [localAiSetupPhase, setLocalAiSetupPhase] = useState<'downloading' | 'idle'>('idle');
  const [selectedAiProvider, setSelectedAiProviderState] = useState<AiProvider>('local');
  const [isChatGptSigningIn, setIsChatGptSigningIn] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const permissionsRef = useRef<HTMLElement | null>(null);
  const parakeetRef = useRef<HTMLElement | null>(null);
  const aiRef = useRef<HTMLElement | null>(null);
  const hasAutoStartedParakeetDownloadRef = useRef(false);
  const autoSelectingReadyModelRef = useRef<LocalTranscriptionModelId | null>(null);
  const runtimeContext = useRuntimeContext();
  const appName = runtimeContext?.appName ?? 'Caul';
  const appIconUrl = runtimeContext?.appChannel === 'beta' || runtimeContext?.appChannel === 'dev'
    ? caulBetaAppIconUrl
    : caulAppIconUrl;

  useEffect(() => {
    void refresh();

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
        return current === 'downloading' ? 'idle' : current;
      });
    });

    const smokeStep = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (detail === 'permissions' || detail === 'parakeet' || detail === 'ai') {
        const step = detail as OnboardingStep;
        const target = {
          ai: aiRef,
          parakeet: parakeetRef,
          permissions: permissionsRef
        }[step];

        target.current?.scrollIntoView({ block: 'start' });
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

  async function refresh() {
    const nextStatus = await getSettingsBridge()?.onboarding?.status();

    if (nextStatus) {
      setStatus(nextStatus);
      setSelectedAiProviderState(nextStatus.ai?.provider ?? 'local');
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
      await getSettingsBridge()?.parakeet?.download(modelId);
      await refresh();
    } catch (error) {
      console.error('Failed to download transcription model:', error);
    }
  }

  async function signInWithChatGpt() {
    setIsChatGptSigningIn(true);

    try {
      await getSettingsBridge()?.ai?.openChatGptLogin?.();
    } finally {
      setIsChatGptSigningIn(false);
    }

    await refresh();
  }

  async function selectAiProvider(provider: AiProvider) {
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
      setLocalAiSetupPhase('downloading');
      setLocalLlmStatus((current) => getPreparingLocalAiStatus(current ?? getCaulLocalLlmStatus(status)));
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

  const missingItems = getMissingOnboardingItems(status);
  const visiblePermissions = getOnboardingVisiblePermissionItems(status?.permissions);
  const onboardingPermissionRows = getOnboardingPermissionRows(visiblePermissions);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const recommendedModelId = status?.transcription.recommendedModel?.id;

    if (
      hasAutoStartedParakeetDownloadRef.current
      || !status
      || status.transcription.recommended === 'cloud'
      || !recommendedModelId
      || status.transcription.autoDownloadModel === false
      || status.transcription.autoDownloadParakeet === false
      || status.parakeet.status !== 'missing'
    ) {
      return;
    }

    hasAutoStartedParakeetDownloadRef.current = true;
    void downloadParakeet(recommendedModelId);
  }, [status]);

  useEffect(() => {
    const readyModelId = status?.parakeet.modelId;

    if (
      !status
      || status.parakeet.status !== 'installed'
      || !readyModelId
      || status.selectedLocalTranscriptionModel === readyModelId
      || autoSelectingReadyModelRef.current === readyModelId
    ) {
      return;
    }

    autoSelectingReadyModelRef.current = readyModelId;

    void getSettingsBridge()?.parakeet?.setModel(readyModelId)
      .then(() => refresh())
      .catch((error) => {
        console.error('Failed to use ready transcription model:', error);
      })
      .finally(() => {
        autoSelectingReadyModelRef.current = null;
      });
  }, [status]);

  useEffect(() => {
    const element = contentRef.current;
    const fitContent = getSettingsBridge()?.onboarding?.fitContent;

    if (!element || !fitContent) {
      return;
    }

    let animationFrame = 0;

    const reportSize = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();

        void fitContent({
          height: Math.ceil(rect.height),
          width: Math.ceil(rect.width)
        });
      });
    };

    const resizeObserver = new ResizeObserver(reportSize);
    resizeObserver.observe(element);
    reportSize();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <TooltipProvider>
      <main className="h-screen overflow-y-auto bg-background text-foreground">
        <div ref={contentRef} className="grid w-full gap-2 px-3 py-3">
        <header className="mb-2 flex flex-col items-center gap-2 pt-1 text-center">
          <img alt={appName} className="size-32 rounded-3xl" src={appIconUrl} />
          <h1 className="text-lg font-semibold">Welcome to {appName}</h1>
        </header>

        <OnboardingPanel sectionRef={parakeetRef} title="Transcription">
          <OnboardingTranscriptionStatus status={status} />
        </OnboardingPanel>

        <OnboardingPanel sectionRef={aiRef} title="AI responses">
          <OnboardingAiModelSetup
            isChatGptSigningIn={isChatGptSigningIn}
            localLlmStatus={localLlmStatus}
            localAiSetupPhase={localAiSetupPhase}
            onCancelLocalDownload={() => void cancelLocalAiDownload()}
            onDownloadLocalAi={(modelId) => void downloadLocalAi(modelId)}
            onSelectProvider={(provider) => void selectAiProvider(provider)}
            onSignInWithChatGpt={() => void signInWithChatGpt()}
            selectedProvider={selectedAiProvider}
            status={status}
          />
        </OnboardingPanel>

        {onboardingPermissionRows.length > 0 ? (
          <OnboardingPanel sectionRef={permissionsRef} title="Permissions">
            <div className="grid">
              {onboardingPermissionRows.map((row) => (
                row.kind === 'audio' ? (
                  <AudioPermissionSetupRow
                    key="audio"
                    microphone={row.microphone}
                    onChange={(permissions) => void requestOnboardingPermissions(permissions)}
                    systemAudio={row.systemAudio}
                  />
                ) : (
                  <PermissionSetupRow
                    key={row.permission.id}
                    onChange={() => void requestOnboardingPermission(row.permission.id)}
                    permission={row.permission}
                  />
                )
              ))}
            </div>
          </OnboardingPanel>
        ) : null}

        <OnboardingStartButton
          isCompleting={isCompleting}
          missingItems={missingItems}
          onClick={() => void finish()}
        />
        </div>
      </main>
    </TooltipProvider>
  );
}

function OnboardingStartButton({
  isCompleting,
  missingItems,
  onClick
}: {
  isCompleting: boolean;
  missingItems: string[];
  onClick: () => void;
}) {
  const disabled = isCompleting || missingItems.length > 0;

  return (
    <div className="flex w-full justify-center py-6">
      <span className={disabled ? 'group relative inline-flex cursor-not-allowed' : 'inline-flex'}>
        <Button
          className={disabled
            ? 'h-10 pointer-events-none px-5 text-sm'
            : 'h-10 bg-[#34424A] px-5 text-sm text-white hover:bg-[#8EA6AD] focus-visible:border-[#8EA6AD] focus-visible:ring-[#34424A]/30 dark:bg-[#8EA6AD] dark:text-[#101619] dark:hover:bg-[#B8A46A]'}
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          {isCompleting ? 'Starting Caul' : 'Start using Caul'}
        </Button>
        {disabled && !isCompleting ? (
          <div
            className="pointer-events-none absolute bottom-full left-1/2 z-[2147483647] mb-2 hidden w-max max-w-64 -translate-x-1/2 rounded-md bg-primary px-2 py-1.5 text-left text-xs leading-4 text-primary-foreground shadow-md group-hover:block group-focus-within:block"
            role="tooltip"
          >
            <div className="font-medium">Still needed</div>
            <ul className="mt-1 list-disc pl-4">
              {missingItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <span className="absolute left-1/2 top-full size-2.5 -translate-x-1/2 -translate-y-[calc(50%_-_2px)] rotate-45 rounded-[2px] bg-primary" />
          </div>
        ) : null}
      </span>
    </div>
  );
}

function getMissingOnboardingItems(status: OnboardingStatus | null) {
  if (!status) {
    return ['Setup checks'];
  }

  const missing = [];
  const missingPermissions = getOnboardingVisiblePermissionItems(status.permissions).filter((permission) => (
    permission.status !== 'granted' && permission.status !== 'unsupported'
  ));

  if (missingPermissions.length > 0) {
    missing.push(...missingPermissions.map((permission) => permission.label));
  }

  if (!isOnboardingTranscriptionModelReady(status)) {
    missing.push('Local transcription');
  }

  return missing;
}

function isOnboardingTranscriptionModelReady(status: OnboardingStatus) {
  return Boolean(
    status.selectedLocalTranscriptionModel
    && status.parakeet.installed
    && status.parakeet.modelId === status.selectedLocalTranscriptionModel
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
    <section ref={sectionRef} aria-labelledby={titleId} className="rounded-lg border border-border bg-card/55 px-3 py-2 shadow-sm">
      <h2 id={titleId} className="mb-2 text-base font-semibold">{title}</h2>
      {description ? <p className="mb-2 text-xs text-muted-foreground">{description}</p> : null}
      {children}
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
    <div className="flex items-center justify-between gap-3 border-b border-border/70 py-1.5 text-sm last:border-b-0">
      <div>
        <h3 className="text-sm font-medium">{label}</h3>
        {value ? <div aria-live="polite" className="text-xs text-muted-foreground">{value}</div> : null}
      </div>
      {action ?? (ready ? <CheckCircle2Icon className="size-4 text-[#34424A]" /> : <XCircleIcon className="size-4 text-muted-foreground" />)}
    </div>
  );
}

function OnboardingAiModelSetup({
  isChatGptSigningIn,
  localAiSetupPhase,
  localLlmStatus,
  onCancelLocalDownload,
  onDownloadLocalAi,
  onSelectProvider,
  onSignInWithChatGpt,
  selectedProvider,
  status
}: {
  isChatGptSigningIn: boolean;
  localAiSetupPhase: 'downloading' | 'idle';
  localLlmStatus: LocalLlmStatus | null;
  onCancelLocalDownload: () => void;
  onDownloadLocalAi: (modelId?: string) => void;
  onSelectProvider: (provider: AiProvider) => void;
  onSignInWithChatGpt: () => void;
  selectedProvider: AiProvider;
  status: OnboardingStatus | null;
}) {
  const ai = status?.ai;
  const piReady = Boolean(status?.pi.connected);
  const localRecommendedModel = ai?.recommended === 'local' ? ai.recommendedModel : null;
  const caulLocalStatus = localLlmStatus ?? getCaulLocalLlmStatus(status);
  const isLocalDownloading = caulLocalStatus?.status === 'downloading' || localAiSetupPhase === 'downloading';
  const localModelInstalled = Boolean(
    caulLocalStatus?.runtime.installed
    && caulLocalStatus.model?.installed
    && localRecommendedModel
    && caulLocalStatus.model.id === localRecommendedModel.id
  );
  return (
    <div className="grid gap-2">
      <div className="inline-flex w-full rounded-md border border-border bg-muted/30 p-0.5" role="tablist" aria-label="AI provider">
        {(['local', 'cloud'] as AiProvider[]).map((provider) => (
          <button
            key={provider}
            aria-label={provider === 'local' ? 'Local' : 'Cloud'}
            aria-selected={selectedProvider === provider}
            className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 text-sm font-medium transition-colors ${selectedProvider === provider ? '!bg-primary !text-primary-foreground shadow-sm hover:!bg-primary/90 dark:!bg-primary dark:!text-primary-foreground dark:hover:!bg-primary/90' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => onSelectProvider(provider)}
            role="tab"
            type="button"
          >
            <span>{provider === 'local' ? 'Local' : 'Cloud'}</span>
            {ai?.recommended === provider ? <RecommendedPill selected={selectedProvider === provider} /> : null}
          </button>
        ))}
      </div>

      {selectedProvider === 'local' ? (
        <div role="tabpanel" className="grid h-20 grid-rows-[1fr_2.25rem] justify-items-center gap-1.5 text-center">
          <div className="flex min-w-0 items-center gap-1 text-xs leading-5 text-muted-foreground">
            <p>Local and private. Slower and less intelligent than ChatGPT.</p>
            {localRecommendedModel ? <LocalAiRecommendationInfoButton recommendation={ai} /> : null}
          </div>
          <div className="flex min-h-9 flex-wrap items-center justify-center gap-2">
            {localModelInstalled ? (
              <StatusPill ready>Ready</StatusPill>
            ) : caulLocalStatus?.runtime.supported === false ? (
              <StatusPill ready={false}>Unavailable</StatusPill>
            ) : isLocalDownloading ? (
              <>
                <Button onClick={onCancelLocalDownload} size="sm" type="button" variant="outline">Cancel</Button>
                {caulLocalStatus?.progress ? (
                  <span aria-live="polite" className="max-w-52 truncate text-xs tabular-nums text-muted-foreground" title={getLocalAiDownloadProgressLabel(caulLocalStatus.progress).accessibleLabel}>
                    {getLocalAiDownloadProgressLabel(caulLocalStatus.progress).label}
                  </span>
                ) : (
                  <span aria-live="polite" className="max-w-52 truncate text-xs tabular-nums text-muted-foreground">
                    Downloading local AI...
                  </span>
                )}
              </>
            ) : (
              <Button disabled={!caulLocalStatus?.runtime.supported && Boolean(caulLocalStatus)} onClick={() => onDownloadLocalAi(localRecommendedModel?.id)} size="sm" type="button">
                Download local AI
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div role="tabpanel" className="grid h-20 grid-rows-[1fr_2.25rem] justify-items-center gap-1.5 text-center">
          <p className="flex items-center text-xs leading-5 text-muted-foreground">
            Sends to ChatGPT. Faster and smarter than Local.
          </p>
          <div className="flex min-h-9 items-center justify-center gap-1.5">
            {!piReady ? (
              <Button disabled={isChatGptSigningIn} onClick={onSignInWithChatGpt} size="sm" type="button">
                {isChatGptSigningIn ? <LoaderCircleIcon className="mr-1.5 size-3.5 animate-spin" /> : null}
                {isChatGptSigningIn ? 'Opening' : 'Sign in with ChatGPT'}
              </Button>
            ) : (
              <StatusPill ready>Ready</StatusPill>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelAutoUpdateCheckbox({
  checked,
  description,
  id,
  onCheckedChange
}: {
  checked: boolean;
  description: string;
  id: string;
  onCheckedChange: (enabled: boolean) => void;
}) {
  return (
    <Field className="w-auto self-start gap-2" orientation="horizontal">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
      />
      <div className="grid gap-0.5">
        <FieldLabel htmlFor={id}>Auto update model</FieldLabel>
        <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
          {description}
        </p>
      </div>
    </Field>
  );
}

function RecommendedPill({ selected = false }: { selected?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={selected ? selectedRecommendedPillClassName : recommendedPillClassName}
    >
      Recommended
    </span>
  );
}

function LocalAiRecommendationInfoButton({
  recommendation
}: {
  recommendation: AiRecommendation | null | undefined;
}) {
  const model = recommendation?.recommended === 'local' ? recommendation.recommendedModel : null;
  const runtime = recommendation?.resources.localRuntimes?.caulLlamaCpp ?? recommendation?.localRuntime;
  const sizeGb = runtime?.model?.sizeGb;
  const source = recommendation?.selectionReason ? 'live recommendations' : 'fallback catalogue';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="Local AI recommendation details"
          size="icon"
          type="button"
          variant="ghost"
        >
          <InfoIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">Local AI details</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            Caul picked this for private replies on this computer.
          </p>
        </div>
        <dl className="grid gap-2 text-xs">
          <div className="grid gap-0.5">
            <dt className="font-medium text-foreground">Model</dt>
            <dd className="text-muted-foreground">{model?.name ?? runtime?.model?.name ?? 'Recommended local AI'}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="font-medium text-foreground">Runtime</dt>
            <dd className="text-muted-foreground">{model?.runtime ?? runtime?.provider ?? 'Caul local runtime'}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="font-medium text-foreground">Download size</dt>
            <dd className="text-muted-foreground">{typeof sizeGb === 'number' ? `About ${sizeGb.toFixed(1)} GB` : 'Shown when available'}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="font-medium text-foreground">Why this one</dt>
            <dd className="text-muted-foreground">{recommendation?.selectionReason ?? model?.reason ?? 'Best fit for this computer.'}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="font-medium text-foreground">Source</dt>
            <dd className="text-muted-foreground">{source}</dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
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
    return 'Check for newer AI recommendations.';
  }

  const failedSources = result.sourceReports.filter((report) => !report.ok).length;
  const checkedSources = result.sourceReports.length;
  const sourceText = checkedSources === 1 ? '1 source checked' : `${checkedSources} sources checked`;
  const failureText = failedSources > 0
    ? `, ${failedSources} could not be reached`
    : '';

  return `AI recommendations refreshed ${formatReviewedDate(result.reviewedAt)}. ${sourceText}${failureText}.`;
}

function getCaulLocalLlmStatus(status: OnboardingStatus | null): LocalLlmStatus | null {
  const runtime = status?.ai.resources.localRuntimes?.caulLlamaCpp;

  return runtime?.provider === 'caul-llama.cpp' || runtime?.provider === 'caul-mlx' ? runtime : null;
}

function getPreparingLocalAiStatus(status: LocalLlmStatus | null): LocalLlmStatus | null {
  if (!status) {
    return null;
  }

  return {
    ...status,
    progress: {
      downloadedBytes: 0,
      label: 'Preparing local AI',
      percent: 0,
      phase: 'runtime',
      totalBytes: null
    },
    status: 'downloading'
  };
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
        action={<LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />}
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
        label="Ready"
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
        action={<LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />}
        label="Finishing transcription setup"
        ready={false}
      />
    );
  }

  return (
    <StatusRow
      action={canAutoDownload
        ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
        : <StatusPill ready={false}>Not ready</StatusPill>}
      label={canAutoDownload ? 'Preparing local transcription' : 'Transcription setup needs attention'}
      ready={false}
    />
  );
}

const localTranscriptionModelOptions: Array<{ label: string; title: string; value: LocalTranscriptionModelId }> = [
  { label: 'Best accuracy', title: 'Best accuracy - Parakeet v3', value: 'parakeet' },
  { label: 'Lower memory use', title: 'Lower memory use - Moonshine tiny', value: 'moonshine-tiny' }
];

function getInitialTranscriptionModelId(status: OnboardingStatus): LocalTranscriptionModelId {
  return status.selectedLocalTranscriptionModel ?? status.parakeet.modelId ?? status.transcription.recommendedModel?.id ?? 'parakeet';
}

function getLocalTranscriptionModelTitle(modelId: LocalTranscriptionModelId) {
  return localTranscriptionModelOptions.find((option) => option.value === modelId)?.title ?? 'Best accuracy - Parakeet v3';
}

function TranscriptionModelRow({
  onCancel,
  onDownload,
  onSelectModel,
  selectedModelId,
  status
}: {
  onCancel: () => void;
  onDownload: (modelId: LocalTranscriptionModelId) => void;
  onSelectModel: (modelId: LocalTranscriptionModelId) => void;
  selectedModelId: LocalTranscriptionModelId;
  status: OnboardingStatus | null;
}) {
  const isDownloading = status?.parakeet.status === 'downloading';
  const isSelectedModelReady = status?.parakeet.status === 'installed' && status.parakeet.modelId === selectedModelId;
  const isSelectedModelInUse = isSelectedModelReady && status?.selectedLocalTranscriptionModel === selectedModelId;
  const canDownload = Boolean(status && !isDownloading && status.transcription.recommended !== 'cloud');
  const canUse = canDownload && !isSelectedModelReady && !isSelectedModelInUse;
  const recommendedModelId = status?.transcription.recommendedModel?.id;
  const showRecommendedBadge = selectedModelId === recommendedModelId;
  const recommendedTooltip = getRecommendedTranscriptionModelTooltip(status);
  const selectedModelTitle = getLocalTranscriptionModelTitle(selectedModelId);
  const downloadProgress = getLocalModelDownloadProgressLabel(status?.parakeet.progress);
  const renderRecommendedBadge = () => (
    <span className={recommendedPillClassName} title={recommendedTooltip}>
      Recommended
    </span>
  );

  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <select
          aria-label="Transcription model"
          className="h-8 w-[15.25rem] max-w-full min-w-0 appearance-auto rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          name="transcription-model"
          value={selectedModelId}
          onChange={(event) => onSelectModel(event.currentTarget.value as LocalTranscriptionModelId)}
          title={selectedModelTitle}
        >
          {localTranscriptionModelOptions.map((option) => (
            <option key={option.value} title={option.title} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {showRecommendedBadge ? renderRecommendedBadge() : null}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {isDownloading ? (
          <span aria-label={downloadProgress.accessibleLabel} aria-live="polite" className="min-w-0 flex-1 truncate text-right text-xs tabular-nums text-muted-foreground" title={downloadProgress.accessibleLabel}>
            {downloadProgress.label}
          </span>
        ) : isSelectedModelReady ? (
          <span aria-live="polite" className="inline-flex w-20 items-center justify-end gap-1 text-xs font-medium text-[#34424A] dark:text-[#8EA6AD]">
            <CheckCircle2Icon className="size-3.5" />
            Ready
          </span>
        ) : null}
        {isDownloading ? (
          <Button onClick={onCancel} size="sm" type="button" variant="outline">Cancel</Button>
        ) : isSelectedModelReady ? null : (
          <Button disabled={!canUse} onClick={() => onDownload(selectedModelId)} size="sm" type="button">
            Use
          </Button>
        )}
      </div>
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

function getLocalAiDownloadProgressLabel(progress: LocalLlmStatus['progress']) {
  if (!progress) {
    return {
      accessibleLabel: 'Downloading local AI',
      label: 'Downloading local AI...'
    };
  }

  if (progress.totalBytes === null) {
    return {
      accessibleLabel: progress.label,
      label: progress.label
    };
  }

  return {
    accessibleLabel: `${progress.label} ${progress.percent}%`,
    label: `${progress.label} · ${progress.percent}%`
  };
}

function getRecommendedTranscriptionModelTooltip(status: OnboardingStatus | null) {
  if (!status?.transcription.recommendedModel) {
    return 'Recommended from local setup checks.';
  }

  const model = status.transcription.recommendedModel;
  const scores = [
    `Parakeet score ${status.transcription.score.parakeet}`,
    typeof status.transcription.score.moonshineTiny === 'number'
      ? `Moonshine score ${status.transcription.score.moonshineTiny}`
      : null
  ].filter(Boolean).join(', ');

  return `${model.reason} Based on a short local machine probe: ${scores}.`;
}

function StatusPill({
  children,
  ready
}: {
  children: ReactNode;
  ready: boolean;
}) {
  return (
    <span className={`rounded-full border px-2 py-1 text-xs font-medium ${ready ? 'border-[#34424A]/35 text-[#34424A] dark:text-[#8EA6AD]' : 'border-destructive/35 text-destructive'}`}>
      {children}
    </span>
  );
}

type OnboardingPermissionRow =
  | { kind: 'permission'; permission: PermissionItem }
  | { kind: 'audio'; microphone: PermissionItem | null; systemAudio: PermissionItem | null };

function getOnboardingPermissionRows(permissions: PermissionItem[]): OnboardingPermissionRow[] {
  const microphone = permissions.find((permission) => permission.id === 'microphone') ?? null;
  const systemAudio = permissions.find((permission) => permission.id === 'system-audio') ?? null;
  const rows: OnboardingPermissionRow[] = permissions
    .filter((permission) => permission.id !== 'microphone' && permission.id !== 'system-audio')
    .map((permission) => ({ kind: 'permission', permission }));

  if (microphone || systemAudio) {
    rows.push({ kind: 'audio', microphone, systemAudio });
  }

  return rows;
}

function AudioPermissionSetupRow({
  microphone,
  onChange,
  showDivider = true,
  systemAudio
}: {
  microphone: PermissionItem | null;
  onChange: (permissions: Array<PermissionItem['id']>) => void;
  showDivider?: boolean;
  systemAudio: PermissionItem | null;
}) {
  const [restartHintVisible, setRestartHintVisible] = useState(false);
  const permissions = [microphone, systemAudio].filter((permission): permission is PermissionItem => Boolean(permission));
  const label = microphone && systemAudio
    ? 'Microphone & System Audio'
    : microphone?.label ?? systemAudio?.label ?? 'Audio';
  const description = microphone && systemAudio
    ? 'Required for microphone input and audio from other apps. macOS may show these prompts one after the other.'
    : systemAudio
      ? 'Required for audio from other apps.'
      : 'Required when listening to your microphone.';
  const ready = permissions.every((permission) => permission.status === 'granted' || permission.status === 'unsupported');
  const needsRestart = permissions.some((permission) => permission.status === 'denied' || permission.status === 'restricted');
  const showRestart = needsRestart && restartHintVisible;
  const actionLabel = needsRestart ? 'Open Settings' : 'Grant';
  const missingPermissionIds = permissions
    .filter((permission) => permission.status !== 'granted' && permission.status !== 'unsupported')
    .map((permission) => permission.id)
    .sort((a, b) => {
      const order = ['microphone', 'system-audio'];
      return order.indexOf(a) - order.indexOf(b);
    });
  const deniedPermissionIds = permissions
    .filter((permission) => permission.status === 'denied' || permission.status === 'restricted')
    .map((permission) => permission.id)
    .sort((a, b) => {
      const order = ['microphone', 'system-audio'];
      return order.indexOf(a) - order.indexOf(b);
    });
  const actionPermissionIds = needsRestart
    ? deniedPermissionIds.slice(0, 1)
    : missingPermissionIds;

  return (
    <div className={`${showDivider ? 'border-b border-border/70 last:border-b-0' : ''} text-sm`.trim()}>
      <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-sm font-medium">{label}</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={`${label} permission info`}
                className="inline-flex size-6 shrink-0 cursor-default items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                type="button"
              >
                <InfoIcon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="block max-w-72">
                {description}
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-1 text-xs font-medium ${ready ? 'border-[#34424A]/35 text-[#34424A] dark:text-[#8EA6AD]' : 'border-destructive/35 text-destructive'}`}>
            {ready ? 'Granted' : 'Not granted'}
          </span>
          {!ready ? (
            <Button
              aria-label={`Grant ${label}`}
              onClick={() => {
                onChange(actionPermissionIds);
                if (needsRestart) {
                  setRestartHintVisible(true);
                }
              }}
              size="sm"
              type="button"
            >
              {actionLabel}
            </Button>
          ) : null}
          {showRestart ? (
            <Button
              aria-label="Restart Caul"
              onClick={() => void getSettingsBridge()?.relaunch?.()}
              size="sm"
              type="button"
              variant="secondary"
            >
              Restart
            </Button>
          ) : null}
        </div>
      </div>
      {showRestart ? (
        <p className="pb-2 text-xs text-muted-foreground">
          Changed it in System Settings? Restart Caul to apply the permission.
        </p>
      ) : null}
    </div>
  );
}

function PermissionSetupRow({
  onChange,
  permission,
  showDivider = true
}: {
  onChange: () => void;
  permission: PermissionItem;
  showDivider?: boolean;
}) {
  const ready = permission.status === 'granted' || permission.status === 'unsupported';
  const statusLabel = getPermissionStatusLabel(permission.status);
  const macosPermissionName = getMacosPermissionName(permission.id);

  return (
    <div className={`${showDivider ? 'border-b border-border/70 last:border-b-0' : ''} text-sm`.trim()}>
      <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-sm font-medium">{permission.label}</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={`${permission.label} permission info`}
                className="inline-flex size-6 shrink-0 cursor-default items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                type="button"
              >
                <InfoIcon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="block max-w-72">
                {permission.description} macOS permission: {macosPermissionName}.
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-1 text-xs font-medium ${ready ? 'border-[#34424A]/35 text-[#34424A] dark:text-[#8EA6AD]' : 'border-destructive/35 text-destructive'}`}>
            {statusLabel}
          </span>
          {!ready ? (
            <Button aria-label={`Grant ${permission.label}`} onClick={onChange} size="sm" type="button">
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

type OverlayResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';

function PrivateOverlayResizeHandles() {
  const resizeStateRef = useRef<{
    direction: OverlayResizeDirection;
    pointerId: number;
  } | null>(null);
  const handles: Array<{
    className: string;
    direction: OverlayResizeDirection;
    label: string;
  }> = [
    { className: layout.overlayResizeHandleN, direction: 'n', label: 'Resize window from top edge' },
    { className: layout.overlayResizeHandleE, direction: 'e', label: 'Resize window from right edge' },
    { className: layout.overlayResizeHandleS, direction: 's', label: 'Resize window from bottom edge' },
    { className: layout.overlayResizeHandleW, direction: 'w', label: 'Resize window from left edge' },
    { className: layout.overlayResizeHandleNE, direction: 'ne', label: 'Resize window from top right corner' },
    { className: layout.overlayResizeHandleSE, direction: 'se', label: 'Resize window from bottom right corner' },
    { className: layout.overlayResizeHandleSW, direction: 'sw', label: 'Resize window from bottom left corner' },
    { className: layout.overlayResizeHandleNW, direction: 'nw', label: 'Resize window from top left corner' }
  ];

  function getResizePoint(event: PointerEvent<HTMLDivElement>, direction: OverlayResizeDirection) {
    return {
      direction,
      screenX: event.screenX,
      screenY: event.screenY
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>, direction: OverlayResizeDirection) {
    if (event.button !== 0) {
      return;
    }

    const bridge = getPrivateOverlayBridge();

    if (!bridge) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      direction,
      pointerId: event.pointerId
    };

    void bridge.resizeWindowStart(getResizePoint(event, direction));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const resizeState = resizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    void getPrivateOverlayBridge()?.resizeWindowMove(getResizePoint(event, resizeState.direction));
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const resizeState = resizeStateRef.current;

    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }

    resizeStateRef.current = null;

    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    event.preventDefault();
    void getPrivateOverlayBridge()?.resizeWindowEnd(getResizePoint(event, resizeState.direction));
  }

  return (
    <>
      {handles.map((handle) => (
        <div
          key={handle.direction}
          aria-label={handle.label}
          className={`${layout.overlayResizeHandle} ${handle.className}`}
          onPointerCancel={handlePointerEnd}
          onPointerDown={(event) => handlePointerDown(event, handle.direction)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="presentation"
        />
      ))}
    </>
  );
}

function PrivateOverlayWindowTitleBar({
  appTitle,
  isMac,
  isSettingsOpen,
  notifications,
  onOpenHistoryFolder,
  onOpenSettingsSection,
  onToggleSettings
}: {
  appTitle: string;
  isMac: boolean;
  isSettingsOpen: boolean;
  notifications: MainNotification[];
  onOpenHistoryFolder: () => void;
  onOpenSettingsSection: (section: SettingsSection) => void;
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

  const quitConfirmationContent = (
    <PopoverContent
      align={isMac ? 'start' : 'end'}
      className="w-56 gap-3"
      side="bottom"
      sideOffset={8}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Quit Caul?</h2>
        <p className="text-xs text-muted-foreground">
          This will stop Caul and close the app completely.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => setIsQuitConfirmationOpen(false)} size="sm" type="button" variant="outline">
          Cancel
        </Button>
        <Button onClick={confirmQuit} size="sm" type="button" variant="destructive">
          Quit Caul
        </Button>
      </div>
    </PopoverContent>
  );

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
            <button
              aria-label="Hide Caul app"
              className={layout.windowTitleBarMacCloseButton}
              data-platform="macos"
              onClick={() => void getPrivateOverlayBridge()?.hide()}
              title="Hide Caul app"
              type="button"
            />
            <Popover open={isQuitConfirmationOpen} onOpenChange={setIsQuitConfirmationOpen}>
              <PopoverTrigger asChild>
                <button
                  aria-label="Quit Caul"
                  className={layout.windowTitleBarMacQuitButton}
                  data-platform="macos"
                  title="Quit Caul completely"
                  type="button"
                >
                  <PowerIcon />
                </button>
              </PopoverTrigger>
              {quitConfirmationContent}
            </Popover>
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
            <Popover open={isQuitConfirmationOpen} onOpenChange={setIsQuitConfirmationOpen}>
              <PopoverTrigger asChild>
                <Button
                  aria-label="Quit Caul"
                  className={layout.windowTitleBarQuitButton}
                  data-platform="desktop"
                  size="icon"
                  title="Quit Caul completely"
                  type="button"
                  variant="ghost"
                >
                  <PowerIcon />
                </Button>
              </PopoverTrigger>
              {quitConfirmationContent}
            </Popover>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Open history folder"
              className={`${layout.windowTitleBarSettingsButton} ${isMac ? layout.windowTitleBarHistoryButtonMac : layout.windowTitleBarHistoryButtonDesktop}`}
              onClick={onOpenHistoryFolder}
              type="button"
            >
              <HistoryIcon className="mx-auto size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open history folder</TooltipContent>
        </Tooltip>
        {notifications.length > 0 ? (
          <MainNotificationButton
            className={`${layout.windowTitleBarSettingsButton} ${isMac ? layout.windowTitleBarNotificationButtonMac : layout.windowTitleBarNotificationButtonDesktop}`}
            notifications={notifications}
            onOpenSettingsSection={onOpenSettingsSection}
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Caul Settings"
              aria-pressed={isSettingsOpen}
              className={`${layout.windowTitleBarSettingsButton} ${isMac ? layout.windowTitleBarSettingsButtonMac : layout.windowTitleBarSettingsButtonDesktop} ${isSettingsOpen ? 'bg-muted text-foreground' : ''}`}
              onClick={onToggleSettings}
              type="button"
            >
              <SettingsIcon className="mx-auto size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Caul settings</TooltipContent>
        </Tooltip>
      </header>
    </>
  );
}

function MainNotificationButton({
  className,
  notifications,
  onOpenSettingsSection
}: {
  className: string;
  notifications: MainNotification[];
  onOpenSettingsSection: (section: SettingsSection) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Caul notifications"
          className={className}
          type="button"
        >
          <CircleAlertIcon className="mx-auto size-4" />
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-2" side="bottom" sideOffset={8}>
        <h2 className="text-sm font-medium text-foreground">Needs attention</h2>
        <div className="grid gap-1">
          {notifications.map((notification) => (
            <button
              key={notification.id}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => {
                setOpen(false);
                onOpenSettingsSection(notification.section);
              }}
              type="button"
            >
              <span>{notification.label}</span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </button>
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
    <main className={layout.handleRoot} aria-label="Caul overlay handle">
      <button
        aria-label="Toggle Caul app"
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
        title="Toggle Caul app"
        type="button"
      >
        <span aria-hidden="true" className="caul-handle-icon" style={handleIconStyle} />
      </button>
    </main>
  );
}

function HomePage({
  autoCollapse,
  canStartListening,
  edge,
  isAiResponsePlaceholder,
  isBusy,
  isListening,
  isLlmReady,
  isTranscriptPlaceholder,
  listenToMicrophone,
  listenToSystemAudio,
  localLlmStatus,
  llmOutputRef,
  missingSelectedPermissions,
  onAskAiFromTranscript,
  onAskAiFromManualPrompt,
  onAskAiFromSpecificTranscript,
  onClearAiResponses,
  onClearTranscript,
  onCopyAiResponse,
  onCopyTranscript,
  onDownloadAiResponse,
  onDownloadTranscript,
  onOpenGeneralInstructions,
  onOpenPermissionSettings,
  onOpenPromptTemplateSettings,
  onSelectPromptTemplates,
  onSetListenToMicrophone,
  onSetListenToSystemAudio,
  outputRef,
  promptTemplates,
  sendToAiWhenListeningStops,
  selectedAiProvider,
  selectedPromptTemplateIds,
  setSendToAiWhenListeningStops,
  toggleListening,
  transcription
}: {
  autoCollapse: boolean;
  canStartListening: boolean;
  edge: OverlayEdge;
  isAiResponsePlaceholder: boolean;
  isBusy: boolean;
  isListening: boolean;
  isLlmReady: boolean;
  isTranscriptPlaceholder: boolean;
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
  localLlmStatus: LocalLlmStatus | null;
  llmOutputRef: RefObject<HTMLDivElement | null>;
  missingSelectedPermissions: PermissionItem[];
  onAskAiFromTranscript: () => void;
  onAskAiFromManualPrompt: (prompt: string) => void;
  onAskAiFromSpecificTranscript: (transcript: string) => void;
  onClearAiResponses: () => void;
  onClearTranscript: () => void;
  onCopyAiResponse: () => void;
  onCopyTranscript: () => void;
  onDownloadAiResponse: (format: TranscriptDownloadFormat) => void;
  onDownloadTranscript: (format: TranscriptDownloadFormat) => void;
  onOpenGeneralInstructions: () => void;
  onOpenPermissionSettings: () => void;
  onOpenPromptTemplateSettings: () => void;
  onSelectPromptTemplates: (ids: string[]) => void;
  onSetListenToMicrophone: (listen: boolean) => void;
  onSetListenToSystemAudio: (listen: boolean) => void;
  outputRef: RefObject<HTMLDivElement | null>;
  promptTemplates: PromptTemplate[];
  sendToAiWhenListeningStops: boolean;
  selectedAiProvider: AiProvider;
  selectedPromptTemplateIds: string[];
  setSendToAiWhenListeningStops: (sendToAi: boolean) => void;
  toggleListening: () => void;
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
  const localAiPlaceholderStatusText = selectedAiProvider === 'local'
    ? getLocalAiPlaceholderStatusText(localLlmStatus)
    : null;
  const isBlockedByPermissions = missingSelectedPermissions.length > 0;
  const hasTranscript = isTranscriptTextCopyable(transcription.output);
  const hasAiResponse = visibleAiResponses.some((response) => isAiResponseTextCopyable(response.response));
  const startButtonLabel = isListening
    ? 'Stop Listening'
    : isBusy
      ? 'Starting...'
      : isLlmReady
        ? 'Start Listening'
        : 'Preparing...';
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
      autoCollapse,
      current,
      ids: visibleTranscriptSessions.map((session) => session.id),
      overrides: transcriptCollapseOverrides
    }));
  }, [activeTranscriptSessionId, autoCollapse, transcriptCollapseOverrides, visibleTranscriptSessions]);

  useLayoutEffect(() => {
    setCollapsedAiResponseIds((current) => reconcileCollapsedSectionIds({
      activeId: activeAiResponseId,
      autoCollapse,
      current,
      ids: visibleAiResponses.map((response) => response.id),
      overrides: aiResponseCollapseOverrides
    }));
  }, [activeAiResponseId, aiResponseCollapseOverrides, autoCollapse, visibleAiResponses]);

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
            canStartListening={canStartListening}
            edge={edge}
            isBlockedByPermissions={isBlockedByPermissions}
            isBusy={isBusy}
            isListening={isListening}
            listenToMicrophone={listenToMicrophone}
            listenToSystemAudio={listenToSystemAudio}
            onOpenPermissionSettings={onOpenPermissionSettings}
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
            {isTranscriptPanelPlaceholder ? (
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
            {isAiResponsePanelPlaceholder ? (
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
              disabled={transcription.isAsking}
              onChange={(event) => setManualAiPrompt(event.target.value)}
              onKeyDown={handleManualAiPromptKeyDown}
              placeholder="Ask anything"
              rows={1}
              style={manualAiPromptMaxHeight === null ? undefined : { maxHeight: `${manualAiPromptMaxHeight}px` }}
              value={manualAiPrompt}
            />
            <TooltipButton
              aria-label="Send manual prompt to AI"
              disabled={!manualAiPrompt.trim() || transcription.isAsking}
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
            canStartListening={canStartListening}
            edge={edge}
            isBlockedByPermissions={isBlockedByPermissions}
            isBusy={isBusy}
            isListening={isListening}
            listenToMicrophone={listenToMicrophone}
            listenToSystemAudio={listenToSystemAudio}
            onOpenPermissionSettings={onOpenPermissionSettings}
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
  if (!open) {
    return null;
  }

  return (
    <>
      <button
        aria-label="Close general instructions backdrop"
        className={layout.settingsBackdrop}
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <section
        aria-describedby="general-instructions-dialog-description"
        aria-labelledby="general-instructions-dialog-title"
        aria-modal="false"
        className={layout.generalInstructionsDialog}
        data-state="open"
        role="dialog"
      >
        <PlatformDialogCloseButton isMac={isMac} label="Close general instructions" onClick={() => onOpenChange(false)} />
        <div className={`${layout.promptTemplateHeader} ${isMac ? layout.promptTemplateHeaderMac : ''}`}>
          <h2 id="general-instructions-dialog-title" className={layout.modalHeaderTitle}>Instructions</h2>
          <p id="general-instructions-dialog-description" className="sr-only">
            Add preferences you want every AI reply to follow, like spelling, tone, format or how concise to be.
          </p>
        </div>
        <div className={layout.generalInstructionsEditor}>
          <Field className="min-h-0">
            <p className={layout.settingsDescription}>
              Add preferences you want every AI reply to follow, like spelling, tone, format or how concise to be.
            </p>
            <Textarea
              aria-label="Instructions"
              className="min-h-0 flex-1 resize-none"
              id="general-instructions"
              onChange={(event) => onSave(event.target.value)}
              placeholder={generalInstructionsPlaceholder}
              value={instructions}
            />
          </Field>
        </div>
      </section>
    </>
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
  edge,
  isBlockedByPermissions,
  isBusy,
  isListening,
  listenToMicrophone,
  listenToSystemAudio,
  onOpenGeneralInstructions,
  onOpenPermissionSettings,
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
  edge: OverlayEdge;
  isBlockedByPermissions: boolean;
  isBusy: boolean;
  isListening: boolean;
  listenToMicrophone: boolean;
  listenToSystemAudio: boolean;
  onOpenGeneralInstructions: () => void;
  onOpenPermissionSettings: () => void;
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
  const startButtonDisabled = isBusy || (!canStartListening && hasAudioSource);
  const startListeningTooltip = isListening
    ? 'Stop listening and finish the transcript'
    : hasAudioSource
      ? getStartListeningSourceDescription({ listenToMicrophone, listenToSystemAudio })
      : 'Select a sound input or output source to listen to using the source buttons.';
  const autoSendControl = (
    <div className={isVertical ? layout.sideToolbarRow : undefined}>
      <TooltipButton
        aria-label={autoSendLabel}
        aria-pressed={sendToAiWhenListeningStops}
        className={`${isVertical ? layout.sideToolbarButton : layout.compactToolbarButton} ${sendToAiWhenListeningStops ? layout.listeningSourceIndicatorActive : 'text-muted-foreground'}`.trim()}
        flashTooltipOnClick
        onClick={() => setSendToAiWhenListeningStops(!sendToAiWhenListeningStops)}
        size={isVertical ? 'icon-lg' : 'lg'}
        tooltip={autoSendTooltip}
        tooltipSide={tooltipSide}
        type="button"
        variant="outline"
      >
        <span className="relative inline-flex size-4 items-center justify-center">
          <FastForwardIcon className="size-4" />
          {!sendToAiWhenListeningStops && (
            <span
              aria-hidden="true"
              className="caul-auto-send-off-slash absolute left-1/2 top-1/2 h-0.5 w-[1.1rem] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-current"
            />
          )}
        </span>
        <span className={isVertical ? 'sr-only' : layout.expandedToolbarButtonLabel}>{autoSendLabel}</span>
      </TooltipButton>
    </div>
  );
  const primaryControls = (
    <div className={isVertical ? layout.transcriptPrimaryActionsVertical : layout.transcriptPrimaryActions}>
      <div className={isVertical ? layout.sideToolbarRow : undefined}>
        {isBlockedByPermissions ? (
          <TooltipButton
            aria-label="Permissions"
            className={isVertical ? layout.sideToolbarButton : `${layout.grantPermissionsButton} ${layout.compactToolbarButton}`}
            onClick={onOpenPermissionSettings}
            size="lg"
            tooltip="Open settings to grant required permissions"
            tooltipSide={tooltipSide}
            type="button"
            variant="destructive"
          >
            <CircleAlertIcon />
            <span className={isVertical ? layout.sideToolbarButtonLabel : layout.compactToolbarButtonLabel}>Permissions</span>
          </TooltipButton>
        ) : (
          <TooltipButton
            aria-label={startButtonLabel}
            aria-disabled={!hasAudioSource || undefined}
            className={`${isVertical ? layout.sideToolbarButton : `${layout.listeningButton} ${layout.compactToolbarButton}`} ${isListening ? '' : layout.startButton} ${!hasAudioSource ? 'cursor-not-allowed opacity-50' : ''}`.trim()}
            disabled={startButtonDisabled}
            onClick={!hasAudioSource ? undefined : toggleListening}
            size="lg"
            tooltip={startListeningTooltip}
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
        )}
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
          <FileTextIcon />
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
  hasTranscript,
  onAskAiFromTranscript,
  onClearTranscript,
  onCopyTranscript,
  onDownloadTranscript,
  showLabels = false,
  tooltipSide,
  transcriptionIsAsking
}: {
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
      <div className={layout.homeToolbarBottomActionGroup}>
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
          <CopyIcon />
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
      </div>
      <TooltipButton
        aria-label="Send full transcript to AI"
        disabled={!hasTranscript || transcriptionIsAsking}
        className={showLabels ? layout.compactToolbarButton : undefined}
        onClick={onAskAiFromTranscript}
        size={showLabels ? 'lg' : 'icon-lg'}
        tooltip="Send full transcript to AI now"
        tooltipSide={tooltipSide}
        type="button"
        variant="outline"
      >
        <SendIcon />
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
    <div className={layout.homeToolbarBottomActionGroup}>
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
      <CopyIcon />
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
    </div>
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TooltipButton
          aria-label={ariaLabel}
          className={className}
          disabled={disabled}
          size={size}
          tooltip={tooltip}
          tooltipSide={tooltipSide}
          type="button"
          variant="outline"
        >
          <Trash2Icon />
          <span className={showLabels ? layout.expandedToolbarButtonLabel : 'sr-only'}>Clear</span>
        </TooltipButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3" side={tooltipSide}>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)} type="button" variant="outline">
            Cancel
          </Button>
          <Button onClick={confirm} type="button" variant="destructive">
            {actionLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
    <TooltipButton
      aria-label={`${label} ${active ? 'on' : 'off'}`}
      aria-pressed={active}
      className={`${showLabel ? layout.compactToolbarButton : ''} ${active ? layout.listeningSourceIndicatorActive : 'text-muted-foreground'}`.trim()}
      flashTooltipOnClick
      onClick={onToggle}
      size={showLabel ? 'lg' : 'icon-lg'}
      title={title}
      tooltip={tooltip}
      tooltipSide={tooltipSide}
      type="button"
      variant="outline"
    >
      {icon}
      <span className={showLabel ? layout.expandedToolbarButtonLabel : 'sr-only'}>
        {showLabel ? visibleLabel : `${label} ${active ? 'on' : 'off'}`}
      </span>
    </TooltipButton>
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
            tooltipSide="bottom"
            onWheel={scrollOpenPreviewTooltip}
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
            tooltipSide="bottom"
            onWheel={collapsedPreview ? scrollOpenPreviewTooltip : undefined}
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
          <LoaderCircleIcon
            aria-label="Waiting for response"
            className="size-4 animate-spin text-muted-foreground"
          />
        ) : (
          <ReactMarkdown>{response}</ReactMarkdown>
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
  collapsedIds,
  isAsking,
  onAskAi,
  onToggleCollapsed,
  sessions
}: {
  activeSessionId?: string | null;
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
  isActive = false,
  isAsking,
  isCollapsed,
  onAskAi,
  onToggleCollapsed,
  session
}: {
  isActive?: boolean;
  isAsking: boolean;
  isCollapsed: boolean;
  onAskAi: (transcript: string) => void;
  onToggleCollapsed: (id: string) => void;
  session: TranscriptSession;
}) {
  const headerClassName = `${layout.transcriptSectionHeader} ${isActive ? layout.transcriptSectionHeaderActive : ''}`.trim();
  const collapsedPreview = isCollapsed ? getTranscriptSectionBody(session.output) : null;

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
                onClick={() => void navigator.clipboard?.writeText(session.output)}
                size="icon"
                tooltip={getActionTooltipWithPreview('Copy this transcript to clipboard', collapsedPreview)}
                tooltipClassName={collapsedPreview ? layout.sectionPreviewTooltip : undefined}
                tooltipInteractive={collapsedPreview !== null}
                tooltipSide="bottom"
                onWheel={collapsedPreview ? scrollOpenPreviewTooltip : undefined}
                type="button"
                variant="outline"
              >
                <CopyIcon />
              </TooltipButton>
              <DownloadTranscriptPopover
                disabled={false}
                label="Download this transcript"
                onDownload={(format) => downloadTranscriptFile(session.output, format)}
                preview={collapsedPreview}
                tooltipSide="bottom"
                triggerSize="icon"
              />
              <TooltipButton
                aria-label="Send this transcript to AI"
                disabled={isAsking}
                onClick={() => onAskAi(session.output)}
                size="icon"
                tooltip={getActionTooltipWithPreview('Send this transcript to AI now', collapsedPreview)}
                tooltipClassName={collapsedPreview ? layout.sectionPreviewTooltip : undefined}
                tooltipInteractive={collapsedPreview !== null}
                tooltipSide="bottom"
                onWheel={collapsedPreview ? scrollOpenPreviewTooltip : undefined}
                type="button"
                variant="outline"
              >
                <SendIcon />
              </TooltipButton>
            </div>
          </div>
          {!isCollapsed ? (
          <div className={layout.transcriptSectionBody}>
            {getTranscriptSectionBody(session.output)}
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
      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${label}`}
      className={layout.sectionCollapseButton}
      onClick={onToggle}
      onWheel={preview ? scrollOpenPreviewTooltip : undefined}
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
    <Tooltip disableHoverableContent={false}>
      <TooltipTrigger asChild>
        {button}
      </TooltipTrigger>
      <TooltipContent className={layout.sectionPreviewTooltip} collisionPadding={12} side="bottom">
        <div className="markdown-output">
          <ReactMarkdown>{formatPreviewMarkdown(preview)}</ReactMarkdown>
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
        <ReactMarkdown>{formatPreviewMarkdown(preview)}</ReactMarkdown>
      </div>
    </div>
  );
}

function getAiInputTooltip(request: string) {
  return (
    <div>
      <div className="mb-3 font-medium">AI input</div>
      <div className="markdown-output border-t border-primary-foreground/20 pt-3">
        <ReactMarkdown>{formatPreviewMarkdown(request)}</ReactMarkdown>
      </div>
    </div>
  );
}

function scrollOpenPreviewTooltip(event: WheelEvent<HTMLElement>) {
  const tooltip = document.querySelector<HTMLElement>('[data-slot="tooltip-content"].caul-preview-tooltip');

  if (!tooltip) {
    return;
  }

  const canScrollVertically = tooltip.scrollHeight > tooltip.clientHeight;
  const canScrollHorizontally = tooltip.scrollWidth > tooltip.clientWidth;

  if (!canScrollVertically && !canScrollHorizontally) {
    return;
  }

  event.preventDefault();
  tooltip.scrollBy({
    left: canScrollHorizontally ? event.deltaX : 0,
    top: canScrollVertically ? event.deltaY : 0
  });
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
  const [isEditTooltipActive, setIsEditTooltipActive] = useState(false);
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

  function clearTemplates() {
    onSelect([]);
    setSearch('');
  }

  function toggleTemplate(id: string) {
    onSelect(selectedTemplateIds.includes(id)
      ? selectedTemplateIds.filter((selectedId) => selectedId !== id)
      : [...selectedTemplateIds, id]);
  }

  return (
    <div className={isCompact ? layout.promptTemplateSelectorRootVertical : layout.promptTemplateSelectorRoot}>
      <div className={isCompact ? layout.promptTemplateSelectorPickerVertical : layout.promptTemplateSelectorPicker}>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
        }}
      >
        <Tooltip open={isOpen || isEditTooltipActive ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                aria-label="Prompt template"
                className={isCompact ? layout.promptTemplateTriggerVertical : layout.promptTemplateTrigger}
                size={isCompact ? 'icon-lg' : 'lg'}
                type="button"
                variant="outline"
              >
                <ListChecksIcon className={layout.promptTemplateCompactIcon} />
                <span className={isCompact ? 'sr-only' : 'prompt-template-trigger-label min-w-0 flex-1 truncate text-left'}>
                  {selectedTemplateName}
                </span>
                <ChevronDownIcon className="prompt-template-trigger-chevron" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 whitespace-pre-line break-words leading-4" collisionPadding={8} side={tooltipSide}>
            {selectedTemplateTooltip}
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
          <div className={`${layout.pickerList} ${layout.pickerListScrollable}`}>
            <button
              aria-current={selectedTemplateIds.length === 0 ? 'true' : undefined}
              className={layout.pickerItem}
              data-active={selectedTemplateIds.length === 0}
              onClick={clearTemplates}
              type="button"
            >
              <span className={layout.pickerItemLabel}>No template</span>
            </button>
            {filteredTemplates.map((template) => {
              const isSelected = selectedTemplateIds.includes(template.id);

              return (
                <button
                  key={template.id}
                  aria-current={isSelected ? 'true' : undefined}
                  aria-pressed={isSelected}
                  className={`${layout.pickerItem} ${layout.pickerCheckboxItem}`}
                  data-active={isSelected}
                  onClick={() => toggleTemplate(template.id)}
                  type="button"
                >
                  <CheckboxDisplay aria-hidden="true" checked={isSelected} />
                  <span className={layout.pickerItemLabel}>{template.name}</span>
                </button>
              );
            })}
            {filteredTemplates.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">No templates found.</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      </div>
      <div
        ref={editAnchorRef}
        className={isCompact ? layout.promptTemplateSelectorEditVertical : layout.promptTemplateSelectorEdit}
        onFocus={() => setIsEditTooltipActive(true)}
        onMouseEnter={() => setIsEditTooltipActive(true)}
        onMouseLeave={() => setIsEditTooltipActive(false)}
      >
        <TooltipButton
          aria-label="Manage prompt templates"
          className={isCompact ? layout.sideToolbarIconButton : undefined}
          onBlur={() => setIsEditTooltipActive(false)}
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
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDeleteConfirmationId(null);
      return;
    }

    if (activeId && !visibleTemplates.some((template) => template.id === activeId)) {
      return;
    }

    const nextTemplate = visibleTemplates.find((template) => template.id === activeId) ?? visibleTemplates[0] ?? createPromptTemplate({ name: '', prompt: '' });
    setActiveId(nextTemplate.id);
    setDraft(nextTemplate);
    setDeleteConfirmationId((id) => (id && visibleTemplates.some((template) => template.id === id) ? id : null));
  }, [activeId, draft.id, open, visibleTemplates]);

  function createNewTemplate() {
    const template = withPromptTemplateTimestamp(createPromptTemplate({ name: '', prompt: '' }));
    setVisibleTemplates((items) => [...items, template]);
    selectTemplate(template);
    onSave(normalisePromptTemplateDraft(template));
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
      onSave(normalisePromptTemplateDraft(nextTemplate));
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

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        aria-label="Close prompt templates backdrop"
        className={layout.settingsBackdrop}
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <section
        aria-describedby="prompt-templates-dialog-description"
        aria-labelledby="prompt-templates-dialog-title"
        aria-modal="false"
        className={layout.promptTemplateDialog}
        data-state="open"
        role="dialog"
      >
        <PlatformDialogCloseButton isMac={isMac} label="Close prompt templates" onClick={() => onOpenChange(false)} />
        <div className={`${layout.promptTemplateHeader} ${isMac ? layout.promptTemplateHeaderMac : ''}`}>
          <h2 id="prompt-templates-dialog-title" className={layout.modalHeaderTitle}>Prompt templates</h2>
          <p id="prompt-templates-dialog-description" className="sr-only">
            Save reusable instructions that are prepended to transcript requests.
          </p>
        </div>
        <div className={layout.promptTemplateEditor}>
          <div className={layout.promptTemplateSidebar}>
            <Button onClick={createNewTemplate} type="button" variant="outline">
              New template
            </Button>
            <div className={`${layout.pickerList} ${layout.pickerListScrollable}`}>
              {visibleTemplates.map((template) => (
                <div key={template.id} className={layout.pickerRow}>
                  <button
                    aria-current={activeId === template.id ? 'true' : undefined}
                    className={`${layout.pickerItem} ${layout.pickerRowButton}`}
                    data-active={activeId === template.id}
                    onClick={() => selectTemplate(template)}
                    type="button"
                  >
                    <span className={layout.pickerItemLabel}>{getPromptTemplateDisplayName(template)}</span>
                  </button>
                  <Popover
                    open={deleteConfirmationId === template.id}
                    onOpenChange={(nextOpen) => setDeleteConfirmationId(nextOpen ? template.id : null)}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        aria-label={`Delete ${getPromptTemplateDisplayName(template)}`}
                        className={layout.pickerRowDelete}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <XIcon />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 gap-3" side="right">
                      <div>
                        <div className="text-sm font-medium">Delete this template?</div>
                        <p className="text-sm text-muted-foreground">
                          This removes it from your saved prompt templates.
                        </p>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button onClick={() => setDeleteConfirmationId(null)} type="button" variant="outline">
                          Cancel
                        </Button>
                        <Button onClick={() => deleteTemplate(template.id)} type="button" variant="destructive">
                          Confirm delete
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              ))}
            </div>
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
                  className="min-h-0 flex-1 resize-none"
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
                {draftAttachments.length > 0 && (
                  <p className={layout.settingsDescription}>
                    Local reads supported document text. Cloud sends the file to ChatGPT.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
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

function getMainNotifications({
  localLlmStatus,
  selectedAiProvider,
  updateStatus
}: {
  localLlmStatus: LocalLlmStatus | null;
  selectedAiProvider: AiProvider;
  updateStatus: UpdateStatus | null;
}): MainNotification[] {
  const notifications: MainNotification[] = [];

  if (updateStatus?.lastResult?.status === 'error') {
    notifications.push({
      id: 'app-update-error',
      label: 'App update needs attention',
      section: 'updates',
      tone: 'error'
    });
  } else if (isUpdateInstalling(updateStatus)) {
    notifications.push({
      id: 'app-update-installing',
      label: 'App update installing',
      section: 'updates',
      tone: 'progress'
    });
  } else if (isUpdateDownloaded(updateStatus)) {
    notifications.push({
      id: 'app-update-ready',
      label: 'App update ready',
      section: 'updates',
      tone: 'action'
    });
  } else if (updateStatus?.availableUpdate) {
    notifications.push({
      id: 'app-update-available',
      label: 'App update available',
      section: 'updates',
      tone: updateStatus.downloading ? 'progress' : 'action'
    });
  }

  if (
    selectedAiProvider === 'local'
    && localLlmStatus
    && (localLlmStatus.status === 'missing' || localLlmStatus.status === 'error')
  ) {
    notifications.push({
      id: 'local-ai-setup',
      label: 'Local AI needs setup',
      section: 'models',
      tone: localLlmStatus.status === 'error' ? 'error' : 'action'
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
      <Tooltip disableHoverableContent={preview ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={label}
              className={triggerClassName}
              disabled={disabled}
              onWheel={preview ? scrollOpenPreviewTooltip : undefined}
              size={triggerSize}
              type="button"
              variant="outline"
            >
              <DownloadIcon />
              <span className={showTriggerLabel ? layout.expandedToolbarButtonLabel : 'sr-only'}>{triggerLabel}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className={preview ? layout.sectionPreviewTooltip : undefined} side={tooltipSide}>
          {getActionTooltipWithPreview(label, preview)}
        </TooltipContent>
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
  flashTooltipOnClick = false,
  onClick,
  tooltip,
  tooltipClassName,
  tooltipInteractive = false,
  tooltipSide,
  ...props
}: React.ComponentProps<typeof Button> & {
  flashTooltipOnClick?: boolean;
  tooltip: React.ReactNode;
  tooltipClassName?: string;
  tooltipInteractive?: boolean;
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

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
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
    <Tooltip disableHoverableContent={tooltipInteractive ? false : undefined} {...tooltipProps}>
      <TooltipTrigger asChild>
        {button}
      </TooltipTrigger>
      <TooltipContent className={tooltipClassName} side={tooltipSide}>
        {tooltip}
      </TooltipContent>
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

  return [
    ...starterPromptTemplates,
    ...customTemplates
  ];
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

  const customName = `${baseName} custom`;

  if (!usedNames.has(customName.toLocaleLowerCase())) {
    return customName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${customName} ${index}`;

    if (!usedNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  return `${customName} ${Date.now()}`;
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

function SettingsPage({
  autoCollapse,
  initialSection,
  isMac,
  isBusy,
  isListening,
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
  setAutoCollapse,
  setLlmModel,
  setLlmReasoning
}: {
  autoCollapse: boolean;
  initialSection: SettingsSection;
  isMac: boolean;
  isBusy: boolean;
  isListening: boolean;
  llmModel: LlmModel;
  llmReasoning: LlmReasoning;
  onClose: () => void;
  onQuit: () => void;
  onRequestPermission: (permission: PermissionItem['id']) => void;
  onSelectedAiProviderChange: (provider: AiProvider) => void;
  onSetPrivateOverlayHandleSize: (size: PrivateOverlayHandleSize) => void;
  permissionsStatus: PermissionsStatus | null;
  privateOverlayStatus: PrivateOverlayState | null;
  resetSettings: () => void;
  setAutoCollapse: (autoCollapse: boolean) => void;
  setLlmModel: (model: LlmModel) => void;
  setLlmReasoning: (reasoning: LlmReasoning) => void;
}) {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [localLlmStatus, setLocalLlmStatus] = useState<LocalLlmStatus | null>(null);
  const [localAiSetupPhase, setLocalAiSetupPhase] = useState<'downloading' | 'idle'>('idle');
  const [catalogueRefreshResult, setCatalogueRefreshResult] = useState<ModelCatalogueRefreshResult | null>(null);
  const [isRefreshingCatalogue, setIsRefreshingCatalogue] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus | null>(null);
  const [selectedAiProvider, setSelectedAiProviderState] = useState<AiProvider>('local');
  const [selectedTranscriptionModelId, setSelectedTranscriptionModelId] = useState<LocalTranscriptionModelId>('parakeet');
  const hasInitialisedTranscriptionModelRef = useRef(false);
  const autoSelectingReadyModelRef = useRef<LocalTranscriptionModelId | null>(null);
  const hasDownloadedUpdate = isUpdateDownloaded(updateStatus);
  const isRestartingForUpdate = isInstallingUpdate || isUpdateInstalling(updateStatus);
  const isCloudAiReady = Boolean(onboardingStatus?.pi.connected);
  const recommendedLocalAiModel = onboardingStatus?.ai.recommended === 'local' ? onboardingStatus.ai.recommendedModel : null;
  const recommendedLocalAiModelReady = Boolean(
    localLlmStatus?.runtime.installed
    && localLlmStatus.model?.installed
    && (!recommendedLocalAiModel || localLlmStatus.model.id === recommendedLocalAiModel.id)
  );
  const settingsSections: Array<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'models', label: 'Models' },
    { id: 'updates', label: 'Updates' },
    { id: 'storage', label: 'Storage' },
    { id: 'permissions', label: 'Permissions' }
  ];
  const updateFrequencyOptions: Array<{ value: UpdateFrequency; label: string }> = [
    { value: 'never', label: 'Never' },
    { value: 'startup', label: 'On startup' },
    { value: 'hourly', label: 'Every hour' },
    { value: 'sixHours', label: 'Every 6 hours' },
    { value: 'twelveHours', label: 'Every 12 hours' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' }
  ];

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

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
        return current === 'downloading' ? 'idle' : current;
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
      .catch((error) => {
        console.error('Failed to load update status:', error);
      });

    return () => {
      isMounted = false;
      unsubscribe?.();
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
      }
    } catch (error) {
      console.error('Failed to update AI provider:', error);
    }
  }

  async function downloadLocalAi(modelId?: string) {
    try {
      setLocalAiSetupPhase('downloading');
      setLocalLlmStatus((current) => getPreparingLocalAiStatus(current ?? getCaulLocalLlmStatus(onboardingStatus)));
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

  async function signInWithChatGptFromSettings() {
    try {
      await getSettingsBridge()?.ai?.openChatGptLogin?.();
      await refreshOnboardingStatus();
    } catch (error) {
      console.error('Failed to open ChatGPT sign in:', error);
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
            Configure Caul listening, model and reset settings.
          </p>
        </div>
        <div className={layout.settingsContent}>
          <nav aria-label="Settings sections" className={layout.settingsSidebar}>
            {settingsSections.map((section) => (
              <button
                key={section.id}
                aria-current={activeSection === section.id ? 'page' : undefined}
                className={layout.pickerItem}
                data-active={activeSection === section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <span className={layout.pickerItemLabel}>{section.label}</span>
              </button>
            ))}
          </nav>
          <div className={layout.settingsPanel}>
            {activeSection === 'general' ? (
              <FieldGroup className={layout.settingsPageStack}>
                <FieldSet className={layout.settingsSection}>
                  <FieldLegend>Floating button</FieldLegend>
                  <FieldGroup className={layout.settingsInlineGroup}>
                    <Field className="w-auto">
                      <FieldLabel htmlFor="floating-button-size">Size</FieldLabel>
                      <Select
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
                </FieldSet>

                <FieldSet className={layout.settingsSection}>
                  <FieldLegend>Auto-collapse</FieldLegend>
                  <FieldGroup className={layout.settingsSectionBody}>
                    <p className={layout.settingsDescription}>
                      Collapses older AI replies when a new answer starts, so the latest response stays easy to read during a call.
                    </p>
                    <Field className="w-auto self-start" orientation="horizontal">
                      <Checkbox
                        id="auto-collapse"
                        checked={autoCollapse}
                        onCheckedChange={(checked) => setAutoCollapse(checked === true)}
                      />
                      <FieldLabel htmlFor="auto-collapse">Auto-collapse</FieldLabel>
                    </Field>
                  </FieldGroup>
                </FieldSet>

                <FieldSet className={layout.settingsSection}>
                  <FieldLegend>Advanced</FieldLegend>
                  <FieldGroup className={layout.settingsSectionBody}>
                    <div className="flex max-w-2xl flex-wrap items-center gap-2">
                      <div className="flex">
                        <TooltipButton
                          onClick={onQuit}
                          size="default"
                          tooltip="Quit Caul"
                          type="button"
                          variant="destructive"
                        >
                          <LogOutIcon />
                          Quit Caul
                        </TooltipButton>
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
                          Reset Settings
                        </TooltipButton>
                      </div>
                    </div>
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            ) : null}

            {activeSection === 'storage' ? (
              <FieldSet className={layout.settingsSection}>
                <FieldLegend>History and storage</FieldLegend>
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
                        <FolderOpenIcon />
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
              </FieldSet>
            ) : null}

            {activeSection === 'updates' ? (
              <FieldSet className={layout.settingsSection}>
                <FieldLegend>Updates</FieldLegend>
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
                          {updateStatus?.checking ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
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
                          {updateStatus.downloading ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
                          Download
                        </TooltipButton>
                      ) : (
                        <TooltipButton
                          disabled={isRestartingForUpdate}
                          onClick={() => void restartToInstallUpdate()}
                          size="default"
                          tooltip="Restart Caul and install the update"
                          type="button"
                        >
                          {isRestartingForUpdate ? <LoaderCircleIcon className="animate-spin" /> : null}
                          {isRestartingForUpdate ? 'Restarting...' : 'Restart to update'}
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
                  </div>
                </FieldGroup>
              </FieldSet>
            ) : null}

            {activeSection === 'models' ? (
              <FieldGroup className={layout.settingsPageStack}>
                <FieldSet className={layout.settingsSection}>
                  <FieldLegend>AI recommendations</FieldLegend>
                  <FieldGroup className={layout.settingsSectionBody}>
                    <div className="flex max-w-2xl flex-col items-start gap-2">
                      <p className={layout.settingsDescription} aria-live="polite">
                        {formatCatalogueRefreshStatus(catalogueRefreshResult)}
                      </p>
                      <TooltipButton
                        disabled={isListening || isBusy || isRefreshingCatalogue}
                        onClick={() => void refreshModelCatalogue()}
                        size="default"
                        tooltip="Refresh AI recommendations"
                        type="button"
                        variant="outline"
                      >
                        {isRefreshingCatalogue ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
                        Refresh AI recommendations
                      </TooltipButton>
                    </div>
                  </FieldGroup>
                </FieldSet>

                <FieldSet className={layout.settingsSection}>
                  <FieldLegend>Transcription</FieldLegend>
                  <FieldGroup className={layout.settingsSectionBody}>
                    <p className={layout.settingsDescription}>
                      Controls the model Caul uses to turn call audio into text.
                    </p>
                    <TranscriptionModelRow
                      onCancel={() => void getSettingsBridge()?.parakeet?.cancelDownload()}
                      onDownload={(modelId) => void downloadTranscriptionModel(modelId)}
                      onSelectModel={setSelectedTranscriptionModelId}
                      selectedModelId={selectedTranscriptionModelId}
                      status={onboardingStatus}
                    />
                    <ModelAutoUpdateCheckbox
                      checked={onboardingStatus?.autoUpdate?.transcription ?? true}
                      description="Caul can suggest better supported models on your update schedule."
                      id="settings-auto-update-transcription-model"
                      onCheckedChange={(enabled) => void setAutoUpdateModel('transcription', enabled)}
                    />
                  </FieldGroup>
                </FieldSet>

                <FieldSet className={layout.settingsSection}>
                  <FieldLegend>AI responses</FieldLegend>
                  <FieldGroup className={layout.settingsSectionBody}>
                    <p className={layout.settingsDescription}>
                      Controls how Caul writes answers after it has a transcript.
                    </p>
                    <div className="inline-flex w-full max-w-sm rounded-md border border-border bg-muted/30 p-0.5" role="tablist" aria-label="AI provider">
                      {(['local', 'cloud'] as AiProvider[]).map((provider) => (
                        <button
                          key={provider}
                          aria-selected={selectedAiProvider === provider}
                          className={`h-8 flex-1 rounded-[6px] px-3 text-sm font-medium transition-colors ${selectedAiProvider === provider ? '!bg-primary !text-primary-foreground shadow-sm hover:!bg-primary/90 dark:!bg-primary dark:!text-primary-foreground dark:hover:!bg-primary/90' : 'text-muted-foreground hover:text-foreground'}`}
                          disabled={isListening || isBusy}
                          onClick={() => void selectAiProvider(provider)}
                          role="tab"
                          type="button"
                        >
                          {provider === 'local' ? 'Local' : 'Cloud'}
                        </button>
                      ))}
                    </div>

                    {selectedAiProvider === 'local' ? (
                      <div className="grid max-w-2xl gap-2 text-sm">
                        <div className="flex items-center gap-1">
                          <p className={layout.settingsDescription}>Local and private. Slower and less intelligent than ChatGPT.</p>
                          {recommendedLocalAiModel ? <LocalAiRecommendationInfoButton recommendation={onboardingStatus?.ai} /> : null}
                        </div>
                        {(localLlmStatus?.status === 'downloading' || localAiSetupPhase === 'downloading') && localLlmStatus?.progress ? (
                          <p className={layout.settingsDescription} aria-live="polite">
                            {getLocalAiDownloadProgressLabel(localLlmStatus.progress).label}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          {localLlmStatus?.status === 'downloading' || localAiSetupPhase === 'downloading' ? (
                            <Button onClick={() => void cancelLocalAiDownload()} size="sm" type="button" variant="outline">Cancel</Button>
                          ) : localLlmStatus?.runtime.supported === false ? (
                            <StatusPill ready={false}>Unavailable</StatusPill>
                          ) : !recommendedLocalAiModelReady ? (
                            <Button onClick={() => void downloadLocalAi(recommendedLocalAiModel?.id)} size="sm" type="button">
                              Download local AI
                            </Button>
                          ) : (
                            <StatusPill ready>Ready</StatusPill>
                          )}
                        </div>
                        <ModelAutoUpdateCheckbox
                          checked={onboardingStatus?.autoUpdate?.ai ?? true}
                          description="Caul can suggest better supported models on your update schedule."
                          id="settings-auto-update-ai-model"
                          onCheckedChange={(enabled) => void setAutoUpdateModel('ai', enabled)}
                        />
                      </div>
                    ) : (
                      <div className="grid max-w-2xl gap-2 text-sm">
                        <p className={layout.settingsDescription}>Sends to ChatGPT. Faster and smarter than Local.</p>
                        {!isCloudAiReady ? (
                          <Button disabled={isListening || isBusy} onClick={() => void signInWithChatGptFromSettings()} size="sm" type="button">
                            Sign in with ChatGPT
                          </Button>
                        ) : (
                          <>
                            <StatusPill ready>Ready</StatusPill>
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
                                    <SelectTrigger id="llm-model" className="w-[9.5rem]">
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
                          </>
                        )}
                      </div>
                    )}
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            ) : null}

            {activeSection === 'permissions' ? (
              <FieldSet className={layout.settingsSection}>
                <FieldLegend>Permissions</FieldLegend>
                <FieldGroup className={layout.settingsSectionBody}>
                  <div className="grid w-full">
                    {permissionsStatus ? getOnboardingPermissionRows(getVisiblePermissionItems(permissionsStatus)).map((row) => (
                      row.kind === 'audio' ? (
                        <AudioPermissionSetupRow
                          key="audio"
                          microphone={row.microphone}
                          onChange={(permissions) => permissions.forEach((permission) => onRequestPermission(permission))}
                          showDivider={false}
                          systemAudio={row.systemAudio}
                        />
                      ) : (
                        <PermissionSetupRow
                          key={row.permission.id}
                          onChange={() => onRequestPermission(row.permission.id)}
                          permission={row.permission}
                          showDivider={false}
                        />
                      )
                    )) : (
                      <StatusRow
                        label="Permissions"
                        ready={false}
                        value="Checking current permission status"
                      />
                    )}
                  </div>
                </FieldGroup>
              </FieldSet>
            ) : null}
          </div>
      </div>
      <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset settings?</DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>This will restore:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Window size and location</li>
                  <li>Floating button position</li>
                  <li>Model and listening sources</li>
                  <li>Starter prompt templates</li>
                  <li>Your custom prompts will not be deleted</li>
                </ul>
              </div>
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
  return getVisiblePermissionItems(permissionsStatus).filter((permission) => {
    if (permission.id === 'microphone' && !defaultListenToMicrophone) {
      return false;
    }

    return true;
  });
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

function isAiResponseTextCopyable(output: string) {
  return output.trim().length > 0
    && output !== aiResponsePlaceholder
    && output !== aiResponseDisabledPlaceholder
    && output !== legacyAiResponsePlaceholder
    && output !== shortAiResponsePlaceholder;
}

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { initialCaptureStatus, type CaptureRunState } from './foundation/capture';
import type { AiProvider, HistorySessionUpdate, HistoryStatus, LocalLlmStatus, LocalTranscriptionModelId, ModelCatalogueRefreshStatus, OnboardingStatus, ParakeetStatus, PermissionItem, PiStatus, PortablePreferences, PrivateOverlayState, PromptTemplate, PromptTemplateAttachment, PromptTemplateState, TranscriptionBridgeEvent, UpdateFrequency, UpdateStatus } from './foundation/desktopBridge';
import type { RuntimeContext } from './foundation/runtime';

function currentLongDatePattern() {
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium'
  }).format(new Date());

  return new RegExp(formattedDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function getTranscriptDraftTail() {
  return screen.getByLabelText('Transcription output').querySelector('.transcript-draft-tail');
}

describe('App', () => {
  afterEach(() => {
    delete document.documentElement.dataset.caulSuppressTooltips;
    delete document.documentElement.dataset.caulSuppressTooltipsAt;
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('shows only the minimal listening form', async () => {
    render(<App />);

    expect(await screen.findByText('Caul')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Caul'));
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caul Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Speaker' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Your live transcript will appear here once you start listening.');
    expect(screen.getByLabelText('Start Listening hint')).toHaveTextContent(
      'Click Start Listening while playing something through your speakers or headphones.'
    );
    expect(screen.getByLabelText('Start Listening hint')).toHaveClass('caul-primary-glow-nudge');
    expect(screen.getByLabelText('Prompt template hint')).toHaveTextContent(
      'Pick a prompt template or customise one to change how AI responds.'
    );
    expect(screen.getByLabelText('Prompt template hint')).toHaveClass('caul-primary-glow-nudge');
    expect(screen.queryByLabelText('LLM query')).not.toBeInTheDocument();
    expect(screen.getByLabelText('AI response')).toHaveTextContent(
      'Auto Send is on.\nStop listening to send transcript to AI',
      { normalizeWhitespace: false }
    );
    expect(screen.queryByText('%')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize transcript and AI response panes' })).not.toBeInTheDocument();
    expect(screen.getByTestId('home-panels')).toHaveAttribute('data-panel-flow', 'side-by-side');
  });

  it('shows the running app flavour in the open window title', async () => {
    installTestBridge({
      runtimeContext: testRuntimeContext({
        appChannel: 'dev',
        appName: 'Caul Dev'
      })
    });

    render(<App />);

    expect(await screen.findByText('Caul Dev')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Caul Dev'));
  });

  it('opens settings as a modal page and closes it from either control', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.hover(screen.getByRole('button', { name: 'Caul Settings' }));
    expect((await screen.findAllByText('Open Caul settings'))
      .find((element) => element.getAttribute('data-slot') === 'tooltip-content'))
      .toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Caul Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caul Settings' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveClass('caul-settings-dialog');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveClass('caul-large-modal-shell', 'h-[85vh]', 'w-[85vw]', 'max-w-[85vw]');
    expect(screen.getByRole('dialog', { name: 'Settings' })).not.toHaveClass('w-[59.765625vw]', 'max-w-[59.765625vw]');
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'General' }))
      .toHaveAttribute('data-active', 'true');
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'General' }))
      .toHaveClass('h-8', 'data-[active=true]:bg-sidebar-accent', 'data-[active=true]:text-sidebar-accent-foreground');
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Transcription' }))
      .toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveClass('text-sm', 'text-center');

    await user.click(screen.getByRole('button', { name: 'Caul Settings' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caul Settings' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Caul Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Close settings' }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('opens the history folder from the title bar', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Open history folder' }));

    expect(bridge.historyFolderOpens).toBe(1);
  });

  it('shows and updates Caul folder history settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      historyStatus: testHistoryStatus({
        folder: '/Users/alex/Documents/Caul',
        message: 'Moved Caul folder, but 1 HTML history file could not be moved.'
      })
    });

    render(<App />);

    await openSettings(user);

    expect(await screen.findByLabelText('Save HTML history')).toBeChecked();
    expect(screen.getByText('/Users/alex/Documents/Caul')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'History and storage' })).toBeInTheDocument();
    expect(screen.getByText('Moved Caul folder, but 1 HTML history file could not be moved.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Caul Folder' }));
    await user.click(screen.getByRole('button', { name: 'Change Folder' }));
    await user.click(screen.getByLabelText('Save HTML history'));

    expect(bridge.historyFolderOpens).toBe(1);
    expect(bridge.historyFolderChooses).toBe(1);
    expect(await screen.findByText('/Users/alex/Documents/Changed Caul History')).toBeInTheDocument();
    expect(bridge.historyEnabledChanges).toEqual([false]);
  });

  it('closes settings when clicking the negative space around it', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Caul Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close settings backdrop' })).toHaveClass('cursor-default');

    await user.click(screen.getByRole('button', { name: 'Close settings backdrop' }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('renders guided onboarding setup rows', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    expect(await screen.findByAltText('Caul')).toBeInTheDocument();
    expect(screen.getByText('Screen & System Audio Recording')).toBeInTheDocument();
    expect(screen.getByText('System Audio')).toBeInTheDocument();
    expect(screen.getByText('Microphone')).toBeInTheDocument();
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();
    expect(screen.queryByText('Microphone & System Audio')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Permissions', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Local transcription' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI responses' })).not.toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 1: Permissions' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Step 2: Local transcription' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 3: AI responses' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Local transcription', level: 2 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'AI responses', level: 2 })).toBeInTheDocument();
    expect(screen.queryByText('Permission setup')).not.toBeInTheDocument();
    expect(bridge.onboardingStatusOptions[0]).toEqual({ refreshCatalogue: false });
  });

  it('shows targeted onboarding permission status and actions', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    window.localStorage.setItem('caul.initial-permission-requested', '1');
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'granted'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'granted'
        }
      ]
    });

    render(<App />);

    expect(await screen.findByText('Not granted')).toBeInTheDocument();
    expect(screen.getAllByText('Granted')).toHaveLength(2);
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request Permissions' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant Screen & System Audio Recording' })).toHaveTextContent('Grant');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Grant Screen & System Audio Recording' }));

    expect(bridge.requestedPermissions).toEqual(['screen-recording']);
  });

  it('waits for the user to click permission buttons during onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'not-determined'
        }
      ]
    });

    render(<App />);

    expect(await screen.findAllByText('Not granted')).toHaveLength(3);
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();
    expect(bridge.requestedPermissions).toEqual([]);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Grant System Audio' }));

    expect(bridge.requestedPermissions).toEqual(['system-audio']);
  });

  it('only requests the missing system audio permission from onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'granted'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'denied'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'granted'
        }
      ]
    });

    render(<App />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Grant System Audio' }));

    expect(bridge.requestedPermissions).toEqual(['system-audio']);
  });

  it('keeps denied onboarding permissions as Grant actions after retry', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'granted'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'denied'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'granted'
        }
      ]
    });

    render(<App />);

    const user = userEvent.setup();

    expect(screen.queryByText('Changed it in System Settings? Restart Caul to apply the permission.')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Grant System Audio' })).toHaveTextContent('Grant');

    await user.click(await screen.findByRole('button', { name: 'Grant System Audio' }));

    expect(screen.queryByText('Changed it in System Settings? Restart Caul to apply the permission.')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Grant System Audio' })).toHaveTextContent('Grant');
    expect(screen.queryByRole('button', { name: 'Restart System Audio' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Grant System Audio' }));

    expect(bridge.requestedPermissions).toEqual(['system-audio', 'system-audio']);
    expect(bridge.relaunches).toBe(0);
  });

  it('requests each onboarding audio permission separately during recovery', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'granted'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'denied'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'denied'
        }
      ]
    });

    render(<App />);

    const user = userEvent.setup();

    expect(await screen.findByRole('button', { name: 'Grant System Audio' })).toHaveTextContent('Grant');
    expect(screen.getByRole('button', { name: 'Grant Microphone' })).toHaveTextContent('Grant');
    expect(screen.queryByText('Optional')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Grant System Audio' }));

    expect(bridge.requestedPermissions).toEqual(['system-audio']);
    expect(screen.queryByText('Changed it in System Settings? Restart Caul to apply the permission.')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Grant System Audio' })).toHaveTextContent('Grant');
    expect(screen.queryByRole('button', { name: 'Restart System Audio' })).not.toBeInTheDocument();
  });

  it('hides the permissions step during onboarding when no platform permissions are relevant', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'unsupported'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'unsupported'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'unsupported'
        }
      ]
    });

    render(<App />);

    await screen.findByText('Local transcription');

    expect(screen.queryByRole('heading', { name: 'Permissions' })).not.toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 1: Local transcription' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 2: AI responses' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Step 3: AI responses' })).not.toBeInTheDocument();
    expect(screen.queryByText('Screen & System Audio Recording')).not.toBeInTheDocument();
    expect(screen.queryByText('System Audio')).not.toBeInTheDocument();
    expect(screen.queryByText('Microphone')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument();
    expect(bridge.requestedPermissions).toEqual([]);
  });

  it('uses the packaged app name on onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    installTestBridge({
      runtimeContext: testRuntimeContext({
        appChannel: 'dev',
        appName: 'Caul Dev'
      })
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome to Caul Dev' })).toBeInTheDocument();
    expect(screen.getByAltText('Caul Dev')).toBeInTheDocument();
  });

  it('lets the user explicitly download the recommended Parakeet model during onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const bridge = installTestBridge({
      parakeetStatus: testParakeetStatus({
        installed: false,
        status: 'missing'
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'Local transcription');
    expect(await screen.findByLabelText('Transcription model')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Best accuracy Recommended', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();
    expect(bridge.parakeetDownloads).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(bridge.parakeetDownloads).toBe(1));
  });

  it('lets the user explicitly download the recommended Moonshine model during onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const moonshineStatus = testParakeetStatus({
      installed: false,
      modelId: 'moonshine-tiny',
      modelName: 'Moonshine tiny',
      status: 'missing'
    });
    const bridge = installTestBridge({
      onboardingStatus: testOnboardingStatus({
        parakeet: moonshineStatus,
        transcription: testTranscriptionRecommendation({
          recommended: 'local-moonshine-tiny',
          recommendedModel: {
            id: 'moonshine-tiny',
            name: 'Moonshine tiny',
            reason: 'Lightweight local fallback for this computer.'
          }
        })
      }),
      parakeetStatus: moonshineStatus
    });

    render(<App />);

    await openOnboardingStep(user, 'Local transcription');
    expect(await screen.findByLabelText('Transcription model')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Lower memory use Recommended', selected: true })).toBeInTheDocument();
    expect(screen.queryByText('Moonshine tiny')).not.toBeInTheDocument();
    expect(bridge.parakeetDownloads).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(bridge.parakeetDownloads).toBe(1));
    expect(bridge.selectedLocalTranscriptionModels).toEqual(['moonshine-tiny']);
  });

  it('shows transcription model selection in onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await openOnboardingStep(user, 'Local transcription');
    expect((await screen.findAllByText('Ready')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Transcription model')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Best accuracy Recommended' })).toBeInTheDocument();
    expect(screen.queryByText('Parakeet v3')).not.toBeInTheDocument();
    expect(screen.queryByText('Moonshine tiny')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('does not download a local model automatically when cloud transcription is recommended', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const bridge = installTestBridge({
      onboardingStatus: testOnboardingStatus({
        parakeet: testParakeetStatus({
          installed: false,
          status: 'missing'
        }),
        transcription: testTranscriptionRecommendation({
          autoDownloadParakeet: false,
          recommended: 'cloud',
          summary: 'Recommended: cloud transcription'
        })
      }),
      parakeetStatus: testParakeetStatus({
        installed: false,
        status: 'missing'
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'Local transcription');
    expect(await screen.findByLabelText('Transcription model')).toBeInTheDocument();

    expect(bridge.parakeetDownloads).toBe(0);
  });

  it('shows local model download progress in onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge({
      parakeetStatus: testParakeetStatus({
        installed: false,
        progress: {
          downloadedBytes: 42,
          percent: 42,
          totalBytes: 100
        },
        status: 'downloading'
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'Local transcription');
    expect(await screen.findByLabelText('Transcription model')).toBeInTheDocument();
    expect(screen.getByText('42% · 42 B/100 B')).toBeInTheDocument();
    expect(screen.getByLabelText('Downloading 42% · 42 B of 100 B')).toBeInTheDocument();
    expect(screen.queryByText('Downloading Parakeet v3')).not.toBeInTheDocument();
  });

  it('shows Moonshine as a ready local recommendation instead of a failed state', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge({
      onboardingStatus: testOnboardingStatus({
        parakeet: testParakeetStatus({
          modelId: 'moonshine-tiny',
          modelName: 'Moonshine tiny'
        }),
        transcription: testTranscriptionRecommendation({
          recommended: 'local-moonshine-tiny',
          recommendedModel: {
            id: 'moonshine-tiny',
            name: 'Moonshine tiny',
            reason: 'Lightweight local fallback for this computer.'
          },
          summary: 'Recommended: Moonshine local transcription'
        })
      }),
      parakeetStatus: testParakeetStatus({
        modelId: 'moonshine-tiny',
        modelName: 'Moonshine tiny'
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'Local transcription');
    await waitFor(() => expect(screen.getAllByText('Ready').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();
    expect(screen.queryByText('Moonshine tiny')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Transcription model')).toBeInTheDocument();
  });

  it('keeps manual transcription model switching in settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      parakeetStatus: testParakeetStatus({
        modelId: 'parakeet',
        modelName: 'Parakeet v3'
      })
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'Transcription');

    const localTranscriptionGroup = await screen.findByRole('group', { name: 'Local transcription' });
    const transcriptionModelControl = await within(localTranscriptionGroup).findByRole('tablist', { name: 'Transcription model' });

    expect(transcriptionModelControl).toHaveTextContent('Best accuracy');
    expect(within(localTranscriptionGroup).getByRole('tab', { name: 'Best accuracy Recommended', selected: true })).toBeInTheDocument();
    expect(within(localTranscriptionGroup).getByRole('button', { name: 'Why this is recommended' })).toBeInTheDocument();
    await user.hover(within(localTranscriptionGroup).getByRole('button', { name: 'Why this is recommended' }));
    expect((await screen.findAllByText('Recommended for this computer based on accuracy, memory use and supported local audio models.')).length).toBeGreaterThan(0);
    expect(within(localTranscriptionGroup).getByText('Uses more memory and processing power.')).toBeInTheDocument();
    expect(screen.queryByText('Parakeet v3 is best when accuracy matters most. It can be harder on your computer because it uses more memory and processing power.')).not.toBeInTheDocument();
    expect(within(localTranscriptionGroup).getByText('Ready')).toBeInTheDocument();
    await user.hover(within(localTranscriptionGroup).getByRole('button', { name: 'Parakeet v3 details' }));
    expect((await screen.findAllByText('Parakeet v3 is best when accuracy matters most. It can be harder on your computer because it uses more memory and processing power.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();
    expect(within(localTranscriptionGroup).queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();

    await user.click(within(localTranscriptionGroup).getByRole('tab', { name: 'Lower memory use' }));

    expect(await within(localTranscriptionGroup).findByRole('tab', { name: 'Lower memory use', selected: true })).toBeInTheDocument();
    expect(within(localTranscriptionGroup).getByText('Lighter load. May be less accurate.')).toBeInTheDocument();
    expect(screen.queryByText('Moonshine tiny is best when you want lower memory use or a lighter load on your computer. It may be less accurate than Parakeet v3.')).not.toBeInTheDocument();
    expect(within(localTranscriptionGroup).queryByText('Ready')).not.toBeInTheDocument();
    expect(within(localTranscriptionGroup).getByText('Not downloaded yet')).toBeInTheDocument();
    expect(within(localTranscriptionGroup).getByRole('button', { name: 'Download' })).toBeEnabled();
    await user.hover(within(localTranscriptionGroup).getByRole('button', { name: 'Moonshine tiny details' }));
    expect((await screen.findAllByText('Moonshine tiny is best when you want lower memory use or a lighter load on your computer. It may be less accurate than Parakeet v3.')).length).toBeGreaterThan(0);
    await user.click(within(localTranscriptionGroup).getByRole('button', { name: 'Moonshine tiny details' }));
    expect(bridge.parakeetDownloads).toBe(0);
  });

  it('organises settings into clearer General, Transcription and AI responses sections', async () => {
    const user = userEvent.setup();

    installTestBridge();
    render(<App />);

    await openSettings(user);

    expect(screen.getByRole('group', { name: 'Floating button' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'History and storage' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Auto-collapse transcripts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Auto-collapse AI responses' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Save HTML history' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Caul folder' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).queryByRole('button', { name: 'Storage' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).queryByRole('button', { name: 'Updates' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).queryByRole('button', { name: 'Permissions' })).not.toBeInTheDocument();

    await openSettingsSection(user, 'Transcription');
    expect(screen.queryByText('Automatically collapse previous transcriptions.')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto update local transcription model' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'Auto update local transcription model info' }));
    expect((await screen.findAllByText('Caul can suggest and select a better supported local transcription model on your update schedule.')).length).toBeGreaterThan(0);
    await user.hover(screen.getByRole('button', { name: 'Auto-collapse info' }));
    expect((await screen.findAllByText('Automatically collapse previous transcriptions when a new transcript starts.')).length).toBeGreaterThan(0);

    await openSettingsSection(user, 'AI responses');
    expect(screen.queryByText('Automatically collapse previous AI responses.')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto update local AI model' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'Auto update local AI model info' }));
    expect((await screen.findAllByText('Caul can suggest and download a better supported local AI model on your update schedule.')).length).toBeGreaterThan(0);
    await user.hover(screen.getByRole('button', { name: 'Auto-collapse info' }));
    expect((await screen.findAllByText('Automatically collapse previous AI responses when a new response starts.')).length).toBeGreaterThan(0);

    await openSettingsSection(user, 'General');
    expect(screen.getByRole('group', { name: 'Caul updates' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Local AI Catalogue' })).toBeInTheDocument();
    expect(screen.getByLabelText('Automatic checks')).toHaveTextContent('Weekly');
    expect(screen.getByLabelText('Automatic refresh')).toHaveTextContent('Monthly');

    await openSettingsSection(user, 'Transcription');
    expect(screen.getByRole('group', { name: 'Local transcription' })).not.toHaveClass('border-t');

    await openSettingsSection(user, 'AI responses');
    expect(screen.getByRole('group', { name: 'AI responses' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Local Recommended', selected: true })).toBeInTheDocument();
    await user.hover(within(screen.getByRole('group', { name: 'AI responses' })).getByRole('button', { name: 'Why this is recommended' }));
    expect((await screen.findAllByText('Based on this computer’s power, Caul recommends Local because you should still get acceptable private AI results on this machine.')).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('group', { name: 'AI responses' })).getByText('Ready')).toBeInTheDocument();
    await user.hover(within(screen.getByRole('group', { name: 'AI responses' })).getByRole('button', { name: 'Local AI recommendation details' }));
    expect((await screen.findAllByText('Qwen 2.5 3B Instruct Q4')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('About 2.2 GB')).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('group', { name: 'AI responses' })).queryByRole('button', { name: 'Download local AI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Model list' })).not.toBeInTheDocument();

    await openSettingsSection(user, 'General');
    expect(screen.getByRole('group', { name: 'Permissions' })).toBeInTheDocument();
  });

  it('starts ChatGPT sign in from onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    await user.click(await screen.findByRole('tab', { name: 'Cloud' }));
    await user.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }));

    expect(bridge.chatGptLoginOpens).toBe(1);
  });

  it('defaults onboarding AI setup to a simple local recommendation', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          recommended: 'local',
          recommendedModel: {
            id: 'qwen2.5-3b-instruct-q4_k_m',
            name: 'Qwen 2.5 3B Instruct Q4',
            reason: 'Qwen 2.5 3B Instruct Q4 is the best local AI response fit for this machine from the offline benchmark catalogue.',
            runtime: 'llama.cpp'
          },
          summary: 'Recommended: Qwen 2.5 3B Instruct Q4 local AI responses',
          viable: true
        })
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    expect(await screen.findByRole('tab', { name: 'Local', selected: true })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'AI responses' })).getByRole('button', { name: 'Why this is recommended' })).toBeInTheDocument();
    await user.hover(within(screen.getByRole('region', { name: 'AI responses' })).getByRole('button', { name: 'Why this is recommended' }));
    expect((await screen.findAllByText('Based on this computer’s power, Caul recommends Local because you should still get acceptable private AI results on this machine.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Data stays local and private. Slower and less intelligent than Cloud.')).toBeInTheDocument();
    expect(screen.getByText('Not downloaded yet')).toBeInTheDocument();
    const localSetup = screen.getByRole('group', { name: 'Local AI setup' });
    expect(within(localSetup).getByRole('button', { name: 'Download local AI' })).toBeInTheDocument();
    expect(within(localSetup).getByRole('button', { name: 'Local AI recommendation details' })).toBeInTheDocument();
    expect(within(localSetup).getByText('Not downloaded yet')).toBeInTheDocument();
    expect(screen.queryByText('Qwen 2.5 3B Instruct Q4')).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'Local AI recommendation details' }));
    expect((await screen.findAllByText('Qwen 2.5 3B Instruct Q4')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('About 2.2 GB')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Local AI details')).not.toBeInTheDocument();
    expect(screen.queryByText('Recommended for this computer based on power, memory and local AI support.')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime')).not.toBeInTheDocument();
    expect(screen.queryByText('Why this one')).not.toBeInTheDocument();
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
    expect(screen.queryByText(/Artificial Analysis LLM Leaderboard/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with ChatGPT' })).not.toBeInTheDocument();
  });

  it('shows the recommended local AI model download size in onboarding details', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          recommended: 'local',
          recommendedModel: {
            downloadSizeGb: 6.5,
            id: 'gemma-4-12b-it-q4_0',
            name: 'Gemma 4 12B IT Q4_0',
            reason: 'Gemma 4 12B IT Q4_0 is the best local AI response fit for this machine.',
            runtime: 'llama.cpp'
          } as OnboardingStatus['ai']['recommendedModel'] & { downloadSizeGb: number },
          resources: {
            ...testAiRecommendation().resources,
            localRuntimes: {
              caulLlamaCpp: testLocalLlmStatus({
                model: {
                  id: 'qwen2.5-1.5b-instruct-q4_k_m',
                  installed: false,
                  name: 'Qwen 2.5 1.5B Instruct Q4',
                  path: '/tmp/caul/local-llm/models/qwen2.5-1.5b-instruct-q4_k_m.gguf',
                  sizeGb: 1.1
                }
              })
            }
          }
        })
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    await user.hover(await screen.findByRole('button', { name: 'Local AI recommendation details' }));

    expect((await screen.findAllByText('Gemma 4 12B IT Q4_0')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('About 6.5 GB').length).toBeGreaterThan(0);
    expect(screen.queryByText('About 1.1 GB')).not.toBeInTheDocument();
  });

  it('shows onboarding setup as permissions, transcription, then AI', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    installTestBridge();

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Permissions' })).toBeInTheDocument();
    await openOnboardingStep(userEvent.setup(), 'Local transcription');
    expect(await screen.findByRole('heading', { name: 'Local transcription' })).toBeInTheDocument();
    expect(screen.getByText('Local and private. Audio is transcribed on this computer.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing is sent to the internet.')).not.toBeInTheDocument();
    await openOnboardingStep(userEvent.setup(), 'AI responses');
    expect(await screen.findByRole('heading', { name: 'AI responses' })).toBeInTheDocument();
  });

  it('defaults onboarding AI setup to cloud when cloud is recommended', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          recommended: 'cloud',
          recommendedModel: null,
          summary: 'Cloud AI is recommended for this machine',
          viable: true
        })
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    expect(await screen.findByRole('tab', { name: 'Cloud', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Sends to a cloud model like ChatGPT. Faster and smarter than Local.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'ChatGPT sign in details' })).not.toBeInTheDocument();
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    const cloudSetup = screen.getByRole('group', { name: 'Cloud AI setup' });
    expect(within(cloudSetup).getByRole('button', { name: 'Sign in with ChatGPT' })).toBeInTheDocument();
    expect(within(cloudSetup).queryByRole('button', { name: 'ChatGPT sign in details' })).not.toBeInTheDocument();
    expect(within(cloudSetup).getByText('Not signed in')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Local' }));
    expect(await screen.findByRole('tab', { name: 'Local', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Cloud' }));
    expect(await screen.findByRole('tab', { name: 'Cloud', selected: true })).toBeInTheDocument();

    await user.hover(within(screen.getByRole('region', { name: 'AI responses' })).getByRole('button', { name: 'Why this is recommended' }));
    expect((await screen.findAllByText('Based on this computer’s power, Caul recommends Cloud because local AI probably will not give acceptable results on this machine.')).length).toBeGreaterThan(0);
  });

  it('uses the recommended AI provider as the onboarding default when saved provider is stale', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const bridge = installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          provider: 'local',
          recommended: 'cloud',
          recommendedModel: null,
          summary: 'Cloud AI is recommended for this machine',
          viable: true
        })
      })
    });

    render(<App />);

    await openOnboardingStep(userEvent.setup(), 'AI responses');
    expect(await screen.findByRole('tab', { name: 'Cloud', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Sends to a cloud model like ChatGPT. Faster and smarter than Local.')).toBeInTheDocument();
    await waitFor(() => expect(bridge.selectedAiProviders).toEqual(['cloud']));
  });

  it('keeps model auto-update details out of onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    await screen.findByRole('tab', { name: 'Local', selected: true });
    expect(screen.queryByRole('checkbox', { name: /Auto update local/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/checks trusted online model sources during setup/)).not.toBeInTheDocument();
    expect(screen.queryByText(/uses the bundled model list offline/)).not.toBeInTheDocument();
  });

  it('shows model auto-update preferences in settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      portablePreferences: {
        autoUpdateAiModel: false,
        autoUpdateTranscriptionModel: false
      }
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'Transcription');

    const transcriptionAutoUpdateControl = await screen.findByRole('checkbox', { name: 'Auto update local transcription model' });
    expect(transcriptionAutoUpdateControl).not.toBeChecked();
    await user.click(transcriptionAutoUpdateControl);

    await openSettingsSection(user, 'AI responses');
    const aiAutoUpdateControl = await screen.findByRole('checkbox', { name: 'Auto update local AI model' });
    expect(aiAutoUpdateControl).not.toBeChecked();
    await user.click(aiAutoUpdateControl);

    await waitFor(() => expect(bridge.portablePreferenceSaves).toEqual([
      { autoUpdateTranscriptionModel: true },
      { autoUpdateAiModel: true }
    ]));
  });

  it('refreshes model recommendations from Settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    expect(screen.getByText('Refresh available local transcription and local AI model recommendations.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh catalogue' }));

    await waitFor(() => expect(bridge.modelCatalogueRefreshes).toBe(1));
    expect(await screen.findByText(/Local AI Catalogue refreshed/)).toHaveTextContent('2 sources checked');

    await selectSetting(user, 'Automatic refresh', 'Daily');
    expect(bridge.modelCatalogueRefreshFrequencyChanges).toEqual(['daily']);
  });

  it('keeps cloud model controls hidden until ChatGPT is signed in', async () => {
    const user = userEvent.setup();
    installTestBridge({
      piStatus: testPiStatus({
        connected: false,
        selectedModel: null,
        status: 'disconnected'
      })
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'AI responses');
    await user.click(screen.getByRole('tab', { name: 'Cloud' }));

    expect(screen.getByText('Sends to a cloud model like ChatGPT. Faster and smarter than Local.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeEnabled();
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reasoning')).not.toBeInTheDocument();
  });

  it('shows Cloud AI as ready in Settings after ChatGPT sign in', async () => {
    const user = userEvent.setup();
    installTestBridge({
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'openai-codex/gpt-5.4-mini',
        status: 'ready'
      })
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'AI responses');
    await user.click(screen.getByRole('tab', { name: 'Cloud' }));

    const aiResponsesGroup = screen.getByRole('group', { name: 'AI responses' });
    expect(within(aiResponsesGroup).getByText('Ready')).toBeInTheDocument();
    expect(within(aiResponsesGroup).getByRole('button', { name: 'Cloud AI model details' })).toBeInTheDocument();
    await user.hover(within(aiResponsesGroup).getByRole('button', { name: 'Cloud AI model details' }));
    expect((await screen.findAllByText('5.4 mini (Default)')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Off (Default)')).length).toBeGreaterThan(0);
    expect(within(aiResponsesGroup).queryByRole('button', { name: 'Sign in with ChatGPT' })).not.toBeInTheDocument();
    expect(within(aiResponsesGroup).getByLabelText('Model')).toBeInTheDocument();
    expect(within(aiResponsesGroup).getByLabelText('Reasoning')).toBeInTheDocument();
  });

  it('uses backend AI readiness when switching providers in Settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      localLlmStatus: testReadyLocalLlmStatus(),
      onSetAiProvider: (provider) => provider === 'local' ? testLocalLlmStatus() : undefined,
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'openai-codex/gpt-5.4-mini',
        status: 'ready'
      }),
      portablePreferences: {
        selectedAiProvider: 'cloud'
      }
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'AI responses');
    await user.click(screen.getByRole('tab', { name: 'Local Recommended' }));

    await waitFor(() => expect(bridge.selectedAiProviders).toEqual(['local']));
    const aiResponsesGroup = screen.getByRole('group', { name: 'AI responses' });
    expect(within(aiResponsesGroup).getByRole('button', { name: 'Download local AI' })).toBeInTheDocument();
    expect(within(aiResponsesGroup).getByText('Not downloaded yet')).toBeInTheDocument();
    expect(within(aiResponsesGroup).queryByText('Ready')).not.toBeInTheDocument();
  });

  it('requires ChatGPT sign in when Cloud is selected before onboarding can finish', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    await user.click(await screen.findByRole('tab', { name: 'Cloud' }));

    expect(bridge.selectedAiProviders).toEqual(['cloud']);
    expect(screen.getByText('Sends to a cloud model like ChatGPT. Faster and smarter than Local.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sign in with ChatGPT' })).toBeEnabled();
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    const startButton = screen.getByRole('button', { name: 'Start using Caul' });
    expect(startButton).toBeDisabled();

    await user.hover(startButton.parentElement!);

    expect(await screen.findByText('Still needed')).toBeInTheDocument();
    expect(screen.getByText('ChatGPT sign in')).toBeInTheDocument();
  });

  it('enables onboarding start when Cloud is selected and signed in', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const bridge = installTestBridge({
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'openai-codex/gpt-5.4-mini',
        status: 'ready'
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    await user.click(await screen.findByRole('tab', { name: 'Cloud' }));

    expect(bridge.selectedAiProviders).toEqual(['cloud']);
    expect(within(await screen.findByRole('group', { name: 'Cloud AI setup' })).getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start using Caul' })).toBeEnabled();
  });

  it('starts the Caul-managed local AI download from onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    let resolveDownload!: (status: LocalLlmStatus) => void;
    const bridge = installTestBridge({
      localLlmStatus: testLocalLlmStatus(),
      downloadLocalAi: () => new Promise((resolve) => {
        resolveDownload = resolve;
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    const downloadButton = await screen.findByRole('button', { name: 'Download local AI' });
    await waitFor(() => expect(downloadButton).toBeEnabled());
    expect(downloadButton).toHaveAttribute('data-size', 'default');
    await user.click(downloadButton);

    expect(bridge.localLlmDownloads).toBe(1);
    expect(bridge.selectedLocalAiDownloads).toEqual(['qwen2.5-3b-instruct-q4_k_m']);
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText('Requesting local AI download...')).toBeInTheDocument();
    expect(screen.queryByText('Caul downloads one recommended model for this computer. You can cancel and use Cloud instead.')).not.toBeInTheDocument();
    expect(screen.queryByText('Preparing local AI')).not.toBeInTheDocument();
    expect(screen.queryByText('Preparing local AI · 0%')).not.toBeInTheDocument();

    act(() => {
      resolveDownload(testReadyLocalLlmStatus());
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Download local AI' })).not.toBeInTheDocument());
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.queryByText('Qwen 2.5 3B Instruct Q4')).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'Local AI recommendation details' }));
    expect((await screen.findAllByText('Qwen 2.5 3B Instruct Q4')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('About 2.2 GB')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start using Caul' })).toBeEnabled();
  });

  it('shows detailed local AI download progress in onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const downloadingStatus = testLocalLlmStatus({
      progress: {
        downloadedBytes: 1_181_116_006,
        label: 'Downloading local AI model',
        percent: 50,
        phase: 'model',
        totalBytes: 2_362_232_013
      },
      status: 'downloading'
    });
    const bridge = installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          localRuntime: downloadingStatus,
          resources: {
            ...testAiRecommendation().resources,
            localRuntimes: {
              caulLlamaCpp: downloadingStatus
            }
          }
        })
      })
    });

    render(<App />);

    await openOnboardingStep(userEvent.setup(), 'AI responses');
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText('Downloading local AI model · 50% · 1.1 GB of 2.2 GB')).toBeInTheDocument();

    act(() => {
      bridge.emitLocalLlmStatus(testLocalLlmStatus({
        progress: undefined,
        status: 'downloading'
      }));
    });

    expect(screen.getByText('Downloading local AI model · 50% · 1.1 GB of 2.2 GB')).toBeInTheDocument();
    expect(screen.queryByText('Downloading local AI...')).not.toBeInTheDocument();
    expect(screen.queryByText('Caul downloads one recommended model for this computer. You can cancel and use Cloud instead.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download local AI' })).not.toBeInTheDocument();
  });

  it('shows a loading state while ChatGPT sign in opens from onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    let resolveLogin!: (value: { ok: boolean }) => void;
    const loginPromise = new Promise<{ ok: boolean }>((resolve) => {
      resolveLogin = resolve;
    });

    installTestBridge({
      openChatGptLogin: () => loginPromise
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    await user.click(await screen.findByRole('tab', { name: 'Cloud' }));
    await user.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }));

    expect(screen.getByRole('button', { name: 'Opening' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'ChatGPT sign in details' })).not.toBeInTheDocument();
    expect(screen.getByText('Opening ChatGPT sign in...')).toBeInTheDocument();

    resolveLogin({ ok: true });

    expect(await screen.findByRole('button', { name: 'Sign in with ChatGPT' })).toBeEnabled();
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });

  it('keeps onboarding start disabled and explains missing setup', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const permissions: PermissionItem[] = [
      {
        description: 'Required when listening to speaker audio output.',
        id: 'screen-recording',
        label: 'Screen & System Audio Recording',
        status: 'denied'
      },
      {
        description: 'Required when listening to your microphone.',
        id: 'microphone',
        label: 'Microphone',
        status: 'granted'
      }
    ];
    installTestBridge({
      onboardingStatus: testOnboardingStatus({
        parakeet: testParakeetStatus({
          installed: false,
          status: 'missing'
        }),
        permissions: {
          ok: true,
          permissions,
          platform: 'darwin'
        },
        transcription: testTranscriptionRecommendation({
          autoDownloadModel: false,
          autoDownloadParakeet: false
        })
      }),
      localLlmStatus: testReadyLocalLlmStatus(),
      parakeetStatus: testParakeetStatus({
        installed: false,
        status: 'missing'
      }),
      permissions
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    const startButton = await screen.findByRole('button', { name: 'Start using Caul' });
    expect(startButton).toBeDisabled();

    await user.hover(startButton.parentElement!);

    expect(await screen.findAllByText('Still needed')).not.toHaveLength(0);
    expect(screen.getAllByText('Screen & System Audio Recording')).not.toHaveLength(0);
    expect(screen.getAllByText('Local transcription')).not.toHaveLength(0);
    expect(screen.queryByText('Local AI')).not.toBeInTheDocument();
    expect(screen.queryByText('ChatGPT sign in')).not.toBeInTheDocument();
  });

  it('enables onboarding start when local AI and transcription setup are complete', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const readyLocalAi = testReadyLocalLlmStatus();
    const bridge = installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          localRuntime: readyLocalAi,
          resources: {
            ...testAiRecommendation().resources,
            localRuntimes: {
              caulLlamaCpp: readyLocalAi
            }
          }
        })
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    const startButton = await screen.findByRole('button', { name: 'Start using Caul' });
    await waitFor(() => expect(startButton).toBeEnabled());

    await user.click(startButton);

    expect(bridge.onboardingCompletes).toBe(1);
  });

  it('requires microphone permission before onboarding can finish', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const readyLocalAi = testReadyLocalLlmStatus();
    installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          localRuntime: readyLocalAi,
          resources: {
            ...testAiRecommendation().resources,
            localRuntimes: {
              caulLlamaCpp: readyLocalAi
            }
          }
        }),
        permissions: {
          ok: true,
          platform: 'darwin',
          permissions: [
            {
              description: 'Required when listening to speaker audio output.',
              id: 'screen-recording',
              label: 'Screen & System Audio Recording',
              status: 'granted'
            },
            {
              description: 'Required when listening to audio from other apps.',
              id: 'system-audio',
              label: 'System Audio',
              status: 'granted'
            },
            {
              description: 'Required when listening to your microphone.',
              id: 'microphone',
              label: 'Microphone',
              status: 'not-determined'
            }
          ]
        }
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    const startButton = await screen.findByRole('button', { name: 'Start using Caul' });
    expect(startButton).toBeDisabled();

    await user.hover(startButton.parentElement!);

    expect(await screen.findByText('Still needed')).toBeInTheDocument();
    expect(screen.getAllByText('Microphone')).not.toHaveLength(0);
  });

  it('shows progress and ignores repeat clicks while onboarding completes', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const readyLocalAi = testReadyLocalLlmStatus();
    let resolveComplete!: (status: OnboardingStatus) => void;
    const bridge = installTestBridge({
      completeOnboarding: () => new Promise((resolve) => {
        resolveComplete = resolve;
      }),
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          localRuntime: readyLocalAi,
          resources: {
            ...testAiRecommendation().resources,
            localRuntimes: {
              caulLlamaCpp: readyLocalAi
            }
          }
        })
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    const startButton = await screen.findByRole('button', { name: 'Start using Caul' });
    await waitFor(() => expect(startButton).toBeEnabled());

    await user.click(startButton);
    expect(await screen.findByRole('button', { name: 'Starting Caul' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Starting Caul' }));
    expect(bridge.onboardingCompletes).toBe(1);

    act(() => {
      resolveComplete(testOnboardingStatus({ complete: true, required: false }));
    });
  });

  it('lets the user explicitly choose a ready Parakeet model during onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    const readyLocalAi = testReadyLocalLlmStatus();
    const bridge = installTestBridge({
      onboardingStatus: testOnboardingStatus({
        ai: testAiRecommendation({
          localRuntime: readyLocalAi,
          resources: {
            ...testAiRecommendation().resources,
            localRuntimes: {
              caulLlamaCpp: readyLocalAi
            }
          }
        }),
        selectedLocalTranscriptionModel: null
      }),
      selectedLocalTranscriptionModel: null
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    const startButton = await screen.findByRole('button', { name: 'Start using Caul' });
    expect(startButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();
    await openOnboardingStep(user, 'Local transcription');
    await user.click(screen.getByRole('tab', { name: 'Best accuracy Recommended' }));
    await openOnboardingStep(user, 'AI responses');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start using Caul' })).toBeEnabled());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Download local AI' })).not.toBeInTheDocument());
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    await waitFor(() => expect(bridge.selectedLocalTranscriptionModels).toEqual(['parakeet']));
  });

  it('does not show extra ChatGPT sign-in status text in onboarding', async () => {
    window.history.pushState({}, '', '/?caul-surface=onboarding');
    const user = userEvent.setup();
    installTestBridge({
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'openai-codex/gpt-5.5',
        status: 'ready'
      })
    });

    render(<App />);

    await openOnboardingStep(user, 'AI responses');
    await user.click(await screen.findByRole('tab', { name: 'Cloud' }));
    await screen.findByText('Sends to a cloud model like ChatGPT. Faster and smarter than Local.');

    expect(screen.queryByText('Sign in required')).not.toBeInTheDocument();
    expect(screen.queryByText('Opening browser')).not.toBeInTheDocument();
  });

  it('uses platform-specific modal close controls', async () => {
    const user = userEvent.setup();
    installTestBridge({
      runtimeContext: testRuntimeContext({
        isMac: false,
        platform: 'win32'
      })
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Caul Settings' }));

    const settingsClose = await screen.findByRole('button', { name: 'Close settings' });
    expect(settingsClose).toHaveClass('right-3');
    expect(settingsClose).not.toHaveClass('left-3');
    expect(settingsClose.querySelector('svg')).toBeInTheDocument();

    await user.click(settingsClose);
    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));

    const promptTemplatesClose = await screen.findByRole('button', { name: 'Close prompt templates' });
    expect(screen.getByRole('dialog', { name: 'Prompt templates' })).toHaveClass('caul-settings-dialog', 'caul-large-modal-shell', 'h-[85vh]', 'w-[85vw]');
    expect(screen.getByRole('heading', { name: 'Prompt templates' })).toHaveClass('text-sm', 'text-center');
    expect(screen.getByText('Save reusable instructions that are prepended to transcript requests.')).toHaveClass('sr-only');
    expect(promptTemplatesClose).toHaveClass('right-3');
    expect(promptTemplatesClose).not.toHaveClass('left-3');
    expect(promptTemplatesClose.querySelector('svg')).toBeInTheDocument();
  });

  it('uses macOS modal close dots on the left', async () => {
    const user = userEvent.setup();
    installTestBridge({
      runtimeContext: testRuntimeContext({
        isMac: true,
        platform: 'darwin'
      })
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Caul Settings' }));

    const settingsClose = await screen.findByRole('button', { name: 'Close settings' });
    expect(settingsClose).toHaveClass('top-6', '-translate-y-1/2', 'left-3', 'size-[14px]', 'rounded-full', 'border-[0.5px]', 'border-[#FB1626]', 'bg-[#FF5C60]', 'shadow-none', 'hover:bg-[#FF5C60]', 'active:bg-[#D94D4F]', 'text-[#802F31]');
    expect(settingsClose).not.toHaveClass('hover:bg-muted');
    expect(settingsClose).not.toHaveClass('hover:bg-red-400');
    expect(settingsClose.className).not.toContain('shadow-[inset');
    expect(settingsClose).not.toHaveClass('right-3');
    expect(settingsClose).not.toHaveAttribute('data-variant');
    expect(settingsClose).toHaveClass('caul-mac-close-button');
    expect(settingsClose.querySelector('svg')).not.toBeInTheDocument();

    await user.click(settingsClose);
    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));

    const promptTemplatesClose = await screen.findByRole('button', { name: 'Close prompt templates' });
    expect(promptTemplatesClose).toHaveClass('top-6', '-translate-y-1/2', 'left-3', 'size-[14px]', 'rounded-full', 'border-[0.5px]', 'border-[#FB1626]', 'bg-[#FF5C60]', 'shadow-none', 'hover:bg-[#FF5C60]', 'active:bg-[#D94D4F]', 'text-[#802F31]');
    expect(promptTemplatesClose).not.toHaveClass('hover:bg-muted');
    expect(promptTemplatesClose).not.toHaveClass('hover:bg-red-400');
    expect(promptTemplatesClose.className).not.toContain('shadow-[inset');
    expect(promptTemplatesClose).not.toHaveClass('right-3');
    expect(promptTemplatesClose).not.toHaveAttribute('data-variant');
    expect(promptTemplatesClose).toHaveClass('caul-mac-close-button');
    expect(promptTemplatesClose.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders the private overlay handle surface and toggles the full app overlay', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    window.history.pushState({}, '', '/?caul-surface=handle');

    render(<App />);

    expect(screen.getByLabelText('Caul overlay handle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Caul app' }).querySelector('.caul-handle-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Caul app' }).querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Caul app' })).not.toHaveTextContent('S');
    expect(screen.getByRole('button', { name: 'Toggle Caul app' })).toHaveAttribute('data-open', 'false');
    await user.click(screen.getByRole('button', { name: 'Toggle Caul app' }));

    expect(bridge.privateOverlayToggles).toBe(1);
    expect(bridge.privateOverlayState.overlayWindowVisible).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Toggle Caul app' })).toHaveAttribute('data-open', 'true');
    });
    expect(screen.getByRole('button', { name: 'Toggle Caul app' })).toHaveAttribute('data-open', 'true');
  });

  it('marks the private overlay handle as pressing while clicked', () => {
    installTestBridge();
    window.history.pushState({}, '', '/?caul-surface=handle');

    render(<App />);

    const handle = screen.getByRole('button', { name: 'Toggle Caul app' });

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      screenX: 100,
      screenY: 100
    });

    expect(handle).toHaveAttribute('data-motion', 'pressing');
  });

  it('drags the circular private overlay handle without toggling the app overlay', () => {
    const bridge = installTestBridge();
    window.history.pushState({}, '', '/?caul-surface=handle');

    render(<App />);

    const handle = screen.getByRole('button', { name: 'Toggle Caul app' });

    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      screenX: 100,
      screenY: 100
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      screenX: 132,
      screenY: 118
    });
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      screenX: 132,
      screenY: 118
    });

    expect(bridge.privateOverlayHandleDragStarts).toBe(1);
    expect(bridge.privateOverlayHandleDragMoves).toBe(1);
    expect(bridge.privateOverlayHandleDragEnds).toBe(1);
    expect(bridge.privateOverlayToggles).toBe(0);
  });

  it('opens the private overlay handle menu on right click without toggling the app overlay', () => {
    const bridge = installTestBridge();
    window.history.pushState({}, '', '/?caul-surface=handle');

    render(<App />);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Toggle Caul app' }));

    expect(bridge.privateOverlayHandleMenuShows).toBe(1);
    expect(bridge.privateOverlayToggles).toBe(0);
  });

  it('drags the private overlay window from the title bar without toggling the app overlay', () => {
    const bridge = installTestBridge();

    render(<App />);

    const titleBar = screen.getByLabelText('Move Caul window');

    fireEvent.pointerDown(titleBar, {
      button: 0,
      pointerId: 2,
      screenX: 400,
      screenY: 80
    });
    fireEvent.pointerMove(titleBar, {
      pointerId: 2,
      screenX: 452,
      screenY: 126
    });
    fireEvent.pointerUp(titleBar, {
      pointerId: 2,
      screenX: 452,
      screenY: 126
    });

    expect(bridge.privateOverlayWindowDragStarts).toBe(1);
    expect(bridge.privateOverlayWindowDragMoves).toBe(1);
    expect(bridge.privateOverlayWindowDragEnds).toBe(1);
    expect(bridge.privateOverlayToggles).toBe(0);
  });

  it('sends live resize events from the invisible window resize affordance', async () => {
    const bridge = installTestBridge();

    render(<App />);

    const resizeHandle = await screen.findByLabelText('Resize window from left edge');

    expect(screen.getByLabelText('Resize window from top edge')).toHaveClass('top-0', 'h-[11px]');
    expect(resizeHandle).toHaveClass('left-0', 'w-[11px]');

    fireEvent.pointerDown(resizeHandle, {
      button: 0,
      pointerId: 3,
      screenX: 120,
      screenY: 180
    });
    fireEvent.pointerMove(resizeHandle, {
      pointerId: 3,
      screenX: 96,
      screenY: 180
    });
    fireEvent.pointerUp(resizeHandle, {
      pointerId: 3,
      screenX: 96,
      screenY: 180
    });

    expect(bridge.privateOverlayWindowResizeStarts).toBe(1);
    expect(bridge.privateOverlayWindowResizeMoves).toBe(1);
    expect(bridge.privateOverlayWindowResizeEnds).toBe(1);
  });

  it('uses a centred title and macOS traffic-light close dot on macOS', async () => {
    installTestBridge({
      runtimeContext: testRuntimeContext({
        isMac: true,
        platform: 'darwin'
      })
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hide Caul app' })).toHaveAttribute('data-platform', 'macos');
    });

    expect(screen.getByLabelText('Move Caul window')).toHaveClass('justify-center');
    expect(screen.getByLabelText('Move Caul window').parentElement).toHaveClass('h-8');
    expect(screen.getByLabelText('Move Caul window')).toHaveClass('cursor-default');
    expect(screen.getByText('Caul')).toHaveClass('text-sm', 'font-medium');
    expect(screen.getByRole('button', { name: 'Hide Caul app' })).toHaveClass('left-3', 'size-[14px]', 'cursor-default', 'rounded-full', 'border-[0.5px]', 'border-[#FB1626]', 'bg-[#FF5C60]', 'shadow-none', 'hover:bg-[#FF5C60]', 'active:bg-[#D94D4F]');
    expect(screen.getByRole('button', { name: 'Hide Caul app' })).not.toHaveClass('hover:bg-red-400');
    expect(screen.getByRole('button', { name: 'Hide Caul app' }).className).not.toContain('shadow-[inset');
    expect(screen.getByRole('button', { name: 'Hide Caul app' }).querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quit Caul' })).toHaveAttribute('data-platform', 'macos');
    expect(screen.getByRole('button', { name: 'Quit Caul' })).toHaveClass('left-8', 'size-[14px]', 'cursor-default', 'rounded-full', 'border-[0.5px]', 'border-[#9B48D6]', 'bg-[#BF5AF2]');
    expect(screen.getByRole('button', { name: 'Quit Caul' }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caul Settings' })).toHaveClass('right-1.5');
    expect(screen.getByRole('button', { name: 'Caul Settings' })).not.toHaveClass('left-1.5');
    expect(screen.getByRole('button', { name: 'Caul Settings' })).toHaveClass('size-7', 'bg-transparent');
    expect(screen.getByRole('button', { name: 'Caul Settings' })).not.toHaveClass('border-border');
  });

  it('puts quit before hide on non-macOS platforms', async () => {
    installTestBridge({
      runtimeContext: testRuntimeContext({
        isMac: false,
        platform: 'win32'
      })
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hide Caul app' })).toHaveAttribute('data-platform', 'desktop');
    });

    expect(screen.getByRole('button', { name: 'Hide Caul app' })).toHaveClass('right-1');
    expect(screen.getByRole('button', { name: 'Hide Caul app' })).toHaveClass('cursor-default');
    expect(screen.getByRole('button', { name: 'Hide Caul app' }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quit Caul' })).toHaveAttribute('data-platform', 'desktop');
    expect(screen.getByRole('button', { name: 'Quit Caul' })).toHaveClass('right-9');
    expect(screen.getByRole('button', { name: 'Quit Caul' }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caul Settings' })).toHaveClass('left-1.5');
    expect(screen.getByRole('button', { name: 'Caul Settings' })).not.toHaveClass('right-1.5');
    expect(screen.getByRole('button', { name: 'Caul Settings' })).toHaveClass('size-7', 'bg-transparent');
    expect(screen.getByRole('button', { name: 'Caul Settings' })).not.toHaveClass('border-border');
  });

  it('requires confirmation before quitting from the titlebar', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      runtimeContext: testRuntimeContext({
        isMac: false,
        platform: 'win32'
      })
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Quit Caul' }));

    expect(await screen.findByRole('heading', { name: 'Quit Caul?' })).toBeInTheDocument();
    expect(bridge.quits).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Quit Caul?' })).not.toBeInTheDocument();
    });
    expect(bridge.quits).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Quit Caul' }));
    await user.click(screen.getAllByRole('button', { name: 'Quit Caul' }).at(-1)!);

    expect(bridge.quits).toBe(1);
  });

  it('requires confirmation before quitting from Settings Advanced', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);

    const advancedSettings = screen.getByRole('group', { name: 'Advanced' });
    await user.click(within(advancedSettings).getByRole('button', { name: 'Quit Caul' }));

    expect(await screen.findByRole('heading', { name: 'Quit Caul?' })).toBeInTheDocument();
    expect(bridge.quits).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Quit Caul?' })).not.toBeInTheDocument();
    });
    expect(bridge.quits).toBe(0);

    await user.click(within(advancedSettings).getByRole('button', { name: 'Quit Caul' }));
    await user.click(screen.getAllByRole('button', { name: 'Quit Caul' }).at(-1)!);

    expect(bridge.quits).toBe(1);
  });

  it.each([
    'top',
    'right',
    'bottom',
    'left'
  ] as const)('keeps home toolbar tooltip directions stable with the %s handle edge', async (handleEdge) => {
    const user = userEvent.setup();

    installTestBridge({
      privateOverlayState: testPrivateOverlayStateForEdge(handleEdge)
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Home layout')).toHaveAttribute('data-home-toolbar-edge', handleEdge);
    });

    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();

    expect(screen.getByTestId('home-panels')).toHaveAttribute(
      'data-panel-flow',
      'side-by-side'
    );

    const toolbar = screen.getByLabelText('Home actions');
    const bottomToolbar = screen.queryByLabelText('Bottom transcript actions');
    const panels = screen.getByTestId('home-panels');
    const transcriptSection = toolbar.querySelector('[data-toolbar-section="transcript"]');
    const aiSection = toolbar.querySelector('[data-toolbar-section="ai"]');
    const transcriptPanelBottomSection = panels.querySelector('[data-toolbar-section="transcript-bottom"]');
    const aiPanelBottomSection = panels.querySelector('[data-toolbar-section="ai-bottom"]');
    const transcriptBottomSection = bottomToolbar?.querySelector('[data-toolbar-section="transcript-bottom"]') ?? transcriptPanelBottomSection;
    const aiBottomSection = bottomToolbar?.querySelector('[data-toolbar-section="ai-bottom"]') ?? aiPanelBottomSection;

    expect(transcriptSection).toBeInTheDocument();
    expect(aiSection).toBeInTheDocument();

    expect(bottomToolbar).toBeInTheDocument();
    expect(transcriptBottomSection).toBeInTheDocument();
    expect(aiBottomSection).toBeInTheDocument();
    expect(transcriptPanelBottomSection).not.toBeInTheDocument();
    expect(aiPanelBottomSection).not.toBeInTheDocument();
    expect(toolbar).toHaveClass('grid');
    expect(toolbar).toHaveClass('divide-x');
    expect(toolbar).not.toHaveClass('w-12');
    expect(toolbar).not.toHaveClass('divide-y');
    expect(aiSection).not.toHaveClass('border-l');

    const transcriptQueries = within(transcriptSection as HTMLElement);
    const aiQueries = within(aiSection as HTMLElement);

    const transcriptActionQueries = within((transcriptBottomSection ?? transcriptSection) as HTMLElement);
    const aiActionQueries = within((aiBottomSection ?? aiSection) as HTMLElement);

    expect(transcriptActionQueries.getByRole('button', { name: 'Copy full transcript' })).toBeInTheDocument();
    expect(transcriptActionQueries.getByRole('button', { name: 'Download full transcript' })).toBeInTheDocument();
    expect(transcriptActionQueries.getByRole('button', { name: 'Send full transcript to AI' })).toBeInTheDocument();
    expect(transcriptQueries.queryByRole('button', { name: 'Prompt template' })).not.toBeInTheDocument();
    expect(transcriptQueries.queryByRole('button', { name: 'Manage prompt templates' })).not.toBeInTheDocument();

    expect(aiQueries.getByRole('button', { name: 'Prompt template' })).toBeInTheDocument();
    expect(aiQueries.getByRole('button', { name: 'Manage prompt templates' })).toBeInTheDocument();
    expect(aiQueries.getByRole('button', { name: 'Instructions' })).toBeInTheDocument();
    expect(aiActionQueries.queryByRole('button', { name: 'Send full transcript to AI' })).not.toBeInTheDocument();

    await user.hover(transcriptQueries.getByRole('button', { name: 'Start Listening' }));

    const startListeningTooltip = await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-content"]');
      expect(tooltip).toHaveTextContent(
        'Click Start Listening while playing something through your speakers or headphones.'
      );
      return tooltip;
    });
    expect(startListeningTooltip).toHaveTextContent(
      'Click Start Listening while playing something through your speakers or headphones.'
    );
    expect(startListeningTooltip).toHaveAttribute('data-side', 'bottom');

    await user.unhover(transcriptQueries.getByRole('button', { name: 'Start Listening' }));

    expect(aiQueries.getByRole('button', { name: 'Prompt template' })).not.toHaveClass('size-9');
    expect(aiQueries.getByRole('button', { name: 'Manage prompt templates' })).toHaveClass('size-9');
    expect(transcriptQueries.getByRole('button', { name: 'Start Listening' })).toHaveClass('w-[140px]');
  });

  it('arms tooltip suppression when the private overlay opens from the floating handle', async () => {
    installTestBridge({
      privateOverlayState: testPrivateOverlayStateForEdge('right')
    });

    render(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.caulSuppressTooltips).toBe('true');
    });
  });

  it('updates adaptive overlay layout from live private overlay state', async () => {
    const bridge = installTestBridge({
      privateOverlayState: testPrivateOverlayStateForEdge('right')
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Home layout')).toHaveAttribute('data-home-toolbar-edge', 'right');
    });

    bridge.setPrivateOverlayState(testPrivateOverlayStateForEdge('top'));

    await waitFor(() => {
      expect(screen.getByLabelText('Home layout')).toHaveAttribute('data-home-toolbar-edge', 'top');
    });
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('loads the full app when the retired compact overlay route is requested', async () => {
    window.history.pushState({}, '', '/?caul-surface=overlay');

    render(<App />);

    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Caul private overlay')).not.toBeInTheDocument();
  });

  it('does not expose private overlay controls in settings', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await openSettings(user);

    expect(screen.queryByText('Private overlay')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Show floating handle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle App Overlay' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset Handle Position' })).not.toBeInTheDocument();
  });

  it('changes the floating button size from Settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await selectSetting(user, 'Size', 'Large');

    expect(bridge.privateOverlayState.handle.size).toBe('large');
  });

  it('shows long scroll fixture sections when requested in development', () => {
    window.history.pushState({}, '', '/?caul-scroll-fixture=1');

    const { container } = render(<App />);

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Incident follow-up fixture line 34');
    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('Launch readiness review fixture line 34');
    expect(screen.getByLabelText('AI response')).toHaveTextContent('Incident follow-up section 10');
    expect(screen.getByLabelText('AI response')).not.toHaveTextContent('Launch readiness review section 10');
    expect(container.querySelectorAll('#transcript-output article')).toHaveLength(3);
    expect(container.querySelectorAll('#llm-output article')).toHaveLength(3);
    expect(container.querySelector('#transcript-output')).toHaveClass('-mt-px');
    expect(container.querySelector('#llm-output')).toHaveClass('-mt-px');
    expect(container.querySelector('#transcript-output .transcript-section-header')).toHaveClass('border-y');
    expect(container.querySelector('#llm-output .transcript-section-header')).toHaveClass('border-y');
    expect(container.querySelector('#transcript-output .section-title-compact')).toHaveTextContent(
      /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/
    );
    expect(container.querySelector('#llm-output .section-title-compact')).toHaveTextContent(
      /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/
    );
    expect(container.querySelector('#transcript-output .transcript-section-header > div')).toHaveClass('truncate');
  });

  it('shows permission status rows in Settings', async () => {
    const user = userEvent.setup();
    installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'denied'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'granted'
        }
      ]
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    const settingsDialog = within(screen.getByRole('dialog', { name: 'Settings' }));

    expect(settingsDialog.getByRole('group', { name: 'Permissions' })).toBeInTheDocument();
    expect(settingsDialog.getByText('Screen & System Audio Recording')).toBeInTheDocument();
    expect(settingsDialog.getByText('Microphone')).toBeInTheDocument();
    expect(settingsDialog.getByRole('button', { name: 'Grant Screen & System Audio Recording' })).toBeInTheDocument();
    expect(settingsDialog.queryByRole('button', { name: 'Grant Microphone' })).not.toBeInTheDocument();
  });

  it('hides unsupported permission rows in Settings', async () => {
    const user = userEvent.setup();
    installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'unsupported'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'unsupported'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'granted'
        }
      ]
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    const settingsDialog = within(screen.getByRole('dialog', { name: 'Settings' }));

    expect(settingsDialog.queryByText('Screen & System Audio Recording')).not.toBeInTheDocument();
    expect(settingsDialog.queryByText('System Audio')).not.toBeInTheDocument();
    expect(settingsDialog.getByText('Microphone')).toBeInTheDocument();
    expect(settingsDialog.queryByText('Unsupported')).not.toBeInTheDocument();
  });

  it('requests a permission from the Settings permissions area', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('caul.initial-permission-requested', '1');
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'not-determined'
        }
      ]
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    const settingsDialog = within(screen.getByRole('dialog', { name: 'Settings' }));

    expect(settingsDialog.getByRole('button', { name: 'Grant Screen & System Audio Recording' })).toBeInTheDocument();
    expect(settingsDialog.getByRole('button', { name: 'Grant System Audio' })).toBeInTheDocument();
    expect(settingsDialog.getByRole('button', { name: 'Grant Microphone' })).toBeInTheDocument();
    expect(settingsDialog.queryByText('Required for setup')).not.toBeInTheDocument();

    await user.click(settingsDialog.getByRole('button', { name: 'Grant System Audio' }));
    await user.click(settingsDialog.getByRole('button', { name: 'Grant Microphone' }));
    expect(bridge.requestedPermissions).toEqual(['system-audio', 'microphone']);
  });

  it('requests denied audio permissions separately from Settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'granted'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'denied'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'denied'
        }
      ]
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    const settingsDialog = within(screen.getByRole('dialog', { name: 'Settings' }));

    expect(await settingsDialog.findByRole('button', { name: 'Grant System Audio' })).toHaveTextContent('Grant');
    expect(settingsDialog.getByRole('button', { name: 'Grant Microphone' })).toHaveTextContent('Grant');

    await user.click(settingsDialog.getByRole('button', { name: 'Grant System Audio' }));
    await user.click(settingsDialog.getByRole('button', { name: 'Grant Microphone' }));

    expect(bridge.requestedPermissions).toEqual(['system-audio', 'microphone']);
    expect(settingsDialog.queryByText('Changed it in System Settings? Restart Caul to apply the permission.')).not.toBeInTheDocument();
    expect(await settingsDialog.findByRole('button', { name: 'Grant System Audio' })).toHaveTextContent('Grant');
    expect(settingsDialog.getByRole('button', { name: 'Grant Microphone' })).toHaveTextContent('Grant');
    expect(settingsDialog.queryByRole('button', { name: 'Restart System Audio' })).not.toBeInTheDocument();
    expect(settingsDialog.queryByRole('button', { name: 'Restart Microphone' })).not.toBeInTheDocument();
  });

  it('marks microphone permission as required when microphone input is enabled', async () => {
    const user = userEvent.setup();
    installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'granted'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'granted'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'not-determined'
        }
      ]
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Microphone off' }));
    await openSettings(user);
    await openSettingsSection(user, 'General');

    const settingsDialog = within(screen.getByRole('dialog', { name: 'Settings' }));

    expect(settingsDialog.getByText('Required now')).toBeInTheDocument();
    expect(settingsDialog.queryByText('Required for setup')).not.toBeInTheDocument();
  });

  it('does not show Grant buttons for granted permissions in Settings', async () => {
    const user = userEvent.setup();
    installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'granted'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'not-determined'
        }
      ]
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    const settingsDialog = within(screen.getByRole('dialog', { name: 'Settings' }));

    expect(settingsDialog.queryByRole('button', { name: 'Grant Screen & System Audio Recording' })).not.toBeInTheDocument();
    expect(settingsDialog.getByRole('button', { name: 'Grant Microphone' })).toBeInTheDocument();
  });

  it('keeps Start Listening visible and shows a transcript permission issue when a selected source is missing permission', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'granted'
        }
      ]
    });

    render(<App />);

    await screen.findByRole('button', { name: 'Start Listening' });
    const grantButton = await screen.findByRole('button', { name: 'Grant Screen & System Audio Recording' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Listening' })).toBeDisabled();
    });
    expect(grantButton).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Permissions are needed before listening.');
    expect(screen.queryByLabelText('Start Listening hint')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant Microphone' })).not.toBeInTheDocument();
    await user.click(grantButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Listening' })).not.toBeDisabled();
    });
      expect(screen.queryByText('Permissions are needed before listening.')).not.toBeInTheDocument();
    expect(bridge.requestedPermissions).toEqual(['screen-recording']);
    expect(bridge.starts).toEqual([]);
  });

  it('keeps Start Listening before source indicators and Auto Send in the horizontal home toolbar when permissions are missing', async () => {
    installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'denied'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'granted'
        }
      ],
      privateOverlayState: testPrivateOverlayStateForEdge('top')
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Home layout')).toHaveAttribute('data-home-toolbar-edge', 'top');
    });

    const toolbar = await screen.findByLabelText('Home actions');
    const transcriptSection = toolbar.querySelector('[data-toolbar-section="transcript"]');

    expect(transcriptSection).toBeInTheDocument();

    const toolbarQueries = within(transcriptSection as HTMLElement);
    const startButton = await waitFor(() => toolbarQueries.getByRole('button', {
      name: 'Start Listening'
    }));
    const speakerButton = await waitFor(() => toolbarQueries.getByRole('button', { name: 'Speaker on' }));
    const autoSendButton = await waitFor(() => {
      return toolbarQueries.getByRole('button', { name: 'Auto Send' });
    });

    expect(startButton).toHaveTextContent('Start Listening');
    expect(startButton).toBeDisabled();
    expect(
      startButton.compareDocumentPosition(speakerButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      startButton.compareDocumentPosition(autoSendButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows a transcript model recovery control without replacing Start Listening', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      parakeetStatus: testParakeetStatus({
        installed: false,
        status: 'missing'
      })
    });

    render(<App />);

    await screen.findByRole('button', { name: 'Start Listening' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Listening' })).toBeDisabled();
    });
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Download a transcription model before listening.');
    expect(screen.queryByLabelText('Start Listening hint')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Transcription model')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(bridge.parakeetDownloads).toBe(1);
      expect(screen.getByRole('button', { name: 'Start Listening' })).not.toBeDisabled();
    });
    expect(bridge.selectedLocalTranscriptionModels).toEqual(['parakeet']);
  });

  it('keeps global transcript and AI response actions in the horizontal bottom toolbar', async () => {
    installTestBridge({
      privateOverlayState: testPrivateOverlayStateForEdge('top')
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Home layout')).toHaveAttribute('data-home-toolbar-edge', 'top');
    });

    const toolbar = await screen.findByLabelText('Home actions');
    const bottomToolbar = await screen.findByLabelText('Bottom transcript actions');
    const transcriptSection = toolbar.querySelector('[data-toolbar-section="transcript"]');
    const aiSection = toolbar.querySelector('[data-toolbar-section="ai"]');
    const transcriptBottomSection = bottomToolbar.querySelector('[data-toolbar-section="transcript-bottom"]');
    const aiBottomSection = bottomToolbar.querySelector('[data-toolbar-section="ai-bottom"]');

    expect(transcriptSection).toBeInTheDocument();
    expect(aiSection).toBeInTheDocument();
    expect(transcriptBottomSection).toBeInTheDocument();
    expect(aiBottomSection).toBeInTheDocument();
    expect(toolbar).toHaveClass('grid');
    expect(toolbar).toHaveClass('divide-x');
    expect(bottomToolbar).toHaveClass('border-t');
    expect(aiSection).not.toHaveClass('border-l');
    expect(aiSection).not.toHaveClass('justify-end');
    expect(aiSection).not.toHaveClass('justify-between');
    expect(aiSection).toHaveClass('justify-center');

    const transcriptQueries = within(transcriptSection as HTMLElement);
    const aiQueries = within(aiSection as HTMLElement);
    const transcriptBottomQueries = within(transcriptBottomSection as HTMLElement);
    const aiBottomQueries = within(aiBottomSection as HTMLElement);
    const copyButton = transcriptBottomQueries.getByRole('button', { name: 'Copy full transcript' });
    const downloadButton = transcriptBottomQueries.getByRole('button', { name: 'Download full transcript' });
    const sendButton = transcriptBottomQueries.getByRole('button', { name: 'Send full transcript to AI' });
    const templateButton = aiQueries.getByRole('button', { name: 'Prompt template' });
    const settingsButton = aiQueries.getByRole('button', { name: 'Manage prompt templates' });
    const generalInstructionsButton = aiQueries.getByRole('button', { name: 'Instructions' });
    const copyAiButton = aiBottomQueries.getByRole('button', { name: 'Copy all AI responses' });
    const downloadAiButton = aiBottomQueries.getByRole('button', { name: 'Download all AI responses' });

    expect(transcriptQueries.getByRole('button', { name: 'Speaker on' }).parentElement?.parentElement)
      .toHaveClass('justify-center');
    expect(transcriptQueries.getByRole('button', { name: 'Microphone off' }).parentElement?.parentElement)
      .toHaveClass('justify-center');
    expect(transcriptQueries.getByRole('button', { name: 'Auto Send' }).parentElement)
      .not.toHaveClass('justify-center');
    expect(transcriptBottomSection).toHaveClass('justify-center');
    expect(aiBottomSection).toHaveClass('justify-center');
    expect(copyButton.closest('.min-w-0')).toBeInTheDocument();
    expect(copyAiButton.closest('.min-w-0')).toBeInTheDocument();
    expect(templateButton.closest('.flex-1')).toBeInTheDocument();
    expect(settingsButton.parentElement).not.toHaveClass('ml-auto');
    expect(generalInstructionsButton.parentElement).toHaveClass('ml-auto');
    expect(copyButton.compareDocumentPosition(downloadButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(downloadButton.compareDocumentPosition(sendButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(templateButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(settingsButton.compareDocumentPosition(generalInstructionsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(copyAiButton.compareDocumentPosition(downloadAiButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(copyAiButton).toBeDisabled();
    expect(downloadAiButton).toBeDisabled();
  });

  it('does not request fresh macOS permissions automatically for a brand new user', async () => {
    const bridge = installTestBridge({
      permissions: [
        {
          description: 'Required when listening to speaker audio output.',
          id: 'screen-recording',
          label: 'Screen & System Audio Recording',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to audio from other apps.',
          id: 'system-audio',
          label: 'System Audio',
          status: 'not-determined'
        },
        {
          description: 'Required when listening to your microphone.',
          id: 'microphone',
          label: 'Microphone',
          status: 'not-determined'
        }
      ]
    });

    render(<App />);

    await screen.findByRole('button', { name: 'Start Listening' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start Listening' })).toBeDisabled();
    });
    expect(await screen.findByRole('button', { name: 'Grant Screen & System Audio Recording' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant System Audio' })).toBeInTheDocument();

    expect(bridge.requestedPermissions).toEqual([]);
    expect(window.localStorage.getItem('caul.initial-permission-requested')).toBeNull();
  });

  it('toggles listening with one button', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Live transcription is unavailable in this environment.');
  });

  it('passes the default system source to native transcription', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    expect(bridge.starts.at(-1)).toEqual({ sources: ['system'] });
  });

  it('shows a waiting status immediately after listening starts', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Starting audio...');
  });

  it('shows speech detection before the first transcript text arrives', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({ type: 'speech-started' });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Speech detected...');
  });

  it('updates native transcription sources while listening', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Microphone off' }));
    await user.click(screen.getByRole('button', { name: 'Start Listening' }));

    expect(bridge.starts.at(-1)).toEqual({ sources: ['system', 'microphone'] });

    await user.click(screen.getByRole('button', { name: 'Microphone on' }));

    await waitFor(() => {
      expect(bridge.starts.at(-1)).toEqual({ sources: ['system'] });
    });
  });

  it('ignores microphone transcript events after input is turned off while listening', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Microphone off' }));
    await user.click(screen.getByRole('button', { name: 'Start Listening' }));
    await user.click(screen.getByRole('button', { name: 'Microphone on' }));

    await waitFor(() => {
      expect(bridge.starts.at(-1)).toEqual({ sources: ['system'] });
    });

    bridge.emit({
      source: 'microphone',
      text: 'late microphone words',
      type: 'completed',
      utteranceId: 1
    });
    bridge.emit({
      source: 'system',
      text: 'speaker words',
      type: 'completed',
      utteranceId: 2
    });

    const output = screen.getByLabelText('Transcription output');
    await waitFor(() => {
      expect(output).toHaveTextContent('speaker words');
    });
    expect(output).not.toHaveTextContent('late microphone words');
  });

  it('keeps source labels on once input and output have both been active in a session', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        source: 'system',
        text: 'Output only before input.',
        type: 'completed',
        utteranceId: 1
      });
    });

    await user.click(screen.getByRole('button', { name: 'Microphone off' }));
    await waitFor(() => {
      expect(bridge.starts.at(-1)).toEqual({ sources: ['system', 'microphone'] });
    });

    act(() => {
      bridge.emit({
        source: 'system',
        text: 'Speaker after input activated.',
        type: 'completed',
        utteranceId: 2
      });
      bridge.emit({
        source: 'microphone',
        text: 'Microphone after input activated.',
        type: 'completed',
        utteranceId: 3
      });
    });

    await user.click(screen.getByRole('button', { name: 'Microphone on' }));
    await waitFor(() => {
      expect(bridge.starts.at(-1)).toEqual({ sources: ['system'] });
    });

    act(() => {
      bridge.emit({
        source: 'system',
        text: 'Speaker after input off.',
        type: 'completed',
        utteranceId: 4
      });
    });

    const output = screen.getByLabelText('Transcription output').textContent ?? '';
    expect(output).toContain(': Output only before input.');
    expect(output).not.toContain('[Speaker]: Output only before input.');
    expect(output).toContain('[Speaker]: Speaker after input activated.');
    expect(output).toContain('[Microphone]: Microphone after input activated.');
    expect(output).toContain('[Speaker]: Speaker after input off.');
  });

  it('prepares the default transcription source while idle', async () => {
    const bridge = installTestBridge();

    render(<App />);

    expect(bridge.prepares.at(-1)).toEqual({ sources: ['system'] });
  });

  it('shows the speaker source indicator on by default', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    const speaker = await screen.findByRole('button', { name: 'Speaker on' });
    expect(speaker).toHaveAttribute('aria-pressed', 'true');
    expect(speaker).toHaveClass('!bg-primary');
    expect(speaker).toHaveTextContent('Output');
    const microphoneOff = screen.getByRole('button', { name: 'Microphone off' });
    expect(microphoneOff).toHaveAttribute('aria-pressed', 'false');
    expect(microphoneOff).toHaveClass('text-muted-foreground');
    expect(microphoneOff).toHaveTextContent('Input');
    expect(microphoneOff.querySelector('.lucide-mic-off')).toBeInTheDocument();

    await user.click(microphoneOff);
    const microphoneOn = screen.getByRole('button', { name: 'Microphone on' });
    expect(microphoneOn).toHaveAttribute('aria-pressed', 'true');
    expect(microphoneOn).toHaveClass('!bg-primary');
    expect(microphoneOn).toHaveTextContent('Input');
    expect(microphoneOn.querySelector('.lucide-mic')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Listening hint')).toHaveTextContent(
      'Click Start Listening while playing something through your speakers, headphones, or speaking into your microphone.'
    );
    expect(screen.queryByText('Will listen to your sound input.')).not.toBeInTheDocument();
    expect((await screen.findAllByText('Captures what you say into your microphone.')).length).toBeGreaterThan(0);
    expect(bridge.prepares.at(-1)).toEqual({ sources: ['system', 'microphone'] });

    await user.click(screen.getByRole('button', { name: 'Speaker on' }));
    const speakerOff = screen.getByRole('button', { name: 'Speaker off' });
    expect(speakerOff).toHaveAttribute('aria-pressed', 'false');
    expect(speakerOff).toHaveClass('text-muted-foreground');
    expect(speakerOff).toHaveTextContent('Output');
    expect(speakerOff.querySelector('.lucide-volume-x')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Listening hint')).toHaveTextContent(
      'Click Start Listening while speaking into your microphone.'
    );
    expect(screen.queryByText('Will not listen to your sound output.')).not.toBeInTheDocument();
    expect((await screen.findAllByText('Captures what you hear on your speakers or headphones.')).length).toBeGreaterThan(0);
    expect(bridge.prepares.at(-1)).toEqual({ sources: ['microphone'] });

    await user.click(screen.getByRole('button', { name: 'Start Listening' }));
    expect(bridge.starts.at(-1)).toEqual({ sources: ['microphone'] });
  });

  it('explains that an audio source is required before listening', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Speaker on' }));
    const startListening = screen.getByRole('button', { name: 'Start Listening' });

    expect(screen.getByRole('button', { name: 'Speaker off' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Microphone off' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Start Listening hint')).toHaveTextContent(
      'Select Input, Output or both before starting.'
    );
    expect(startListening).toBeDisabled();
  });

  it('uses green icon styling for Auto Send when it is on', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    const autoSend = screen.getByRole('button', { name: 'Auto Send' });
    expect(autoSend).toHaveAttribute('aria-pressed', 'true');
    expect(autoSend).toHaveClass('!bg-primary');
    expect(autoSend.querySelector('.caul-auto-send-off-slash')).not.toBeInTheDocument();

    await user.click(autoSend);
    expect(autoSend).toHaveAttribute('aria-pressed', 'false');
    expect(autoSend).toHaveClass('text-muted-foreground');
    expect(autoSend.querySelector('.caul-auto-send-off-slash')).toBeInTheDocument();
    expect((await screen.findAllByText('Sends the transcript to AI when listening stops.'))
      .find((element) => element.getAttribute('data-slot') === 'tooltip-content'))
      .toBeInTheDocument();
  });

  it('keeps transcript timestamps readable for default speaker chunks', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        source: 'system',
        utteranceId: 1,
        text: 'Hello, hello, hello.'
      });
    });

    const output = screen.getByLabelText('Transcription output').textContent ?? '';
    expect(output).toMatch(/\[\d{2}:\d{2}:\d{2}(?:\s?[AP]M)?\]: Hello, hello, hello\./);
  });

  it('timestamps transcript chunks from their display time', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    const emittedAt = new Date();

    act(() => {
      bridge.emit({
        type: 'completed',
        startMs: 2_000,
        utteranceId: 1,
        text: 'Started two seconds in.'
      });
    });

    const expectedTime = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(emittedAt);
    const output = screen.getByLabelText('Transcription output').textContent ?? '';
    expect(output).toContain(`[${expectedTime}]: Started two seconds in.`);
  });

  it('orders completed transcript chunks by recorded start time', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        startMs: 12_000,
        utteranceId: 2,
        text: 'Second line.'
      });
      bridge.emit({
        type: 'completed',
        startMs: 11_000,
        utteranceId: 1,
        text: 'First line.'
      });
    });

    const output = screen.getByLabelText('Transcription output').textContent ?? '';
    expect(output.indexOf('First line.')).toBeLessThan(output.indexOf('Second line.'));
  });

  it('ignores stale partial transcript chunks after a newer final chunk for the same source', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        source: 'system',
        startMs: 12_000,
        utteranceId: 2,
        text: 'This book sold for $2.2 million.'
      });
      bridge.emit({
        type: 'partial',
        source: 'system',
        startMs: 11_000,
        utteranceId: 1,
        text: 'This book sold for two point two million dollars.'
      });
    });

    const output = screen.getByLabelText('Transcription output');
    expect(output).toHaveTextContent('This book sold for $2.2 million.');
    expect(output).not.toHaveTextContent('This book sold for two point two million dollars.');
  });

  it('shows provisional partial text before final chunks', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'partial',
        source: 'system',
        startMs: 1_000,
        utteranceId: 1,
        text: 'Speaker partial'
      });
    });

    const output = screen.getByLabelText('Transcription output');
    expect(output).toHaveTextContent('Speaker partial');
    expect(getTranscriptDraftTail()).toHaveTextContent('Speaker partial');

    act(() => {
      bridge.emit({
        type: 'completed',
        source: 'system',
        startMs: 1_000,
        utteranceId: 1,
        text: 'Speaker final'
      });
    });

    expect(output).toHaveTextContent('Speaker final');
    expect(output).not.toHaveTextContent('Speaker partial');
    expect(getTranscriptDraftTail()).toBeNull();
  });

  it('replaces provisional partial text when a final arrives for the same utterance', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        source: 'system',
        startMs: 0,
        text: 'Um buy hero play. Um I think that is a pretty comfortable pick',
        type: 'partial',
        utteranceId: 1
      });
    });

    const output = screen.getByLabelText('Transcription output');
    expect(output).toHaveTextContent(
      'Um buy hero play. Um I think that is a pretty comfortable pick'
    );
    expect(getTranscriptDraftTail()).toHaveTextContent(
      'Um buy hero play. Um I think that is a pretty comfortable pick'
    );

    act(() => {
      bridge.emit({
        source: 'system',
        startMs: 0,
        text: 'I think that is a pretty comfortable pick',
        type: 'completed',
        utteranceId: 1
      });
    });

    expect(output).toHaveTextContent(
      'I think that is a pretty comfortable pick'
    );
    expect(output).not.toHaveTextContent('Um buy hero play.');
    expect(getTranscriptDraftTail()).toBeNull();
  });

  it('renders diagnostic partial utterances only as draft tails', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'partial',
        source: 'system',
        startMs: 0,
        endMs: 3_420,
        utteranceId: 1,
        text: "Which I don't need to tell you guys about, you've heard enough about it already."
      });
      bridge.emit({
        type: 'partial',
        source: 'system',
        startMs: 4_020,
        endMs: 4_530,
        utteranceId: 2,
        text: 'Nice.'
      });
    });

    const output = screen.getByLabelText('Transcription output');
    expect(output).toHaveTextContent("Which I don't need to tell you guys about, you've heard enough about it already.");
    expect(output).toHaveTextContent('Nice.');
    expect(getTranscriptDraftTail()).toHaveTextContent("Which I don't need to tell you guys about, you've heard enough about it already.");
    expect(getTranscriptDraftTail()).toHaveTextContent('Nice.');
  });

  it('does not show audio source selection in Settings while listening', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await openSettings(user);
    expect(screen.queryByRole('checkbox', { name: 'Microphone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Speaker' })).not.toBeInTheDocument();

    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    await openSettings(user);

    expect(screen.queryByRole('checkbox', { name: 'Microphone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Speaker' })).not.toBeInTheDocument();
  });

  it('does not expose auto controls or parameters', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    expect(screen.queryByText('Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto parameters')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eager' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Short' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Broad' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    expect(bridge.starts.at(-1)).toEqual({ sources: ['system'] });
  });

  it('renders searchable prompt templates in the AI toolbar', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Prompt template' })).toHaveTextContent('No template');
    expect(screen.getByRole('button', { name: 'Manage prompt templates' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prompt template' }));
    expect(await screen.findByText('STAR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CV' }).querySelector('[data-slot="checkbox"]'))
      .toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByRole('button', { name: 'STAR' }).querySelector('[data-slot="checkbox"]'))
      .toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByRole('button', { name: 'No template' }).querySelector('[data-slot="checkbox"]'))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No template' })).toHaveAttribute('data-active', 'true');

    await user.type(screen.getByLabelText('Search prompt templates'), 'PD');
    expect(screen.getByText('PD')).toBeInTheDocument();
    expect(screen.queryByText('STAR')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search prompt templates'));

    await user.click(screen.getByText('STAR'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Prompt template' })).toHaveTextContent('STAR');
    });
  });

  it('migrates old built-in prompt template names on startup without dropping custom templates', async () => {
    installTestBridge({
      promptTemplateState: testPromptTemplateState({
        selectedTemplateIds: ['starter-use-my-cv', 'starter-job-description'],
        templates: [
          testPromptTemplate({
            id: 'starter-use-my-cv',
            name: 'Use my CV',
            prompt: 'Old CV prompt.'
          }),
          testPromptTemplate({
            id: 'starter-job-description',
            name: 'Job description',
            prompt: 'Old job description prompt.'
          }),
          testPromptTemplate({
            id: 'custom-template',
            name: 'Custom template',
            prompt: 'Keep this custom prompt.'
          })
        ]
      })
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Prompt template' })).toHaveTextContent('CV + PD');
    expect(screen.queryByText('Use my CV')).not.toBeInTheDocument();
    expect(screen.queryByText('Job description')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Prompt template' }));

    expect(await screen.findByText('Custom template')).toBeInTheDocument();
  });

  it('refreshes the prompt template tooltip when hovering from the picker to edit', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    const templateButton = await screen.findByRole('button', { name: 'Prompt template' });
    const editButton = screen.getByRole('button', { name: 'Manage prompt templates' });

    await user.hover(templateButton);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent)
        .toMatch(/^Selected prompt templates:/);
    });

    await user.hover(editButton);

    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent)
        .not.toBe('Selected prompt templates:\nCV\nPD');
    });
    expect((await screen.findAllByText('Manage prompt templates'))
      .find((element) => element.getAttribute('data-slot') === 'tooltip-content'))
      .toBeInTheDocument();
  });

  it('keeps the clicked prompt template selected when the bridge returns stale selection state', async () => {
    const user = userEvent.setup();
    installTestBridge({
      setSelectedPromptTemplate: async (_id, state) => ({
        ...state,
        selectedTemplateIds: []
      })
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Prompt template' }));
    await user.click(await screen.findByText('STAR'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Prompt template' })).toHaveTextContent('STAR');
    });
  });

  it('creates edits and deletes prompt templates in the modal', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));
    const promptTemplateDialog = within(screen.getByRole('dialog', { name: 'Prompt templates' }));
    expect(promptTemplateDialog.getByRole('button', { name: 'CV' }))
      .toHaveAttribute('data-active', 'false');
    await user.click(promptTemplateDialog.getByRole('button', { name: 'CV' }));
    expect(promptTemplateDialog.getByRole('button', { name: 'CV' }))
      .toHaveAttribute('data-active', 'true');
    expect(promptTemplateDialog.getByRole('button', { name: 'CV' }))
      .toHaveClass('h-8', 'data-[active=true]:bg-sidebar-accent', 'data-[active=true]:text-sidebar-accent-foreground');
    expect(promptTemplateDialog.getByRole('button', { name: 'PD' }))
      .toHaveAttribute('data-active', 'false');
    await user.click(screen.getByRole('button', { name: 'New template' }));
    expect(promptTemplateDialog.getByRole('button', { name: 'Untitled' })).toHaveAttribute('data-active', 'true');
    expect(promptTemplateDialog.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(promptTemplateDialog.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Risk summary');
    await user.type(screen.getByLabelText('Prompt'), 'Summarise risks from this transcript.');

    expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attachments: [],
        name: 'Risk summary',
        prompt: 'Summarise risks from this transcript.'
      })
    ]));

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Risk and actions');
    expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Risk and actions' })
    ]));

    await user.click(screen.getByRole('button', { name: 'Delete Risk and actions' }));
    expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Risk and actions' })
    ]));

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(bridge.promptTemplateState.templates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Risk and actions' })
    ]));
  });

  it('auto-renames duplicate prompt template names in the modal', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.type(screen.getByLabelText('Name'), 'CV');
    await user.type(screen.getByLabelText('Prompt'), 'Use the CV context carefully.');

    await waitFor(() => expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'CV 2', prompt: 'Use the CV context carefully.' })
    ])));
    expect(screen.getByRole('button', { name: 'CV 2' })).toHaveAttribute('data-active', 'true');
  });

  it('opens prompt templates without a blocking backdrop', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));

    expect(screen.getByRole('dialog', { name: 'Prompt templates' })).toHaveAttribute('data-state', 'open');
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeInTheDocument();
  });

  it('edits general instructions from the AI toolbar', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Instructions' }));

    const instructionsDialog = screen.getByRole('dialog', { name: 'Instructions' });
    const instructionsInput = within(instructionsDialog).getByRole('textbox', { name: 'Instructions' });
    expect(instructionsDialog).toHaveAttribute('data-state', 'open');
    expect(instructionsDialog).toHaveClass('caul-large-modal-shell', 'h-[85vh]', 'w-[85vw]');
    expect(instructionsInput).toHaveValue('');
    expect(instructionsInput).toHaveAttribute('placeholder', 'e.g. Always answer in British English.');
    expect(screen.queryByRole('button', { name: 'Restore default' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await user.clear(instructionsInput);
    await user.type(instructionsInput, 'Keep the answer concise.');

    await waitFor(() => expect(bridge.portablePreferences.generalInstructions).toBe('Keep the answer concise.'));
    expect(screen.getByRole('dialog', { name: 'Instructions' })).toBeInTheDocument();
  });

  it('keeps blank general instructions as blank defaults', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Instructions' }));
    const instructionsInput = within(screen.getByRole('dialog', { name: 'Instructions' }))
      .getByRole('textbox', { name: 'Instructions' });
    await user.type(instructionsInput, 'Temporary instruction');
    await user.clear(instructionsInput);
    await user.click(screen.getByRole('button', { name: 'Close general instructions' }));
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Discussed renewal timelines.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    const requestTranscript = bridge.llmRequests.at(-1)?.transcript ?? '';
    await waitFor(() => expect(bridge.portablePreferences.generalInstructions).toBe(''));
    expect(requestTranscript).not.toContain('General instructions:');
    expect(requestTranscript).toContain('Discussed renewal timelines.');
  });

  it('does not expose prompt template restoration in the prompt manager', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));

    expect(screen.queryByRole('button', { name: 'Restore defaults' })).not.toBeInTheDocument();
  });

  it('adds prompt template attachments and sends supported files to the LLM', async () => {
    const user = userEvent.setup();
    const attachment = testPromptTemplateAttachment({
      name: 'Diagram.png',
      path: '/tmp/diagram.png'
    });
    const bridge = installTestBridge({
      choosePromptTemplateAttachments: async () => ({
        ok: true,
        attachments: [attachment]
      })
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.type(screen.getByLabelText('Name'), 'Image context');
    await user.type(screen.getByLabelText('Prompt'), 'Use the attached image as context.');
    await user.click(screen.getByRole('button', { name: 'Add files' }));

    expect(await screen.findByText('Diagram.png')).toBeInTheDocument();

    const savedTemplate = bridge.promptTemplateState.templates.find((template) => template.name === 'Image context');
    expect(savedTemplate?.attachments).toEqual([attachment]);

    await user.click(screen.getByRole('button', { name: 'Close prompt templates' }));
    await user.click(await screen.findByRole('button', { name: 'Prompt template' }));
    await user.click(await screen.findByText('Image context'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Prompt template' })).toHaveTextContent('Image context');
    });
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Explain this design.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Send full transcript to AI' }));

    expect(bridge.llmRequests.at(-1)?.attachments).toEqual([attachment]);
  });

  it('prepends the selected prompt template to AI requests', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Prompt template' }));
    await user.click(await screen.findByText('STAR'));
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Discussed renewal timelines.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    const requestTranscript = bridge.llmRequests.at(-1)?.transcript ?? '';
    expect(requestTranscript).toContain('Use STAR when answering interview-style questions.');
    expect(requestTranscript).toContain('Situation: brief context');
    expect(requestTranscript).not.toContain('Use my CV as background context.');
    expect(requestTranscript).not.toContain('Use the position description as role context.');
    expect(requestTranscript).toContain('Transcript:');
    expect(requestTranscript).toContain('Discussed renewal timelines.');
  });

  it('prepends general instructions before prompt templates in AI requests', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Instructions' }));
    const instructionsDialog = screen.getByRole('dialog', { name: 'Instructions' });
    const instructionsInput = within(instructionsDialog).getByRole('textbox', { name: 'Instructions' });
    await user.clear(instructionsInput);
    await user.type(instructionsInput, 'Keep the answer concise.');
    await user.click(screen.getByRole('button', { name: 'Close general instructions' }));
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Discussed renewal timelines.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    const requestTranscript = bridge.llmRequests.at(-1)?.transcript ?? '';
    expect(requestTranscript).toContain('General instructions:\nKeep the answer concise.');
    expect(requestTranscript.indexOf('General instructions:\nKeep the answer concise.')).toBeLessThan(
      requestTranscript.indexOf('Transcript:')
    );
    expect(requestTranscript).toContain('Transcript:');
    expect(requestTranscript).toContain('Discussed renewal timelines.');
  });

  it('sends the visible transcript to the LLM when listening stops', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'What is the refund policy?'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests).toEqual([{
      model: 'openai-codex/gpt-5.4-mini',
      requestId: expect.stringMatching(/^manual-/),
      reasoning: 'off',
      transcript: expect.stringContaining('What is the refund policy?')
    }]);
    expect(screen.queryByLabelText('LLM query')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('AI response')).toHaveTextContent('manual llm answer');
  });

  it('sends manual AI prompts from the AI response panel', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    const promptInput = await screen.findByPlaceholderText('Ask anything');
    const sendButton = screen.getByRole('button', { name: 'Send manual prompt to AI' });

    expect(promptInput).toHaveAttribute('placeholder', 'Ask anything');
    expect(sendButton).toBeDisabled();

    await user.type(promptInput, 'Summarise the last decision.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send manual prompt to AI' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Send manual prompt to AI' }));

    expect(bridge.llmRequests.at(-1)).toEqual({
      model: 'openai-codex/gpt-5.4-mini',
      requestId: expect.stringMatching(/^manual-/),
      reasoning: 'off',
      transcript: expect.stringContaining('Summarise the last decision.')
    });
    expect(promptInput).toHaveValue('');
    expect(await screen.findByLabelText('AI response')).toHaveTextContent('manual llm answer');

    await user.hover(screen.getByRole('button', { name: 'Show AI input' }));

    expect(await screen.findAllByText('AI input')).not.toHaveLength(0);
    expect(screen.getAllByText((content) => content.includes('Summarise the last decision.'))).not.toHaveLength(0);
    expect(document.querySelector('.caul-preview-tooltip')).toHaveClass('pointer-events-auto');
  });

  it('caps the manual AI prompt height to half the AI panel height', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'AI response panel') {
        return {
          bottom: 400,
          height: 400,
          left: 0,
          right: 400,
          top: 0,
          width: 400,
          x: 0,
          y: 0,
          toJSON: () => ({})
        };
      }

      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({})
      };
    });

    installTestBridge();
    render(<App />);

    expect(await screen.findByPlaceholderText('Ask anything')).toHaveStyle({ maxHeight: '200px' });
  });

  it('uses Enter to send manual AI prompts and Shift Enter for multiline input', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    const promptInput = await screen.findByLabelText('Ask AI');

    await user.click(promptInput);
    await user.keyboard('Line one');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.keyboard('Line two');

    expect(promptInput).toHaveValue('Line one\nLine two');
    expect(bridge.llmRequests).toEqual([]);

    await user.keyboard('{Enter}');

    expect(bridge.llmRequests.at(-1)?.transcript).toContain('Line one\nLine two');
    expect(promptInput).toHaveValue('');
  });

  it('does not send the transcript to the LLM when Send to AI is off', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    const autoSend = screen.getByRole('button', { name: 'Auto Send' });
    expect(autoSend).toHaveAttribute('aria-pressed', 'true');

    await user.click(autoSend);
    expect(autoSend).toHaveAttribute('aria-pressed', 'false');
    expect(autoSend).toHaveAccessibleName('Auto Send');
    expect(screen.getByLabelText('AI response')).toHaveTextContent(
      'Auto Send is off.\nManually send a transcript.',
      { normalizeWhitespace: false }
    );

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Do not send this.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests).toEqual([]);
    expect(screen.getByLabelText('AI response')).toHaveTextContent(
      'Auto Send is off.\nManually send a transcript.',
      { normalizeWhitespace: false }
    );
  });

  it('copies the visible transcript from the transcript toolbar', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    render(<App />);

    const disabledCopyButton = screen.getByRole('button', { name: 'Copy full transcript' });
    const disabledSendButton = screen.getByRole('button', { name: 'Send full transcript to AI' });
    expect(disabledCopyButton).toBeDisabled();
    expect(disabledCopyButton).not.toHaveAttribute('title');
    expect(disabledSendButton).toBeDisabled();
    expect(disabledSendButton).not.toHaveAttribute('title');

    await user.hover(disabledCopyButton);
    expect(screen.queryByText('Copy full transcript to clipboard')).not.toBeInTheDocument();
    await user.hover(disabledSendButton);
    expect(screen.queryByText('Send full transcript to AI now')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Copy this transcript.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Copy full transcript' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Copy this transcript.'));
  });

  it('downloads the visible transcript from the transcript toolbar', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:caul-transcript');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    let downloadName = '';
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalCreateElement = document.createElement.bind(document);

    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);

      if (tagName.toLowerCase() === 'a') {
        element.click = click;
        Object.defineProperty(element, 'download', {
          configurable: true,
          get: () => downloadName,
          set: (value) => {
            downloadName = value;
          }
        });
      }

      return element;
    });

    render(<App />);

    expect(screen.getByRole('button', { name: 'Download full transcript' })).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Download this transcript.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Download full transcript' }));
    await user.click(await screen.findByRole('button', { name: 'Text file' }));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadName).toMatch(/^caul-transcript-\d{14}\.txt$/);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:caul-transcript');

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('downloads Word transcripts as docx and preserves line breaks', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:caul-transcript');
    const click = vi.fn();
    let downloadName = '';
    let downloadedBlob: Blob | null = null;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalCreateElement = document.createElement.bind(document);

    URL.createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlob = blob;
      return createObjectURL(blob);
    }) as typeof URL.createObjectURL;
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);

      if (tagName.toLowerCase() === 'a') {
        element.click = click;
        Object.defineProperty(element, 'download', {
          configurable: true,
          get: () => downloadName,
          set: (value) => {
            downloadName = value;
          }
        });
      }

      return element;
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'First line.'
      });
      bridge.emit({
        type: 'completed',
        utteranceId: 2,
        text: 'Second line.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Download full transcript' }));
    await user.click(await screen.findByRole('button', { name: 'Word document' }));

    expect(downloadName).toMatch(/^caul-transcript-\d{14}\.docx$/);
    expect(downloadedBlob).not.toBeNull();
    const blob = downloadedBlob as unknown as Blob;
    const blobText = await blob.text();

    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(blobText).toEqual(expect.stringContaining('Transcript started:'));
    expect(blobText).toEqual(expect.stringContaining('First line.</w:t></w:r></w:p>'));
    expect(blobText).toEqual(expect.stringContaining('Second line.</w:t></w:r></w:p>'));
    expect(click).toHaveBeenCalled();

    URL.createObjectURL = originalCreateObjectURL;
  });

  it('shows the transcript started line only in the transcript section title', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: 'Auto Send' }));
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Keep this line in the section body.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(screen.queryByText(/^Transcript started:/)).not.toBeInTheDocument();
    expect(screen.getByText(currentLongDatePattern())).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Keep this line in the section body.');
    expect(container.querySelector('#transcript-output .transcript-section-header')).toHaveClass('sticky');
    expect(container.querySelector('#transcript-output .transcript-section-header')).toHaveClass('border-y');
  });

  it('sends an existing transcript to the LLM from the transcript toolbar', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Auto Send' }));
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Send this transcript later.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Send full transcript to AI' }));

    expect(bridge.llmRequests).toEqual([{
      model: 'openai-codex/gpt-5.4-mini',
      requestId: expect.stringMatching(/^manual-/),
      reasoning: 'off',
      transcript: expect.stringContaining('Send this transcript later.')
    }]);
    expect(await screen.findByLabelText('AI response')).toHaveTextContent('manual llm answer');
  });

  it('sends the selected model and reasoning to the LLM', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'openai-codex/gpt-5.4-mini',
        status: 'ready'
      })
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'AI responses');
    await user.click(screen.getByRole('tab', { name: 'Cloud' }));
    await selectSetting(user, 'Model', '5.5');
    await selectSetting(user, 'Reasoning', 'Low');
    await waitFor(() => expect(bridge.portablePreferences).toMatchObject({
      llmModel: 'openai-codex/gpt-5.5',
      llmReasoning: 'low'
    }));
    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Summarise the deployment status.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests).toEqual([{
      model: 'openai-codex/gpt-5.5',
      requestId: expect.stringMatching(/^manual-/),
      reasoning: 'low',
      transcript: expect.stringContaining('Summarise the deployment status.')
    }]);
  });

  it('sends the selected local thinking level to Local AI requests', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      localLlmStatus: testReadyLocalLlmStatus()
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'AI responses');
    await selectSetting(user, 'Thinking', 'Low');
    await waitFor(() => expect(bridge.portablePreferences).toMatchObject({
      localLlmReasoning: 'low'
    }));
    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Summarise the local model status.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests).toEqual([{
      model: 'openai-codex/gpt-5.4-mini',
      requestId: expect.stringMatching(/^manual-/),
      reasoning: 'low',
      transcript: expect.stringContaining('Summarise the local model status.')
    }]);
  });

  it('restores model, reasoning and instructions from portable preferences', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      portablePreferences: {
        generalInstructions: 'Prefer concise answers.',
        llmModel: 'openai-codex/gpt-5.5',
        llmReasoning: 'low',
        selectedAiProvider: 'cloud'
      }
    });

    render(<App />);

    await waitFor(() => expect(bridge.portablePreferences.llmModel).toBe('openai-codex/gpt-5.5'));
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Summarise this.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests.at(-1)).toEqual({
      model: 'openai-codex/gpt-5.5',
      requestId: expect.stringMatching(/^manual-/),
      reasoning: 'low',
      transcript: expect.stringContaining('General instructions:\nPrefer concise answers.')
    });
  });

  it('resets settings to their defaults', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'openai-codex/gpt-5.4-mini',
        status: 'ready'
      }),
      promptTemplateState: testPromptTemplateState({
        selectedTemplateIds: ['custom-template'],
        templates: [
          testPromptTemplate({
            id: 'custom-template',
            name: 'Custom template',
            prompt: 'Use my custom instructions.'
          })
        ]
      })
    });

    render(<App />);

    await openSettings(user);
    expect(screen.getByRole('group', { name: 'Advanced' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Onboarding' })).not.toBeInTheDocument();
    expect(screen.queryByText('Restores window size and position, floating button position, model and listening sources, and starter prompt templates.')).not.toBeInTheDocument();
    await openSettingsSection(user, 'AI responses');
    await user.click(screen.getByRole('tab', { name: 'Cloud' }));
    await selectSetting(user, 'Model', '5.5');
    await selectSetting(user, 'Reasoning', 'Low');
    await openSettingsSection(user, 'General');

    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));

    expect(bridge.settingsResets).toBe(0);
    expect(screen.getByRole('dialog', { name: 'Reset settings?' })).toBeInTheDocument();
    expect(screen.getByText('This will restore:')).toBeInTheDocument();
    expect(screen.getByText('Window size and location')).toBeInTheDocument();
    expect(screen.getByText('Floating button position')).toBeInTheDocument();
    expect(screen.getByText('Model and listening sources')).toBeInTheDocument();
    expect(screen.getByText('Starter prompt templates')).toBeInTheDocument();
    expect(screen.getByText('Your user prompt templates will be backed up to /Users/alex/Documents/Caul/Backups/prompts/, then removed from active prompts.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));

    expect(bridge.settingsResets).toBe(1);
    expect(screen.queryByRole('checkbox', { name: 'Microphone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Speaker' })).not.toBeInTheDocument();
    expect(bridge.promptTemplateState.selectedTemplateIds).toEqual([]);
    expect(bridge.promptTemplateState.templates).toEqual([
      expect.objectContaining({ id: 'starter-answer-with-star' }),
      expect.objectContaining({ id: 'starter-use-my-cv' }),
      expect.objectContaining({ id: 'starter-job-description' })
    ]);

    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Use the defaults.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.starts.at(-1)).toEqual({ sources: ['system'] });
    expect(bridge.llmRequests.at(-1)).toEqual({
      model: 'openai-codex/gpt-5.4-mini',
      requestId: expect.stringMatching(/^manual-/),
      reasoning: 'off',
      transcript: expect.stringContaining('Use the defaults.')
    });
  });

  it('removes customised starter prompt templates from active prompts when settings reset', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      promptTemplateState: testPromptTemplateState({
        templates: [
          testPromptTemplate({
            id: 'starter-use-my-cv',
            name: 'My CV',
            prompt: 'Use my edited CV instructions.'
          })
        ]
      })
    });

    render(<App />);

    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));
    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));

    expect(bridge.promptTemplateState.selectedTemplateIds).toEqual([]);
    expect(bridge.promptTemplateState.templates).toEqual(starterTestPromptTemplates());
  });

  it('keeps existing prompt templates active when settings reset fails', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      resetSettings: async () => {
        throw new Error('Prompt backup failed.');
      },
      promptTemplateState: testPromptTemplateState({
        selectedTemplateIds: ['custom-template'],
        templates: [
          testPromptTemplate({
            id: 'custom-template',
            name: 'Custom template',
            prompt: 'Use my custom instructions.'
          })
        ]
      })
    });

    render(<App />);

    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));
    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));

    expect(screen.getByRole('dialog', { name: 'Reset settings?' })).toBeInTheDocument();
    expect(bridge.promptTemplateState.selectedTemplateIds).toEqual(['custom-template']);
    expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-template', name: 'Custom template' })
    ]));
  });

  it('shows update settings with weekly default and manual check action', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    expect(screen.getByRole('group', { name: 'Caul updates' })).toBeInTheDocument();
    expect(screen.getByLabelText('Automatic checks')).toHaveTextContent('Weekly');
    expect(screen.getByText('Caul Beta 0.1.8 · Beta')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check now' }));

    await waitFor(() => expect(bridge.updateChecks).toBe(1));
    expect(await screen.findByText(/Caul is up to date\./)).toBeInTheDocument();

    await selectSetting(user, 'Automatic checks', 'Daily');

    expect(bridge.updateFrequencyChanges).toEqual(['daily']);
  });

  it('shows stable and dev app identity in update settings', async () => {
    const user = userEvent.setup();

    installTestBridge();
    render(<App />);
    await openSettings(user);
    await openSettingsSection(user, 'General');
    expect(await screen.findByText('Caul Beta 0.1.8 · Beta')).toBeInTheDocument();
    cleanup();

    installTestBridge({
      updateStatus: testUpdateStatus({
        appChannel: 'stable',
        appName: 'Caul'
      })
    });
    render(<App />);
    await openSettings(user);
    await openSettingsSection(user, 'General');
    expect(await screen.findByText('Caul 0.1.8 · Stable')).toBeInTheDocument();
    cleanup();

    installTestBridge({
      updateStatus: testUpdateStatus({
        appChannel: 'dev',
        appName: 'Caul Dev'
      })
    });
    render(<App />);
    await openSettings(user);
    await openSettingsSection(user, 'General');
    expect(await screen.findByText('Caul Dev 0.1.8 · Dev')).toBeInTheDocument();
    cleanup();

    installTestBridge({
      updateStatus: testUpdateStatus({
        appChannel: 'dev-private',
        appName: 'Caul Dev-Private'
      })
    });
    render(<App />);
    await openSettings(user);
    await openSettingsSection(user, 'General');
    expect(await screen.findByText('Caul Dev-Private 0.1.8 · Dev-Private')).toBeInTheDocument();
  });

  it('shows update download progress outside the update action row', async () => {
    const user = userEvent.setup();
    installTestBridge({
      updateStatus: testUpdateStatus({
        availableUpdate: {
          prerelease: false,
          releaseName: 'Caul 0.1.9',
          version: '0.1.9'
        },
        downloading: true,
        lastResult: {
          ok: true,
          status: 'downloading',
          message: 'Downloading update 42%',
          progress: {
            percent: 42,
            transferred: 42,
            total: 100
          }
        }
      })
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
    expect(screen.getByText(/^Last checked: Never\.$/)).toBeInTheDocument();
    expect(screen.getByText('Downloading update 42%')).toBeInTheDocument();
    expect(screen.queryByText(/Last checked: Never\. Downloading update 42%/)).not.toBeInTheDocument();
  });

  it('hides the update download button once the update is downloaded', async () => {
    const user = userEvent.setup();
    installTestBridge({
      updateStatus: testUpdateStatus({
        availableUpdate: {
          prerelease: false,
          releaseName: 'Caul 0.1.9',
          version: '0.1.9'
        },
        lastResult: {
          ok: true,
          status: 'ready',
          message: 'Update downloaded. Restart Caul to install it.'
        }
      })
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');

    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart to update' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release Page' })).toBeInTheDocument();
  });

  it('shows restart progress immediately after clicking restart to update', async () => {
    const user = userEvent.setup();
    installTestBridge({
      updateStatus: testUpdateStatus({
        availableUpdate: {
          prerelease: false,
          releaseName: 'Caul 0.1.9',
          version: '0.1.9'
        },
        lastResult: {
          ok: true,
          status: 'ready',
          message: 'Update downloaded. Restart Caul to install it.'
        }
      })
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'General');
    await user.click(screen.getByRole('button', { name: 'Restart to update' }));

    expect(await screen.findByRole('button', { name: 'Restarting...' })).toBeDisabled();
  });

  it('shows a quiet main notification for app updates and opens General', async () => {
    const user = userEvent.setup();
    installTestBridge({
      updateStatus: testUpdateStatus({
        availableUpdate: {
          prerelease: false,
          releaseName: 'Caul 0.1.9',
          version: '0.1.9'
        },
        lastResult: {
          ok: true,
          status: 'available',
          message: 'Caul 0.1.9 is available.'
        }
      })
    });

    render(<App />);

    const notificationsButton = await screen.findByRole('button', { name: 'Caul notifications' });
    expect(notificationsButton).toHaveAttribute('data-notification-tone', 'attention');

    await user.click(notificationsButton);
    await user.click(await screen.findByRole('button', { name: 'App update available' }));

    expect(await screen.findByRole('group', { name: 'Caul updates' })).toBeInTheDocument();
  });

  it('shows an error main notification for missing transcription model setup and opens Transcription', async () => {
    const user = userEvent.setup();
    installTestBridge({
      parakeetStatus: testParakeetStatus({
        installed: false,
        status: 'missing'
      })
    });

    render(<App />);

    const notificationsButton = await screen.findByRole('button', { name: 'Caul notifications' });
    expect(notificationsButton).toHaveAttribute('data-notification-tone', 'error');

    await user.click(notificationsButton);
    await user.click(await screen.findByRole('button', { name: 'Transcription model needs setup' }));

    expect(await screen.findByRole('group', { name: 'Local transcription' })).toBeInTheDocument();
  });

  it('streams AI response deltas while the request is still running', async () => {
    const user = userEvent.setup();
    const streamedRequests: string[] = [];
    let resolveRequest: ((value: { ok: boolean; text: string }) => void) | null = null;
    const bridge = installTestBridge({
      requestLlm: async ({ transcript }) => {
        streamedRequests.push(transcript);

        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      }
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'What is the refund policy?'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    act(() => {
      bridge.emit({ type: 'llm-response-delta', text: 'Refunds ' });
      bridge.emit({ type: 'llm-response-delta', text: 'take 30 days.' });
    });

    expect(streamedRequests).toEqual([expect.stringContaining('What is the refund policy?')]);
    expect(screen.getByLabelText('AI response')).toHaveTextContent('Refunds take 30 days.');

    act(() => {
      resolveRequest?.({ ok: true, text: 'Refunds take 30 days.' });
    });
  });

  it('shows normal loading state before the first local AI delta arrives', async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: { ok: boolean; text: string }) => void) | null = null;
    const bridge = installTestBridge({
      requestLlm: async () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Summarise this call.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await waitFor(() => {
      expect(screen.getByLabelText('AI response')).not.toHaveTextContent('Preparing local AI...');
    });
    expect(screen.getByLabelText('Waiting for response')).toBeInTheDocument();

    act(() => {
      bridge.emit({ type: 'llm-response-delta', text: 'Summary ready.' });
    });

    expect(screen.getByLabelText('AI response')).toHaveTextContent('Summary ready.');

    act(() => {
      resolveRequest?.({ ok: true, text: 'Summary ready.' });
    });
  });

  it('collapses prior transcript sections when a new session starts', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    const { container } = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'First transcript body.'
      });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 2,
        text: 'Second transcript body.'
      });
    });

    const transcriptArticles = container.querySelectorAll('#transcript-output [data-transcript-session-id]');
    const firstTranscriptArticle = transcriptArticles[0] as HTMLElement;
    const secondTranscriptArticle = transcriptArticles[1] as HTMLElement;

    expect(transcriptArticles).toHaveLength(2);
    expect(within(firstTranscriptArticle).getByRole('button', { name: 'Expand transcript section' })).toBeInTheDocument();
    expect(firstTranscriptArticle).not.toHaveTextContent('First transcript body.');
    expect(within(firstTranscriptArticle).getByRole('button', { name: 'Copy this transcript' })).toBeEnabled();
    expect(within(firstTranscriptArticle).getByRole('button', { name: 'Download this transcript' })).toBeEnabled();
    expect(within(firstTranscriptArticle).getByRole('button', { name: 'Send this transcript to AI' })).toBeEnabled();
    expect(firstTranscriptArticle.querySelector('.transcript-section-header')).not.toHaveClass('sticky');
    expect(secondTranscriptArticle).toHaveAttribute('data-transcript-session-active', 'true');
    expect(secondTranscriptArticle).not.toHaveClass('min-h-full');
    expect(secondTranscriptArticle.querySelector('.transcript-section-header')).toHaveClass('sticky');
    expect(within(secondTranscriptArticle).getByRole('button', { name: 'Collapse transcript section' })).toBeInTheDocument();
    expect(secondTranscriptArticle).toHaveTextContent('Second transcript body.');
  });

  it('keeps manually expanded older transcript sections expanded after later sessions', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    const { container } = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 1, text: 'Manually expanded transcript.' });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 2, text: 'Middle transcript.' });
    });
    await user.click(within(container.querySelectorAll('#transcript-output [data-transcript-session-id]')[0] as HTMLElement).getByRole('button', { name: 'Expand transcript section' }));
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 3, text: 'Newest transcript.' });
    });

    const firstTranscriptArticle = container.querySelectorAll('#transcript-output [data-transcript-session-id]')[0] as HTMLElement;

    expect(firstTranscriptArticle).toHaveTextContent('Manually expanded transcript.');
    expect(within(firstTranscriptArticle).getByRole('button', { name: 'Collapse transcript section' })).toBeInTheDocument();
  });

  it('collapses prior AI responses when a new request starts', async () => {
    const user = userEvent.setup();
    let requestCount = 0;
    const bridge = installTestBridge({
      requestLlm: async () => {
        requestCount += 1;

        if (requestCount === 1) {
          return { ok: true, text: 'First AI answer.' };
        }

        return { ok: true, text: 'Second AI answer.' };
      }
    });

    const { container } = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'First transcript.'
      });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));
    expect(await screen.findByText('First AI answer.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 2,
        text: 'Second transcript.'
      });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));
    expect(await screen.findByText('Second AI answer.')).toBeInTheDocument();

    const aiArticles = container.querySelectorAll('#llm-output [data-ai-response-id]');
    const firstAiArticle = aiArticles[0] as HTMLElement;
    const activeAiArticle = container.querySelector('#llm-output [data-ai-response-active="true"]') as HTMLElement;

    expect(aiArticles).toHaveLength(2);
    expect(firstAiArticle).not.toHaveTextContent('First AI answer.');
    expect(within(firstAiArticle).getByRole('button', { name: 'Expand AI response' })).toBeInTheDocument();
    expect(within(firstAiArticle).getByRole('button', { name: 'Copy this AI response' })).toBeEnabled();
    expect(within(firstAiArticle).getByRole('button', { name: 'Download this AI response' })).toBeEnabled();
    expect(firstAiArticle.querySelector('.transcript-section-header')).not.toHaveClass('sticky');
    expect(activeAiArticle).toHaveTextContent('Second AI answer.');
    expect(activeAiArticle).not.toHaveClass('min-h-full');
    expect(activeAiArticle.querySelector('.transcript-section-header')).toHaveClass('sticky');
    expect(within(activeAiArticle).getByRole('button', { name: 'Collapse AI response' })).toBeInTheDocument();
    expect(activeAiArticle).toHaveAttribute('data-ai-response-id', expect.stringMatching(/^ai-response-/));
    expect(activeAiArticle).not.toHaveAttribute('data-ai-response-id', 'live-ai-response');
  });

  it('keeps manually expanded older AI responses expanded after later requests', async () => {
    const user = userEvent.setup();
    let requestCount = 0;
    const bridge = installTestBridge({
      requestLlm: async () => {
        requestCount += 1;

        return { ok: true, text: `AI answer ${requestCount}.` };
      }
    });
    const { container } = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 1, text: 'First transcript.' });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));
    expect(await screen.findByText('AI answer 1.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 2, text: 'Second transcript.' });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));
    expect(await screen.findByText('AI answer 2.')).toBeInTheDocument();
    await user.click(within(container.querySelectorAll('#llm-output [data-ai-response-id]')[0] as HTMLElement).getByRole('button', { name: 'Expand AI response' }));

    await user.click(screen.getByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 3, text: 'Third transcript.' });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));
    expect(await screen.findByText('AI answer 3.')).toBeInTheDocument();

    const firstAiArticle = container.querySelectorAll('#llm-output [data-ai-response-id]')[0] as HTMLElement;

    expect(firstAiArticle).toHaveTextContent('AI answer 1.');
    expect(within(firstAiArticle).getByRole('button', { name: 'Collapse AI response' })).toBeInTheDocument();
  });

  it('leaves older sections expanded when both Auto-collapse settings are off', async () => {
    const user = userEvent.setup();
    let requestCount = 0;
    const bridge = installTestBridge({
      requestLlm: async () => {
        requestCount += 1;

        return { ok: true, text: `Expanded AI answer ${requestCount}.` };
      }
    });

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'Transcription');
    await user.click(screen.getByRole('checkbox', { name: 'Auto-collapse' }));
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).not.toBeChecked();
    await waitFor(() => expect(bridge.portablePreferences.autoCollapseTranscription).toBe(false));

    await openSettingsSection(user, 'AI responses');
    await user.click(screen.getByRole('checkbox', { name: 'Auto-collapse' }));
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).not.toBeChecked();
    await waitFor(() => expect(bridge.portablePreferences.autoCollapseAiResponses).toBe(false));
    await openHome(user);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 1, text: 'Expanded first transcript.' });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));
    expect(await screen.findByText('Expanded AI answer 1.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({ type: 'completed', utteranceId: 2, text: 'Expanded second transcript.' });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));
    expect(await screen.findByText('Expanded AI answer 2.')).toBeInTheDocument();

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Expanded first transcript.');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Expanded second transcript.');
    expect(screen.getByLabelText('AI response')).toHaveTextContent('Expanded AI answer 1.');
    expect(screen.getByLabelText('AI response')).toHaveTextContent('Expanded AI answer 2.');
  });

  it('defaults Auto-collapse on and restores it when settings reset', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await openSettingsSection(user, 'Transcription');
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Auto-collapse' }));
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).not.toBeChecked();
    await waitFor(() => expect(bridge.portablePreferences.autoCollapseTranscription).toBe(false));

    await openSettingsSection(user, 'AI responses');
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Auto-collapse' }));
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).not.toBeChecked();
    await waitFor(() => expect(bridge.portablePreferences.autoCollapseAiResponses).toBe(false));

    await openSettingsSection(user, 'General');
    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));
    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));

    await openSettingsSection(user, 'Transcription');
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).toBeChecked();
    await openSettingsSection(user, 'AI responses');
    expect(screen.getByRole('checkbox', { name: 'Auto-collapse' })).toBeChecked();
    await waitFor(() => expect(bridge.portablePreferences.autoCollapseTranscription).toBe(true));
    await waitFor(() => expect(bridge.portablePreferences.autoCollapseAiResponses).toBe(true));
  });

  it('clears transcript and AI response feeds from the global action toolbar', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Clear this transcript.'
      });
    });
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(await screen.findByText('manual llm answer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Prompt template hint')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Clear this transcript.');

    await user.click(screen.getByRole('button', { name: 'Clear transcript feed' }));
    expect(screen.getByText('Clear transcript?')).toBeInTheDocument();
    expect(screen.getByText('This removes the transcript from this session.')).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Clear this transcript.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Clear transcript?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Clear this transcript.');

    await user.click(screen.getByRole('button', { name: 'Clear transcript feed' }));
    await user.click(screen.getByRole('button', { name: 'Clear transcript' }));
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent(
      'Your live transcript will appear here once you start listening.'
    );
    expect(screen.getByLabelText('Start Listening hint')).toHaveTextContent(
      'Click Start Listening while playing something through your speakers or headphones.'
    );

    await user.click(screen.getByRole('button', { name: 'Clear AI response feed' }));
    expect(screen.getByText('Clear AI responses?')).toBeInTheDocument();
    expect(screen.getByText('This removes all AI responses from this session.')).toBeInTheDocument();
    expect(screen.getByLabelText('AI response')).toHaveTextContent('manual llm answer');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Clear AI responses?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('AI response')).toHaveTextContent('manual llm answer');

    await user.click(screen.getByRole('button', { name: 'Clear AI response feed' }));
    await user.click(screen.getByRole('button', { name: 'Clear responses' }));
    expect(screen.getByLabelText('AI response')).toHaveTextContent(
      'Auto Send is on.\nStop listening to send transcript to AI',
      { normalizeWhitespace: false }
    );
    expect(screen.getByLabelText('Prompt template hint')).toHaveTextContent(
      'Pick a prompt template or customise one to change how AI responds.'
    );
  });

  it('renders AI response markdown formatting', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      requestLlm: async () => ({
        ok: true,
        text: '## Refund policy\n\n**Annual plans** are refundable within 30 days.'
      })
    });

    const { container } = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'What is the refund policy?'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(await screen.findByRole('heading', { name: 'Refund policy' })).toBeInTheDocument();
    expect(screen.getByLabelText('AI response')).toHaveTextContent(currentLongDatePattern());
    expect(screen.getByRole('button', { name: 'Copy this AI response' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download this AI response' })).toBeEnabled();
    expect(screen.getByText('Annual plans').tagName.toLowerCase()).toBe('strong');
    expect(container.querySelector('#llm-output .transcript-section-header')).toHaveClass('sticky');
    expect(container.querySelector('#llm-output .transcript-section-header')).toHaveClass('border-y');
  });

  it('does not show noisy loading text while waiting for the first cloud LLM token', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      portablePreferences: {
        selectedAiProvider: 'cloud'
      },
      requestLlm: async () => new Promise(() => undefined)
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'What is the refund policy?'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(screen.getByLabelText('AI response')).toHaveTextContent(currentLongDatePattern());
    expect(screen.queryByText('Waiting for response...')).not.toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('does not send an LLM request when stopped with no transcript', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests).toEqual([]);
  });

  it('waits for stop to flush completed transcript before sending it to the LLM', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      stop: async (emit) => {
        emit({
          type: 'completed',
          utteranceId: 1,
          text: 'final flushed transcript'
        });

        return { ok: true };
      }
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'partial',
        utteranceId: 1,
        text: 'partial transcript before stop'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('partial transcript before stop');
    expect(getTranscriptDraftTail()).toHaveTextContent('partial transcript before stop');

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await waitFor(() => {
      expect(bridge.llmRequests.at(-1)?.transcript).toContain('final flushed transcript');
    });
    expect(bridge.llmRequests.at(-1)?.transcript).not.toContain('partial transcript before stop');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('final flushed transcript');
    expect(getTranscriptDraftTail()).toBeNull();
  });

  it('does not send diagnostic partial text as the stop fallback when no final chunk arrives', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'partial',
        utteranceId: 1,
        text: 'partial transcript survives stop'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('partial transcript survives stop');
    expect(getTranscriptDraftTail()).toHaveTextContent('partial transcript survives stop');

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests).toEqual([]);
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent(
      'Your live transcript will appear here once you start listening.'
    );
  });

  it('marks primary toolbar controls for compact viewport sizing', async () => {
    installTestBridge({
      privateOverlayState: testPrivateOverlayStateForEdge('top')
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Home layout')).toHaveAttribute('data-home-toolbar-edge', 'top');
    });

    const toolbar = await screen.findByLabelText('Home actions');
    const transcriptSection = toolbar.querySelector('[data-toolbar-section="transcript"]');
    const aiSection = toolbar.querySelector('[data-toolbar-section="ai"]');

    expect(transcriptSection).toBeInTheDocument();
    expect(aiSection).toBeInTheDocument();

    const transcriptQueries = within(transcriptSection as HTMLElement);
    const aiQueries = within(aiSection as HTMLElement);
    const startButton = transcriptQueries.getByRole('button', { name: 'Start Listening' });
    const templateButton = aiQueries.getByRole('button', { name: 'Prompt template' });

    expect(toolbar).toHaveClass('h-12');
    expect(startButton).toHaveClass('compact-toolbar-button');
    expect(startButton).toHaveClass('w-[140px]');
    expect(templateButton).toHaveClass('prompt-template-trigger', 'w-full');
    expect(templateButton.querySelector('.prompt-template-trigger-icon')).toBeInTheDocument();
    expect(templateButton.querySelector('.prompt-template-trigger-label')).toBeInTheDocument();
    expect(templateButton.querySelector('.prompt-template-trigger-chevron')).toBeInTheDocument();
  });

  it('appends local confirmed transcription and keeps it after stopping', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    const startButton = await screen.findByRole('button', { name: 'Start Listening' });

    expect(startButton).toHaveClass('compact-toolbar-button');

    await user.click(startButton);

    const stopButton = await screen.findByRole('button', { name: 'Stop Listening' });

    expect(stopButton).toBeInTheDocument();
    expect(stopButton).toHaveClass('compact-toolbar-button');

    act(() => {
      bridge.emit({
        type: 'partial',
        utteranceId: 1,
        text: 'volatile local transcript'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('volatile local transcript');
    expect(getTranscriptDraftTail()).toHaveTextContent('volatile local transcript');

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'confirmed local transcript'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('confirmed local transcript');
    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('volatile local transcript');
    expect(getTranscriptDraftTail()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('confirmed local transcript');
  });

  it('does not replace local confirmed text with volatile partials', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        text: 'a longer confirmed transcript line'
      });
      bridge.emit({
        type: 'partial',
        utteranceId: 2,
        text: 'next words'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('a longer confirmed transcript line');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('next words');
    expect(getTranscriptDraftTail()).toHaveTextContent('next words');
  });

  it('renders confirmed chunks as timestamped transcript lines', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'first chunk'
      });
      bridge.emit({
        type: 'completed',
        utteranceId: 2,
        text: 'second chunk'
      });
      bridge.emit({
        type: 'partial',
        utteranceId: 3,
        text: 'third preview'
      });
    });

    const output = screen.getByLabelText('Transcription output').textContent ?? '';
    expect(output).not.toContain('Transcript started:');
    expect(output).toContain('first chunk');
    expect(output).toContain('second chunk');
    expect(output).toContain('third preview');
    expect(getTranscriptDraftTail()).toHaveTextContent('third preview');
  });

  it('appends overlapping confirmed transcript chunks without renderer cleanup', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'I can see why fans would vote Tally and be'
      });
      bridge.emit({
        type: 'completed',
        utteranceId: 2,
        text: 'Tally and be, I mean Tally would have such a pivotal role.'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('I can see why fans would vote Tally and be');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Tally and be, I mean Tally would have such a pivotal role.');
  });

  it('preserves dangling one-letter chunk fragments from Parakeet output', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: "rappers don't have the greatest track record with gay humour and b"
      });
      bridge.emit({
        type: 'completed',
        utteranceId: 2,
        text: 'But like you could see somebody overreacting to that.'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent("rappers don't have the greatest track record with gay humour and b");
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('But like you could see somebody overreacting to that.');
  });

  it('shows local partial text until a final chunk arrives', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'partial',
        utteranceId: 1,
        text: 'the rolling preview'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('the rolling preview');
    expect(getTranscriptDraftTail()).toHaveTextContent('the rolling preview');

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'the final sentence is ready'
      });
    });

    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('the rolling preview');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('the final sentence is ready');
    expect(getTranscriptDraftTail()).toBeNull();
  });

  it('ignores a longer diagnostic partial when its final transcript arrives', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'partial',
        utteranceId: 1,
        startMs: 0,
        endMs: 2_000,
        text: 'this is a longer live partial transcript'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('this is a longer live partial transcript');
    expect(getTranscriptDraftTail()).toHaveTextContent('this is a longer live partial transcript');

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'this is final'
      });
    });

    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('this is a longer live partial transcript');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('this is final');
    expect(getTranscriptDraftTail()).toBeNull();
  });

  it('replaces very early timed partials as newer draft text arrives', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        endMs: 700,
        startMs: 0,
        text: 'unstable first guess',
        type: 'partial',
        utteranceId: 1
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('unstable first guess');
    expect(getTranscriptDraftTail()).toHaveTextContent('unstable first guess');

    act(() => {
      bridge.emit({
        endMs: 1600,
        startMs: 0,
        text: 'more stable first phrase',
        type: 'partial',
        utteranceId: 1
      });
    });

    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('unstable first guess');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('more stable first phrase');
    expect(getTranscriptDraftTail()).toHaveTextContent('more stable first phrase');
  });

  it('saves transcript and AI response snapshots to HTML history', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        endMs: 1200,
        startMs: 0,
        text: 'history transcript line',
        type: 'completed',
        utteranceId: 1
      });
    });

    await waitFor(() => expect(bridge.historySessionSaves.some((save) => (
      save.transcript?.includes('history transcript line')
    ))).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await waitFor(() => expect(bridge.historySessionSaves.some((save) => (
      save.aiResponses?.some((response) => (
        response.request.includes('history transcript line')
        && response.response === 'manual llm answer'
      ))
    ))).toBe(true));
  });

  it('keeps Start Listening enabled and shows an AI issue until cloud AI is ready', async () => {
    const user = userEvent.setup();
    let emitLlmStatus: ((status: { ok: boolean; ready: boolean; status: 'warming' | 'ready' | 'error' | 'disabled' }) => void) | null = null;
    let resolveLogin!: (value: { ok: boolean }) => void;
    const bridge = installTestBridge({
      llmReady: false,
      openChatGptLogin: () => new Promise((resolve) => {
        resolveLogin = resolve;
      }),
      portablePreferences: {
        selectedAiProvider: 'cloud'
      },
      onLlmStatus: (callback) => {
        emitLlmStatus = callback;

        return () => {
          emitLlmStatus = null;
        };
      }
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Start Listening' })).not.toBeDisabled();
    expect(await screen.findByText('Cloud AI needs sign-in before AI responses can work.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Local' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cloud' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send manual prompt to AI' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));

    expect(bridge.chatGptLoginOpens).toBe(1);
    expect(await screen.findByRole('button', { name: 'Opening' })).toBeDisabled();

    act(() => {
      resolveLogin({ ok: true });
    });

    act(() => {
      emitLlmStatus?.({
        ok: true,
        ready: true,
        status: 'ready'
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('Cloud AI needs sign-in before AI responses can work.')).not.toBeInTheDocument();
    });
  });

  it('shows a local AI setup issue without blocking transcription', async () => {
    const user = userEvent.setup();
    let resolveDownload!: (status: LocalLlmStatus) => void;
    const bridge = installTestBridge({
      downloadLocalAi: () => new Promise((resolve) => {
        resolveDownload = resolve;
      }),
      llmReady: false,
      localLlmStatus: testLocalLlmStatus()
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Start Listening' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Auto Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send manual prompt to AI' })).toBeDisabled();
    expect(screen.getByLabelText('AI response')).toHaveTextContent('Local AI needs setup before AI responses can work.');
    expect(screen.queryByRole('tab', { name: 'Local' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cloud' })).not.toBeInTheDocument();
    const localSetup = screen.getByRole('group', { name: 'Local AI setup' });
    expect(within(localSetup).getByRole('button', { name: 'Download local AI' })).toBeInTheDocument();
    expect(within(localSetup).queryByText('Not downloaded yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Swap to Cloud' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Prompt template hint')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download local AI' }));

    expect(await screen.findByText('Requesting local AI download...')).toBeInTheDocument();

    act(() => {
      bridge.emitLocalLlmStatus(testLocalLlmStatus({
        progress: {
          downloadedBytes: 42,
          label: 'Downloading local AI',
          percent: 42,
          phase: 'model',
          totalBytes: 100
        },
        status: 'downloading'
      }));
    });

    expect(await screen.findByText('Local AI is downloading before AI responses can work.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(await screen.findByText('Downloading local AI model · 42% · 42 B of 100 B')).toBeInTheDocument();

    act(() => {
      resolveDownload(testReadyLocalLlmStatus());
    });

    await waitFor(() => {
      expect(bridge.localLlmDownloads).toBe(1);
      expect(screen.queryByText('Local AI needs setup before AI responses can work.')).not.toBeInTheDocument();
    });
  });

  it('offers to swap to Cloud when Local AI is unavailable and Cloud is ready', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      localLlmStatus: testLocalLlmStatus(),
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'gpt-5.4',
        status: 'ready'
      })
    });

    render(<App />);

    expect(await screen.findByText('Local AI needs setup before AI responses can work.')).toBeInTheDocument();
    const localSetup = screen.getByRole('group', { name: 'Local AI setup' });
    expect(within(localSetup).getByRole('button', { name: 'Download local AI' })).toBeInTheDocument();
    expect(within(localSetup).getByRole('button', { name: 'Local AI recommendation details' })).toBeInTheDocument();
    await user.hover(within(localSetup).getByRole('button', { name: 'Local AI recommendation details' }));
    expect((await screen.findAllByText('Why Local')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Local AI keeps prompts and transcript context on this computer, but it needs a model download and may be slower than Cloud.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Local AI tradeoff details' })).not.toBeInTheDocument();
    expect(within(localSetup).queryByText('Not downloaded yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap to Cloud' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cloud AI tradeoff details' })).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Local' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cloud' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Swap to Cloud' }));

    await waitFor(() => {
      expect(bridge.selectedAiProviders).toEqual(['cloud']);
      expect(screen.queryByText('Local AI needs setup before AI responses can work.')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Auto Send' })).toBeEnabled();
    expect(screen.getByLabelText('Ask AI')).not.toBeDisabled();
  });

  it('hides the Cloud swap while local AI is downloading from the issue panel', async () => {
    const user = userEvent.setup();
    let resolveDownload!: (status: LocalLlmStatus) => void;
    installTestBridge({
      downloadLocalAi: () => new Promise((resolve) => {
        resolveDownload = resolve;
      }),
      localLlmStatus: testLocalLlmStatus(),
      piStatus: testPiStatus({
        connected: true,
        selectedModel: 'gpt-5.4',
        status: 'ready'
      })
    });

    render(<App />);

    expect(await screen.findByText('Local AI needs setup before AI responses can work.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap to Cloud' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download local AI' }));

    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Swap to Cloud' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Local AI tradeoff details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cloud AI tradeoff details' })).not.toBeInTheDocument();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
    expect(await screen.findByText('Requesting local AI download...')).toBeInTheDocument();

    act(() => {
      resolveDownload(testReadyLocalLlmStatus());
    });

    await waitFor(() => {
      expect(screen.queryByText('Local AI needs setup before AI responses can work.')).not.toBeInTheDocument();
    });
  });

  it('offers to swap to Local when Cloud AI is unavailable and Local is ready', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      llmReady: false,
      localLlmStatus: testReadyLocalLlmStatus(),
      portablePreferences: {
        selectedAiProvider: 'cloud'
      }
    });

    render(<App />);

    expect(await screen.findByText('Cloud AI needs sign-in before AI responses can work.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Swap to Local' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Swap to Local' }));

    await waitFor(() => {
      expect(bridge.selectedAiProviders).toEqual(['local']);
      expect(screen.queryByText('Cloud AI needs sign-in before AI responses can work.')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Auto Send' })).toBeEnabled();
    expect(screen.getByLabelText('Ask AI')).not.toBeDisabled();
  });

  it('shows local AI warm-up status above the AI placeholder', async () => {
    const bridge = installTestBridge({
      localLlmStatus: testLocalLlmStatus()
    });

    render(<App />);

    await screen.findByText('Local AI needs setup before AI responses can work.');

    act(() => {
      bridge.emitLocalLlmStatus(testReadyLocalLlmStatus({ status: 'warming' }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('AI response')).toHaveTextContent('Preparing local AI...');
    });
    expect(screen.getByLabelText('AI response')).toHaveTextContent(
      'Auto Send is on.\nStop listening to send transcript to AI',
      { normalizeWhitespace: false }
    );
  });

  it('updates the local AI placeholder status when warm-up completes', async () => {
    const bridge = installTestBridge({
      localLlmStatus: testReadyLocalLlmStatus({ status: 'warming' })
    });

    render(<App />);

    act(() => {
      bridge.emitLocalLlmStatus(testReadyLocalLlmStatus({ status: 'warm' }));
    });

    expect(await screen.findByText('Local AI ready')).toBeInTheDocument();
  });

  it('keeps Start Listening enabled while local AI is warming', async () => {
    installTestBridge({
      llmReady: false
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Start Listening' })).not.toBeDisabled();
  });

  it('allows listening when packaged AI bridge is disabled', async () => {
    installTestBridge({
      llmStatus: {
        ok: true,
        ready: false,
        status: 'disabled'
      }
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Start Listening' })).not.toBeDisabled();
  });

  it('keeps speculative LLM text hidden until matching transcript is stopped', async () => {
    vi.stubEnv('VITE_CAUL_SPECULATIVE_LLM', '1');
    vi.stubEnv('VITE_CAUL_SPECULATIVE_LLM_DELAY_MS', '20');
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'What is the refund policy?'
      });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const speculativeRequest = bridge.llmRequests.at(-1);
    expect(speculativeRequest?.requestId).toMatch(/^speculative-/);

    act(() => {
      bridge.emit({
        requestId: speculativeRequest?.requestId,
        text: 'Hidden answer ',
        type: 'llm-response-delta'
      });
      bridge.emit({
        requestId: speculativeRequest?.requestId,
        text: 'Hidden answer final.',
        type: 'llm-response'
      });
    });

    expect(screen.getByLabelText('AI response')).toHaveTextContent(
      'Auto Send is on.\nStop listening to send transcript to AI',
      { normalizeWhitespace: false }
    );

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(screen.getByLabelText('AI response')).toHaveTextContent('manual llm answer');
  });

  it('falls back to a normal LLM request when speculative transcript is stale', async () => {
    vi.stubEnv('VITE_CAUL_SPECULATIVE_LLM', '1');
    vi.stubEnv('VITE_CAUL_SPECULATIVE_LLM_DELAY_MS', '200');
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'What is the refund policy?'
      });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 225));
    });

    const speculativeRequest = bridge.llmRequests.at(-1);
    expect(speculativeRequest?.requestId).toMatch(/^speculative-/);

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 2,
        text: 'For annual plans?'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await waitFor(() => {
      expect(bridge.llmRequests.at(-1)?.requestId).toMatch(/^manual-/);
    });

    expect(bridge.llmRequests.at(-1)).toMatchObject({
      transcript: expect.stringContaining('What is the refund policy?')
    });
    expect(bridge.llmRequests.at(-1)?.transcript).toContain('For annual plans?');
  });
});

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Caul Settings' }));
  await screen.findByRole('navigation', { name: 'Settings sections' });
}

async function openSettingsSection(user: ReturnType<typeof userEvent.setup>, section: 'General' | 'Transcription' | 'AI responses') {
  await user.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: section }));
}

async function openOnboardingStep(user: ReturnType<typeof userEvent.setup>, step: 'Permissions' | 'Local transcription' | 'AI responses') {
  await user.click(await screen.findByRole('button', { name: new RegExp(`^Step \\d: ${step}$`) }));
}

async function openHome(user: ReturnType<typeof userEvent.setup>) {
  const closeSettings = screen.queryByRole('button', { name: 'Close settings' });

  if (closeSettings) {
    await user.click(closeSettings);
  }

  await screen.findByLabelText('Transcription output');
}

async function selectSetting(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string
) {
  const control = screen.getByLabelText(label);

  if (control instanceof HTMLSelectElement) {
    const matchingOption = Array.from(control.options).find((item) => item.textContent === option || item.label === option);
    expect(matchingOption).toBeDefined();
    await user.selectOptions(control, matchingOption?.value ?? option);
    return;
  }

  await user.click(control);
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${escapeRegExp(option)}(?:\\b|\\s|$)`) }));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function installTestBridge(overrides: {
  choosePromptTemplateAttachments?: () => Promise<{ ok: boolean; attachments: PromptTemplateAttachment[] }>;
  llmReady?: boolean;
  llmStatus?: { ok: boolean; ready: boolean; status: 'warming' | 'ready' | 'error' | 'disabled' };
  onLlmStatus?: (callback: (status: { ok: boolean; ready: boolean; status: 'warming' | 'ready' | 'error' | 'disabled' }) => void) => () => void;
  onboardingStatus?: OnboardingStatus;
  parakeetStatus?: ParakeetStatus;
  permissions?: PermissionItem[];
  piStatus?: PiStatus;
  selectedLocalTranscriptionModel?: LocalTranscriptionModelId | null;
  privateOverlayState?: PrivateOverlayState;
  promptTemplateState?: PromptTemplateState;
  portablePreferences?: PortablePreferences;
  updateStatus?: UpdateStatus;
  historyStatus?: HistoryStatus;
  localLlmStatus?: LocalLlmStatus;
  downloadLocalAi?: (modelId?: string) => Promise<LocalLlmStatus>;
  onSetAiProvider?: (provider: AiProvider) => LocalLlmStatus | void;
  completeOnboarding?: () => Promise<OnboardingStatus>;
  openChatGptLogin?: () => Promise<{ ok: boolean; message?: string }>;
  requestLlm?: (options: {
    attachments?: PromptTemplateAttachment[];
    model: string;
    requestId?: string;
    reasoning: string;
    transcript: string;
  }) => Promise<{ ok: boolean; text: string }>;
  runtimeContext?: RuntimeContext;
  setSelectedPromptTemplate?: (ids: string[], state: PromptTemplateState) => Promise<PromptTemplateState>;
  stop?: (emit: (event: TranscriptionBridgeEvent) => void) => Promise<{ ok: boolean }> | { ok: boolean };
  resetSettings?: () => Promise<{ ok: boolean }>;
} = {}) {
  let emitTranscriptionEvent: ((event: TranscriptionBridgeEvent) => void) | null = null;
  const starts: Array<{
    sources: string[];
  }> = [];
  const prepares: Array<{
    sources: string[];
  }> = [];
  const llmRequests: Array<{
    attachments?: PromptTemplateAttachment[];
    model: string;
    requestId?: string;
    reasoning: string;
    transcript: string;
  }> = [];
  const openedPermissions: string[] = [];
  const requestedPermissions: string[] = [];
  let promptTemplateState = overrides.promptTemplateState ?? testPromptTemplateState();
  let portablePreferences: PortablePreferences = overrides.portablePreferences ?? {};
  const portablePreferenceSaves: PortablePreferences[] = [];
  let settingsResets = 0;
  let quits = 0;
  let relaunches = 0;
  const savedPiModels: string[] = [];
  const selectedAiProviders: AiProvider[] = [];
  const selectedLocalTranscriptionModels: string[] = [];
  const selectedLocalAiDownloads: string[] = [];
  let localLlmDownloads = 0;
  let modelCatalogueRefreshes = 0;
  let chatGptLoginOpens = 0;
  let onboardingCompletes = 0;
  const onboardingStatusOptions: Array<{ refreshCatalogue?: boolean } | undefined> = [];
  let parakeetDownloads = 0;
  const removedLocalTranscriptionModels: string[] = [];
  let parakeetStatus = overrides.parakeetStatus ?? testParakeetStatus();
  let piStatus = overrides.piStatus ?? testPiStatus();
  let permissions = overrides.permissions ?? [
    {
      description: 'Required when listening to speaker audio output.',
      id: 'screen-recording',
      label: 'Screen & System Audio Recording',
      status: 'granted'
    },
    {
      description: 'Required when listening to audio from other apps.',
      id: 'system-audio',
      label: 'System Audio',
      status: 'granted'
    },
    {
      description: 'Required when listening to your microphone.',
      id: 'microphone',
      label: 'Microphone',
      status: 'granted'
    }
  ];
  let selectedAiProvider: AiProvider = overrides.onboardingStatus?.ai.provider ?? 'local';
  let localLlmStatus = overrides.localLlmStatus ?? getCaulLocalLlmStatusForTest(overrides.onboardingStatus) ?? testReadyLocalLlmStatus();
  let emitLocalLlmStatus: ((status: LocalLlmStatus) => void) | null = null;
  let selectedLocalTranscriptionModel: LocalTranscriptionModelId | null = Object.hasOwn(overrides, 'selectedLocalTranscriptionModel')
    ? overrides.selectedLocalTranscriptionModel ?? null
    : overrides.onboardingStatus?.selectedLocalTranscriptionModel ?? parakeetStatus.modelId ?? null;
  let privateOverlayHandleDragStarts = 0;
  let privateOverlayHandleDragMoves = 0;
  let privateOverlayHandleDragEnds = 0;
  let privateOverlayHandleMenuShows = 0;
  let privateOverlayWindowDragStarts = 0;
  let privateOverlayWindowDragMoves = 0;
  let privateOverlayWindowDragEnds = 0;
  let privateOverlayWindowResizeStarts = 0;
  let privateOverlayWindowResizeMoves = 0;
  let privateOverlayWindowResizeEnds = 0;
  let privateOverlayToggles = 0;
  let privateOverlayShowMainCalls = 0;
  let privateOverlayPanicHides = 0;
  let privateOverlayResetHandlePositionCalls = 0;
  let privateOverlayState = overrides.privateOverlayState ?? testPrivateOverlayState();
  let emitPrivateOverlayState: ((state: PrivateOverlayState) => void) | null = null;
  let updateStatus = overrides.updateStatus ?? testUpdateStatus();
  let historyStatus = overrides.historyStatus ?? testHistoryStatus();
  let updateChecks = 0;
  let updateFrequencyChanges: UpdateFrequency[] = [];
  let modelCatalogueRefreshStatus: ModelCatalogueRefreshStatus = {
    enabled: true,
    frequency: 'monthly' as UpdateFrequency,
    lastCheckedAt: null
  };
  let modelCatalogueRefreshFrequencyChanges: UpdateFrequency[] = [];
  let emitUpdateStatus: ((status: UpdateStatus) => void) | null = null;
  let historyFolderOpens = 0;
  let historyFolderChooses = 0;
  const historyEnabledChanges: boolean[] = [];
  const historySessionSaves: HistorySessionUpdate[] = [];

  function updatePrivateOverlayState(update: Partial<PrivateOverlayState> | ((state: PrivateOverlayState) => PrivateOverlayState)) {
    privateOverlayState = typeof update === 'function'
      ? update(privateOverlayState)
      : {
        ...privateOverlayState,
        ...update
      };
    emitPrivateOverlayState?.(privateOverlayState);

    return privateOverlayState;
  }

  const getCurrentOnboardingStatus = async () => {
    const current = overrides.onboardingStatus ?? testOnboardingStatus({
      parakeet: parakeetStatus,
      permissions: await window.caul!.permissions!.status(),
      pi: piStatus,
      selectedLocalTranscriptionModel
    });
    const nextAi = {
      ...current.ai,
      localRuntime: localLlmStatus,
      provider: selectedAiProvider,
      resources: {
        ...current.ai.resources,
        localRuntimes: {
          ...current.ai.resources.localRuntimes,
          caulLlamaCpp: localLlmStatus
        }
      }
    };
    const transcriptionReady = Boolean(
      selectedLocalTranscriptionModel
      && parakeetStatus.installed
      && parakeetStatus.modelId === selectedLocalTranscriptionModel
    );
    const permissions = await window.caul!.permissions!.status();
    const permissionsReady = permissions.permissions.every((permission) => permission.status === 'granted');
    const localAiReady = Boolean(localLlmStatus.runtime.installed && localLlmStatus.model?.installed);
    const cloudAiReady = Boolean(piStatus.connected);
    const aiReady = selectedAiProvider === 'cloud' ? cloudAiReady : localAiReady;
    const complete = permissionsReady && transcriptionReady && aiReady;

    return {
      ...current,
      ai: nextAi,
      autoUpdate: {
        ai: portablePreferences.autoUpdateAiModel !== false,
        transcription: portablePreferences.autoUpdateTranscriptionModel !== false
      },
      complete,
      required: !complete,
      selectedLocalTranscriptionModel
    };
  };

  window.caul = {
    capture: {
      pause: async () => testCaptureStatus('paused'),
      start: async () => testCaptureStatus('testing'),
      status: async () => testCaptureStatus('idle'),
      stop: async () => testCaptureStatus('idle')
    },
    getRuntimeContext: async () => overrides.runtimeContext ?? testRuntimeContext(),
    llm: {
      onStatus: overrides.onLlmStatus ?? (() => () => undefined),
      status: async () => overrides.llmStatus ?? ({
        ok: true,
        ready: overrides.llmReady ?? true,
        status: overrides.llmReady === false ? 'warming' : 'ready'
      })
    },
    permissions: {
      open: async (permission) => {
        openedPermissions.push(permission);

        return { ok: true };
      },
      request: async (permission) => {
        requestedPermissions.push(permission);
        permissions = permissions.map((item) => (
          item.id === permission && item.status !== 'denied' && item.status !== 'restricted'
            ? {
              ...item,
              status: 'granted'
            }
            : item
        ));

        return { ok: true };
      },
      status: async () => ({
        ok: true,
        permissions,
        platform: 'darwin'
      })
    },
    privateOverlay: {
      dragHandleEnd: async () => {
        privateOverlayHandleDragEnds += 1;

        return privateOverlayState;
      },
      dragHandleMove: async () => {
        privateOverlayHandleDragMoves += 1;

        return privateOverlayState;
      },
      dragHandleStart: async () => {
        privateOverlayHandleDragStarts += 1;

        return privateOverlayState;
      },
      dragWindowEnd: async () => {
        privateOverlayWindowDragEnds += 1;

        return privateOverlayState;
      },
      dragWindowMove: async () => {
        privateOverlayWindowDragMoves += 1;

        return privateOverlayState;
      },
      dragWindowStart: async () => {
        privateOverlayWindowDragStarts += 1;

        return privateOverlayState;
      },
      resizeWindowEnd: async () => {
        privateOverlayWindowResizeEnds += 1;

        return privateOverlayState;
      },
      resizeWindowMove: async () => {
        privateOverlayWindowResizeMoves += 1;
      },
      resizeWindowStart: async () => {
        privateOverlayWindowResizeStarts += 1;

        return privateOverlayState;
      },
      showHandleMenu: async () => {
        privateOverlayHandleMenuShows += 1;

        return privateOverlayState;
      },
      hide: async () => updatePrivateOverlayState((state) => ({
        ...state,
        overlay: {
          ...state.overlay,
          visible: false
        },
        overlayWindowVisible: false
      })),
      onState: (callback) => {
        emitPrivateOverlayState = callback;

        return () => {
          emitPrivateOverlayState = null;
        };
      },
      panicHide: async () => {
        privateOverlayPanicHides += 1;

        return updatePrivateOverlayState((state) => ({
          ...state,
          handle: {
            ...state.handle,
            visible: true
          },
          handleWindowVisible: true,
          overlay: {
            ...state.overlay,
            visible: false
          },
          overlayWindowVisible: false
        }));
      },
      resetHandlePosition: async () => {
        privateOverlayResetHandlePositionCalls += 1;

        return updatePrivateOverlayState((state) => ({
          ...state,
          handle: {
            ...state.handle,
            visible: true,
            x: 100,
            y: 100
          },
          handleWindowVisible: true
        }));
      },
      setClickThrough: async (enabled) => updatePrivateOverlayState((state) => ({
        ...state,
        clickThrough: enabled
      })),
      setHandleSize: async (size) => updatePrivateOverlayState((state) => ({
        ...state,
        handle: {
          ...state.handle,
          size
        }
      })),
      showMain: async () => {
        privateOverlayShowMainCalls += 1;

        return privateOverlayState;
      },
      status: async () => privateOverlayState,
      toggle: async () => {
        privateOverlayToggles += 1;

        return updatePrivateOverlayState((state) => ({
          ...state,
          overlay: {
            ...state.overlay,
            visible: !state.overlay.visible
          },
          overlayWindowVisible: !state.overlayWindowVisible
        }));
      }
    },
    settings: {
      ai: {
        benchmarkLocal: async (modelId) => ({
          failureReason: null,
          firstTokenMs: 400,
          modelId: modelId ?? localLlmStatus.model?.id ?? 'qwen2.5-3b-instruct-q4_k_m',
          ok: true,
          status: 'passed',
          tokensPerSecond: 20,
          totalMs: 900
        }),
        cancelLocalDownload: async () => {
          localLlmStatus = testLocalLlmStatus({ status: 'missing' });
          emitLocalLlmStatus?.(localLlmStatus);
          return localLlmStatus;
        },
        disconnect: async () => {
          piStatus = testPiStatus({ connected: false, selectedModel: null, status: 'disconnected' });
          return piStatus;
        },
        downloadLocal: async (modelId) => {
          localLlmDownloads += 1;
          if (modelId) {
            selectedLocalAiDownloads.push(modelId);
          }
          if (overrides.downloadLocalAi) {
            localLlmStatus = await overrides.downloadLocalAi(modelId);
            emitLocalLlmStatus?.(localLlmStatus);
            return localLlmStatus;
          }
          localLlmStatus = testLocalLlmStatus({
            model: {
              id: 'qwen2.5-3b-instruct-q4_k_m',
              installed: true,
              name: 'Qwen 2.5 3B Instruct Q4',
              path: '/tmp/caul/local-llm/models/qwen2.5-3b-instruct-q4_k_m.gguf',
              sizeGb: 2.2
            },
            runtime: {
              assetName: 'llama-test.tar.gz',
              installed: true,
              path: '/tmp/caul/local-llm/llama-server',
              supported: true,
              version: 'test'
            },
            status: 'ready'
          });
          emitLocalLlmStatus?.(localLlmStatus);
          return localLlmStatus;
        },
        localStatus: async () => localLlmStatus,
        onLocalStatus: (callback) => {
          emitLocalLlmStatus = callback;
          return () => {
            emitLocalLlmStatus = null;
          };
        },
        setLocalModel: async (modelId) => {
          localLlmStatus = testLocalLlmStatus({
            model: {
              id: modelId,
              installed: localLlmStatus.model?.installed ?? false,
              name: localLlmStatus.model?.name ?? 'Qwen 2.5 3B Instruct Q4',
              path: localLlmStatus.model?.path ?? '/tmp/caul/local-llm/models/qwen2.5-3b-instruct-q4_k_m.gguf',
              sizeGb: localLlmStatus.model?.sizeGb ?? 2.2
            },
            status: localLlmStatus.status
          });
          emitLocalLlmStatus?.(localLlmStatus);
          return localLlmStatus;
        },
        openChatGptLogin: async () => {
          chatGptLoginOpens += 1;
          if (overrides.openChatGptLogin) {
            return overrides.openChatGptLogin();
          }
          return { ok: true };
        },
        openLogin: async () => ({ ok: true }),
        openModel: async () => ({ ok: true }),
        refreshCatalogue: async () => {
          modelCatalogueRefreshes += 1;
          modelCatalogueRefreshStatus = {
            ...modelCatalogueRefreshStatus,
            lastCheckedAt: '2026-06-08T00:00:00.000Z'
          };
          return {
            ok: true,
            reviewedAt: '2026-06-08',
            sourceReports: [
              {
                detail: 'Intelligence Index 19',
                ok: true,
                source: 'Artificial Analysis',
                url: 'https://artificialanalysis.ai/models/gemma-4-e4b'
              },
              {
                detail: 'latest release v0.25.0',
                ok: true,
                source: 'MLX LM',
                url: 'https://api.github.com/repos/ml-explore/mlx-lm/releases/latest'
              }
            ],
            status: await getCurrentOnboardingStatus()
          };
        },
        refreshCatalogueStatus: async () => modelCatalogueRefreshStatus,
        saveModel: async (model) => {
          savedPiModels.push(model);
          piStatus = testPiStatus({ connected: true, selectedModel: model, status: 'ready' });
          return piStatus;
        },
        setRefreshCatalogueFrequency: async (frequency) => {
          modelCatalogueRefreshFrequencyChanges = [...modelCatalogueRefreshFrequencyChanges, frequency];
          modelCatalogueRefreshStatus = {
            ...modelCatalogueRefreshStatus,
            frequency
          };
          return modelCatalogueRefreshStatus;
        },
        setProvider: async (provider) => {
          selectedAiProvider = provider;
          selectedAiProviders.push(provider);
          const nextLocalLlmStatus = overrides.onSetAiProvider?.(provider);
          if (nextLocalLlmStatus) {
            localLlmStatus = nextLocalLlmStatus;
          }
          return getCurrentOnboardingStatus();
        },
        status: async () => piStatus
      },
      onboarding: {
        complete: async () => {
          onboardingCompletes += 1;
          if (overrides.completeOnboarding) {
            return overrides.completeOnboarding();
          }
          return getCurrentOnboardingStatus();
        },
        open: async () => getCurrentOnboardingStatus(),
        status: async (options) => {
          onboardingStatusOptions.push(options);
          return getCurrentOnboardingStatus();
        }
      },
      history: {
        chooseFolder: async () => {
          historyFolderChooses += 1;
          historyStatus = testHistoryStatus({ folder: '/Users/alex/Documents/Changed Caul History' });
          return historyStatus;
        },
        openFolder: async () => {
          historyFolderOpens += 1;
          return { ok: true };
        },
        saveSession: async (update) => {
          historySessionSaves.push(update);
          return { ok: true, filePath: `${historyStatus.folder}/2026-06/2026-06-06.html` };
        },
        setEnabled: async (enabled) => {
          historyEnabledChanges.push(enabled);
          historyStatus = {
            ...historyStatus,
            enabled
          };
          return historyStatus;
        },
        status: async () => historyStatus
      },
      parakeet: {
        cancelDownload: async () => {
          parakeetStatus = testParakeetStatus({ installed: false, status: 'missing' });
          return parakeetStatus;
        },
        download: async (modelId) => {
          parakeetDownloads += 1;
          selectedLocalTranscriptionModel = modelId ?? 'parakeet';
          selectedLocalTranscriptionModels.push(selectedLocalTranscriptionModel);
          parakeetStatus = testParakeetStatus({
            installed: true,
            modelId: selectedLocalTranscriptionModel,
            modelName: modelId === 'moonshine-tiny' ? 'Moonshine tiny' : 'Parakeet v3',
            status: 'installed'
          });
          return parakeetStatus;
        },
        onStatus: () => () => undefined,
        remove: async (modelId) => {
          removedLocalTranscriptionModels.push(modelId);
          if (parakeetStatus.modelId === modelId) {
            parakeetStatus = testParakeetStatus({ installed: false, modelId, status: 'missing' });
          }
          return parakeetStatus;
        },
        setModel: async (modelId) => {
          selectedLocalTranscriptionModel = modelId;
          selectedLocalTranscriptionModels.push(modelId);
          parakeetStatus = testParakeetStatus({
            modelId,
            modelName: modelId === 'moonshine-tiny' ? 'Moonshine tiny' : 'Parakeet v3'
          });
          return parakeetStatus;
        },
        status: async () => parakeetStatus
      },
      promptTemplates: {
        chooseAttachments: overrides.choosePromptTemplateAttachments ?? (async () => ({
          ok: true,
          attachments: []
        })),
        delete: async (id) => {
          promptTemplateState = {
            ok: true,
            selectedTemplateIds: promptTemplateState.selectedTemplateIds.filter((selectedId) => selectedId !== id),
            templates: promptTemplateState.templates.filter((template) => template.id !== id)
          };

          return promptTemplateState;
        },
        list: async () => promptTemplateState,
        reset: async () => {
          promptTemplateState = testPromptTemplateState({
            templates: starterTestPromptTemplates()
          });

          return promptTemplateState;
        },
        save: async (template) => {
          const templateToSave = getPromptTemplateForTestSave(template, promptTemplateState.templates);
          promptTemplateState = {
            ok: true,
            selectedTemplateIds: promptTemplateState.selectedTemplateIds,
            templates: resolveTestPromptTemplateNameCollisions(promptTemplateState.templates.some((item) => item.id === templateToSave.id)
              ? promptTemplateState.templates.map((item) => (item.id === templateToSave.id ? templateToSave : item))
              : [...promptTemplateState.templates, templateToSave])
          };

          return promptTemplateState;
        },
        setSelected: async (ids) => {
          if (overrides.setSelectedPromptTemplate) {
            promptTemplateState = await overrides.setSelectedPromptTemplate(ids, promptTemplateState);

            return promptTemplateState;
          }

          promptTemplateState = {
            ...promptTemplateState,
            selectedTemplateIds: ids
          };

          return promptTemplateState;
        }
      },
      preferences: {
        load: async (legacy) => {
          portablePreferences = {
            ...legacy,
            ...portablePreferences
          };
          return { ok: true, preferences: portablePreferences };
        },
        save: async (update) => {
          portablePreferenceSaves.push(update);
          portablePreferences = {
            ...portablePreferences,
            ...update
          };
          return { ok: true, preferences: portablePreferences };
        }
      },
      updates: {
        checkNow: async () => {
          updateChecks += 1;
          updateStatus = {
            ...updateStatus,
            lastCheckedAt: '2026-06-04T00:00:00.000Z',
            lastResult: {
              ok: true,
              status: 'not-available',
              message: 'Caul is up to date.'
            }
          };
          emitUpdateStatus?.(updateStatus);
          return updateStatus;
        },
        downloadAndInstall: async () => updateStatus,
        installDownloaded: async () => {
          updateStatus = {
            ...updateStatus,
            downloading: false,
            lastResult: {
              ok: true,
              status: 'installing',
              message: 'Restarting to install update.'
            }
          };
          emitUpdateStatus?.(updateStatus);
          return { ok: true };
        },
        onStatus: (callback) => {
          emitUpdateStatus = callback;

          return () => {
            emitUpdateStatus = null;
          };
        },
        openDownloadPage: async () => ({ ok: true }),
        setFrequency: async (frequency) => {
          updateFrequencyChanges = [...updateFrequencyChanges, frequency];
          updateStatus = {
            ...updateStatus,
            frequency
          };
          emitUpdateStatus?.(updateStatus);
          return updateStatus;
        },
        status: async () => updateStatus
      },
      reset: async () => {
        settingsResets += 1;
        if (overrides.resetSettings) {
          return overrides.resetSettings();
        }
        promptTemplateState = testPromptTemplateState({
          templates: starterTestPromptTemplates()
        });

        return { ok: true };
      },
      quit: async () => {
        quits += 1;

        return { ok: true };
      },
      relaunch: async () => {
        relaunches += 1;

        return { ok: true };
      }
    },
    systemAudio: {
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true })
    },
    transcription: {
      onEvent: (callback) => {
        emitTranscriptionEvent = callback;

        return () => {
          emitTranscriptionEvent = null;
        };
      },
      prepare: async (options) => {
        prepares.push(options);

        return { ok: true };
      },
      requestLlm: overrides.requestLlm ?? (async ({ attachments, model, reasoning, requestId, transcript }) => {
        llmRequests.push({
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          model,
          reasoning,
          requestId,
          transcript
        });

        return { ok: true, text: 'manual llm answer' };
      }),
      start: async (options) => {
        starts.push(options);

        return { ok: true };
      },
      stop: async () => {
        if (overrides.stop) {
          return overrides.stop((event) => {
            emitTranscriptionEvent?.(event);
          });
        }

        return { ok: true };
      }
    }
  };

  return {
    llmRequests,
    openedPermissions,
    get parakeetDownloads() {
      return parakeetDownloads;
    },
    get removedLocalTranscriptionModels() {
      return removedLocalTranscriptionModels;
    },
    prepares,
    requestedPermissions,
    savedPiModels,
    selectedAiProviders,
    selectedLocalAiDownloads,
    selectedLocalTranscriptionModels,
    get localLlmDownloads() {
      return localLlmDownloads;
    },
    get modelCatalogueRefreshes() {
      return modelCatalogueRefreshes;
    },
    get chatGptLoginOpens() {
      return chatGptLoginOpens;
    },
    onboardingStatusOptions,
    starts,
    get portablePreferences() {
      return portablePreferences;
    },
    get portablePreferenceSaves() {
      return portablePreferenceSaves;
    },
    get privateOverlayHandleDragEnds() {
      return privateOverlayHandleDragEnds;
    },
    get privateOverlayHandleDragMoves() {
      return privateOverlayHandleDragMoves;
    },
    get privateOverlayHandleDragStarts() {
      return privateOverlayHandleDragStarts;
    },
    get privateOverlayHandleMenuShows() {
      return privateOverlayHandleMenuShows;
    },
    get privateOverlayWindowDragEnds() {
      return privateOverlayWindowDragEnds;
    },
    get privateOverlayWindowDragMoves() {
      return privateOverlayWindowDragMoves;
    },
    get privateOverlayWindowDragStarts() {
      return privateOverlayWindowDragStarts;
    },
    get privateOverlayWindowResizeEnds() {
      return privateOverlayWindowResizeEnds;
    },
    get privateOverlayWindowResizeMoves() {
      return privateOverlayWindowResizeMoves;
    },
    get privateOverlayWindowResizeStarts() {
      return privateOverlayWindowResizeStarts;
    },
    get privateOverlayPanicHides() {
      return privateOverlayPanicHides;
    },
    get privateOverlayResetHandlePositionCalls() {
      return privateOverlayResetHandlePositionCalls;
    },
    get privateOverlayShowMainCalls() {
      return privateOverlayShowMainCalls;
    },
    get privateOverlayState() {
      return privateOverlayState;
    },
    get privateOverlayToggles() {
      return privateOverlayToggles;
    },
    setPrivateOverlayState(state: PrivateOverlayState) {
      privateOverlayState = state;
      emitPrivateOverlayState?.(privateOverlayState);
    },
    get promptTemplateState() {
      return promptTemplateState;
    },
    get onboardingCompletes() {
      return onboardingCompletes;
    },
    get settingsResets() {
      return settingsResets;
    },
    get quits() {
      return quits;
    },
    get relaunches() {
      return relaunches;
    },
    get updateChecks() {
      return updateChecks;
    },
    get updateFrequencyChanges() {
      return updateFrequencyChanges;
    },
    get modelCatalogueRefreshFrequencyChanges() {
      return modelCatalogueRefreshFrequencyChanges;
    },
    get historyFolderOpens() {
      return historyFolderOpens;
    },
    get historyFolderChooses() {
      return historyFolderChooses;
    },
    get historyEnabledChanges() {
      return historyEnabledChanges;
    },
    get historySessionSaves() {
      return historySessionSaves;
    },
    emitLocalLlmStatus: (status: LocalLlmStatus) => {
      localLlmStatus = status;
      emitLocalLlmStatus?.(status);
    },
    emit: (event: TranscriptionBridgeEvent) => {
      emitTranscriptionEvent?.(event);
    }
  };
}

function testPromptTemplateState(overrides: Partial<PromptTemplateState> = {}): PromptTemplateState {
  const selectedTemplateIds = overrides.selectedTemplateIds ?? [];

  return {
    ok: true,
    selectedTemplateIds,
    templates: overrides.templates ?? starterTestPromptTemplates()
  };
}

function testUpdateStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    appChannel: 'beta',
    appName: 'Caul Beta',
    appVersion: '0.1.8',
    availableUpdate: null,
    checking: false,
    downloading: false,
    enabled: true,
    frequency: 'weekly',
    lastCheckedAt: null,
    lastResult: null,
    ...overrides
  };
}

function testHistoryStatus(overrides: Partial<HistoryStatus> = {}): HistoryStatus {
  return {
    enabled: overrides.enabled ?? true,
    folder: overrides.folder ?? '/Users/alex/Documents/Caul',
    message: overrides.message,
    ok: overrides.ok ?? true
  };
}

function starterTestPromptTemplates() {
  return [
    testPromptTemplate({
      id: 'starter-answer-with-star',
      name: 'STAR',
      prompt: 'Use STAR when answering interview-style questions.\n\nStructure the answer as:\nSituation: brief context\nTask: what needed to be done\nAction: what I did\nResult: outcome or lesson\n\nKeep it concise and natural to say aloud.'
    }),
    testPromptTemplate({
      id: 'starter-use-my-cv',
      name: 'CV',
      prompt: 'Use my CV as background context.\n\nPrefer specific experience, projects, achievements and skills from the CV. If no CV content or readable CV attachment is provided, say you cannot review the CV until it is attached. Do not invent details, use placeholders or give a generic CV review.'
    }),
    testPromptTemplate({
      id: 'starter-job-description',
      name: 'PD',
      prompt: 'Use the position description as role context.\n\nConnect answers to the role duties, skills and selection criteria where useful.'
    })
  ];
}

function mergeStarterTestPromptTemplates(templates: PromptTemplate[]) {
  const starterIds = new Set(starterTestPromptTemplates().map((template) => template.id));

  return [
    ...starterTestPromptTemplates(),
    ...templates.filter((template) => !starterIds.has(template.id))
  ];
}

function getCustomStarterTestPromptTemplateId(id: string) {
  return `custom-${id}`;
}

function isStarterTestPromptTemplateCustomised(template: PromptTemplate, starterTemplate: PromptTemplate) {
  return template.name !== starterTemplate.name
    || template.prompt !== starterTemplate.prompt
    || (template.attachments ?? []).length > 0;
}

function asCustomStarterTestPromptTemplate(template: PromptTemplate, existingTemplates: PromptTemplate[] = []) {
  const customId = getCustomStarterTestPromptTemplateId(template.id);
  const existingCustom = existingTemplates.find((item) => item.id === customId);
  const collisionTemplates = existingTemplates.filter((item) => item.id !== customId && item.id !== template.id);

  return {
    ...template,
    createdAt: existingCustom?.createdAt ?? template.createdAt,
    id: customId,
    name: getAvailableTestPromptTemplateName(template.name, collisionTemplates),
    updatedAt: template.updatedAt
  };
}

function getAvailableTestPromptTemplateName(name: string, templates: PromptTemplate[]) {
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

function resolveTestPromptTemplateNameCollisions(templates: PromptTemplate[]) {
  const starterTemplateIds = new Set(starterTestPromptTemplates().map((template) => template.id));

  return templates.reduce<PromptTemplate[]>((items, template) => {
    if (starterTemplateIds.has(template.id)) {
      return [...items, template];
    }

    return [
      ...items,
      {
        ...template,
        name: getAvailableTestPromptTemplateName(template.name, items)
      }
    ];
  }, []);
}

function preserveCustomisedStarterTestPromptTemplates(templates: PromptTemplate[]) {
  const starterTemplates = starterTestPromptTemplates();
  const starterTemplatesById = new Map(starterTemplates.map((template) => [template.id, template]));
  const preservedCustomStarters = templates
    .filter((template) => {
      const starterTemplate = starterTemplatesById.get(template.id);
      return starterTemplate && isStarterTestPromptTemplateCustomised(template, starterTemplate);
    })
    .map((template) => asCustomStarterTestPromptTemplate(template, templates));
  const existingCustomTemplates = templates.filter((template) => !starterTemplatesById.has(template.id));
  const customTemplatesById = new Map([...existingCustomTemplates, ...preservedCustomStarters].map((template) => [template.id, template]));

  return resolveTestPromptTemplateNameCollisions([
    ...starterTemplates,
    ...customTemplatesById.values()
  ]);
}

function getPromptTemplateForTestSave(template: PromptTemplate, existingTemplates: PromptTemplate[]) {
  const starterTemplate = starterTestPromptTemplates().find((item) => item.id === template.id);

  return starterTemplate && isStarterTestPromptTemplateCustomised(template, starterTemplate)
    ? asCustomStarterTestPromptTemplate(template, existingTemplates)
    : template;
}

function testPromptTemplate(overrides: Partial<PromptTemplate>): PromptTemplate {
  const now = '2026-05-26T00:00:00.000Z';

  return {
    attachments: overrides.attachments ?? [],
    createdAt: now,
    id: overrides.id ?? 'template-id',
    name: overrides.name ?? 'Template',
    prompt: overrides.prompt ?? 'Template prompt.',
    updatedAt: now
  };
}

function testPromptTemplateAttachment(overrides: Partial<PromptTemplateAttachment> = {}): PromptTemplateAttachment {
  return {
    id: overrides.id ?? 'attachment-id',
    kind: overrides.kind ?? 'image',
    mimeType: overrides.mimeType ?? 'image/png',
    name: overrides.name ?? 'Attachment.png',
    path: overrides.path ?? '/tmp/attachment.png',
    sizeBytes: overrides.sizeBytes ?? 1024,
    support: overrides.support ?? 'supported'
  };
}

function testParakeetStatus(overrides: Partial<ParakeetStatus> = {}): ParakeetStatus {
  return {
    installed: overrides.installed ?? true,
    modelDir: overrides.modelDir ?? '/tmp/caul/models/parakeet-tdt-0.6b-v3-int8',
    modelId: overrides.modelId ?? 'parakeet',
    modelName: overrides.modelName ?? 'Parakeet v3',
    ok: overrides.ok ?? true,
    progress: overrides.progress,
    status: overrides.status ?? 'installed'
  };
}

function testPiStatus(overrides: Partial<PiStatus> = {}): PiStatus {
  return {
    agentDir: overrides.agentDir ?? '/tmp/caul/pi-agent',
    bundled: overrides.bundled ?? true,
    connected: overrides.connected ?? false,
    ok: overrides.ok ?? true,
    selectedModel: overrides.selectedModel ?? null,
    status: overrides.status ?? 'disconnected'
  };
}

function testTranscriptionRecommendation(overrides: Partial<OnboardingStatus['transcription']> = {}): OnboardingStatus['transcription'] {
  return {
    autoDownloadModel: overrides.autoDownloadModel ?? true,
    autoDownloadParakeet: overrides.autoDownloadParakeet ?? true,
    benchmark: overrides.benchmark ?? {
      catalogueLastReviewed: '2026-06-06',
      recommendationSource: 'Hugging Face Open ASR Leaderboard',
      staleEntries: []
    },
    ok: overrides.ok ?? true,
    recommended: overrides.recommended ?? 'local-parakeet',
    recommendedModel: overrides.recommendedModel ?? {
      id: 'parakeet',
      name: 'Parakeet v3',
      reason: 'Best local quality for this computer.'
    },
    resources: overrides.resources ?? {
      accelerator: 'apple-silicon',
      arch: 'arm64',
      cpuCores: 10,
      freeMemoryGb: 12,
      gpu: {
        available: true,
        name: 'Apple Silicon unified GPU',
        unifiedMemory: true,
        vendor: 'apple',
        vramGb: 32
      },
      localRuntimes: {
        caulLlamaCpp: testLocalLlmStatus()
      },
      platform: 'darwin',
      totalMemoryGb: 32
    },
    score: overrides.score ?? {
      machineProbeIterationsPerMs: 50000,
      parakeet: 220,
      moonshineTiny: 180
    },
    status: overrides.status ?? 'ready',
    summary: overrides.summary ?? 'Recommended: local transcription'
  };
}

function testLocalLlmStatus(overrides: Partial<LocalLlmStatus> = {}): LocalLlmStatus {
  return {
    ok: overrides.ok ?? true,
    model: overrides.model ?? {
      id: 'qwen2.5-3b-instruct-q4_k_m',
      installed: false,
      name: 'Qwen 2.5 3B Instruct Q4',
      path: '/tmp/caul/local-llm/models/qwen2.5-3b-instruct-q4_k_m.gguf',
      sizeGb: 2.2
    },
    progress: overrides.progress,
    provider: 'caul-llama.cpp',
    runtime: overrides.runtime ?? {
      assetName: 'llama-test.tar.gz',
      installed: false,
      path: null,
      supported: true,
      version: 'test'
    },
    status: overrides.status ?? 'missing'
  };
}

function testReadyLocalLlmStatus(overrides: Partial<LocalLlmStatus> = {}): LocalLlmStatus {
  return testLocalLlmStatus({
    model: {
      id: 'qwen2.5-3b-instruct-q4_k_m',
      installed: true,
      name: 'Qwen 2.5 3B Instruct Q4',
      path: '/tmp/caul/local-llm/models/qwen2.5-3b-instruct-q4_k_m.gguf',
      sizeGb: 2.2
    },
    runtime: {
      assetName: 'llama-test.tar.gz',
      installed: true,
      path: '/tmp/caul/local-llm/llama-server',
      supported: true,
      version: 'test'
    },
    status: overrides.status ?? 'ready'
  });
}

function testAiRecommendation(overrides: Partial<OnboardingStatus['ai']> = {}): OnboardingStatus['ai'] {
  const localStatus = testLocalLlmStatus();
  const recommended = overrides.recommended ?? 'local';
  return {
    benchmark: overrides.benchmark ?? {
      catalogueLastReviewed: '2026-06-06',
      recommendationSource: 'Artificial Analysis LLM Leaderboard',
      staleEntries: []
    },
    localRuntime: overrides.localRuntime ?? localStatus,
    provider: overrides.provider ?? (recommended === 'cloud' ? 'cloud' : 'local'),
    recommended,
    recommendedModel: overrides.recommendedModel ?? {
      id: 'qwen2.5-3b-instruct-q4_k_m',
      name: 'Qwen 2.5 3B Instruct Q4',
      reason: 'Qwen 2.5 3B Instruct Q4 is the best local AI response fit for this machine from the offline benchmark catalogue.',
      runtime: 'llama.cpp'
    },
    resources: overrides.resources ?? {
      accelerator: 'apple-silicon',
      arch: 'arm64',
      cpuCores: 10,
      freeMemoryGb: 12,
      gpu: {
        available: true,
        name: 'Apple Silicon unified GPU',
        unifiedMemory: true,
        vendor: 'apple',
        vramGb: 32
      },
      localRuntimes: {
        caulLlamaCpp: localStatus
      },
      platform: 'darwin',
      totalMemoryGb: 32
    },
    status: overrides.status ?? 'ready',
    summary: overrides.summary ?? 'Recommended: Qwen 2.5 3B Instruct Q4 local AI responses',
    viable: overrides.viable ?? true
  };
}

function getCaulLocalLlmStatusForTest(status: OnboardingStatus | undefined) {
  const runtime = status?.ai.resources.localRuntimes?.caulLlamaCpp;

  return runtime?.provider === 'caul-llama.cpp' || runtime?.provider === 'caul-mlx' ? runtime : null;
}

function testOnboardingStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  const permissions = overrides.permissions ?? {
    ok: true,
    permissions: [
      {
        description: 'Required when listening to speaker audio output.',
        id: 'screen-recording',
        label: 'Screen & System Audio Recording',
        status: 'granted'
      },
      {
        description: 'Required when listening to audio from other apps.',
        id: 'system-audio',
        label: 'System Audio',
        status: 'granted'
      },
      {
        description: 'Required when listening to your microphone.',
        id: 'microphone',
        label: 'Microphone',
        status: 'granted'
      }
    ],
    platform: 'darwin'
  };
  const parakeet = overrides.parakeet ?? testParakeetStatus();
  const pi = overrides.pi ?? testPiStatus();
  const ai = overrides.ai ?? testAiRecommendation();
  const selectedLocalTranscriptionModel = Object.hasOwn(overrides, 'selectedLocalTranscriptionModel')
    ? overrides.selectedLocalTranscriptionModel ?? null
    : parakeet.modelId ?? null;
  const localRuntime = ai.localRuntime ?? ai.resources.localRuntimes?.caulLlamaCpp;
  const localAiReady = Boolean(localRuntime?.runtime.installed && localRuntime.model?.installed);
  const cloudAiReady = Boolean(pi.connected);
  const aiReady = ai.provider === 'cloud' ? cloudAiReady : localAiReady;
  const complete = overrides.complete ?? (
    permissions.permissions.every((permission) => permission.status === 'granted')
    && parakeet.installed
    && selectedLocalTranscriptionModel === parakeet.modelId
    && aiReady
  );

  return {
    ai,
    autoUpdate: overrides.autoUpdate ?? {
      ai: true,
      transcription: true
    },
    complete,
    completedAt: overrides.completedAt ?? null,
    ok: overrides.ok ?? true,
    parakeet,
    permissions,
    pi,
    required: overrides.required ?? !complete,
    selectedLocalTranscriptionModel,
    transcription: overrides.transcription ?? testTranscriptionRecommendation()
  };
}

function testRuntimeContext(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    arch: overrides.arch ?? 'arm64',
    appChannel: overrides.appChannel ?? 'stable',
    appName: overrides.appName ?? 'Caul',
    isMac: overrides.isMac ?? true,
    platform: overrides.platform ?? 'darwin',
    vmTestingTarget: overrides.vmTestingTarget ?? 'test'
  };
}

function testPrivateOverlayState(overrides: Partial<PrivateOverlayState> = {}): PrivateOverlayState {
  return {
    clickThrough: overrides.clickThrough ?? false,
    handle: overrides.handle ?? {
      opacity: 0.82,
      size: 'medium',
      visible: true,
      x: 100,
      y: 100
    },
    handleWindowVisible: overrides.handleWindowVisible ?? false,
    overlay: overrides.overlay ?? {
      height: 360,
      visible: false,
      width: 480,
      x: 200,
      y: 80
    },
    overlayWindowVisible: overrides.overlayWindowVisible ?? false,
    privateMode: overrides.privateMode ?? true
  };
}

function testPrivateOverlayStateForEdge(edge: 'bottom' | 'left' | 'right' | 'top'): PrivateOverlayState {
  const handleSize = 48;
  const overlay = {
    height: 300,
    visible: true,
    width: 400,
    x: 200,
    y: 200
  };
  const handleByEdge = {
    bottom: { x: 368, y: overlay.y + overlay.height },
    left: { x: overlay.x - handleSize, y: 318 },
    right: { x: overlay.x + overlay.width, y: 318 },
    top: { x: 368, y: overlay.y - handleSize }
  };

  return testPrivateOverlayState({
    handle: {
      opacity: 0.82,
      size: 'medium',
      visible: true,
      ...handleByEdge[edge]
    },
    handleWindowVisible: true,
    overlay,
    overlayWindowVisible: true
  });
}

function testCaptureStatus(state: CaptureRunState) {
  return {
    ...initialCaptureStatus,
    state
  };
}

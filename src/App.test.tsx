import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { initialCaptureStatus, type CaptureRunState } from './foundation/capture';
import type { OnboardingStatus, ParakeetStatus, PermissionItem, PiStatus, PrivateOverlayState, PromptTemplate, PromptTemplateAttachment, PromptTemplateState, TranscriptionBridgeEvent } from './foundation/desktopBridge';
import type { RuntimeContext } from './foundation/runtime';

function currentLongDatePattern() {
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());

  return new RegExp(formattedDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

describe('App', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('shows only the minimal listening form', async () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Susura Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Speaker' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Your live transcript will appear here once you start listening.');
    expect(screen.queryByLabelText('LLM query')).not.toBeInTheDocument();
    expect(screen.getByLabelText('AI response')).toHaveTextContent(
      'Auto Send is on.\nStop listening to send to AI.',
      { normalizeWhitespace: false }
    );
    expect(screen.queryByText('%')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize transcript and AI response panes' })).not.toBeInTheDocument();
    expect(screen.getByTestId('home-panels')).toHaveAttribute('data-panel-flow', 'stacked');
  });

  it('opens settings as a modal page and closes it from either control', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Susura Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Susura Settings' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveClass('susura-settings-dialog');
    expect(screen.getByRole('dialog', { name: 'Settings' })).not.toHaveClass('h-[85vh]', 'w-[50vw]');
    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveClass('text-sm', 'text-center');

    await user.click(screen.getByRole('button', { name: 'Susura Settings' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Susura Settings' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Susura Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Close settings' }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('closes settings when clicking the negative space around it', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Susura Settings' }));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close settings backdrop' }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('renders guided onboarding from the permissions step', async () => {
    window.history.pushState({}, '', '/?susura-surface=onboarding');
    installTestBridge();

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Set up Susura' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByText('Microphone')).toBeInTheDocument();
    expect(screen.getByText('Screen & System Audio Recording')).toBeInTheDocument();
  });

  it('shows Parakeet download progress in onboarding', async () => {
    window.history.pushState({}, '', '/?susura-surface=onboarding');
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

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Transcription' }));

    expect(screen.getByText('42% downloaded')).toBeInTheDocument();
  });

  it('saves the selected Pi model from onboarding', async () => {
    window.history.pushState({}, '', '/?susura-surface=onboarding');
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'AI account' }));
    await user.clear(screen.getByLabelText('Model'));
    await user.type(screen.getByLabelText('Model'), 'anthropic/claude-sonnet');
    await user.click(screen.getByRole('button', { name: 'Save model' }));

    expect(bridge.savedPiModels).toEqual(['anthropic/claude-sonnet']);
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

    await user.click(screen.getByRole('button', { name: 'Susura Settings' }));

    const settingsClose = await screen.findByRole('button', { name: 'Close settings' });
    expect(settingsClose).toHaveClass('right-3');
    expect(settingsClose).not.toHaveClass('left-3');
    expect(settingsClose.querySelector('svg')).toBeInTheDocument();

    await user.click(settingsClose);
    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));

    const promptTemplatesClose = await screen.findByRole('button', { name: 'Close prompt templates' });
    expect(screen.getByRole('dialog', { name: 'Prompt templates' })).toHaveClass('susura-titlebar-centred-dialog');
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

    await user.click(screen.getByRole('button', { name: 'Susura Settings' }));

    const settingsClose = await screen.findByRole('button', { name: 'Close settings' });
    expect(settingsClose).toHaveClass('top-6', '-translate-y-1/2', 'left-3', 'size-[14px]', 'rounded-full', 'border-[0.5px]', 'border-[#FB1626]', 'bg-[#FF5C60]', 'shadow-none', 'hover:bg-[#FF5C60]', 'active:bg-[#D94D4F]', 'text-[#802F31]');
    expect(settingsClose).not.toHaveClass('hover:bg-muted');
    expect(settingsClose).not.toHaveClass('hover:bg-red-400');
    expect(settingsClose.className).not.toContain('shadow-[inset');
    expect(settingsClose).not.toHaveClass('right-3');
    expect(settingsClose).not.toHaveAttribute('data-variant');
    expect(settingsClose).toHaveClass('susura-mac-close-button');
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
    expect(promptTemplatesClose).toHaveClass('susura-mac-close-button');
    expect(promptTemplatesClose.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders the private overlay handle surface and toggles the full app overlay', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    window.history.pushState({}, '', '/?susura-surface=handle');

    render(<App />);

    expect(screen.getByLabelText('Susura overlay handle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Susura app' }).querySelector('.susura-handle-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Susura app' }).querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Susura app' })).not.toHaveTextContent('S');
    expect(screen.getByRole('button', { name: 'Toggle Susura app' })).toHaveAttribute('data-open', 'false');
    await user.click(screen.getByRole('button', { name: 'Toggle Susura app' }));

    expect(bridge.privateOverlayToggles).toBe(1);
    expect(bridge.privateOverlayState.overlayWindowVisible).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Toggle Susura app' })).toHaveAttribute('data-open', 'true');
    });
    expect(screen.getByRole('button', { name: 'Toggle Susura app' })).toHaveAttribute('data-open', 'true');
  });

  it('drags the circular private overlay handle without toggling the app overlay', () => {
    const bridge = installTestBridge();
    window.history.pushState({}, '', '/?susura-surface=handle');

    render(<App />);

    const handle = screen.getByRole('button', { name: 'Toggle Susura app' });

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
    window.history.pushState({}, '', '/?susura-surface=handle');

    render(<App />);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Toggle Susura app' }));

    expect(bridge.privateOverlayHandleMenuShows).toBe(1);
    expect(bridge.privateOverlayToggles).toBe(0);
  });

  it('drags the private overlay window from the title bar without toggling the app overlay', () => {
    const bridge = installTestBridge();

    render(<App />);

    const titleBar = screen.getByLabelText('Move Susura window');

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

  it('uses a centred title and macOS traffic-light close dot on macOS', async () => {
    installTestBridge({
      runtimeContext: testRuntimeContext({
        isMac: true,
        platform: 'darwin'
      })
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hide Susura app' })).toHaveAttribute('data-platform', 'macos');
    });

    expect(screen.getByLabelText('Move Susura window')).toHaveClass('justify-center');
    expect(screen.getByLabelText('Move Susura window').parentElement).toHaveClass('h-12');
    expect(screen.getByLabelText('Move Susura window')).toHaveClass('cursor-default');
    expect(screen.getByText('Susura')).toHaveClass('text-sm', 'font-medium');
    expect(screen.getByRole('button', { name: 'Hide Susura app' })).toHaveClass('left-3', 'size-[14px]', 'cursor-default', 'rounded-full', 'border-[0.5px]', 'border-[#FB1626]', 'bg-[#FF5C60]', 'shadow-none', 'hover:bg-[#FF5C60]', 'active:bg-[#D94D4F]');
    expect(screen.getByRole('button', { name: 'Hide Susura app' })).not.toHaveClass('hover:bg-red-400');
    expect(screen.getByRole('button', { name: 'Hide Susura app' }).className).not.toContain('shadow-[inset');
    expect(screen.getByRole('button', { name: 'Hide Susura app' }).querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Susura Settings' })).toHaveClass('right-1.5');
    expect(screen.getByRole('button', { name: 'Susura Settings' })).not.toHaveClass('left-1.5');
    expect(screen.getByRole('button', { name: 'Susura Settings' })).toHaveClass('border-border', 'bg-background');
  });

  it('keeps the top-right X close button on non-macOS platforms', async () => {
    installTestBridge({
      runtimeContext: testRuntimeContext({
        isMac: false,
        platform: 'win32'
      })
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Hide Susura app' })).toHaveAttribute('data-platform', 'desktop');
    });

    expect(screen.getByRole('button', { name: 'Hide Susura app' })).toHaveClass('right-1');
    expect(screen.getByRole('button', { name: 'Hide Susura app' })).toHaveClass('cursor-default');
    expect(screen.getByRole('button', { name: 'Hide Susura app' }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Susura Settings' })).toHaveClass('left-1.5');
    expect(screen.getByRole('button', { name: 'Susura Settings' })).not.toHaveClass('right-1.5');
    expect(screen.getByRole('button', { name: 'Susura Settings' })).toHaveClass('border-border', 'bg-background');
  });

  it.each([
    'top',
    'right',
    'bottom',
    'left'
  ] as const)('adapts home actions to the %s handle edge', async (handleEdge) => {
    const user = userEvent.setup();
    const expectedTooltipSide = {
      bottom: 'top',
      left: 'right',
      right: 'left',
      top: 'bottom'
    }[handleEdge];

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
      handleEdge === 'left' || handleEdge === 'right' ? 'stacked' : 'side-by-side'
    );

    const toolbar = screen.getByLabelText('Home actions');
    const transcriptSection = toolbar.querySelector('[data-toolbar-section="transcript"]');
    const aiSection = toolbar.querySelector('[data-toolbar-section="ai"]');

    expect(transcriptSection).toBeInTheDocument();
    expect(aiSection).toBeInTheDocument();

    if (handleEdge === 'left' || handleEdge === 'right') {
      expect(toolbar).toHaveClass('grid');
      expect(toolbar).toHaveClass('w-12');
      expect(toolbar).not.toHaveClass('w-16');
      expect(toolbar).toHaveClass('divide-y');
      expect(transcriptSection).toHaveClass('justify-between');
      expect(aiSection).toHaveClass('justify-between');
    } else {
      expect(toolbar).toHaveClass('grid');
      expect(toolbar).toHaveClass('divide-x');
      expect(aiSection).not.toHaveClass('border-l');
    }

    const transcriptQueries = within(transcriptSection as HTMLElement);
    const aiQueries = within(aiSection as HTMLElement);

    expect(transcriptQueries.getByRole('button', { name: 'Copy full transcript' })).toBeInTheDocument();
    expect(transcriptQueries.getByRole('button', { name: 'Download full transcript' })).toBeInTheDocument();
    expect(transcriptQueries.getByRole('button', { name: 'Send full transcript to AI' })).toBeInTheDocument();
    expect(transcriptQueries.queryByRole('button', { name: 'Prompt template' })).not.toBeInTheDocument();
    expect(transcriptQueries.queryByRole('button', { name: 'Manage prompt templates' })).not.toBeInTheDocument();

    expect(aiQueries.getByRole('button', { name: 'Prompt template' })).toBeInTheDocument();
    expect(aiQueries.getByRole('button', { name: 'Manage prompt templates' })).toBeInTheDocument();
    expect(aiQueries.queryByRole('button', { name: 'Send full transcript to AI' })).not.toBeInTheDocument();

    await user.hover(transcriptQueries.getByRole('button', { name: 'Start Listening' }));

    expect((await screen.findAllByText('Start listening to the selected audio sources'))
      .find((element) => element.getAttribute('data-slot') === 'tooltip-content'))
      .toHaveAttribute('data-side', expectedTooltipSide);

    await user.unhover(transcriptQueries.getByRole('button', { name: 'Start Listening' }));

    if (handleEdge === 'left' || handleEdge === 'right') {
      const templateButton = aiQueries.getByRole('button', { name: 'Prompt template' });
      const settingsButton = aiQueries.getByRole('button', { name: 'Manage prompt templates' });

      expect(templateButton).toHaveClass('size-9');
      expect(templateButton).not.toHaveClass('compact-prompt-template-trigger');
      expect(templateButton.querySelector('svg')).toBeInTheDocument();
      expect(templateButton.querySelector('svg + span + svg')).not.toBeInTheDocument();
      expect(templateButton.parentElement).toHaveClass('justify-center');
      expect(templateButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
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
    window.history.pushState({}, '', '/?susura-surface=overlay');

    render(<App />);

    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Susura private overlay')).not.toBeInTheDocument();
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

  it('shows long scroll fixture sections when requested in development', () => {
    window.history.pushState({}, '', '/?susura-scroll-fixture=1');

    const { container } = render(<App />);

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Launch readiness review fixture line 34');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Support handover fixture line 34');
    expect(screen.getByLabelText('AI response')).toHaveTextContent('Launch readiness review section 10');
    expect(screen.getByLabelText('AI response')).toHaveTextContent('Incident follow-up section 10');
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

  it('listens to system audio only by default', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSettings(user);

    const microphone = screen.getByRole('checkbox', { name: 'Microphone' });
    const systemAudio = screen.getByRole('checkbox', { name: 'Speaker' });

    expect(microphone).not.toBeChecked();
    expect(systemAudio).toBeChecked();

    await user.click(microphone);
    await user.click(systemAudio);

    expect(microphone).toBeChecked();
    expect(systemAudio).not.toBeChecked();
  });

  it('shows contextual permission action for a selected source in Settings', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
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

    expect(screen.queryByText('Permissions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Permissions required: Screen & System Audio Recording' })).toHaveTextContent('Click here to grant permission for Speaker: Screen & System Audio Recording');
    expect(screen.queryByRole('button', { name: 'Permissions required: Microphone' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Permissions required: Screen & System Audio Recording' }));

    expect(bridge.requestedPermissions).toEqual(['screen-recording']);
  });

  it('shows contextual permission actions for selected sources without permission', async () => {
    const user = userEvent.setup();
    installTestBridge({
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
          status: 'not-determined'
        }
      ]
    });

    render(<App />);

    await openSettings(user);

    expect(screen.getByRole('button', { name: 'Permissions required: Screen & System Audio Recording' })).toHaveTextContent('Click here to grant permission for Speaker: Screen & System Audio Recording');
    expect(screen.queryByRole('button', { name: 'Permissions required: Microphone' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Microphone' }));

    expect(screen.getByRole('button', { name: 'Permissions required: Screen & System Audio Recording' })).toHaveTextContent('Click here to grant permission for Speaker: Screen & System Audio Recording');
    expect(screen.getByRole('button', { name: 'Permissions required: Microphone' })).toHaveTextContent('Click here to grant permission for Microphone: Microphone access');

    await user.click(screen.getByRole('checkbox', { name: 'Speaker' }));

    expect(screen.queryByRole('button', { name: 'Permissions required: Screen & System Audio Recording' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Permissions required: Microphone' })).toHaveTextContent('Click here to grant permission for Microphone: Microphone access');
  });

  it('does not show permission actions when selected listening sources have permission', async () => {
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

    expect(screen.queryByRole('button', { name: /Permissions required/ })).not.toBeInTheDocument();
  });

  it('blocks Start Listening and shows top bar permission action when a selected source is missing permission', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
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

    const permissionButton = await screen.findByRole('button', { name: 'Open Settings for permissions required' });

    expect(permissionButton).toBeInTheDocument();
    expect(permissionButton).toHaveTextContent('!');
    expect(permissionButton).toHaveClass('whitespace-normal');
    expect(permissionButton).toHaveClass('size-9');
    expect(screen.queryByRole('button', { name: 'Start Listening' })).not.toBeInTheDocument();
    await user.click(permissionButton);

    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Permissions required: Screen & System Audio Recording' })).toHaveTextContent('Click here to grant permission for Speaker: Screen & System Audio Recording');
    expect(bridge.requestedPermissions).toEqual([]);
    expect(bridge.starts).toEqual([]);
  });

  it('places the generic permission action before Auto Send in the horizontal home toolbar', async () => {
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
    const permissionButton = await waitFor(() => toolbarQueries.getByRole('button', {
      name: 'Open Settings for permissions required'
    }));
    const autoSendButton = await waitFor(() => {
      return toolbarQueries.getByRole('button', { name: 'Auto Send' });
    });

    expect(permissionButton).toHaveTextContent('Permissions required');
    expect(
      permissionButton.compareDocumentPosition(autoSendButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('keeps transcript actions before AI template controls in the horizontal home toolbar', async () => {
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
    expect(toolbar).toHaveClass('grid');
    expect(toolbar).toHaveClass('divide-x');
    expect(aiSection).not.toHaveClass('border-l');
    expect(aiSection).not.toHaveClass('justify-end');
    expect(aiSection).toHaveClass('justify-center');

    const transcriptQueries = within(transcriptSection as HTMLElement);
    const aiQueries = within(aiSection as HTMLElement);
    const copyButton = transcriptQueries.getByRole('button', { name: 'Copy full transcript' });
    const downloadButton = transcriptQueries.getByRole('button', { name: 'Download full transcript' });
    const sendButton = transcriptQueries.getByRole('button', { name: 'Send full transcript to AI' });
    const templateButton = aiQueries.getByRole('button', { name: 'Prompt template' });
    const settingsButton = aiQueries.getByRole('button', { name: 'Manage prompt templates' });

    expect(copyButton.parentElement?.parentElement).toHaveClass('ml-auto');
    expect(templateButton.parentElement).toHaveClass('w-auto');
    expect(templateButton.parentElement).toHaveClass('justify-center');
    expect(settingsButton).not.toHaveClass('ml-auto');
    expect(copyButton.compareDocumentPosition(downloadButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(downloadButton.compareDocumentPosition(sendButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(templateButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('requests fresh macOS permissions once for a brand new user', async () => {
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
          status: 'not-determined'
        }
      ]
    });

    render(<App />);

    await waitFor(() => {
      expect(bridge.requestedPermissions).toEqual(['screen-recording', 'microphone']);
    });
    expect(window.localStorage.getItem('susura.initial-permission-requested')).toBe('1');
  });

  it('toggles listening with one button', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeInTheDocument();
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('Live transcription is unavailable in this environment.');
  });

  it('passes selected sources exactly to native transcription', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    expect(bridge.starts.at(-1)).toEqual({ sources: ['system'] });
    await user.click(await screen.findByRole('button', { name: 'Stop Listening' }));

    await openSettings(user);
    await user.click(screen.getByRole('checkbox', { name: 'Microphone' }));
    await user.click(screen.getByRole('checkbox', { name: 'Speaker' }));
    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    expect(bridge.starts.at(-1)).toEqual({ sources: ['microphone'] });
  });

  it('prepares selected transcription sources while idle', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    expect(bridge.prepares.at(-1)).toEqual({ sources: ['system'] });

    await openSettings(user);
    await user.click(screen.getByRole('checkbox', { name: 'Microphone' }));

    expect(bridge.prepares.at(-1)).toEqual({ sources: ['system', 'microphone'] });
  });

  it('prefixes transcript chunks by source when speaker and microphone are both selected', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await user.click(screen.getByRole('checkbox', { name: 'Microphone' }));
    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        source: 'system',
        utteranceId: 1,
        text: 'What is the timeline?'
      });
      bridge.emit({
        type: 'completed',
        source: 'microphone',
        utteranceId: 1,
        text: 'I can answer that.'
      });
    });

    const output = screen.getByLabelText('Transcription output').textContent ?? '';
    expect(output).not.toContain('Transcript started:');
    expect(output).toContain('[Speaker]: What is the timeline?');
    expect(output).toContain('[Microphone]: I can answer that.');
  });

  it('shows source labels immediately after transcript timestamps', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await user.click(screen.getByRole('checkbox', { name: 'Microphone' }));
    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        source: 'microphone',
        utteranceId: 1,
        text: 'Hello, hello, hello.'
      });
    });

    const output = screen.getByLabelText('Transcription output').textContent ?? '';
    expect(output).toMatch(/\[\d{2}:\d{2}:\d{2}(?:\s?[AP]M)?\]\s*\[Microphone\]: Hello, hello, hello\./);
  });

  it('timestamps transcript chunks from their start time', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    const startedAt = new Date();
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

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
    }).format(new Date(startedAt.getTime() + 2_000));
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

  it('keeps simultaneous live partial transcript chunks independent per source', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await user.click(screen.getByRole('checkbox', { name: 'Microphone' }));
    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'partial',
        source: 'system',
        startMs: 1_000,
        utteranceId: 1,
        text: 'Speaker partial'
      });
      bridge.emit({
        type: 'partial',
        source: 'microphone',
        startMs: 1_500,
        utteranceId: 1,
        text: 'Microphone partial'
      });
    });

    const output = screen.getByLabelText('Transcription output');
    expect(output).toHaveTextContent('[Speaker]: Speaker partial');
    expect(output).toHaveTextContent('[Microphone]: Microphone partial');

    act(() => {
      bridge.emit({
        type: 'completed',
        source: 'system',
        startMs: 1_000,
        utteranceId: 1,
        text: 'Speaker final'
      });
    });

    expect(output).toHaveTextContent('[Speaker]: Speaker final');
    expect(output).not.toHaveTextContent('Speaker partial');
    expect(output).toHaveTextContent('[Microphone]: Microphone partial');
  });

  it('locks audio source selection while listening', async () => {
    const user = userEvent.setup();
    installTestBridge();

    render(<App />);

    await openSettings(user);

    const microphone = screen.getByRole('checkbox', { name: 'Microphone' });
    const systemAudio = screen.getByRole('checkbox', { name: 'Speaker' });

    expect(microphone).not.toBeDisabled();
    expect(systemAudio).not.toBeDisabled();

    await openHome(user);
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));
    await openSettings(user);

    expect(screen.getByRole('checkbox', { name: 'Microphone' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Speaker' })).toBeDisabled();
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
    expect(await screen.findByText('Summarise this phone call')).toBeInTheDocument();

    await user.click(screen.getByText('Summarise this phone call'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Prompt template' })).toHaveTextContent('Summarise this phone call');
    });
    expect(screen.queryByLabelText('Search prompt templates')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prompt template' }));
    await user.type(screen.getByLabelText('Search prompt templates'), 'action');
    expect(screen.getByText('Extract action items')).toBeInTheDocument();
    expect(screen.getAllByText('Summarise this phone call')).toHaveLength(1);
  });

  it('keeps the clicked prompt template selected when the bridge returns stale selection state', async () => {
    const user = userEvent.setup();
    installTestBridge({
      setSelectedPromptTemplate: async (_id, state) => ({
        ...state,
        selectedTemplateId: null
      })
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Prompt template' }));
    await user.click(await screen.findByText('Summarise this phone call'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Prompt template' })).toHaveTextContent('Summarise this phone call');
    });
  });

  it('creates edits and deletes prompt templates in the modal', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Manage prompt templates' }));
    await user.click(screen.getByRole('button', { name: 'New template' }));
    await user.type(screen.getByLabelText('Name'), 'Risk summary');
    await user.type(screen.getByLabelText('Prompt'), 'Summarise risks from this transcript.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        attachments: [],
        name: 'Risk summary',
        prompt: 'Summarise risks from this transcript.'
      })
    ]));

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Risk and actions');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Risk and actions' })
    ]));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(bridge.promptTemplateState.templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Risk and actions' })
    ]));

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(bridge.promptTemplateState.templates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Risk and actions' })
    ]));
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

    await user.click(screen.getByRole('button', { name: 'Save' }));
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
    await user.click(await screen.findByText('Summarise this phone call'));
    await user.click(await screen.findByRole('button', { name: 'Start Listening' }));

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'Discussed renewal timelines.'
      });
    });

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(bridge.llmRequests.at(-1)?.transcript).toContain('Summarise this phone call clearly.');
    expect(bridge.llmRequests.at(-1)?.transcript).toContain('Transcript:');
    expect(bridge.llmRequests.at(-1)?.transcript).toContain('Discussed renewal timelines.');
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

    expect(screen.getByRole('button', { name: 'Copy full transcript' })).toBeDisabled();

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
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:susura-transcript');
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
    expect(downloadName).toMatch(/^susura-transcript-\d{14}\.txt$/);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:susura-transcript');

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('downloads Word transcripts as docx and preserves line breaks', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:susura-transcript');
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

    expect(downloadName).toMatch(/^susura-transcript-\d{14}\.docx$/);
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
    const bridge = installTestBridge();

    render(<App />);

    await openSettings(user);
    await selectSetting(user, 'Model', '5.5');
    await selectSetting(user, 'Reasoning', 'Low');
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

  it('resets settings to their defaults', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
      promptTemplateState: testPromptTemplateState({
        selectedTemplateId: 'custom-template',
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
    expect(screen.getByText(/This deletes saved prompt templates\./)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Microphone' }));
    await user.click(screen.getByRole('checkbox', { name: 'Speaker' }));
    await selectSetting(user, 'Model', '5.5');
    await selectSetting(user, 'Reasoning', 'Low');

    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));

    expect(bridge.settingsResets).toBe(0);
    expect(screen.getByRole('dialog', { name: 'Reset settings?' })).toBeInTheDocument();
    expect(screen.getByText(/Saved prompt templates will be deleted\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset Settings' }));

    expect(bridge.settingsResets).toBe(1);
    expect(screen.getByRole('checkbox', { name: 'Microphone' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Speaker' })).toBeChecked();
    expect(bridge.promptTemplateState.selectedTemplateId).toBeNull();
    expect(bridge.promptTemplateState.templates).toEqual([
      expect.objectContaining({ id: 'starter-summarise-phone-call' }),
      expect.objectContaining({ id: 'starter-extract-action-items' }),
      expect.objectContaining({ id: 'starter-draft-follow-up-email' })
    ]);
    expect(bridge.promptTemplateState.templates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-template' })
    ]));

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

  it('shows a spinner instead of loading text while waiting for the first LLM token', async () => {
    const user = userEvent.setup();
    const bridge = installTestBridge({
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
    expect(screen.getByLabelText('Waiting for response')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await waitFor(() => {
      expect(bridge.llmRequests.at(-1)?.transcript).toContain('final flushed transcript');
    });
    expect(bridge.llmRequests.at(-1)?.transcript).not.toContain('partial transcript before stop');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('final flushed transcript');
  });

  it('keeps partial transcript text as the stop fallback when no final chunk arrives', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    await waitFor(() => {
      expect(bridge.llmRequests.at(-1)?.transcript).toContain('partial transcript survives stop');
    });
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('partial transcript survives stop');
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

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'confirmed local transcript'
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('confirmed local transcript');
    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('volatile local transcript');

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

  it('shows local partial text until a final chunk replaces it', async () => {
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

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'the final sentence is ready'
      });
    });

    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('the rolling preview');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('the final sentence is ready');
  });

  it('replaces a longer live partial when its final transcript arrives', async () => {
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

    act(() => {
      bridge.emit({
        type: 'completed',
        utteranceId: 1,
        text: 'this is final'
      });
    });

    expect(screen.getByLabelText('Transcription output')).not.toHaveTextContent('this is a longer live partial transcript');
    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('this is final');
  });

  it('shows very early timed partials immediately for lowest transcript latency', async () => {
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

    act(() => {
      bridge.emit({
        endMs: 1600,
        startMs: 0,
        text: 'more stable first phrase',
        type: 'partial',
        utteranceId: 1
      });
    });

    expect(screen.getByLabelText('Transcription output')).toHaveTextContent('more stable first phrase');
  });

  it('shows when listening has no selected audio source', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openSettings(user);
    await user.click(screen.getByRole('checkbox', { name: 'Speaker' }));
    await openHome(user);

    expect(await screen.findByRole('button', { name: 'Start Listening' })).toBeDisabled();
  });

  it('keeps start disabled until LLM prewarming completes', async () => {
    let emitLlmStatus: ((status: { ok: boolean; ready: boolean; status: 'warming' | 'ready' | 'error' | 'disabled' }) => void) | null = null;

    installTestBridge({
      llmReady: false,
      onLlmStatus: (callback) => {
        emitLlmStatus = callback;

        return () => {
          emitLlmStatus = null;
        };
      }
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Preparing...' })).toBeDisabled();

    act(() => {
      emitLlmStatus?.({
        ok: true,
        ready: true,
        status: 'ready'
      });
    });

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
    vi.stubEnv('VITE_SUSURA_SPECULATIVE_LLM', '1');
    vi.stubEnv('VITE_SUSURA_SPECULATIVE_LLM_DELAY_MS', '20');
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
      'Auto Send is on.\nStop listening to send to AI.',
      { normalizeWhitespace: false }
    );

    await user.click(screen.getByRole('button', { name: 'Stop Listening' }));

    expect(screen.getByLabelText('AI response')).toHaveTextContent('manual llm answer');
  });

  it('falls back to a normal LLM request when speculative transcript is stale', async () => {
    vi.stubEnv('VITE_SUSURA_SPECULATIVE_LLM', '1');
    vi.stubEnv('VITE_SUSURA_SPECULATIVE_LLM_DELAY_MS', '20');
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
  await user.click(screen.getByRole('button', { name: 'Susura Settings' }));
  await screen.findByText('Listen to your:');
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
  await user.click(screen.getByLabelText(label));
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
  privateOverlayState?: PrivateOverlayState;
  promptTemplateState?: PromptTemplateState;
  requestLlm?: (options: {
    attachments?: PromptTemplateAttachment[];
    model: string;
    requestId?: string;
    reasoning: string;
    transcript: string;
  }) => Promise<{ ok: boolean; text: string }>;
  runtimeContext?: RuntimeContext;
  setSelectedPromptTemplate?: (id: string | null, state: PromptTemplateState) => Promise<PromptTemplateState>;
  stop?: (emit: (event: TranscriptionBridgeEvent) => void) => Promise<{ ok: boolean }> | { ok: boolean };
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
  let settingsResets = 0;
  const savedPiModels: string[] = [];
  let parakeetStatus = overrides.parakeetStatus ?? testParakeetStatus();
  let piStatus = overrides.piStatus ?? testPiStatus();
  let privateOverlayHandleDragStarts = 0;
  let privateOverlayHandleDragMoves = 0;
  let privateOverlayHandleDragEnds = 0;
  let privateOverlayHandleMenuShows = 0;
  let privateOverlayWindowDragStarts = 0;
  let privateOverlayWindowDragMoves = 0;
  let privateOverlayWindowDragEnds = 0;
  let privateOverlayToggles = 0;
  let privateOverlayShowMainCalls = 0;
  let privateOverlayPanicHides = 0;
  let privateOverlayResetHandlePositionCalls = 0;
  let privateOverlayState = overrides.privateOverlayState ?? testPrivateOverlayState();
  let emitPrivateOverlayState: ((state: PrivateOverlayState) => void) | null = null;

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

  window.susura = {
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

        return { ok: true };
      },
      status: async () => ({
        ok: true,
        permissions: overrides.permissions ?? [
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
            status: 'granted'
          }
        ],
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
        disconnect: async () => {
          piStatus = testPiStatus({ connected: false, selectedModel: null, status: 'disconnected' });
          return piStatus;
        },
        openLogin: async () => ({ ok: true }),
        openModel: async () => ({ ok: true }),
        saveModel: async (model) => {
          savedPiModels.push(model);
          piStatus = testPiStatus({ connected: true, selectedModel: model, status: 'ready' });
          return piStatus;
        },
        status: async () => piStatus
      },
      onboarding: {
        complete: async () => overrides.onboardingStatus ?? testOnboardingStatus({
          parakeet: parakeetStatus,
          permissions: await window.susura!.permissions!.status(),
          pi: piStatus
        }),
        open: async () => overrides.onboardingStatus ?? testOnboardingStatus({
          parakeet: parakeetStatus,
          permissions: await window.susura!.permissions!.status(),
          pi: piStatus
        }),
        status: async () => overrides.onboardingStatus ?? testOnboardingStatus({
          parakeet: parakeetStatus,
          permissions: await window.susura!.permissions!.status(),
          pi: piStatus
        })
      },
      parakeet: {
        cancelDownload: async () => {
          parakeetStatus = testParakeetStatus({ installed: false, status: 'missing' });
          return parakeetStatus;
        },
        download: async () => {
          parakeetStatus = testParakeetStatus({ installed: true, status: 'installed' });
          return parakeetStatus;
        },
        onStatus: () => () => undefined,
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
            selectedTemplateId: promptTemplateState.selectedTemplateId === id ? null : promptTemplateState.selectedTemplateId,
            templates: promptTemplateState.templates.filter((template) => template.id !== id)
          };

          return promptTemplateState;
        },
        list: async () => promptTemplateState,
        reset: async () => {
          promptTemplateState = testPromptTemplateState({
            selectedTemplateId: null,
            templates: [
              testPromptTemplate({
                id: 'starter-summarise-phone-call',
                name: 'Summarise this phone call',
                prompt: 'Summarise this phone call clearly. Include the main points, decisions, open questions and follow-up actions.'
              }),
              testPromptTemplate({
                id: 'starter-extract-action-items',
                name: 'Extract action items',
                prompt: 'Extract action items from this transcript. Include owner, task and due date when available.'
              }),
              testPromptTemplate({
                id: 'starter-draft-follow-up-email',
                name: 'Draft follow-up email',
                prompt: 'Draft a concise follow-up email based on this transcript. Include decisions, action items and next steps.'
              })
            ]
          });

          return promptTemplateState;
        },
        save: async (template) => {
          promptTemplateState = {
            ok: true,
            selectedTemplateId: promptTemplateState.selectedTemplateId,
            templates: promptTemplateState.templates.some((item) => item.id === template.id)
              ? promptTemplateState.templates.map((item) => (item.id === template.id ? template : item))
              : [...promptTemplateState.templates, template]
          };

          return promptTemplateState;
        },
        setSelected: async (id) => {
          if (overrides.setSelectedPromptTemplate) {
            promptTemplateState = await overrides.setSelectedPromptTemplate(id, promptTemplateState);

            return promptTemplateState;
          }

          promptTemplateState = {
            ...promptTemplateState,
            selectedTemplateId: id
          };

          return promptTemplateState;
        }
      },
      reset: async () => {
        settingsResets += 1;
        promptTemplateState = testPromptTemplateState({
          selectedTemplateId: null,
          templates: [
            testPromptTemplate({
              id: 'starter-summarise-phone-call',
              name: 'Summarise this phone call',
              prompt: 'Summarise this phone call clearly. Include the main points, decisions, open questions and follow-up actions.'
            }),
            testPromptTemplate({
              id: 'starter-extract-action-items',
              name: 'Extract action items',
              prompt: 'Extract action items from this transcript. Include owner, task and due date when available.'
            }),
            testPromptTemplate({
              id: 'starter-draft-follow-up-email',
              name: 'Draft follow-up email',
              prompt: 'Draft a concise follow-up email based on this transcript. Include decisions, action items and next steps.'
            })
          ]
        });

        return { ok: true };
      },
      quit: async () => ({ ok: true })
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
    prepares,
    requestedPermissions,
    savedPiModels,
    starts,
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
    get settingsResets() {
      return settingsResets;
    },
    emit: (event: TranscriptionBridgeEvent) => {
      emitTranscriptionEvent?.(event);
    }
  };
}

function testPromptTemplateState(overrides: Partial<PromptTemplateState> = {}): PromptTemplateState {
  return {
    ok: true,
    selectedTemplateId: overrides.selectedTemplateId ?? null,
    templates: overrides.templates ?? [
      testPromptTemplate({
        id: 'starter-summarise-phone-call',
        name: 'Summarise this phone call',
        prompt: 'Summarise this phone call clearly. Include the main points, decisions, open questions and follow-up actions.'
      }),
      testPromptTemplate({
        id: 'starter-extract-action-items',
        name: 'Extract action items',
        prompt: 'Extract action items from this transcript. Include owner, task and due date when available.'
      }),
      testPromptTemplate({
        id: 'starter-draft-follow-up-email',
        name: 'Draft follow-up email',
        prompt: 'Draft a concise follow-up email based on this transcript. Include decisions, action items and next steps.'
      })
    ]
  };
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
    modelDir: overrides.modelDir ?? '/tmp/susura/models/parakeet-tdt-0.6b-v3-int8',
    ok: overrides.ok ?? true,
    progress: overrides.progress,
    status: overrides.status ?? 'installed'
  };
}

function testPiStatus(overrides: Partial<PiStatus> = {}): PiStatus {
  return {
    agentDir: overrides.agentDir ?? '/tmp/susura/pi-agent',
    bundled: overrides.bundled ?? true,
    connected: overrides.connected ?? false,
    ok: overrides.ok ?? true,
    selectedModel: overrides.selectedModel ?? null,
    status: overrides.status ?? 'disconnected'
  };
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
  const complete = overrides.complete ?? (
    permissions.permissions.every((permission) => permission.status === 'granted')
    && parakeet.installed
    && pi.connected
  );

  return {
    complete,
    completedAt: overrides.completedAt ?? null,
    ok: overrides.ok ?? true,
    parakeet,
    permissions,
    pi,
    required: overrides.required ?? !complete
  };
}

function testRuntimeContext(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    arch: overrides.arch ?? 'arm64',
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
  const handleSize = 32;
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './tooltip';

describe('Tooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset.caulSuppressTooltips;
    delete document.documentElement.dataset.caulSuppressTooltipsAt;
  });

  it('opens on focus and closes with Escape while preserving trigger focus', async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>Focus help</TooltipTrigger>
          <TooltipContent>Focused help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await user.tab();

    const trigger = screen.getByRole('button', { name: 'Focus help' });
    expect(trigger).toHaveFocus();
    expect(await screen.findByText('Focused help')).toHaveAttribute(
      'data-slot',
      'tooltip-content'
    );

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByText('Focused help')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('opens on hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>Hover help</TooltipTrigger>
          <TooltipContent>Hovered help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const trigger = screen.getByRole('button', { name: 'Hover help' });
    await user.hover(trigger);

    expect(await screen.findByText('Hovered help')).toHaveAttribute(
      'data-slot',
      'tooltip-content'
    );

    await user.unhover(trigger);

    await waitFor(() => expect(screen.queryByText('Hovered help')).not.toBeInTheDocument());
  });

  it('uses a 300 ms hover delay by default', async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();

    render(
      <TooltipProvider>
        <Tooltip onOpenChange={onOpenChange}>
          <TooltipTrigger>Delayed help</TooltipTrigger>
          <TooltipContent>Delayed content</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const trigger = screen.getByRole('button', { name: 'Delayed help' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(true, expect.objectContaining({
      reason: 'trigger-hover'
    }));
  });

  it('does not open from a disabled trigger', async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger disabled>Unavailable help</TooltipTrigger>
          <TooltipContent>Unavailable content</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const trigger = screen.getByRole('button', { name: 'Unavailable help' });
    await user.hover(trigger);
    trigger.focus();

    expect(trigger).toHaveAttribute('data-trigger-disabled');
    expect(screen.queryByText('Unavailable content')).not.toBeInTheDocument();
  });

  it('portals Positioner and Popup and forwards positioning options', async () => {
    const sideOffset = vi.fn(() => 11);
    const alignOffset = vi.fn(() => 7);
    const { container } = render(
      <TooltipProvider delay={0}>
        <Tooltip open>
          <TooltipTrigger>Position help</TooltipTrigger>
          <TooltipContent
            side="top"
            align="end"
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            collisionPadding={18}
          >
            Positioned help
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const popup = await screen.findByText('Positioned help');
    const positioner = popup.closest('[data-slot="tooltip-positioner"]');

    expect(container).not.toContainElement(popup);
    expect(document.body).toContainElement(popup);
    expect(popup).toHaveAttribute('data-slot', 'tooltip-content');
    expect(positioner).toHaveAttribute('role', 'presentation');
    await waitFor(() => {
      expect(positioner).toHaveAttribute('data-side', 'top');
      expect(positioner).toHaveAttribute('data-align', 'end');
      expect(positioner).toHaveStyle({ transform: 'translate(-18px, -11px)' });
      expect(sideOffset).toHaveBeenCalled();
      expect(alignOffset).toHaveBeenCalled();
    });
  });

  it('allows an explicitly interactive popup', async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip open disableHoverablePopup={false}>
          <TooltipTrigger>Interactive help</TooltipTrigger>
          <TooltipContent className="pointer-events-auto">
            <button type="button">Tooltip action</button>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const popup = await waitFor(() => {
      const element = document.querySelector('[data-slot="tooltip-content"]');
      expect(element).toBeInTheDocument();
      return element as HTMLElement;
    });
    const positioner = popup.closest('[data-slot="tooltip-positioner"]');

    expect(popup).toHaveClass('pointer-events-auto');
    expect(popup).not.toHaveClass('pointer-events-none');
    expect(positioner).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Tooltip action' })).toBeInTheDocument();
  });

  it('opens an adjacent tooltip immediately within the provider timeout', async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delay={300} timeout={400}>
        <Tooltip>
          <TooltipTrigger>First help</TooltipTrigger>
          <TooltipContent>First content</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>Second help</TooltipTrigger>
          <TooltipContent>Second content</TooltipContent>
        </Tooltip>
        <button type="button">Outside</button>
      </TooltipProvider>
    );

    const firstTrigger = screen.getByRole('button', { name: 'First help' });
    const secondTrigger = screen.getByRole('button', { name: 'Second help' });
    const outside = screen.getByRole('button', { name: 'Outside' });

    firstTrigger.focus();
    expect(await screen.findByText('First content')).toBeInTheDocument();

    outside.focus();
    await waitFor(() => expect(screen.queryByText('First content')).not.toBeInTheDocument());

    await user.hover(secondTrigger);

    expect(screen.getByText('Second content')).toBeInTheDocument();
  });

  it('uses the maintained overlay layer without an inline z-index', () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltipContent = document.querySelector('[data-slot="tooltip-content"]');

    expect(tooltipContent).toHaveClass('z-50');
    expect(tooltipContent).not.toHaveClass('z-[2147483647]');
    expect(tooltipContent).not.toHaveStyle({ zIndex: '2147483647' });
    expect(tooltipContent?.closest('[data-slot="tooltip-positioner"]')).toHaveClass('z-50');
  });

  it('keeps tooltip content from intercepting adjacent trigger hovers', () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltipContent = document.querySelector('[data-slot="tooltip-content"]');

    expect(tooltipContent).toHaveClass('pointer-events-none');
  });

  it('suppresses the first tooltip when a fresh global suppression is active', () => {
    document.documentElement.dataset.caulSuppressTooltips = 'true';
    document.documentElement.dataset.caulSuppressTooltipsAt = String(Date.now());

    render(
      <TooltipProvider delay={0}>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.caulSuppressTooltips).toBeUndefined();
    expect(document.documentElement.dataset.caulSuppressTooltipsAt).toBeUndefined();
  });

  it('clears stale global suppression instead of hiding tooltips forever', () => {
    document.documentElement.dataset.caulSuppressTooltips = 'true';
    document.documentElement.dataset.caulSuppressTooltipsAt = String(Date.now() - 2000);

    render(
      <TooltipProvider delay={0}>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent('Tooltip body');
    expect(document.documentElement.dataset.caulSuppressTooltips).toBeUndefined();
    expect(document.documentElement.dataset.caulSuppressTooltipsAt).toBeUndefined();
  });
});

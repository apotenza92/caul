import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { MacosWindowButton } from '@/components/domain-ui/macos-window-button';
import { OverlayHandleButton } from '@/components/domain-ui/overlay-handle-button';
import { OverlayResizeHandles } from '@/components/domain-ui/overlay-resize-handles';
import { AppTooltipContent } from '@/components/domain-ui/app-tooltip-content';
import { VerticalToggleGroup } from '@/components/domain-ui/vertical-toggle-group';
import { Button } from '@/components/ui/button';
import { ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

describe('domain UI exceptions', () => {
  it('keeps macos-window-button keyboard accessible', async () => {
    const onClick = vi.fn();
    render(
      <MacosWindowButton
        action="close"
        aria-label="Close test window"
        onClick={onClick}
        placement="titlebar"
      />
    );

    const button = screen.getByRole('button', { name: 'Close test window' });
    expect(button).toHaveAttribute('data-domain-ui', 'macos-window-button');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  });

  it('keeps overlay-handle-button labelled and forwards its product-specific context action', async () => {
    const onContextMenu = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(
      <OverlayHandleButton aria-label="Toggle test overlay" onContextMenu={onContextMenu} open={false} />
    );

    const button = screen.getByRole('button', { name: 'Toggle test overlay' });
    expect(button).toHaveAttribute('data-domain-ui', 'overlay-handle-button');
    fireEvent.contextMenu(button);
    expect(onContextMenu).toHaveBeenCalledOnce();
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  });

  it('keeps overlay-resize-handles hidden from accessibility APIs and forwards native resize events', async () => {
    const resizeWindowStart = vi.fn(async () => ({}));
    const resizeWindowMove = vi.fn(async () => undefined);
    const resizeWindowEnd = vi.fn(async () => ({}));
    window.caul = {
      privateOverlay: {
        resizeWindowStart,
        resizeWindowMove,
        resizeWindowEnd
      }
    } as unknown as typeof window.caul;

    const { container } = render(<OverlayResizeHandles />);
    const root = container.querySelector('[data-domain-ui="overlay-resize-handles"]');
    const north = container.querySelector('[data-resize-direction="n"]');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(north).not.toBeNull();

    fireEvent.pointerDown(north!, { button: 0, pointerId: 7, screenX: 100, screenY: 200 });
    fireEvent.pointerMove(north!, { pointerId: 7, screenX: 100, screenY: 190 });
    fireEvent.pointerUp(north!, { pointerId: 7, screenX: 100, screenY: 190 });
    expect(resizeWindowStart).toHaveBeenCalledWith({ direction: 'n', screenX: 100, screenY: 200 });
    expect(resizeWindowMove).toHaveBeenCalledWith({ direction: 'n', screenX: 100, screenY: 190 });
    expect(resizeWindowEnd).toHaveBeenCalledWith({ direction: 'n', screenX: 100, screenY: 190 });
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  });

  it('restores vertical roving focus and additive selection without changing the generated ToggleGroup', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <VerticalToggleGroup defaultValue={['first']} multiple onValueChange={onValueChange}>
        <ToggleGroupItem value="first">First</ToggleGroupItem>
        <ToggleGroupItem value="second">Second</ToggleGroupItem>
        <ToggleGroupItem value="third">Third</ToggleGroupItem>
      </VerticalToggleGroup>
    );

    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });
    expect(first.closest('[data-domain-ui="vertical-toggle-group"]')).not.toBeNull();
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith(['first', 'second'], expect.anything());
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  });

  it('suppresses the first fresh tooltip after the overlay opens', () => {
    document.documentElement.dataset.caulSuppressTooltips = 'true';
    document.documentElement.dataset.caulSuppressTooltipsAt = String(Date.now());

    const { container } = render(<AppTooltipContent>Suppressed tooltip</AppTooltipContent>);
    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement.dataset.caulSuppressTooltips).toBeUndefined();
    expect(document.documentElement.dataset.caulSuppressTooltipsAt).toBeUndefined();
  });

  it('scrolls the actual interactive preview popup under the pointer', () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger render={<Button>Preview</Button>} />
          <AppTooltipContent previewScrollable>Scrollable preview</AppTooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const popup = screen.getByText('Scrollable preview').closest('[data-domain-ui="app-tooltip-content"]');
    expect(popup).not.toBeNull();
    Object.defineProperties(popup!, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 }
    });
    fireEvent.wheel(popup!, { deltaY: 60 });
    expect(popup).toHaveProperty('scrollTop', 60);
  });
});

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './tooltip';

describe('Tooltip', () => {
  afterEach(() => {
    delete document.documentElement.dataset.susuraSuppressTooltips;
    delete document.documentElement.dataset.susuraSuppressTooltipsAt;
  });

  it('renders above app, modal and popover layers', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltipContent = document.querySelector('[data-slot="tooltip-content"]');

    expect(tooltipContent).toHaveClass('z-[2147483647]');
    expect(tooltipContent).toHaveStyle({ zIndex: '2147483647' });
  });

  it('keeps tooltip content from intercepting adjacent trigger hovers', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltipContent = document.querySelector('[data-slot="tooltip-content"]');

    expect(tooltipContent).toHaveClass('pointer-events-none');
  });

  it('clears stale global suppression instead of hiding tooltips forever', () => {
    document.documentElement.dataset.susuraSuppressTooltips = 'true';
    document.documentElement.dataset.susuraSuppressTooltipsAt = String(Date.now() - 2000);

    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent('Tooltip body');
    expect(document.documentElement.dataset.susuraSuppressTooltips).toBeUndefined();
    expect(document.documentElement.dataset.susuraSuppressTooltipsAt).toBeUndefined();
  });
});

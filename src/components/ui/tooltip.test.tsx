import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './tooltip';

describe('Tooltip', () => {
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
});

import { type ComponentProps, type WheelEvent } from 'react';
import { TooltipContent } from '@/components/ui/tooltip';

const tooltipSuppressionStaleMs = 1000;

export function consumeFreshTooltipSuppression(now = Date.now()) {
  if (typeof document === 'undefined' || document.documentElement.dataset.caulSuppressTooltips !== 'true') {
    return false;
  }

  const suppressedAt = Number(document.documentElement.dataset.caulSuppressTooltipsAt ?? 0);
  delete document.documentElement.dataset.caulSuppressTooltips;
  delete document.documentElement.dataset.caulSuppressTooltipsAt;

  return Number.isFinite(suppressedAt) && now - suppressedAt < tooltipSuppressionStaleMs;
}

function scrollTooltip(event: WheelEvent<HTMLElement>) {
  const tooltip = event.currentTarget;
  const maximumTop = Math.max(0, tooltip.scrollHeight - tooltip.clientHeight);
  const maximumLeft = Math.max(0, tooltip.scrollWidth - tooltip.clientWidth);
  const nextTop = Math.min(maximumTop, Math.max(0, tooltip.scrollTop + event.deltaY));
  const nextLeft = Math.min(maximumLeft, Math.max(0, tooltip.scrollLeft + event.deltaX));

  if (nextTop === tooltip.scrollTop && nextLeft === tooltip.scrollLeft) return;
  tooltip.scrollTop = nextTop;
  tooltip.scrollLeft = nextLeft;
  event.preventDefault();
  event.stopPropagation();
}

type AppTooltipContentProps = ComponentProps<typeof TooltipContent> & {
  previewScrollable?: boolean;
};

// The official Tooltip was considered and remains the rendered control. This
// application composition restores Caul's overlay-open suppression and scrollable
// transcript previews without changing canonical generated source.
export function AppTooltipContent({ onWheel, previewScrollable = false, ...props }: AppTooltipContentProps) {
  if (consumeFreshTooltipSuppression()) return null;

  return (
    <TooltipContent
      {...props}
      data-domain-ui="app-tooltip-content"
      data-preview-scroll={previewScrollable ? 'true' : undefined}
      onWheel={(event) => {
        onWheel?.(event);
        if (previewScrollable && !event.defaultPrevented) scrollTooltip(event);
      }}
    />
  );
}

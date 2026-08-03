import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type OverlayHandleButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  open: boolean;
};

// The official Button was considered, but this surface is simultaneously an
// Electron drag target, snap controller and context-menu target. Nova Button
// does not expose the required pointer-capture and window-drag behaviour.
export const OverlayHandleButton = forwardRef<HTMLButtonElement, OverlayHandleButtonProps>(
  function OverlayHandleButton({ className, open, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn('caul-handle-button', className)}
        data-domain-ui="overlay-handle-button"
        data-open={open ? 'true' : 'false'}
        type="button"
        {...props}
      />
    );
  }
);

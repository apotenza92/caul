import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type MacosWindowButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  action: 'close' | 'quit';
  placement: 'dialog' | 'titlebar';
};

// The official Button was considered, but macOS traffic-light controls require
// platform-defined colour, geometry and titlebar placement that no Nova variant exposes.
// Keep this raw control limited to the frameless Electron window chrome.
export const MacosWindowButton = forwardRef<HTMLButtonElement, MacosWindowButtonProps>(
  function MacosWindowButton({ action, className, placement, ...props }, ref) {
    const isQuit = action === 'quit';

    return (
      <button
        ref={ref}
        className={cn(
          'caul-mac-window-button absolute z-20 cursor-default rounded-full border-[0.5px] p-0 shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          placement === 'titlebar' && 'top-1/2 -translate-y-1/2',
          placement === 'dialog' && 'top-[17px]',
          isQuit
            ? 'caul-mac-quit-button left-8 flex size-[14px] items-center justify-center border-[#9B48D6] bg-[#BF5AF2] text-[#4F167D] hover:bg-[#BF5AF2] active:bg-[#9B48D6] focus-visible:ring-[#BF5AF2]/30 focus-visible:ring-offset-background [&_svg]:size-2.5 [&_svg]:stroke-[3]'
            : 'caul-mac-close-button left-3 size-[14px] border-[#FB1626] bg-[#FF5C60] text-[#802F31] hover:bg-[#FF5C60] active:bg-[#D94D4F] focus-visible:ring-[#FF5C60]/30 focus-visible:ring-offset-background',
          className
        )}
        data-domain-ui="macos-window-button"
        data-platform="macos"
        type="button"
        {...props}
      />
    );
  }
);

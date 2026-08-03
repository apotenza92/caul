import { useRef, type PointerEvent } from 'react';
import { getPrivateOverlayBridge } from '@/foundation/desktopBridge';

type OverlayResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';

const handles: Array<{ className: string; direction: OverlayResizeDirection }> = [
  { className: 'inset-x-2 top-0 h-[11px] cursor-ns-resize', direction: 'n' },
  { className: 'right-0 top-2 bottom-2 w-[11px] cursor-ew-resize', direction: 'e' },
  { className: 'inset-x-2 bottom-0 h-[11px] cursor-ns-resize', direction: 's' },
  { className: 'left-0 top-2 bottom-2 w-[11px] cursor-ew-resize', direction: 'w' },
  { className: 'right-0 top-0 size-[11px] cursor-nesw-resize', direction: 'ne' },
  { className: 'right-0 bottom-0 size-[11px] cursor-nwse-resize', direction: 'se' },
  { className: 'left-0 bottom-0 size-[11px] cursor-nesw-resize', direction: 'sw' },
  { className: 'left-0 top-0 size-[11px] cursor-nwse-resize', direction: 'nw' }
];

// The official Resizable composition was considered, but these transparent
// hit targets resize a frameless native Electron window in eight directions.
// Resizable changes DOM panel geometry and cannot drive the native window bridge.
export function OverlayResizeHandles() {
  const resizeStateRef = useRef<{ direction: OverlayResizeDirection; pointerId: number } | null>(null);

  function getResizePoint(event: PointerEvent<HTMLDivElement>, direction: OverlayResizeDirection) {
    return { direction, screenX: event.screenX, screenY: event.screenY };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>, direction: OverlayResizeDirection) {
    if (event.button !== 0) return;
    const bridge = getPrivateOverlayBridge();
    if (!bridge) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = { direction, pointerId: event.pointerId };
    void bridge.resizeWindowStart(getResizePoint(event, direction));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    void getPrivateOverlayBridge()?.resizeWindowMove(getResizePoint(event, state.direction));
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    event.preventDefault();
    void getPrivateOverlayBridge()?.resizeWindowEnd(getResizePoint(event, state.direction));
  }

  return (
    <div aria-hidden="true" data-domain-ui="overlay-resize-handles">
      {handles.map((handle) => (
        <div
          key={handle.direction}
          className={`absolute z-[80] bg-transparent ${handle.className}`}
          data-dialog-interaction-preserved
          data-resize-direction={handle.direction}
          onPointerCancel={handlePointerEnd}
          onPointerDown={(event) => handlePointerDown(event, handle.direction)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="presentation"
        />
      ))}
    </div>
  );
}

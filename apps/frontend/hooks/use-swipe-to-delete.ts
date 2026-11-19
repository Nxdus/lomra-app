"use client";

import { useRef, useState, type PointerEvent, type MouseEvent } from "react";

export const swipeDeleteThreshold = -120;

export function useSwipeToDelete() {
  const drag = useRef<{ id: string; pointerId: number; x: number; y: number; offset: number; cancelled: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [swipe, setSwipe] = useState<{ id: string; offset: number } | null>(null);

  function reset(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setSwipe(null);
  }

  function suppressMouse(event: MouseEvent<HTMLElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function bind(id: string, enabled: boolean, onDelete: () => void) {
    return {
      onPointerDownCapture(event: PointerEvent<HTMLElement>) {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        reset(event);
        if (enabled) drag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset: 0, cancelled: false };
      },
      onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
        const current = drag.current;
        if (!current || current.id !== id || current.pointerId !== event.pointerId || current.cancelled) return;
        if (event.buttons === 0) { reset(event); return; }
        const x = event.clientX - current.x;
        const y = event.clientY - current.y;
        if (!suppressClick.current && Math.abs(y) > Math.max(8, Math.abs(x))) {
          current.cancelled = true;
          return;
        }
        if (x > -8 && !suppressClick.current) return;
        suppressClick.current = true;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        current.offset = Math.max(-160, Math.min(0, x));
        setSwipe({ id, offset: current.offset });
      },
      onPointerUpCapture(event: PointerEvent<HTMLElement>) {
        const current = drag.current;
        reset(event);
        if (!current || current.id !== id || current.pointerId !== event.pointerId || !suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
        if (enabled && current.offset <= swipeDeleteThreshold) onDelete();
      },
      onPointerCancel: reset,
      onLostPointerCapture(event: PointerEvent<HTMLElement>) {
        if (event.target === event.currentTarget) reset(event);
      },
      onMouseUpCapture: suppressMouse,
      onClickCapture: suppressMouse,
      onDoubleClickCapture: suppressMouse,
    };
  }

  return { swipe, bind };
}

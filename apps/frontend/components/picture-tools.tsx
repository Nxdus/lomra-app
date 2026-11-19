"use client";

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { GripVerticalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PopupBoundaryContext } from "@/components/ui/popup-boundary";

export type PictureTool = "Markup" | "Remove BG" | "Erase" | "Resize";

export function PictureTools({ children }: { children: ReactNode }) {
  const boundary = useContext(PopupBoundaryContext);
  const menu = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function fit() {
      const bounds = menu.current!.getBoundingClientRect();
      const x = Math.max(16 - bounds.left, Math.min(0, window.innerWidth - 16 - bounds.right));
      const minY = (boundary?.getBoundingClientRect().top ?? 0) + 16;
      const y = Math.max(minY - bounds.top, Math.min(0, window.innerHeight - 16 - bounds.bottom));
      if (x || y) setOffset(previous => ({ x: previous.x + x, y: previous.y + y }));
    }
    const observer = new ResizeObserver(fit);
    observer.observe(menu.current!);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [boundary]);

  function move(x: number, y: number) {
    const bounds = menu.current!.getBoundingClientRect();
    const dx = Math.max(16 - bounds.left, Math.min(x, window.innerWidth - 16 - bounds.right));
    const minY = (boundary?.getBoundingClientRect().top ?? 0) + 16;
    const dy = Math.max(minY - bounds.top, Math.min(y, window.innerHeight - 16 - bounds.bottom));
    setOffset((previous) => ({ x: previous.x + dx, y: previous.y + dy }));
  }

  return (
    <div ref={menu} role="toolbar" aria-label="Image editing tools" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} className="absolute top-full left-1/2 mt-4 flex max-h-[calc(var(--app-content-height)-2rem)] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-1 overflow-y-auto rounded-3xl border bg-popover p-2 text-popover-foreground shadow-lg">
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
        aria-label="Move picture tools. Drag or use arrow keys."
        title="Drag to move · Arrow keys to reposition"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (active?.pointer !== event.pointerId) return;
          move(event.clientX - active.x, event.clientY - active.y);
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 20 : 10;
          move(direction[0] * step, direction[1] * step);
        }}
      >
        <GripVerticalIcon />
      </Button>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">{children}</div>

    </div>
  );
}

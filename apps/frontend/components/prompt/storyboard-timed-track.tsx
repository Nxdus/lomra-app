import { AudioLinesIcon, CaptionsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TimedItem = { id: string; label: string; start: number; end: number };

export function StoryboardTimedTrack({ kind, duration, items, selected, disabled, action, onSelect }: {
  kind: "audio" | "subtitles";
  duration: number;
  items: TimedItem[];
  selected?: string;
  disabled: boolean;
  action: ReactNode;
  onSelect: (id: string) => void;
}) {
  const audio = kind === "audio";
  const title = audio ? "Audio tracks" : "Subtitle track";
  const Icon = audio ? AudioLinesIcon : CaptionsIcon;
  const span = Number.isFinite(duration) ? Math.max(duration, 0) : 0;
  const rows = audio ? items.map((item) => [item]) : [items];

  return (
    <section aria-label={title} className="rounded-2xl bg-zinc-950 p-3 text-zinc-50 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Icon aria-hidden="true" className="size-4 text-zinc-400" />{title}</h3>
        {action}
      </div>
      <div aria-hidden="true" className="mb-1 flex justify-between text-[10px] tabular-nums text-zinc-400">
        {[0, 1, 2, 3, 4].map((tick) => <span key={tick}>{Number((span * tick / 4).toFixed(2))}s</span>)}
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto" style={{
        backgroundImage: "linear-gradient(to right, #27272a 1px, transparent 1px)",
        backgroundSize: "25% 100%",
      }}>
        {items.length ? rows.map((row, index) => (
          <div key={audio ? row[0].id : index} className="relative h-8 rounded-md border border-zinc-800 bg-zinc-900/20">
            {row.map(({ id, label, start, end }) => {
              const fraction = (time: number) => span > 0 && Number.isFinite(time) ? Math.max(0, Math.min(100, 100 * time / span)) : 0;
              const left = Math.min(99, fraction(start));
              const width = Math.max(0, fraction(end) - left);
              return (
                <Button key={id} type="button" size="xs" variant="ghost" disabled={disabled} aria-label={label} title={label}
                  aria-pressed={selected === id} onClick={() => onSelect(id)} style={{ left: `${left}%`, width: `${width}%` }}
                  className={cn(
                    "absolute inset-y-0 h-full min-w-1.5 justify-start overflow-hidden rounded-sm border px-0 text-xs hover:text-white focus-visible:z-20 focus-visible:ring-inset focus-visible:ring-amber-300",
                    audio ? "border-cyan-700 bg-cyan-950 text-cyan-100 hover:bg-cyan-900" : "border-violet-700 bg-violet-950 text-violet-100 hover:bg-violet-900",
                    selected === id && "z-10 border-amber-300 ring-1 ring-amber-300 ring-inset",
                  )}>
                  <span className="truncate px-2">{label}</span>
                </Button>
              );
            })}
          </div>
        )) : (
          <p className="rounded-md border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400">
            {audio ? "No audio clips" : "No subtitles"}
          </p>
        )}
      </div>
    </section>
  );
}

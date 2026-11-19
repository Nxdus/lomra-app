"use client";

import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

const label = (level: string) => level === "default" ? "Default" : level === "xhigh" ? "Extra high" : level[0].toUpperCase() + level.slice(1);

/** Speedometer icon whose needle swings from the left (Default) to the right (highest effort). */
function GaugeNeedle({ position }: { position: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    <line x1="12" y1="14" x2="12" y2="7" style={{ transform: `rotate(${-70 + 140 * position}deg)`, transformOrigin: "12px 14px", transition: "transform 150ms ease-out" }} />
  </svg>;
}

/** Thinking effort as a slider; the first step leaves the agent's own default. */
export function EffortPicker({ levels, value, onChange, disabled }: {
  levels: readonly string[];
  value?: string;
  onChange: (level: string) => void;
  disabled?: boolean;
}) {
  const steps = ["default", ...levels];
  const index = Math.max(0, steps.indexOf(value ?? "default"));
  return <Popover>
    <Tip label={`Thinking effort: ${label(steps[index])}`}><PopoverTrigger render={<Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Thinking effort: ${label(steps[index])}`} />}>
      <GaugeNeedle position={index / (steps.length - 1)} />
    </PopoverTrigger></Tip>
    <PopoverContent side="top" align="end" className="w-52 gap-3">
      <div className="text-center text-sm font-medium">{label(steps[index])}</div>
      <Slider aria-label="Thinking effort" min={0} max={steps.length - 1} step={1} value={[index]}
        onValueChange={(next) => onChange(steps[Array.isArray(next) ? next[0] : next] ?? "default")} />
    </PopoverContent>
  </Popover>;
}

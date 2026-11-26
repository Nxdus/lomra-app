"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { DicesIcon, HistoryIcon, SlidersHorizontalIcon } from "lucide-react";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { SdRange, SdStatus } from "@/lib/desktop";
import { pictureCapabilities } from "@/lib/picture-capabilities";
import { validSdRangeNumber, type SdSettings } from "@/lib/sd-settings";
import { changeSdSettings, lastSdSeed, loadSdSettings, sdSettingsOf, subscribeSdSettings } from "@/lib/sd-settings-store";
import { sdPrefix } from "./generation";

const saveFailed = () => { toast.add({ title: "Could not save the image settings", description: "They apply until you close the app.", type: "error" }); };

/** A number that may be left empty for the model's default. Only valid values are stored. */
function NumberField({ range, label, placeholder, step, value, onChange, children }: {
  range: SdRange; label: string; placeholder: string; step: number; value?: number; onChange: (value?: number) => void; children?: React.ReactNode;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const { min, max, whole } = range;
  const invalid = draft !== null
    ? draft !== "" && !validSdRangeNumber(range, Number(draft))
    : value !== undefined && !validSdRangeNumber(range, value);
  return <Field data-invalid={invalid || undefined}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <div className="flex items-center gap-1">
      <Input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} placeholder={placeholder} className="min-w-0"
        value={draft ?? value ?? ""} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          // The browser reports half-typed text such as "1e" as an empty value; keep what was stored.
          if (event.target.validity.badInput) return;
          if (next === "") onChange(undefined);
          else if (validSdRangeNumber(range, Number(next))) onChange(Number(next));
        }}
        onBlur={() => setDraft(null)} />
      {children}
    </div>
    {invalid && <FieldError id={`${id}-error`}>{whole ? "Use a whole number" : "Use a number"} from {min} to {max}.</FieldError>}
  </Field>;
}

/** Seed, steps and the other controls of the selected local Stable Diffusion model, saved per model. */
export function SdSettingsPopover({ model, sdStatus, disabled }: { model: string; sdStatus?: SdStatus | null; disabled?: boolean }) {
  const id = useId();
  const settings = useSyncExternalStore(subscribeSdSettings, () => sdSettingsOf(model), () => sdSettingsOf(model));
  const lastSeed = useSyncExternalStore(subscribeSdSettings, lastSdSeed, lastSdSeed);
  useEffect(() => {
    function load() {
      void loadSdSettings().catch(() => toast.add({
        id: "image-settings-load-error",
        title: "Could not load image settings.",
        type: "error",
        actionProps: { children: "Retry", onClick: load },
      }));
    }
    load();
  }, []);
  const caps = pictureCapabilities(`${sdPrefix}${model}`, sdStatus);
  const visibleFields: (keyof SdSettings)[] = [
    ...(caps.negativePrompt ? ["negativePrompt" as const] : []),
    "seed",
    "steps",
    ...(caps.cfg ? ["cfg" as const] : []),
    ...(caps.strength ? ["strength" as const] : []),
  ];
  const changed = visibleFields.some((key) => settings[key] !== undefined);
  const anySaved = Object.keys(settings).length > 0;
  const change = (next: SdSettings) => changeSdSettings(model, { ...settings, ...next }, saveFailed);
  const label = changed ? "Image settings (changed)" : "Image settings";
  const effectiveCfg = settings.cfg ?? caps.defaults.cfg;
  const defaultPlaceholder = (value?: number) => value === undefined ? "Default" : `Default (${value})`;

  return <Popover>
    <Tip label={label}><PopoverTrigger render={<Button type="button" variant={changed ? "secondary" : "ghost"} size="icon-sm" disabled={disabled} aria-label={label} />}>
      <SlidersHorizontalIcon />
    </PopoverTrigger></Tip>
    <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between gap-2">
        <PopoverTitle>Image settings</PopoverTitle>
        <Button type="button" variant="ghost" size="sm" disabled={!anySaved} onClick={() => changeSdSettings(model, {}, saveFailed)}>Reset</Button>
      </div>
      <FieldGroup key={model} className="gap-3">
        {caps.negativePrompt && <Field>
          <div className="flex items-baseline justify-between gap-2">
            <FieldLabel htmlFor={`${id}-negative`}>Negative prompt</FieldLabel>
            {effectiveCfg === 1 && <span className="text-xs text-muted-foreground">No effect at CFG 1</span>}
          </div>
          <Textarea id={`${id}-negative`} rows={2} className="max-h-32" maxLength={caps.negativePromptLimit} placeholder="What to keep out of the picture"
            value={settings.negativePrompt ?? ""} onChange={(event) => change({ negativePrompt: event.target.value })} />
        </Field>}
        <NumberField range={caps.ranges.seed} label="Seed" placeholder="Random" step={1} value={settings.seed} onChange={(seed) => change({ seed })}>
          <Tip label="Random seed"><Button type="button" variant="ghost" size="icon-sm" aria-label="Random seed" disabled={settings.seed === undefined} onClick={() => change({ seed: undefined })}><DicesIcon /></Button></Tip>
          <Tip label={lastSeed === undefined ? "Use last seed" : `Use last seed (${lastSeed})`}><Button type="button" variant="ghost" size="icon-sm" aria-label="Use last seed" disabled={lastSeed === undefined} onClick={() => change({ seed: lastSeed })}><HistoryIcon /></Button></Tip>
        </NumberField>
        {caps.cfg ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField range={caps.ranges.steps} label="Steps" placeholder={defaultPlaceholder(caps.defaults.steps)} step={1} value={settings.steps} onChange={(steps) => change({ steps })} />
            <NumberField range={caps.ranges.cfg} label="CFG scale" placeholder={defaultPlaceholder(caps.defaults.cfg)} step={0.5} value={settings.cfg} onChange={(cfg) => change({ cfg })} />
          </div>
        ) : (
          <NumberField range={caps.ranges.steps} label="Steps" placeholder={defaultPlaceholder(caps.defaults.steps)} step={1} value={settings.steps} onChange={(steps) => change({ steps })} />
        )}
        {caps.strength && <NumberField range={caps.ranges.strength} label="Strength for edits" placeholder={defaultPlaceholder(caps.defaults.strength)} step={0.05} value={settings.strength} onChange={(strength) => change({ strength })} />}
        <FieldDescription>{caps.strength ? "Higher strength changes a picture more. " : ""}Empty fields use the model’s defaults.</FieldDescription>
      </FieldGroup>
    </PopoverContent>
  </Popover>;
}

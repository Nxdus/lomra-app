"use client";

import { ConfirmDelete } from "@/components/confirm-delete";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { isMultiview } from "./multiview";
import { toast } from "@/components/ui/toast";
import { getSetting, saveSetting } from "@/lib/settings";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const categories = [
  { value: "llm", label: "LLM", provider: "OpenRouter" },
  { value: "picture", label: "Image", provider: "OpenRouter" },
  { value: "video", label: "Video", provider: "OpenRouter" },
  { value: "3d", label: "Model 3D", provider: "fal.ai" },
];
const capabilityLabels = {
  "text-to-3d": "Text to 3D",
  "image-to-3d": "Image to 3D",
  "multi-view-to-3d": "Multi-view to 3D",
};
type Capability = keyof typeof capabilityLabels;
type CatalogModel = { id: string; name: string; capabilities?: Capability[] };

function modelDisplayName(name: string) {
  return name.replace(/^[^:]+:\s*/, "").replace(/\s*\([^)]*\)/g, "").trim();
}

function CapabilityText({ capabilities }: { capabilities?: Capability[] }) {
  return capabilities?.length ? <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
    {capabilities.map((capability) => capabilityLabels[capability]).join(" · ")}
  </span> : null;
}

type Group = typeof categories[number] & {
  models: { value: string; label: string; name: string; capabilities?: Capability[]; custom?: boolean }[];
  error: boolean;
};

export function ModelSelector({ models, onModelsChange, disabled = false }: {
  models: string[];
  onModelsChange: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [addingGroup, setAddingGroup] = useState<Group | null>(null);
  const [modelName, setModelName] = useState("");
  const [modelId, setModelId] = useState("");
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const drag = useRef<{ value: string; x: number; y: number; offset: number; cancelled: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [swipe, setSwipe] = useState<{ value: string; offset: number } | null>(null);
  const preferencesReady = useRef(false);
  const [deletingModel, setDeletingModel] = useState<{ value: string; name: string } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  async function removeModel(value: string) {
    const group = groups.find((group) => group.models.some((item) => item.value === value && item.custom));
    if (disabled || settingsSaving || !group) return;
    const next = groups.map((group) => ({ ...group, models: group.models.filter((item) => item.value !== value) }));
    try {
      setSettingsSaving(true);
      await saveSetting('custom-models', next.flatMap((group) => group.models.filter((item) => item.custom)));
    } catch {
      toast.add({ title: "Could not save model settings. Please retry.", type: "error" });
      return;
    } finally {
      setSettingsSaving(false);
    }
    setGroups(next);
    onModelsChange((current) => {
      if (!current.includes(value)) return current;
      const remaining = current.filter((item) => item !== value);
      const fallback = next.find((item) => item.value === group.value)?.models[0];
      return fallback ? [...remaining, fallback.value] : remaining;
    });
  }

  useEffect(() => {
    if (!addingGroup) return;
    const category = addingGroup.value;
    const controller = new AbortController();
    async function loadCatalog() {
      setCatalogStatus("loading");
      setCatalog([]);
      try {
        const response = await fetch(`/api/models?category=${category}&all=true`, { signal: controller.signal });
        if (!response.ok) throw new Error("Catalog unavailable");
        const result = await response.json();
        if (!controller.signal.aborted) {
          setCatalog(result.models);
          setCatalogStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) {
          setCatalogStatus("error");
          toast.add({ id: "model-catalog-error", title: "Could not load models.", type: "error", actionProps: { children: "Retry", onClick: () => setCatalogAttempt((attempt) => attempt + 1) } });
        }
      }
    }
    void loadCatalog();
    return () => controller.abort();
  }, [addingGroup, catalogAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let savedModels: unknown;
      let savedSelection: string[] | undefined;
      try {
        [savedModels, savedSelection] = await Promise.all([getSetting('custom-models', 'custom-models'), getSetting<string[]>('selected-models')]);
      } catch {
        if (!controller.signal.aborted) toast.add({ id: 'model-settings-error', title: 'Could not load model settings. Reload to retry.', type: 'error' });
        return;
      }
      const results = await Promise.all(categories.map(async (category): Promise<Group> => {
        try {
          const response = await fetch(`/api/models?category=${category.value}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Could not load models");
          const result = await response.json();
          return { ...category, error: false, models: result.models.map((item: CatalogModel) => {
            const name = modelDisplayName(item.name);
            return { value: `${category.value}:${item.id}`, label: name, name, capabilities: item.capabilities };
          }) };
        } catch {
          return { ...category, error: true, models: [] };
        }
      }));
      if (!controller.signal.aborted) {
        try {
          const saved: unknown = savedModels;
          if (Array.isArray(saved)) for (const item of saved) {
            if (!item || typeof item.value !== "string" || typeof item.name !== "string" || !item.name.trim()) continue;
            const group = results.find((group) => item.value.startsWith(`${group.value}:`) && item.value.length > group.value.length + 1);
            if (group && !group.models.some((model) => model.value === item.value)) {
              const name = modelDisplayName(item.name);
              group.models.push({ value: item.value, name, label: name, capabilities: group.value === "3d" && isMultiview(item.value.slice(3)) ? ["multi-view-to-3d"] : Array.isArray(item.capabilities) ? item.capabilities.filter((value: unknown): value is Capability => typeof value === "string" && Object.hasOwn(capabilityLabels, value)) : undefined, custom: true });
            }
          }
        } catch { /* Stored models may be unavailable in private browsing. */ }
        setGroups(results);
        preferencesReady.current = true;
        const failed = results.filter((group) => group.error);
        if (failed.length) toast.add({ id: "model-load-error", title: `Could not load ${failed.map((group) => group.label).join(", ")} models.`, type: "error", actionProps: { children: "Retry", onClick: () => setAttempt((value) => value + 1) } });
        onModelsChange((current) => results.flatMap((group) => {
          const selected = group.models.find((item) => (current.length ? current : savedSelection ?? []).includes(item.value)) ?? group.models[0];
          return selected ? [selected.value] : current.filter((value) => value.startsWith(`${group.value}:`));
        }));
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, onModelsChange]);

  useEffect(() => {
    if (!preferencesReady.current || !models.length) return;
    const timer = setTimeout(() => {
      void saveSetting('selected-models', models).catch(() => toast.add({ id: 'model-settings-error', title: 'Could not save selected models. Please retry.', type: 'error' }));
    }, 400);
    return () => clearTimeout(timer);
  }, [models]);

  const items = groups.flatMap((group) => group.models);
  const selectionLabel = groups.find((group) => group.value === "llm")
    ?.models.find((item) => models.includes(item.value))?.name ?? "LLM unavailable";

  if (!groups.length) return (
    <div role="status" aria-label="Loading models" aria-busy="true" className="min-w-0 max-w-[min(15rem,calc(100vw-8rem))] shrink-0">
      <Skeleton aria-hidden="true" className="h-8 w-32 max-w-full" />
    </div>
  );

  return (
    <div className="flex min-w-0 max-w-[min(15rem,calc(100vw-8rem))] shrink-0 flex-col items-end gap-1">
      <Select multiple items={items} open={open} onOpenChange={setOpen}
        value={models} onValueChange={(nextModels) => {
          const added = nextModels.find((value) => !models.includes(value));
          if (added) onModelsChange(nextModels.filter((value) => value === added || value.split(":")[0] !== added.split(":")[0]));
        }} disabled={disabled || settingsSaving || !items.length}>
        <SelectTrigger size="sm" aria-label="AI models" className="max-w-full">
          <SelectValue className="min-w-0 truncate" title={selectionLabel}>
            <span className="truncate">{selectionLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent side="top" align="end" alignItemWithTrigger={false} className="w-80 max-w-[calc(100vw-2rem)]">
          {groups.map((group) => <SelectGroup key={group.value}>
            <div className="flex items-center justify-between pr-1">
              <SelectLabel>{group.label}</SelectLabel>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Add ${group.label} model`}
                onClick={() => { setOpen(false); setModelName(""); setModelId(""); setAddingGroup(group); }}>
                <PlusIcon />
              </Button>
            </div>
            {group.models.length ? group.models.map((item) => <div key={item.value} className="relative overflow-hidden rounded-xl">
              {swipe?.value === item.value && <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-end gap-1 rounded-xl pr-2 text-xs text-destructive ${swipe.offset <= -120 ? "bg-destructive/20" : "bg-destructive/10"}`}>
                <Trash2Icon className="size-4 shrink-0" />
                <span>{swipe.offset <= -120 ? "Release to delete" : "Delete"}</span>
              </div>}
              <SelectItem value={item.value}
              title={item.custom ? "Drag left to remove, or press Delete" : undefined}
              className={item.custom ? "touch-pan-y bg-popover" : undefined}
              style={swipe?.value === item.value ? { transform: `translateX(${swipe.offset}px)` } : undefined}
              onPointerDownCapture={(event) => {
                suppressClick.current = false;
                if (!item.custom || disabled || event.button !== 0) return;
                drag.current = { value: item.value, x: event.clientX, y: event.clientY, offset: 0, cancelled: false };
              }}
              onPointerMoveCapture={(event) => {
                const current = drag.current;
                if (!current || current.value !== item.value || current.cancelled) return;
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
                setSwipe({ value: item.value, offset: current.offset });
              }}
              onPointerUpCapture={(event) => {
                const current = drag.current;
                drag.current = null;
                setSwipe(null);
                if (!current || current.value !== item.value || !suppressClick.current) return;
                event.preventDefault();
                event.stopPropagation();
                if (!current.cancelled && current.offset <= -120) { setOpen(false); setDeletingModel(item); }
              }}
              onPointerCancel={() => { drag.current = null; setSwipe(null); }}
              onLostPointerCapture={() => { drag.current = null; setSwipe(null); }}
              onMouseUpCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}
              onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
              onKeyDown={(event) => {
                if (item.custom && (event.key === "Delete" || event.key === "Backspace")) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  setDeletingModel(item);
                }
              }}>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate">{item.name}</span>
                <CapabilityText capabilities={item.capabilities} />
              </span>
            </SelectItem></div>) : <SelectItem value={`${group.value}:empty`} disabled>
              {group.error ? "Models unavailable" : "No models available"}
            </SelectItem>}
          </SelectGroup>)}
        </SelectContent>
      </Select>
      <ConfirmDelete open={!!deletingModel} onOpenChange={(open) => { if (!open) setDeletingModel(null); }} title="Delete custom model?" description={`“${deletingModel?.name}” will be removed from your model list.`} disabled={disabled || settingsSaving} onConfirm={async () => { if (deletingModel) await removeModel(deletingModel.value); }} />
      <Dialog open={!!addingGroup} onOpenChange={(open) => { if (!open) setAddingGroup(null); }}>
        <DialogContent className="gap-4 rounded-2xl p-4 shadow-lg">
          <DialogHeader className="min-h-8 justify-center pr-8">
            <DialogTitle>Add {addingGroup?.label} model</DialogTitle>
            <DialogDescription className="sr-only">Search {addingGroup?.provider} models by name or ID.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={async (event) => {
            event.preventDefault();
            if (settingsSaving || !addingGroup || !modelName.trim() || !modelId.trim()) return;
            const value = `${addingGroup.value}:${modelId.trim()}`;
            if (items.some((item) => item.value === value)) {
              toast.add({ title: "This model is already in the list.", type: "error" });
              return;
            }
            const name = modelDisplayName(modelName);
            const capabilities = catalog.find((model) => model.id === modelId)?.capabilities;
            const next = groups.map((group) => group.value === addingGroup.value
              ? { ...group, models: [...group.models, { value, name, label: name, capabilities, custom: true }] } : group);
            try {
              setSettingsSaving(true);
              await saveSetting('custom-models', next.flatMap((group) => group.models.filter((model) => model.custom)));
            } catch {
              toast.add({ title: "Could not save model settings. Please retry.", type: "error" });
              return;
            } finally {
              setSettingsSaving(false);
            }
            setGroups(next);
            onModelsChange((current) => [...current.filter((model) => !model.startsWith(`${addingGroup.value}:`)), value]);
            setAddingGroup(null);
          }}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="custom-model-search" className="sr-only">Search models</FieldLabel>
                <Combobox items={catalog.filter((model) => !items.some((item) => item.value === `${addingGroup?.value}:${model.id}`))}
                  value={catalog.find((model) => model.id === modelId) ?? null}
                  itemToStringLabel={(model) => model.name} itemToStringValue={(model) => model.id}
                  filter={(model, query) => `${model.name} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())}
                  isItemEqualToValue={(a, b) => a.id === b.id}
                  onValueChange={(model) => { setModelName(model?.name ?? ""); setModelId(model?.id ?? ""); }}>
                  <ComboboxInput id="custom-model-search" placeholder={catalogStatus === "loading" ? "Loading models…" : "Search by name or ID…"} disabled={catalogStatus !== "ready"} showClear />
                  <ComboboxContent className="shadow-lg">
                    <ComboboxEmpty>No matching models.</ComboboxEmpty>
                    <ComboboxList>
                      {(model: CatalogModel) => <ComboboxItem key={model.id} value={model}>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate">{model.name}</span>
                            <CapabilityText capabilities={model.capabilities} />
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{model.id}</span>
                        </div>
                      </ComboboxItem>}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>
            </FieldGroup>
            <DialogFooter className="flex-row justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddingGroup(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={disabled || settingsSaving || !modelName.trim() || !modelId.trim()}>Add model</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

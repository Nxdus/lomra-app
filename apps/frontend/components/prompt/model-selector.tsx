"use client";

import { ConfirmDelete } from "@/components/confirm-delete";
import { swipeDeleteThreshold, useSwipeToDelete } from "@/hooks/use-swipe-to-delete";
import { AgentIcon } from "@/components/agent-icon";
import Image from "next/image";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createSelectionSaver } from "./selection-saver";
import { isMultiview } from "./multiview";
import { browserImageModel, geminiImageModel, geminiVideoModel, modelProvider, isOllamaModel, ollamaPrefix, isSdModel, sdPrefix, isLocal3dModel, local3dPrefix } from "./generation";
import { useOllama } from "@/hooks/use-ollama";
import { useSd } from "@/hooks/use-sd";
import { useLocal3d } from "@/hooks/use-local3d";
import { Local3dIcon } from "@/components/local3d-icon";
import { HunyuanIcon } from "@/components/hunyuan-icon";
import { TripoIcon } from "@/components/tripo-icon";
import { toast } from "@/components/ui/toast";
import { getSetting, saveSetting } from "@/lib/settings";
import { useDisabledAgents } from "@/hooks/use-disabled-agents";
import { desktopAgents } from "@/lib/desktop";
import { localAgentModel } from "./agent-chat";
import { callProvider, useApiProviders, type KeyedProvider } from "@/components/api-provider";
import { KeyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { StabilityIcon } from "@/components/stability-icon";
import { OllamaIcon } from "@/components/ollama-icon";
import falIcon from "./provider-icons/fal.png";
import { GeminiIcon } from "@/components/gemini-icon";
import googleAiIcon from "./provider-icons/google-ai.png";
import openRouterIcon from "./provider-icons/openrouter.png";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  browserProvider,
  geminiProvider,
  googlePrefix,
  modelApiKeyProvider,
  resolveAddModelOptions,
  type AgentProviderEntry,
  type Capability,
  type CatalogModel,
  type CatalogStatus,
} from "./model-selector-options";

const categories = [
  { value: "llm", label: "LLM", provider: "OpenRouter" },
  { value: "picture", label: "Image", provider: "OpenRouter" },
  { value: "video", label: "Video", provider: "OpenRouter" },
  { value: "3d", label: "Model 3D", provider: "fal.ai" },
] as const;
const providerIcons = {
  OpenRouter: openRouterIcon,
  "fal.ai": falIcon,
  "Google AI": googleAiIcon,
};
const capabilityLabels = {
  "text-to-3d": "Text to 3D",
  "image-to-3d": "Image to 3D",
  "multi-view-to-3d": "Multi-view to 3D",
};

function modelDisplayName(name: string) {
  // "Provider: Model" prefixes only; local model tags like qwen3:4b have no space after the colon.
  return name.replace(/^[^:]+:\s+/, "").replace(/\s*\([^)]*\)/g, "").trim();
}

function CapabilityText({ capabilities }: { capabilities?: Capability[] }) {
  return capabilities?.length ? <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
    {capabilities.map((capability) => capabilityLabels[capability]).join(" · ")}
  </span> : null;
}

/** fal prices need the user's key; any failure just leaves models unpriced. */
async function falPrices(key: string, ids: string[], signal: AbortSignal) {
  const prices = new Map<string, string>();
  if (!key) return prices;
  const chunks = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, index * 50 + 50));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const result = await callProvider("fal", key, { action: "prices", input: chunk, signal }) as { prices?: Record<string, string> };
      for (const [id, price] of Object.entries(result.prices ?? {})) prices.set(id, price);
    } catch { /* Prices are optional. */ }
  }));
  return prices;
}

function PriceText({ price }: { price?: string }) {
  if (!price) return null;
  if (price === "Free") return <span className="shrink-0 text-xs font-medium leading-none text-muted-foreground">Free</span>;
  return <Tip label={price}>
    <span role="img" aria-label={`Price: ${price}`} className="shrink-0 text-xs font-medium leading-none text-muted-foreground">$</span>
  </Tip>;
}

function ModelProviderIcon({ value, provider }: { value: string; provider: Group["provider"] }) {
  const model = value.slice(value.indexOf(":") + 1);
  if (model === browserImageModel || model === browserProvider) {
    return <span role="img" aria-label={browserProvider} title={browserProvider} className="shrink-0">
      <AgentIcon id="codex" className="size-3 shrink-0 grayscale" />
    </span>;
  }
  if (model === geminiImageModel || model === geminiVideoModel || model === geminiProvider) {
    return <span role="img" aria-label={geminiProvider} title={geminiProvider} className="shrink-0">
      <GeminiIcon className="size-3 shrink-0" />
    </span>;
  }
  if (model === local3dPrefix) {
    return <span aria-hidden="true" className="inline-flex shrink-0 gap-1">
      <HunyuanIcon className="size-3" />
      <TripoIcon className="size-3" />
    </span>;
  }
  if (isLocal3dModel(model)) return <Local3dIcon id={model.slice(local3dPrefix.length)} className="size-3 shrink-0" />;
  if (isSdModel(model)) {
    return <span role="img" aria-label="Provider: Stable Diffusion" title="Stable Diffusion" className="shrink-0">
      <StabilityIcon className="size-3 shrink-0" />
    </span>;
  }
  if (isOllamaModel(model)) {
    return <span role="img" aria-label="Provider: Ollama" title="Ollama" className="shrink-0">
      <OllamaIcon className="size-3 shrink-0" />
    </span>;
  }
  const agent = value.startsWith("llm:") ? localAgentModel(model) : undefined;
  if (agent) {
    return <span role="img" aria-label="Provider: Local agent" title="Local agent" className="shrink-0">
      <AgentIcon id={agent.engine} className="size-3 shrink-0 grayscale" />
    </span>;
  }
  const name = provider === "OpenRouter" && modelProvider(model) === "google" ? "Google AI" : provider;
  return <span role="img" aria-label={`Provider: ${name}`} title={name} className="shrink-0">
    <Image src={providerIcons[name]} alt="" width={12} height={12} unoptimized className="size-3 object-contain grayscale" />
  </span>;
}

type Group = typeof categories[number] & {
  models: { value: string; label: string; name: string; capabilities?: Capability[]; price?: string; custom?: boolean }[];
  error: boolean;
};

export function ModelSelector({ models, onModelsChange, onCatalogInfoChange, onSelectableChange, onOpenModelSetup, disabled = false }: {
  models: string[];
  onModelsChange: Dispatch<SetStateAction<string[]>>;
  onCatalogInfoChange?: (info: { prices: ReadonlyMap<string, string>; vision: ReadonlyMap<string, boolean>; names: ReadonlyMap<string, string> }) => void;
  onSelectableChange?: (selectable: ReadonlySet<string>) => void;
  onOpenModelSetup: (options?: { provider?: KeyedProvider; modelName?: string }) => void;
  disabled?: boolean;
}) {
  const { keys, keysReady } = useApiProviders();
  const googleKey = keys.google;
  const falKey = keys.fal;
  const [allGroups, setGroups] = useState<Group[]>([]);
  const [hiddenModels, setHiddenModels] = useState<string[]>([]);
  const ollama = useOllama();
  const sd = useSd();
  const local3d = useLocal3d();
  const isInstalled = useCallback((value: string) => {
    const model = value.slice(value.indexOf(":") + 1);
    if (isOllamaModel(model) && ollama.running) {
      return ollama.models.some((item) => item.tools && item.id === model.slice(ollamaPrefix.length));
    }
    if (isSdModel(model) && sd.status) {
      return sd.status.models.some((item) => item.installed && item.id === model.slice(sdPrefix.length));
    }
    if (isLocal3dModel(model) && local3d.status) {
      return local3d.status.models.some((item) => item.installed && item.id === model.slice(local3dPrefix.length));
    }
    return true;
  }, [ollama.running, ollama.models, sd.status, local3d.status]);
  const groups = allGroups.map((group) => ({
    ...group,
    models: group.models.filter((item) => isInstalled(item.value) && (item.custom || !hiddenModels.includes(item.value))),
  }));
  const items = groups.flatMap((group) => group.models);
  const canDelete = items.length > 1;
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [addingGroup, setAddingGroup] = useState<Group | null>(null);
  const [addProvider, setAddProvider] = useState<string | null>(null);
  const refreshSd = sd.refresh;
  const refreshLocal3d = local3d.refresh;
  const refreshOllama = ollama.refresh;
  const [modelId, setModelId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [googleCatalog, setGoogleCatalog] = useState<CatalogModel[]>([]);
  const [localCatalog, setLocalCatalog] = useState<AgentProviderEntry[]>([]);
  const [browserAvailable, setBrowserAvailable] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("loading");
  const [googleStatus, setGoogleStatus] = useState<CatalogStatus>("loading");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const { swipe, bind: bindSwipe } = useSwipeToDelete();
  const saveSelection = useRef<ReturnType<typeof createSelectionSaver>>(undefined);
  const [deletingModel, setDeletingModel] = useState<{ value: string; name: string } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const { disabled: disabledAgents } = useDisabledAgents();

  async function removeModel(value: string) {
    const item = items.find((item) => item.value === value);
    if (disabled || settingsSaving || !canDelete || !item) return;
    try {
      setSettingsSaving(true);
      if (item.custom) {
        const next = allGroups.map((group) => ({ ...group, models: group.models.filter((item) => item.value !== value) }));
        await saveSetting('custom-models', next.flatMap((group) => group.models.filter((item) => item.custom)));
        setGroups(next);
      } else {
        const next = [...hiddenModels, value];
        await saveSetting('hidden-models', next);
        setHiddenModels(next);
      }
    } catch {
      throw new Error("Could not save model settings. Try again.");
    } finally {
      setSettingsSaving(false);
    }
    onModelsChange((current) => current.filter((item) => item !== value));
  }

  useEffect(() => {
    if (!addingGroup) return;
    const category = addingGroup.value;
    const controller = new AbortController();
    const bridge = desktopAgents();
    if (category === "llm" && bridge) void bridge.list().then(async (agents) => {
      if (controller.signal.aborted) return;
      const entries = await Promise.all(agents.flatMap(({ id, label, available }) => {
        const model = `local-agent/${id}`;
        if (!available || disabledAgents.includes(id) || !localAgentModel(model)) return [];
        return [(async (): Promise<AgentProviderEntry> => {
          if (!bridge.models) return { id: model, name: label, models: null };
          try {
            const list = await bridge.models(id);
            return { id: model, name: label, models: [{ id: model, name: "Default" }, ...list.map((item) => ({ id: `${model}/${item.id}`, name: item.name }))] };
          } catch {
            return { id: model, name: label, models: [{ id: model, name: "Default" }], error: true };
          }
        })()];
      }));
      if (!controller.signal.aborted) setLocalCatalog(entries);
    }).catch(() => {});
    if (category === "picture" && bridge?.browserImage) {
      void bridge.hasCodexSubscription?.().then((available) => {
        if (!controller.signal.aborted) setBrowserAvailable(available);
      }).catch(() => {});
    }
    async function loadDefaultCatalog() {
      setCatalogStatus("loading");
      setCatalog([]);
      try {
        const response = await fetch(`/api/models?category=${category}&all=true`, { signal: controller.signal });
        if (!response.ok) throw new Error("Catalog unavailable");
        let models: CatalogModel[] = (await response.json()).models;
        if (category === "3d") {
          const prices = await falPrices(falKey, models.map((item) => item.id), controller.signal);
          models = models.map((item) => ({ ...item, price: prices.get(item.id) }));
        }
        if (!controller.signal.aborted) {
          setCatalog(models);
          setCatalogStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) setCatalogStatus("error");
      }
    }
    async function loadGoogleCatalog() {
      if (!googleKey || (category !== "llm" && category !== "picture" && category !== "video")) {
        setGoogleCatalog([]);
        setGoogleStatus("ready");
        return;
      }
      setGoogleStatus("loading");
      setGoogleCatalog([]);
      try {
        const result = await callProvider("google", googleKey, { action: "models", signal: controller.signal }) as { models: (CatalogModel & { category: Group["value"] })[] };
        const models = result.models.filter((item) => item.category === category)
          .map((item) => ({ id: `${googlePrefix}${item.id}`, name: modelDisplayName(item.name) }));
        if (!controller.signal.aborted) {
          setGoogleCatalog(models);
          setGoogleStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) setGoogleStatus("error");
      }
    }
    void loadDefaultCatalog();
    void loadGoogleCatalog();
    return () => controller.abort();
  }, [addingGroup, catalogAttempt, googleKey, falKey, disabledAgents]);

  useEffect(() => {
    if (!keysReady) return;
    const controller = new AbortController();
    async function load() {
      let savedModels: unknown;
      let savedSelection: string[] | undefined;
      let hidden: string[] | undefined;
      try {
        [savedModels, savedSelection, hidden] = await Promise.all([
          getSetting('custom-models', 'custom-models'),
          getSetting<string[]>('selected-models'),
          getSetting<string[]>('hidden-models'),
        ]);
      } catch {
        if (!controller.signal.aborted) toast.add({ id: 'model-settings-error', title: 'Could not load model settings. Reload to retry.', type: 'error' });
        return;
      }
      // Prices come from the full catalog so saved models are priced too; a failed lookup just hides prices.
      const prices = new Map<string, string>();
      const vision = new Map<string, boolean>();
      const names = new Map<string, string>();
      await Promise.all(categories.filter((category) => category.value !== "3d").map(async (category) => {
        try {
          const response = await fetch(`/api/models?category=${category.value}&all=true`, { signal: controller.signal });
          if (response.ok) for (const item of (await response.json()).models as CatalogModel[]) {
            if (item.price) prices.set(`${category.value}:${item.id}`, item.price);
            if (category.value === "llm" && typeof item.vision === "boolean") vision.set(item.id, item.vision);
            if (category.value === "llm") names.set(item.id, modelDisplayName(item.name));
          }
        } catch { /* Prices are optional. */ }
      }));
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
              const name = item.value === `picture:${browserImageModel}` ? browserProvider : item.value === `picture:${geminiImageModel}` ? `${geminiProvider} (Image)` : item.value === `video:${geminiVideoModel}` ? `${geminiProvider} (Video)` : modelDisplayName(item.value.startsWith("llm:") && localAgentModel(item.value.slice(4))?.modelId
                ? item.name.replace(/ · (Claude Code|Codex)$/, "")
                : item.name);
              group.models.push({ value: item.value, name, label: name, capabilities: group.value === "3d" && isMultiview(item.value.slice(3)) ? ["multi-view-to-3d"] : Array.isArray(item.capabilities) ? item.capabilities.filter((value: unknown): value is Capability => typeof value === "string" && Object.hasOwn(capabilityLabels, value)) : undefined, custom: true });
            }
          }
        } catch { /* Stored models may be unavailable in private browsing. */ }
        const falPriced = await falPrices(falKey, results.find((group) => group.value === "3d")?.models.map((model) => model.value.slice(3)) ?? [], controller.signal);
        if (controller.signal.aborted) return;
        for (const group of results) for (const model of group.models) model.price = group.value === "3d" ? falPriced.get(model.value.slice(3)) : prices.get(model.value);
        setGroups(results);
        onCatalogInfoChange?.({ prices, vision, names });
        setHiddenModels(hidden ?? []);
        const useSavedSelection = !saveSelection.current;
        saveSelection.current ??= createSelectionSaver(savedSelection ?? [], (values) => saveSetting('selected-models', values));
        const failed = results.filter((group) => group.error);
        if (failed.length) toast.add({ id: "model-load-error", title: `Could not load ${failed.map((group) => group.label).join(", ")} models.`, type: "error", actionProps: { children: "Retry", onClick: () => setAttempt((value) => value + 1) } });
        onModelsChange((current) => results.flatMap((group) => {
          const selection = useSavedSelection && !current.length ? savedSelection ?? [] : current;
          const selected = group.models.find((item) => selection.includes(item.value) && (item.custom || !hidden?.includes(item.value)));
          return selected ? [selected.value] : group.error
            ? selection.filter((value) => value.startsWith(`${group.value}:`) && !hidden?.includes(value))
            : [];
        }));
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, onModelsChange, onCatalogInfoChange, keysReady, falKey]);

  useEffect(() => {
    if (!saveSelection.current) return;
    const isAvailable = (value: string) => {
      const provider = modelApiKeyProvider(value);
      return (!provider || !!keys[provider]) && isInstalled(value) && allGroups.some((group) =>
        group.models.some((item) => item.value === value && item.custom) ||
        (!hiddenModels.includes(value) && (group.models.some((item) => item.value === value) ||
          (group.error && value.startsWith(`${group.value}:`)))));
    };
    onSelectableChange?.(new Set(allGroups.flatMap((group) => group.models.map((item) => item.value)).filter(isAvailable)));
    const available = models.filter(isAvailable);
    if (available.length !== models.length) {
      onModelsChange(available);
      return;
    }
  }, [models, allGroups, hiddenModels, isInstalled, keys, onModelsChange, onSelectableChange]);

  useEffect(() => {
    const save = saveSelection.current;
    if (!save) return;
    const timer = setTimeout(() => {
      void save(models).catch(() => toast.add({ id: 'model-settings-error', title: 'Could not save selected models. Please retry.', type: 'error' }));
    }, 400);
    return () => clearTimeout(timer);
  }, [models]);

  const existingValues = new Set(allGroups.flatMap((group) => group.models
    .filter((item) => item.custom || !hiddenModels.includes(item.value))
    .map((item) => item.value)));
  const geminiAvailable = !!desktopAgents()?.browserGemini;
  const geminiModel = addingGroup?.value === "video" ? geminiVideoModel : geminiImageModel;
  const hiddenOptions = allGroups.find((group) => group.value === addingGroup?.value)?.models
    .filter((item) => !item.custom && hiddenModels.includes(item.value))
    .map((item) => ({ id: item.value.slice(item.value.indexOf(":") + 1), name: item.name, capabilities: item.capabilities, price: item.price })) ?? [];
  // Chat is routed through tool calls, so models without tools could not be used.
  const ollamaToolModels = ollama.models.filter((item) => item.tools).map((item) => ({ id: `${ollamaPrefix}${item.id}`, name: item.id }));
  const sdInstalledModels = (sd.status?.models ?? []).filter((item) => item.installed).map((item) => ({ id: `${sdPrefix}${item.id}`, name: item.name }));
  const local3dInstalledModels = (local3d.status?.models ?? []).filter((item) => item.installed).map((item) => ({ id: `${local3dPrefix}${item.id}`, name: item.name }));
  const googleEligible = !!googleKey && (addingGroup?.value === "llm" || addingGroup?.value === "picture" || addingGroup?.value === "video");
  const {
    providerOptions,
    selectedProvider,
    availableOptions,
    selectedDefault,
    selectedGoogle,
    selectedAgent,
    selectedBrowser,
    selectedGemini,
  } = addingGroup
    ? resolveAddModelOptions({
        category: addingGroup.value,
        defaultProvider: addingGroup.provider,
        existingValues,
        hiddenOptions,
        catalog,
        catalogStatus,
        googleEligible,
        googleCatalog,
        googleStatus,
        agentEntries: localCatalog,
        ollamaPrefix,
        ollamaToolModels,
        sdSupported: !!sd.status?.supported,
        sdPrefix,
        sdInstalledModels,
        local3dSupported: !!local3d.status?.supported,
        local3dPrefix,
        local3dInstalledModels,
        browserAvailable,
        browserImageModel,
        geminiAvailable,
        geminiModel,
        selectedProviderId: addProvider,
      })
    : {
        providerOptions: [],
        selectedProvider: undefined,
        availableOptions: [],
        selectedDefault: false,
        selectedGoogle: false,
        selectedAgent: undefined,
        selectedBrowser: false,
        selectedGemini: false,
      };
  const needsDesktopRestart = !!selectedAgent && selectedAgent.models === null;
  const resolvedModelId = modelId ?? (selectedBrowser ? browserImageModel : selectedGemini ? geminiModel : "");
  const modelToAdd = availableOptions.find((model) => model.id === resolvedModelId);
  const loadingModels = (selectedGoogle && googleStatus === "loading")
    || (selectedDefault && !hiddenOptions.length && catalogStatus === "loading");
  const modelsUnavailable = (selectedGoogle && googleStatus !== "ready")
    || (selectedDefault && !hiddenOptions.length && catalogStatus !== "ready");
  const selectionLabel = items.find((item) => models.includes(item.value))?.name ?? "Select models";

  function openSetupIfKeyMissing(value: string) {
    const provider = modelApiKeyProvider(value);
    if (!keysReady || !provider || keys[provider]) return false;
    const item = items.find((entry) => entry.value === value);
    setOpen(false);
    onOpenModelSetup({ provider, modelName: item?.name });
    return true;
  }

  useEffect(() => {
    if (!addingGroup) return;
    if ((selectedDefault && catalogStatus === "error") || (selectedGoogle && googleStatus === "error") || selectedAgent?.error) {
      toast.add({
        id: "model-catalog-error",
        title: selectedAgent?.error ? "Could not load agent models." : "Could not load models.",
        type: "error",
        actionProps: { children: "Retry", onClick: () => setCatalogAttempt((attempt) => attempt + 1) },
      });
    }
  }, [addingGroup, selectedDefault, selectedGoogle, selectedAgent, catalogStatus, googleStatus]);

  if (!groups.length) return (
    <div role="status" aria-label="Loading models" aria-busy="true" className="min-w-0 max-w-[min(15rem,calc(100vw-8rem))] shrink-0">
      <Skeleton aria-hidden="true" className="h-8 w-32 max-w-full" />
    </div>
  );

  return (
    <div className="flex min-w-0 max-w-[min(15rem,calc(100vw-8rem))] shrink-0 flex-col items-end gap-1">
      <Select multiple items={items} open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void Promise.all([refreshOllama(), refreshSd(), refreshLocal3d()]);
      }}
        value={models} onValueChange={(nextModels) => {
          const added = nextModels.find((value) => !models.includes(value));
          if (added && openSetupIfKeyMissing(added)) return;
          onModelsChange(added ? nextModels.filter((value) => value === added || value.split(":")[0] !== added.split(":")[0]) : nextModels);
        }} disabled={disabled || settingsSaving}>
        <SelectTrigger size="sm" variant="ghost" aria-label="AI models" className="max-w-full">
          <SelectValue className="min-w-0 truncate" title={selectionLabel}>
            <span className="truncate">{selectionLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent side="top" align="end" alignItemWithTrigger={false} className="w-80 max-w-[calc(100vw-2rem)]">
          {groups.map((group) => <SelectGroup key={group.value}>
            <div className="flex items-center justify-between pr-1">
              <SelectLabel>{group.label}</SelectLabel>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Add ${group.label} model`}
                onClick={() => { setOpen(false); if (group.value === "llm") void refreshOllama(); if (group.value === "picture") void refreshSd(); if (group.value === "3d") void refreshLocal3d(); setAddProvider(null); setModelId(null); setLocalCatalog([]); setBrowserAvailable(false); setCatalog([]); setCatalogStatus("loading"); setGoogleCatalog([]); setGoogleStatus("loading"); setAddingGroup(group); }}>
                <PlusIcon />
              </Button>
            </div>
            {group.models.length ? group.models.map((item) => <div key={item.value} className="relative overflow-hidden rounded-xl">
              {swipe?.id === item.value && <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-end rounded-xl pr-2 text-destructive motion-safe:transition-colors ${swipe.offset <= swipeDeleteThreshold ? "bg-destructive/20" : "bg-destructive/10"}`}>
                <Trash2Icon className="size-4 shrink-0" />
              </div>}
              <SelectItem value={item.value}
              title={canDelete ? "Drag left to remove, or press Delete" : "Keep at least one model"}
              className={`[&>:first-child]:min-w-0 ${canDelete ? "touch-pan-y bg-popover" : ""} ${swipe?.id === item.value ? "rounded-none" : ""}`}
              style={swipe?.id === item.value ? { transform: `translateX(${swipe.offset}px)` } : undefined}
              {...bindSwipe(item.value, canDelete && !disabled, () => { setOpen(false); setDeletingModel(item); })}
              onKeyDown={(event) => {
                if (canDelete && (event.key === "Delete" || event.key === "Backspace")) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  setDeletingModel(item);
                }
              }}>
              <span className="flex w-full min-w-0 items-center gap-2">
                <ModelProviderIcon value={item.value} provider={group.provider} />
                <span className="truncate">{item.name}</span>
                <PriceText price={item.price} />
                <CapabilityText capabilities={item.capabilities} />
              </span>
            </SelectItem></div>) : <SelectItem value={`${group.value}:empty`} disabled>
              {group.error ? "Models unavailable" : "No models available"}
            </SelectItem>}
          </SelectGroup>)}
          <div className="border-t border-border p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setOpen(false);
                onOpenModelSetup();
              }}
            >
              <KeyIcon className="size-3.5" />
              <span>Configure API keys & local models…</span>
            </Button>
          </div>
        </SelectContent>
      </Select>
      <ConfirmDelete open={!!deletingModel} onOpenChange={(open) => { if (!open) setDeletingModel(null); }} title="Remove model?" actionLabel="Remove" description={`“${deletingModel?.name}” will be removed from your model list.`} disabled={disabled || settingsSaving || !canDelete} onConfirm={async () => { if (deletingModel) await removeModel(deletingModel.value); }} />
      <Dialog open={!!addingGroup} onOpenChange={(open) => { if (!open && !settingsSaving) setAddingGroup(null); }}>
        <DialogContent showCloseButton={!settingsSaving} className="gap-4 rounded-2xl p-4 shadow-lg sm:max-w-lg">
          <DialogHeader className="min-h-8 justify-center pr-8">
            <DialogTitle>Add {addingGroup?.value === "llm" ? "LLM" : addingGroup?.value === "3d" ? "3D" : addingGroup?.label.toLowerCase()} model</DialogTitle>
            <DialogDescription className="sr-only">Choose a provider and add a model to your list.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={async (event) => {
            event.preventDefault();
            if (disabled || settingsSaving || !addingGroup || !modelToAdd) return;
            const value = `${addingGroup.value}:${modelToAdd.id}`;
            const name = selectedBrowser ? browserProvider : selectedGemini ? geminiProvider : selectedAgent && modelToAdd.id === selectedAgent.id
              ? selectedAgent.name : modelDisplayName(modelToAdd.name);
            const { capabilities } = modelToAdd;
            const next = allGroups.map((group) => group.value === addingGroup.value
              ? { ...group, models: [...group.models, { value, name, label: name, capabilities, custom: true }] } : group);
            try {
              setSettingsSaving(true);
              const signIn = selectedBrowser ? desktopAgents()?.browserSignIn : selectedGemini ? desktopAgents()?.browserSignInGemini : undefined;
              if (signIn && !await signIn()) {
                toast.add({ title: `Sign in to ${selectedGemini ? "Gemini" : "ChatGPT"} to add this model.`, type: "error" });
                return;
              }
              if (selectedDefault && hiddenOptions.some((item) => item.id === modelToAdd.id)) {
                const visible = hiddenModels.filter((model) => model !== value);
                await saveSetting('hidden-models', visible);
                setHiddenModels(visible);
              } else {
                await saveSetting('custom-models', next.flatMap((group) => group.models.filter((model) => model.custom)));
                setGroups(next);
              }
            } catch {
              toast.add({ title: "Could not save model settings. Please retry.", type: "error" });
              return;
            } finally {
              setSettingsSaving(false);
            }
            setAddingGroup(null);
            if (!openSetupIfKeyMissing(value)) {
              onModelsChange((current) => [...current.filter((model) => !model.startsWith(`${addingGroup.value}:`)), value]);
            }
          }}>
            {providerOptions.length > 0 ? <FieldGroup className="gap-3">
              {addingGroup && <Field className="min-w-0">
                <FieldLabel htmlFor="add-model-provider">Provider</FieldLabel>
                <Select items={providerOptions.map(({ id, name }) => ({ value: id, label: name }))}
                  value={selectedProvider?.id} disabled={disabled || settingsSaving}
                  onValueChange={(value) => { setAddProvider(value); setModelId(null); }}>
                  <SelectTrigger id="add-model-provider" title={selectedProvider?.name} className="w-full min-w-0">
                    <SelectValue className="min-w-0 items-center">
                      <ModelProviderIcon value={`${addingGroup.value}:${selectedProvider?.id ?? ""}`} provider={addingGroup.provider} />
                      <span className="truncate">{selectedProvider?.name}</span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {providerOptions.map(({ id, name }) => <SelectItem key={id} value={id}>
                      <span className="flex items-center gap-2">
                        <ModelProviderIcon value={`${addingGroup.value}:${id}`} provider={addingGroup.provider} />
                        {name}
                      </span>
                    </SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>}
              <Field className="min-w-0">
                <FieldLabel htmlFor="custom-model-search">Search models</FieldLabel>
                <Combobox items={availableOptions}
                  value={modelToAdd ?? null}
                  itemToStringLabel={(model) => model.name} itemToStringValue={(model) => model.id}
                  filter={(model, query) => `${model.name} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())}
                  isItemEqualToValue={(a, b) => a.id === b.id}
                  onValueChange={(model) => setModelId(model?.id ?? "")}>
                  <ComboboxInput id="custom-model-search" placeholder={loadingModels ? "Loading models…" : "Search by name or ID…"} disabled={modelsUnavailable || settingsSaving} showClear />
                  <ComboboxContent className="shadow-lg">
                    <ComboboxEmpty>No matching models.</ComboboxEmpty>
                    <ComboboxList className="max-h-[min(14.5rem,calc(var(--available-height)-2.25rem))] snap-y">
                      {(model: CatalogModel) => <ComboboxItem key={model.id} value={model} title={model.name} className="snap-start">
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="flex w-full min-w-0 items-center gap-2">
                            {addingGroup && <ModelProviderIcon value={`${addingGroup.value}:${model.id}`} provider={addingGroup.provider} />}
                            <span className="truncate">{model.name}</span>
                            <PriceText price={model.price} />
                            <CapabilityText capabilities={model.capabilities} />
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{selectedAgent && model.id === selectedAgent.id ? `Uses the model configured in ${selectedAgent.name}` : localAgentModel(model.id)?.modelId ?? model.id}</span>
                        </div>
                      </ComboboxItem>}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Field>
            </FieldGroup> : <p role="status" className="text-xs text-muted-foreground">All available models have been added.</p>}
            {needsDesktopRestart && <p role="status" className="text-xs text-muted-foreground">Restart Lomra to load the agent’s models.</p>}
            <DialogFooter className="flex-row justify-end">
              <Button type="button" variant="ghost" size="sm" disabled={settingsSaving} onClick={() => setAddingGroup(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={disabled || settingsSaving || !modelToAdd}>{settingsSaving ? "Adding…" : "Add model"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

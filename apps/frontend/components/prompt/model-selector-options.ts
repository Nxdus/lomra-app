import type { KeyedProvider } from "@/components/api-provider";
import { localAgentModel } from "./agent-chat";
import { isBrowserModel, isLocal3dModel, isOllamaModel, isSdModel, modelProvider } from "./generation";

export type ModelCategory = "llm" | "picture" | "video" | "3d";
export type CatalogStatus = "loading" | "ready" | "error";
export type Capability = "text-to-3d" | "image-to-3d" | "multi-view-to-3d";
export type CatalogModel = { id: string; name: string; capabilities?: Capability[]; price?: string; vision?: boolean };
export type AgentProviderEntry = { id: string; name: string; models: CatalogModel[] | null; error?: boolean };
export type ProviderOption = { id: string; name: string };

export const googlePrefix = "google-ai/";
export const browserProvider = "ChatGPT";
export const geminiProvider = "Gemini";

export function modelApiKeyProvider(value: string): KeyedProvider | undefined {
  const separator = value.indexOf(":");
  if (separator < 1 || separator === value.length - 1) return;
  const category = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (category === "llm") return isOllamaModel(model) || localAgentModel(model) ? undefined : modelProvider(model);
  if (category === "3d") return isLocal3dModel(model) ? undefined : "fal";
  if ((category === "picture" || category === "video") && !isBrowserModel(model) && !isSdModel(model)) return modelProvider(model);
}

export function resolveAddModelOptions(input: {
  category: ModelCategory;
  defaultProvider: string;
  existingValues: ReadonlySet<string>;
  hiddenOptions: CatalogModel[];
  catalog: CatalogModel[];
  catalogStatus: CatalogStatus;
  googleEligible: boolean;
  googleCatalog: CatalogModel[];
  googleStatus: CatalogStatus;
  agentEntries: AgentProviderEntry[];
  ollamaPrefix: string;
  ollamaToolModels: CatalogModel[];
  sdSupported: boolean;
  sdPrefix: string;
  sdInstalledModels: CatalogModel[];
  /** Local 3D models; optional so callers without it keep working. */
  local3dSupported?: boolean;
  local3dPrefix?: string;
  local3dInstalledModels?: CatalogModel[];
  browserAvailable: boolean;
  browserImageModel: string;
  geminiAvailable: boolean;
  geminiModel: string;
  selectedProviderId: string | null;
}) {
  const { category, defaultProvider, existingValues } = input;
  const isAvailable = (model: CatalogModel) => !existingValues.has(`${category}:${model.id}`);

  const defaultOptions = [
    ...input.hiddenOptions,
    ...input.catalog.filter((model) => !input.hiddenOptions.some((item) => item.id === model.id)),
  ].filter(isAvailable);

  const googleOptions = input.googleCatalog.filter(isAvailable);

  const availableAgentEntries = input.agentEntries
    .map((agent) => ({
      agent,
      options: (agent.models ?? [{ id: agent.id, name: "Default" }]).filter(isAvailable),
    }))
    .filter(({ agent, options }) => agent.models === null || options.length > 0);

  const ollamaOptions = category === "llm" ? input.ollamaToolModels.filter(isAvailable) : [];
  const sdOptions = category === "picture" && input.sdSupported ? input.sdInstalledModels.filter(isAvailable) : [];

  const local3dPrefix = input.local3dPrefix ?? "";
  const local3dInstalled = input.local3dInstalledModels ?? [];
  const local3dOptions = category === "3d" && input.local3dSupported ? local3dInstalled.filter(isAvailable) : [];

  const browserOptions = category === "picture" && input.browserAvailable
    ? [{ id: input.browserImageModel, name: "Create image" }].filter(isAvailable)
    : [];

  const geminiOptions = (category === "picture" || category === "video") && input.geminiAvailable
    ? [{ id: input.geminiModel, name: category === "video" ? "Create video" : "Create image" }].filter(isAvailable)
    : [];

  const providerOptions: ProviderOption[] = [
    ...(input.catalogStatus !== "ready" || defaultOptions.length > 0
      ? [{ id: defaultProvider, name: defaultProvider }]
      : []),
    ...(input.googleEligible && (input.googleStatus !== "ready" || googleOptions.length > 0)
      ? [{ id: googlePrefix, name: "Google AI" }]
      : []),
    ...availableAgentEntries.map(({ agent }) => ({ id: agent.id, name: agent.name })),
    ...(ollamaOptions.length > 0
      ? [{ id: input.ollamaPrefix, name: "Ollama" }]
      : []),
    ...(sdOptions.length > 0
      ? [{ id: input.sdPrefix, name: "Stable Diffusion" }]
      : []),
    ...(local3dOptions.length > 0
      ? [{ id: local3dPrefix, name: "3D models" }]
      : []),
    ...(browserOptions.length > 0 ? [{ id: browserProvider, name: browserProvider }] : []),
    ...(geminiOptions.length > 0 ? [{ id: geminiProvider, name: geminiProvider }] : []),
  ];

  const selectedProvider = providerOptions.find(({ id }) => id === input.selectedProviderId) ?? providerOptions[0];
  const activeId = selectedProvider?.id;
  const selectedDefault = activeId === defaultProvider;
  const selectedGoogle = input.googleEligible && activeId === googlePrefix;
  const selectedOllama = category === "llm" && activeId === input.ollamaPrefix;
  const selectedSd = category === "picture" && input.sdSupported && activeId === input.sdPrefix;
  const selectedLocal3d = category === "3d" && !!input.local3dSupported && activeId === local3dPrefix;
  const selectedAgentEntry = availableAgentEntries.find(({ agent }) => agent.id === activeId);
  const selectedBrowser = category === "picture" && input.browserAvailable && activeId === browserProvider;
  const selectedGemini = (category === "picture" || category === "video") && input.geminiAvailable && activeId === geminiProvider;

  const availableOptions: CatalogModel[] = selectedBrowser
    ? browserOptions
    : selectedGemini
      ? geminiOptions
      : selectedOllama
        ? ollamaOptions
        : selectedLocal3d
          ? local3dOptions
          : selectedSd
            ? sdOptions
            : selectedAgentEntry
              ? selectedAgentEntry.options
              : selectedGoogle
                ? googleOptions
                : selectedDefault
                  ? defaultOptions
                  : [];

  return {
    providerOptions,
    selectedProvider,
    availableOptions,
    selectedDefault,
    selectedGoogle,
    selectedAgent: selectedAgentEntry?.agent,
    selectedBrowser,
    selectedGemini,
  };
}

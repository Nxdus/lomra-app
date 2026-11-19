import assert from "node:assert/strict";
import test from "node:test";
import {
  browserProvider,
  geminiProvider,
  googlePrefix,
  resolveAddModelOptions,
  type AgentProviderEntry,
  type CatalogModel,
} from "./model-selector-options";

const baseInput = {
  category: "picture" as const,
  defaultProvider: "OpenRouter",
  existingValues: new Set<string>(),
  hiddenOptions: [] as CatalogModel[],
  catalog: [{ id: "openai/gpt-5.4-image-2", name: "GPT Image" }],
  catalogStatus: "ready" as const,
  googleEligible: true,
  googleCatalog: [{ id: `${googlePrefix}gemini-2.5-flash-image`, name: "Gemini Flash Image" }],
  googleStatus: "ready" as const,
  agentEntries: [] as AgentProviderEntry[],
  ollamaPrefix: "ollama/",
  ollamaToolModels: [] as CatalogModel[],
  sdSupported: false,
  sdPrefix: "sd-local/",
  sdInstalledModels: [] as CatalogModel[],
  browserAvailable: true,
  browserImageModel: "chatgpt-browser/create-image",
  geminiAvailable: true,
  geminiModel: "gemini-browser/create-image",
  selectedProviderId: null,
};

test("hides ChatGPT and Gemini when their single model is already added", () => {
  const initial = resolveAddModelOptions(baseInput);
  assert.deepEqual(initial.providerOptions.map((p) => p.id), ["OpenRouter", googlePrefix, browserProvider, geminiProvider]);

  const afterAdding = resolveAddModelOptions({
    ...baseInput,
    existingValues: new Set([
      "picture:chatgpt-browser/create-image",
      "picture:gemini-browser/create-image",
    ]),
  });
  assert.deepEqual(afterAdding.providerOptions.map((p) => p.id), ["OpenRouter", googlePrefix]);
});

test("hides Google AI and OpenRouter once all of their models are added and falls back to the next provider", () => {
  const result = resolveAddModelOptions({
    ...baseInput,
    existingValues: new Set([
      "picture:openai/gpt-5.4-image-2",
      `picture:${googlePrefix}gemini-2.5-flash-image`,
      "picture:gemini-browser/create-image",
    ]),
    selectedProviderId: null,
  });
  assert.deepEqual(result.providerOptions.map((p) => p.id), [browserProvider]);
  assert.equal(result.selectedProvider?.id, browserProvider);
  assert.equal(result.selectedBrowser, true);
  assert.deepEqual(result.availableOptions, [{ id: "chatgpt-browser/create-image", name: "Create image" }]);
});

test("keeps OpenRouter and Google AI visible while loading or on error, and returns empty list when all providers are exhausted", () => {
  const loading = resolveAddModelOptions({
    ...baseInput,
    catalog: [],
    catalogStatus: "loading",
    googleCatalog: [],
    googleStatus: "loading",
    browserAvailable: false,
    geminiAvailable: false,
  });
  assert.deepEqual(loading.providerOptions.map((p) => p.id), ["OpenRouter", googlePrefix]);

  const exhausted = resolveAddModelOptions({
    ...baseInput,
    existingValues: new Set([
      "picture:openai/gpt-5.4-image-2",
      `picture:${googlePrefix}gemini-2.5-flash-image`,
      "picture:chatgpt-browser/create-image",
      "picture:gemini-browser/create-image",
    ]),
  });
  assert.deepEqual(exhausted.providerOptions, []);
  assert.equal(exhausted.selectedProvider, undefined);
  assert.deepEqual(exhausted.availableOptions, []);
});

test("hides Stable Diffusion when no installed models can be added", () => {
  const withoutInstalled = resolveAddModelOptions({
    ...baseInput,
    sdSupported: true,
    sdInstalledModels: [],
    browserAvailable: false,
    geminiAvailable: false,
  });
  assert.deepEqual(withoutInstalled.providerOptions.map((p) => p.id), ["OpenRouter", googlePrefix]);

  const allAdded = resolveAddModelOptions({
    ...baseInput,
    sdSupported: true,
    sdInstalledModels: [{ id: "sd-local/flux", name: "FLUX" }],
    existingValues: new Set(["picture:sd-local/flux"]),
    browserAvailable: false,
    geminiAvailable: false,
  });
  assert.deepEqual(allAdded.providerOptions.map((p) => p.id), ["OpenRouter", googlePrefix]);
});

test("hides local agents and Ollama when none of their models can be added", () => {
  const agents: AgentProviderEntry[] = [
    { id: "local-agent/opencode", name: "OpenCode", models: [{ id: "local-agent/opencode", name: "Default" }] },
    {
      id: "local-agent/claude",
      name: "Claude Code",
      models: [
        { id: "local-agent/claude", name: "Default" },
        { id: "local-agent/claude/sonnet", name: "Sonnet" },
      ],
    },
    { id: "local-agent/restart", name: "Codex", models: null },
  ];
  const ollamaModels = [{ id: "ollama/qwen3:4b", name: "qwen3:4b" }];

  const withRemaining = resolveAddModelOptions({
    ...baseInput,
    category: "llm",
    catalog: [{ id: "anthropic/claude-opus-5.5", name: "Claude Opus" }],
    googleEligible: false,
    googleCatalog: [],
    agentEntries: agents,
    ollamaToolModels: ollamaModels,
    browserAvailable: false,
    geminiAvailable: false,
    existingValues: new Set(["llm:local-agent/opencode", "llm:ollama/qwen3:4b"]),
  });
  assert.deepEqual(
    withRemaining.providerOptions.map((p) => p.id),
    ["OpenRouter", "local-agent/claude", "local-agent/restart"],
  );

  const withoutToolModels = resolveAddModelOptions({
    ...baseInput,
    category: "llm",
    catalog: [{ id: "anthropic/claude-opus-5.5", name: "Claude Opus" }],
    googleEligible: false,
    googleCatalog: [],
    agentEntries: [],
    ollamaToolModels: [],
    browserAvailable: false,
    geminiAvailable: false,
  });
  assert.deepEqual(withoutToolModels.providerOptions.map((p) => p.id), ["OpenRouter"]);
});

test("offers local 3D only when an installed model can be added", () => {
  const input = { ...baseInput, category: "3d" as const, local3dSupported: true, local3dPrefix: "local3d/", browserAvailable: false, geminiAvailable: false };
  const notInstalled = resolveAddModelOptions({ ...input, local3dInstalledModels: [] });
  assert.equal(notInstalled.providerOptions.some((p) => p.id === "local3d/"), false);
  const installed = resolveAddModelOptions({ ...input, local3dInstalledModels: [{ id: "local3d/triposr", name: "TripoSR" }], selectedProviderId: "local3d/" });
  assert.equal(installed.selectedProvider?.id, "local3d/");
  assert.deepEqual(installed.availableOptions, [{ id: "local3d/triposr", name: "TripoSR" }]);
  const added = resolveAddModelOptions({ ...input, local3dInstalledModels: [{ id: "local3d/triposr", name: "TripoSR" }], existingValues: new Set(["3d:local3d/triposr"]) });
  assert.equal(added.providerOptions.some((p) => p.id === "local3d/"), false);
  assert.equal(resolveAddModelOptions({ ...input, category: "picture", local3dInstalledModels: [] }).providerOptions.some((p) => p.id === "local3d/"), false);
  assert.equal(resolveAddModelOptions({ ...input, local3dSupported: false }).providerOptions.some((p) => p.id === "local3d/"), false);
});

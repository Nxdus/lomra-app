"use client";

import { Tip } from "@/components/tip";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpIcon, BoxIcon, CloudUploadIcon, DownloadIcon, EyeIcon, GripVerticalIcon, HistoryIcon, Loader2Icon, MessageCircleIcon, MicIcon, PauseIcon, PlusIcon, RefreshCwIcon, PanelsTopLeftIcon, TrashIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chatStorage, persistentUrl, restoreGenerations, type Chat } from "./chat-storage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { EffortPicker } from "./effort-picker";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { imagePreview, MAX_MEDIA_ITEMS, promptContent, type MediaPart } from "./media";
import { mediaToolModel, type ToolSource } from "./media-tools";
import { SpeechMenu } from "./speech-menu";
import { VoiceRecorder } from "./voice-recorder";
import { MarkdownMessage } from "./markdown-message";
import { chatTimeline } from "./chat-timeline";
import { ModelSelector } from "./model-selector";
import { toast } from "@/components/ui/toast";
import { useApiProviders } from "@/components/api-provider";
import { multiviewRequirements, resolveMultiview } from "./multiview";
import { canvasResults, generate, llmProvider as providerOf, modelProvider, type Category, selectedModel, isMultiview, isSdModel, requiresImage, isLocal3dModel, type ConversationMessage, type GeneratedFile, type Generation, type GenerationTask } from "./generation";
import type { VisibleImage } from "@/components/image-canvas";
import { CanvasModelViewer } from "@/components/canvas-model-viewer";
import { canvasFileError, canvasFileKind } from "@/lib/image-canvas/image-canvas-storage";
import { getSetting, saveSetting } from "@/lib/settings";
import { isRemoteOllama } from "@/lib/ollama-url";
import { desktopAgents, desktopOllama, type AgentToolResult } from "@/lib/desktop";
import { swipeDeleteThreshold, useSwipeToDelete } from "@/hooks/use-swipe-to-delete";
import { agentEfforts, agentLabels, localAgentModel, runAgentChat } from "./agent-chat";
import { saveAgentLimits } from "./agent-limits";
import { draftedShots, draftShotsInstruction, draftStoryInstruction, maxStoryCharacters, mergeStoryCharacters, shotImagePrompt, storyCharacterNotesLimit, storyLimit, storyReply, type Shot, type Storyboard, type StoryCharacter } from "./storyboard-data";
import { StoryboardShots } from "./storyboard-shots";
import { StoryboardCharacters } from "./storyboard-characters";
import { storageFile } from "@/lib/storage";
import { CharacterPicker } from "./character-picker";
import { characterContext, characterGeneration, loadCharacterReferences } from "./character-references";

function notifyError(title: string) { toast.add({ title, type: "error" }); }
const storyboardCommand = "/storyboard";
// A single invisible character lets the textarea delete the badge with native editing keys.
const storyboardMarker = "\u2060";

export function FloatingPrompt({ canvasId = "default", loading = false, onAddToCanvas, onFocusFile, selection = [], onModelPreview, onDeselect }: { canvasId?: string; loading?: boolean; onAddToCanvas?: (files: File[]) => Promise<string[]>; onFocusFile?: (file: File) => void; selection?: VisibleImage[]; onModelPreview?: (id: string) => string; onDeselect?: (ids: string[]) => void }) {
  const panel = useRef<HTMLElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const commandsId = useId();
  const storyboardOptionId = `${commandsId}-storyboard`;
  const storyboardOverlay = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [chatBottom, setChatBottom] = useState<number | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [promptFocused, setPromptFocused] = useState(false);
  const [commandsDismissed, setCommandsDismissed] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const llm = selectedModel(models, "llm");
  const localEngine = localAgentModel(llm);
  const threeDModel = selectedModel(models, "3d") ?? "";
  const multiview = isMultiview(threeDModel);
  const selectedCharacterImage = selection.length === 1 && canvasFileKind(selection[0].file) === "image" ? selection[0].file : undefined;
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [storyboard, setStoryboard] = useState<Storyboard>();
  const [storyboardQueued, setStoryboardQueued] = useState(false);
  const [shotsOpen, setShotsOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const storyImages = history[0]?.images ?? [];
  const canChooseStoryboard = !storyboard && !storyboardQueued;
  const promptPlaceholder = storyboard || storyboardQueued ? "What story would you like to tell or revise?" : "Describe what you want to generate...";
  const isStoryboardShortcut = canChooseStoryboard && prompt.startsWith("/") && storyboardCommand.startsWith(prompt.trim().toLowerCase());
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [status, setStatus] = useState("");
  const [agentText, setAgentText] = useState("");
  const waitingForReply = !!status && !agentText;
  const transcript = useRef<HTMLDivElement>(null);
  const [efforts, setEfforts] = useState<Record<string, string>>({});
  const [agentSession, setAgentSession] = useState<Chat["agentSession"]>();
  const [adding, setAdding] = useState("");
  const [canvasFiles, setCanvasFiles] = useState<Record<string, File>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [chatExpanded, setChatExpanded] = useState<string[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const commandsOpen = isStoryboardShortcut && !!chatId && promptFocused && !commandsDismissed && !status && !voiceMode;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const { swipe, bind: bindSwipe } = useSwipeToDelete();
  const [storageError, setStorageError] = useState("");
  const [saving, setSaving] = useState(false);
  const saves = useRef(Promise.resolve());
  const importing = useRef(false);
  const { keys, request } = useApiProviders();
  const active = useRef<AbortController | null>(null);
  const agentMessageIndex = useRef(0);
  const agentSelection = useRef<VisibleImage[] | null>(null);
  const agentCharacters = useRef<Awaited<ReturnType<typeof loadCharacterReferences>>>([]);
  const toolQueue = useRef<Promise<unknown>>(Promise.resolve());
  const toolHandler = useRef<(name: string, args: Record<string, unknown>) => Promise<AgentToolResult>>(async () => ({ text: "" }));
  const mounted = useRef(true);
  const positionLoaded = useRef(false);

  useEffect(() => {
    const list = transcript.current;
    if (waitingForReply && list) list.scrollTop = list.scrollHeight;
  }, [waitingForReply, history.length]);

  useEffect(() => {
    if (storageError) toast.add({ id: "chat-storage-error", title: storageError, type: "error" });
  }, [storageError]);

  function openChat(chat?: Chat) {
    setChatId(chat?.id ?? crypto.randomUUID());
    setHistory(chat?.history ?? []);
    setStoryboard(chat?.storyboard);
    setStoryboardQueued(false);
    setShotsOpen(false);
    setCharactersOpen(false);
    setGenerations(restoreGenerations(chat?.generations ?? []));
    setAgentSession(chat?.agentSession);
    setAgentText("");
    if (chat) setModels(chat.models);
    setPrompt("");
    setCanvasFiles({});
    setExpanded([]);
    setChatExpanded(chat ? ["chat"] : []);
    setHistoryOpen(false);
  }

  useEffect(() => {
    void getSetting<Record<string, string>>('agent-effort').then((saved) => { if (saved) setEfforts(saved); }, () => {});
  }, []);

  function changeEffort(engine: string, value: string) {
    const next = { ...efforts };
    if (value === "default") delete next[engine]; else next[engine] = value;
    const previous = efforts;
    setEfforts(next);
    void saveSetting('agent-effort', next).catch(() => {
      setEfforts(previous);
      toast.add({ id: 'agent-effort-error', title: 'Could not save effort. Please retry.', type: 'error' });
    });
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([chatStorage(undefined, canvasId), getSetting<{ x: number; y: number }>('prompt-position')]).then(([saved, savedPosition]) => {
      if (cancelled) return;
      setChats(saved);
      openChat(); // Always start with a new chat when opening a canvas.
      if (savedPosition) moveTo(savedPosition.x, savedPosition.y);
      positionLoaded.current = true;
    }).catch(() => { if (!cancelled) setStorageError("Could not load chat history. Reload to retry; existing chats have not been changed."); });
    return () => { cancelled = true; };
  }, [canvasId]);

  useEffect(() => {
    if (!positionLoaded.current || !position) return;
    const timer = setTimeout(() => {
      void saveSetting('prompt-position', position).catch(() => toast.add({ id: 'prompt-position-error', title: 'Could not save prompt position. Please retry.', type: 'error' }));
    }, 400);
    return () => clearTimeout(timer);
  }, [position]);

  useEffect(() => {
    if (!chatId || !history.length) return;
    const chat: Chat = { id: chatId, canvasId, title: history.find((message) => message.role === "user")?.content.slice(0, 80) || "New chat", updatedAt: Date.now(), history, generations, models, storyboard, ...(agentSession && { agentSession }) };
    let cancelled = false;
    saves.current = saves.current.then(async () => {
      if (!cancelled) setSaving(true);
      const saved = await chatStorage(chat, canvasId);
      if (!cancelled) { setChats(saved); setStorageError(""); }
    }).catch(() => { setStorageError("Could not save chat history to database. Keep this tab open and check the backend connection before retrying."); }).finally(() => { if (!cancelled) setSaving(false); });
    return () => { cancelled = true; };
  }, [chatId, canvasId, history, generations, models, agentSession, storyboard]);

  async function deleteChat() {
    if (!deleting || status || saving) return;
    try {
      const saved = await chatStorage(deleting.id, canvasId);
      setChats(saved);
      if (deleting.id === chatId) openChat();
      setDeleting(null);
      setStorageError("");
    } catch { setStorageError("Could not delete this chat. Please try again."); }
  }

  async function addToCanvas(file: GeneratedFile, files: GeneratedFile[] = [], signal?: AbortSignal) {
    if (!mounted.current || !onAddToCanvas || importing.current) return;
    importing.current = true;
    setAdding(file.url);
    try {
      const timeout = AbortSignal.timeout(60_000);
      const response = await fetch(file.url, { credentials: file.url.startsWith("/api/storage/files/") ? "same-origin" : "omit", signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
      if (!response.ok) throw new Error("Could not download this result. The link may have expired.");
      const blob = await response.blob();
      const type = file.kind === "video" ? (blob.type.startsWith("video/webm") ? "video/webm" : "video/mp4") : file.kind === "file" ? "model/gltf-binary" : blob.type;
      const extension = file.kind === "video" ? (type === "video/webm" ? "webm" : "mp4") : file.kind === "file" ? "glb" : type.split("/")[1];
      const imported = file.kind === "file" && file.name === "OBJ"
        ? await (await import("./model-conversion")).objToGlb(blob, files)
        : new File([blob], `${file.name}.${extension}`, { type });
      const invalid = canvasFileError(imported);
      if (invalid) throw new Error(invalid);
      if (!mounted.current) return;
      signal?.throwIfAborted();
      const [id] = await onAddToCanvas([imported]);
      setCanvasFiles((current) => ({ ...current, [file.url]: imported }));
      return id;
    } catch (cause) {
      if (signal) throw cause;
      notifyError(cause instanceof Error ? cause.message : "Could not add this result to canvas");
    } finally { importing.current = false; setAdding(""); }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);

  function updateGeneration(id: string, change: Partial<Generation>) {
    setGenerations((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  async function runTask(task: Generation, signal: AbortSignal, imageUrl?: string, images?: string[], sources?: ToolSource[]) {
    try {
      let summary = "";
      const results = await generate(task, request, signal, (change) => { if (change.summary) summary = change.summary; updateGeneration(task.id, change); }, imageUrl, images, sources);
      const files = await Promise.all(results.map(async (file) => ({ ...file, url: await persistentUrl(file.url, file.kind === "file") })));
      results.forEach((file) => { if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url); });
      updateGeneration(task.id, { status: "Completed", files, error: undefined });
      const candidates = canvasResults(files, task.category);
      let imported = candidates.length > 0;
      if (!imported && !summary) notifyError("No supported 3D model was returned. Download the result files to inspect them.");
      for (const file of candidates) {
        if (!await addToCanvas(file, files)) imported = false;
      }
      if (imported) setExpanded((current) => current.filter((id) => id !== task.id));
      return summary || `${task.category} generated with ${task.model}: ${task.prompt}`;
    } catch (cause) {
      const message = signal.aborted ? (cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Request aborted. This provider may still finish submitted work and charge for it.") : cause instanceof Error ? cause.message : "Generation failed";
      notifyError(message);
      updateGeneration(task.id, { status: "Interrupted", error: message });
      return `${task.category} did not complete: ${message}`;
    }
  }

  /** Tools a local agent can call (through the desktop MCP bridge): generate media and read the canvas selection. */
  async function runAgentTool(name: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    const controller = active.current;
    const selected = agentSelection.current;
    if (!controller || !selected) throw new Error("No agent chat is running in Lomra");
    const selectedImages = selected.filter((item) => canvasFileKind(item.file) === "image");
    if (name === "canvas_selection") {
      const text = JSON.stringify({
        selected: selected.map((item) => ({ name: item.file.name, kind: canvasFileKind(item.file) })),
        models: { image: selectedModel(models, "picture") ?? null, video: selectedModel(models, "video") ?? null, "3d": threeDModel || null },
        ...(multiview && { multiview: { requirements: multiviewRequirements(threeDModel), images: selectedImages.map(({ file }, index) => ({ index, name: file.name })) } }),
      });
      if (args.include_images !== true) return { text };
      if (selectedImages.length > MAX_MEDIA_ITEMS) throw new Error(`Select at most ${MAX_MEDIA_ITEMS} images per prompt.`);
      const images = [];
      for (const { file } of selectedImages) images.push(await imagePreview(file, controller.signal));
      return { text, images };
    }
    const category = ({ generate_image: "picture", generate_video: "video", generate_3d: "3d" } as Record<string, Category | undefined>)[name];
    if (!category) throw new Error("Unknown tool");
    const text = typeof args.prompt === "string" ? args.prompt.trim().slice(0, 4000) : "";
    if (!text) throw new Error("A prompt is required");
    const kind = category === "picture" ? "image" : category;
    const model = selectedModel(models, category);
    if (!model) throw new Error(`The user has not selected a ${kind} model in the Lomra prompt yet`);
    if (category === "3d" && !isLocal3dModel(model) && !keys.fal) throw new Error("The user has not entered a Fal API key in Settings, which 3D generation needs");
    const needsViews = category === "3d" && isMultiview(model);
    const content = await promptContent(text, needsViews ? selectedImages : selected, controller.signal, onModelPreview);
    const images = Array.isArray(content) ? content.filter((part) => part.type === "image_url") : [];
    const views = needsViews ? resolveMultiview(model, args.viewIndices, images.map(({ image_url }, index) => ({ url: image_url.url, name: selectedImages[index].file.name }))) : undefined;
    if (category === "3d" && !needsViews && requiresImage(model) && images.length !== 1) throw new Error("This 3D model needs exactly one image selected on the canvas");
    const { task, images: generationImages } = characterGeneration(
      { category, prompt: text, aspectRatio: typeof args.aspect_ratio === "string" ? args.aspect_ratio.slice(0, 16) : undefined, id: crypto.randomUUID(), model, status: "Waiting", messageIndex: agentMessageIndex.current, views },
      images.map((image) => image.image_url.url), agentCharacters.current,
    );
    setGenerations((current) => [...current, task]);
    setExpanded((current) => [...current, task.id]);
    setStatus(`Generating ${kind} · ${model}`);
    const outcome = await runTask(task, controller.signal, images.length === 1 ? images[0].image_url.url : undefined, generationImages, selected);
    if (outcome.includes(" did not complete: ")) throw new Error(outcome);
    return { text: outcome };
  }
  toolHandler.current = runAgentTool;

  useEffect(() => {
    const bridge = desktopAgents();
    if (!bridge) return;
    return bridge.onTool(({ callId, name, args }) => {
      // One at a time: generations share the canvas import step.
      const controller = active.current;
      toolQueue.current = toolQueue.current.then(() => {
        if (!controller || active.current !== controller) throw new Error("The agent run ended");
        controller.signal.throwIfAborted();
        return toolHandler.current(name, args);
      }).then(
        (result) => bridge.toolResult(callId, result),
        (cause) => bridge.toolResult(callId, { text: cause instanceof Error ? cause.message : "Tool failed", isError: true }),
      );
    });
  }, []);

  async function submitMessage(signal: AbortSignal) {
    const images = [];
    for (const { file } of selection) {
      if (canvasFileKind(file) !== "image") continue;
      if (images.length === MAX_MEDIA_ITEMS) throw new Error(`Select at most ${MAX_MEDIA_ITEMS} images per prompt.`);
      images.push({ name: file.name.slice(0, 512), url: await imagePreview(file, signal) });
    }
    signal.throwIfAborted();
    const message: ConversationMessage = { role: "user", content: prompt.trim(), ...(images.length > 0 && { images }) };
    setHistory((current) => [...current, message]);
    setPrompt("");
    onDeselect?.(selection.map(({ id }) => id));
    return message;
  }

  async function sendToAgent({ engine, modelId }: NonNullable<ReturnType<typeof localAgentModel>>) {
    const label = agentLabels[engine];
    const text = prompt.trim();
    agentMessageIndex.current = history.length + 1;
    const controller = new AbortController();
    active.current = controller;
    agentSelection.current = [...selection];
    setStatus(`${label} is working…`);
    setAgentText("");
    let submitted = false;
    const resumed = agentSession?.engine === engine && agentSession.modelId === modelId;
    const intro = resumed ? "" : "You are the assistant inside Lomra, a canvas app for making images, 3D models and video. Use the lomra tools to generate media (results are added to the user's canvas) and to see what the user has selected. Keep replies short and answer in the user's language.\n\n";
    const names = selection.map((item) => item.file.name).filter(Boolean);
    const context = (names.length ? `\n\n(The user sent this message with these canvas items: ${names.join(", ")}.)` : "")
      + (selection.some(({ file }) => canvasFileKind(file) === "image") ? "\n\nIf the attached images matter to the request, call canvas_selection with include_images=true to view them." : "")
      + (multiview ? `\n\nThe selected 3D model supports Multi-view: ${multiviewRequirements(threeDModel)}. For a 3D generation, call canvas_selection with include_images=true to inspect the selected images and their indices. Use only those images and ask the user to identify any missing or ambiguous views.` : "");
    try {
      agentCharacters.current = await loadCharacterReferences(text, controller.signal);
      await submitMessage(controller.signal);
      submitted = true;
      const result = await runAgentChat(engine, intro + text + context + characterContext(agentCharacters.current), {
        sessionId: resumed ? agentSession.id : undefined,
        modelId,
        effort: efforts[engine],
        signal: controller.signal,
        onText: setAgentText,
        onTool: (name) => setStatus(`${label} · ${name}`),
        onLimits: (windows) => { if (engine === "claude") void saveAgentLimits(windows).catch(() => {}); },
      });
      if (result.sessionId) setAgentSession({ engine, id: result.sessionId, modelId });
      setHistory((current) => [...current, { role: "assistant", content: (result.text || `${label} finished without a reply.`).slice(0, 8000) }]);
    } catch (cause) {
      notifyError(controller.signal.aborted ? "Request stopped" : cause instanceof Error ? cause.message : `${label} failed`);
      if (submitted) setHistory((current) => [...current, { role: "assistant", content: controller.signal.aborted ? "Stopped." : `${label} did not finish.` }]);
    } finally {
      setAgentText("");
      agentSelection.current = null;
      agentCharacters.current = [];
      active.current = null;
      setStatus("");
    }
  }

  async function startLocalLlm(signal: AbortSignal) {
    const ollama = desktopOllama();
    if (!ollama) return;
    const server = await getSetting<string>("ollama-url").catch(() => undefined);
    if (!server || !isRemoteOllama(server)) {
      setStatus("Starting Ollama…");
      await ollama.start();
    }
    signal.throwIfAborted();
  }

  async function runStoryboard(label: string, work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus(label);
    try {
      await work(controller.signal);
    } catch (cause) {
      notifyError(controller.signal.aborted ? "Request stopped" : cause instanceof Error ? cause.message : "Storyboard request failed");
    } finally {
      active.current = null;
      setStatus("");
    }
  }

  async function storyboardCompletion(instruction: string, text: string, images: typeof storyImages, signal: AbortSignal, prior: ConversationMessage[] = []) {
    if (!llm || localEngine) throw new Error("Select an OpenRouter, Google, or Ollama LLM for Storyboard.");
    const provider = providerOf(llm);
    if (provider === "ollama") {
      await startLocalLlm(signal);
      setStatus(instruction === draftStoryInstruction ? "Refining story…" : "Drafting shots…");
    }
    const content: MediaPart[] = [{ type: "text", text }];
    for (const [index, image] of images.entries()) {
      content.push({ type: "text", text: `Selected image ${index}: ${image.name}` }, { type: "image_url", image_url: { url: image.url } });
    }
    return request(provider, {
      action: "chat", model: llm, signal,
      input: [{ role: "system", content: instruction }, ...prior.slice(-20).map(({ role, content }) => ({ role, content })), { role: "user", content }],
    });
  }

  async function refineStory() {
    await runStoryboard("Refining story…", async (signal) => {
      const text = prompt.trim();
      const prior = storyboardQueued ? [] : history;
      const references = prior.length ? [] : selection.filter(({ file }) => canvasFileKind(file) === "image");
      if (references.length > MAX_MEDIA_ITEMS) throw new Error(`Select at most ${MAX_MEDIA_ITEMS} images for a storyboard.`);
      const images = prior.length ? [...storyImages] : await Promise.all(references.map(async ({ file }) => ({
        name: file.name.slice(0, 512) || "Selected image", url: await imagePreview(file, signal),
      })));
      const mentioned = await loadCharacterReferences(text, signal, true);
      const imported = mentioned.map(({ character, url }): StoryCharacter => {
        const label = `@${character.name}`;
        const saved = images.findIndex((image) => image.name === label && image.url === url);
        const image = saved >= 0 ? saved : images.push({ name: label, url }) - 1;
        return { name: character.name, notes: character.notes.slice(0, storyCharacterNotesLimit), image };
      });
      if (images.length > MAX_MEDIA_ITEMS) throw new Error(`A storyboard can use up to ${MAX_MEDIA_ITEMS} selected images and @Character references combined.`);
      const cast = mergeStoryCharacters(storyboard?.characters ?? [], imported);
      const input = JSON.stringify({ userRequest: text, currentDraft: storyboard?.story ?? "", cast: cast.map(({ name, notes, image }) => ({ name, notes, image })) });
      const reply = storyReply(await storyboardCompletion(draftStoryInstruction, input, images, signal, prior), images.length);
      signal.throwIfAborted();
      if (storyboardQueued && (history.length || generations.length)) openChat();
      setStoryboardQueued(false);
      setChatExpanded(["chat"]);
      const conversation: ConversationMessage[] = [...prior, { role: "user", content: text }, { role: "assistant", content: reply.reply }];
      if (images.length) conversation[0] = { ...conversation[0], images };
      setHistory(conversation);
      setStoryboard({ story: reply.story, characters: mergeStoryCharacters(cast, reply.characters) });
      setPrompt("");
      if (references.length) onDeselect?.(references.map(({ id }) => id));
    });
  }

  async function makeShots(story: Storyboard) {
    if (!story.story.trim()) return;
    await runStoryboard("Drafting shots…", async (signal) => {
      const characters = story.characters ?? [];
      const input = JSON.stringify({ story: story.story, cast: characters.map(({ name, notes, image }, index) => ({ index, name, notes, image })) });
      const shots = draftedShots(await storyboardCompletion(draftShotsInstruction, input, storyImages, signal), storyImages.length, characters);
      signal.throwIfAborted();
      setStoryboard({ ...story, shots });
      setShotsOpen(true);
    });
  }

  function editShot(index: number, change: Partial<Shot>) {
    setStoryboard((current) => current?.shots ? {
      ...current, shots: current.shots.map((shot, position) => position === index ? { ...shot, ...change } : shot),
    } : current);
  }

  function editCharacter(index: number, change: Partial<StoryCharacter>) {
    setStoryboard((current) => current ? {
      ...current, characters: current.characters?.map((character, position) => position === index ? { ...character, ...change } : character),
    } : current);
  }

  function removeCharacter(index: number) {
    setStoryboard((current) => current ? {
      ...current, characters: current.characters?.filter((_, position) => position !== index),
      shots: current.shots?.map((shot) => ({ ...shot, characters: shot.characters?.filter((position) => position !== index)
        .map((position) => position > index ? position - 1 : position) })),
    } : current);
  }

  async function renderStoryboardImage(name: string, prompt: string, images: string[], signal: AbortSignal) {
    const model = selectedModel(models, "picture");
    if (!model) throw new Error("Select an image model in the prompt toolbar first.");
    const task: Generation = { id: crypto.randomUUID(), category: "picture", model, status: "Waiting", prompt };
    const files = await generate(task, request, signal, ({ status }) => { if (status) setStatus(status); }, undefined, images);
    try {
      signal.throwIfAborted();
      const file = files.find((file) => file.kind === "image");
      if (!file) throw new Error("The image model did not return a picture.");
      const id = await addToCanvas({ ...file, name }, files, signal);
      if (!id) throw new Error("Could not add the image to the canvas.");
      return id;
    } finally {
      files.forEach(({ url }) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); });
    }
  }

  async function generateCharacter(index: number, character: StoryCharacter, story: string) {
    await runStoryboard(`Generating reference for ${character.name}…`, async (signal) => {
      const prompt = `Create one clear character reference image for ${character.name}. Show their appearance and clothing clearly in a neutral pose, without text.\nAppearance: ${character.notes}\nStory context: ${story}`;
      const generatedId = await renderStoryboardImage(`Character ${character.name.replace(/[\\/]/g, " ")}`, prompt, [], signal);
      editCharacter(index, { generatedId, approved: false });
    });
  }

  async function generateShot(index: number, story: Storyboard) {
    const shot = story.shots?.[index];
    if (!shot?.description.trim() || shot.image !== null || shot.generatedId) return;
    await runStoryboard(`Generating image for shot ${index + 1}…`, async (signal) => {
      const model = selectedModel(models, "picture");
      if (!model) throw new Error("Select an image model in the prompt toolbar first.");
      const useImages = !isSdModel(model) && modelProvider(model) !== "google";
      const references: string[] = [];
      const details: string[] = [];
      for (const position of shot.characters ?? []) {
        const character = story.characters![position];
        let url = useImages && character.image !== null ? storyImages[character.image].url : undefined;
        if (useImages && !url && character.approved && character.generatedId) {
          const blob = await storageFile(character.generatedId);
          if (!blob) throw new Error(`Could not load the reference for ${character.name}.`);
          url = await imagePreview(new File([blob], character.name), signal);
        }
        const image = url ? (references.includes(url) ? references.indexOf(url) + 1 : references.push(url)) : undefined;
        details.push(`${character.name.trim() || `Character ${position + 1}`}: ${character.notes}${image ? ` (reference image ${image})` : ""}`);
      }
      if (useImages) for (const index of shot.references) {
        const url = storyImages[index].url;
        if (references.length < MAX_MEDIA_ITEMS && !references.includes(url)) references.push(url);
      }
      const prompt = shotImagePrompt(shot.description, story.story, details);
      const generatedId = await renderStoryboardImage(`Storyboard shot ${index + 1}`, prompt, references, signal);
      editShot(index, { generatedId });
    });
  }

  function chooseStoryboard() {
    if (!chatId || active.current) return;
    setStoryboardQueued(true);
    if (isStoryboardShortcut) setPrompt("");
    requestAnimationFrame(() => {
      const input = promptInput.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  async function send() {
    if (active.current || !chatId || !prompt.trim()) return;
    if (commandsOpen || (canChooseStoryboard && prompt.trim().toLowerCase() === storyboardCommand)) { chooseStoryboard(); return; }
    setChatExpanded(["chat"]);
    if (storyboardQueued || storyboard) {
      if (!storyboard?.shots) await refineStory();
      return;
    }
    if (localEngine) return sendToAgent(localEngine);
    const llmProvider = llm ? providerOf(llm) : "openrouter";
    if (!llm || (llmProvider !== "ollama" && !keys[llmProvider])) {
      notifyError(!llm ? "Select an LLM first" : `Enter your ${llmProvider === "google" ? "Google" : "OpenRouter"} API key in Settings first`);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setStatus(selection.length ? "Preparing selected media…" : "Thinking…");
    try {
      if (llmProvider === "ollama") {
        await startLocalLlm(controller.signal);
        setStatus(selection.length ? "Preparing selected media…" : "Thinking…");
      }
      const characters = await loadCharacterReferences(prompt, controller.signal);
      const routingPrompt = `${prompt.trim()}${characterContext(characters, false)}\n\nSelected 3D model: ${threeDModel || "none"}. ${multiview ? `Multiview: ${multiviewRequirements(threeDModel)}.` : requiresImage(threeDModel) ? "Image-to-3D: requires one image." : "Text-to-3D: no images required."}`;
      if (characters.length && routingPrompt.length > 8000) throw new Error("The prompt is too long. Shorten it before sending.");
      const content = await promptContent(routingPrompt, selection, controller.signal, onModelPreview);
      const images = Array.isArray(content) ? content.filter((part) => part.type === "image_url") : [];
      const imageUrl = images.length === 1 ? images[0].image_url.url : undefined;
      const message = await submitMessage(controller.signal);
      const fullHistory = [...history, message];
      setStatus("Thinking…");
      const input = [...history.slice(-20).map(({ role, content }) => ({ role, content })), { role: "user", content }];
      const plan = await request(llmProvider, { action: "route", model: llm, input, signal: controller.signal }) as { text: string; tasks: GenerationTask[] };
      const prepared = plan.tasks.map((task) => {
        const model = task.mediaTool ? mediaToolModel(task.mediaTool) : task.operation ? "Local image tools" : selectedModel(models, task.category);
        if (!model) throw new Error(`Select a ${task.category === "picture" ? "image" : task.category} model first`);
        if (task.category === "3d" && !task.mediaTool && !isLocal3dModel(model) && !keys.fal) throw new Error("Enter your Fal API key in Settings to generate 3D models");
        if (task.mediaTool && model !== "Local media tools" && !keys.fal) throw new Error("Enter your Fal API key in Settings to run AI media tools");
        const views = task.category === "3d" && isMultiview(model)
          ? resolveMultiview(model, task.viewIndices, images.map(({ image_url }, index) => ({ url: image_url.url, name: `Selected image ${index + 1}` })))
          : undefined;
        return characterGeneration(
          { ...task, views, id: crypto.randomUUID(), model, status: "Waiting", messageIndex: fullHistory.length },
          images.map((image) => image.image_url.url), characters,
        );
      });
      const tasks = prepared.map(({ task }) => task);
      const nextHistory: ConversationMessage[] = [...fullHistory, ...(plan.text || tasks.length ? [{ role: "assistant" as const, content: plan.text.slice(0, 8000) }] : [])];
      setHistory(nextHistory);
      setGenerations((current) => [...current, ...tasks]);
      setExpanded((current) => [...current, ...tasks.map((task) => task.id)]);
      const outcomes: string[] = [];
      for (const { task, images: generationImages } of prepared) {
        if (controller.signal.aborted) {
          updateGeneration(task.id, { status: "Not submitted", error: "Stopped before submission" });
          continue;
        }
        setStatus(`Generating ${task.category === "picture" ? "image" : task.category} · ${task.model}`);
        outcomes.push(await runTask(task, controller.signal, imageUrl, generationImages, selection));
      }
      if (outcomes.length) setHistory([...nextHistory, { role: "assistant", content: outcomes.join("\n").slice(0, 8000) }] as ConversationMessage[]);
    } catch (cause) {
      notifyError(controller.signal.aborted ? "Request stopped" : cause instanceof Error ? cause.message : "Could not send prompt");
    } finally {
      active.current = null;
      setStatus("");
    }
  }

  async function checkJob(task: Generation) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus("Checking existing job…");
    updateGeneration(task.id, { error: undefined, status: "Checking" });
    try {
      const outcome = await runTask(task, controller.signal, undefined, undefined, selection);
      setHistory((current) => [...current, { role: "assistant" as const, content: outcome.slice(0, 8000) }]);
    }
    finally { active.current = null; setStatus(""); }
  }

  function moveTo(x: number, y: number) {
    const bounds = panel.current?.getBoundingClientRect();
    if (!bounds) return;
    const contentTop = panel.current?.closest("main")?.getBoundingClientRect().top ?? 0;

    setChatBottom(null);
    setPosition({
      x: Math.max(16, Math.min(x, window.innerWidth - bounds.width - 16)),
      y: Math.max(contentTop + 16, Math.min(y, window.innerHeight - bounds.height - 16)),
    });
  }

  function changeChatExpanded(value: string[]) {
    if (!value.includes("chat") && position && chatBottom === null && panel.current) {
      setChatBottom(window.innerHeight - panel.current.getBoundingClientRect().bottom);
    }
    setChatExpanded(value);
  }

  useEffect(() => {
    function keepInView() {
      const bounds = panel.current?.getBoundingClientRect();
      if (bounds && (
        bounds.left < 16 || bounds.top < 16 ||
        bounds.right > window.innerWidth - 16 || bounds.bottom > window.innerHeight - 16
      )) moveTo(bounds.x, bounds.y);
    }

    window.addEventListener("resize", keepInView);
    const observer = new ResizeObserver(keepInView);
    if (panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener("resize", keepInView);
      observer.disconnect();
    };
  }, []);

  return (
    <section
      ref={panel}
      aria-label="Prompt editor"
      aria-busy={loading}
      className="fixed flex max-h-[calc(var(--app-content-height)-2rem)] min-h-13.5 w-184 max-w-[calc(100%-2rem)] flex-col gap-2 overflow-y-auto rounded-3xl border border-border bg-card p-2 text-card-foreground shadow-xl"
      style={position
        ? { left: position.x, ...(chatBottom === null
          ? { top: `max(calc(var(--app-titlebar-space) + 1rem), ${position.y}px)` }
          : { bottom: chatBottom }) }
        : { left: "50%", bottom: 24, transform: "translateX(-50%)" }}
    >
      {loading ? <div role="status" aria-label="Loading canvas" className="flex flex-col gap-3 p-2">
        <div aria-hidden="true" className="flex items-center gap-2">
          <Skeleton className="size-5" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="ml-auto size-7" />
          <Skeleton className="size-7" />
        </div>
        <div aria-hidden="true" className="flex items-center gap-2">
          <Skeleton className="size-7" />
          <Skeleton className="h-9 min-w-0 flex-1" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
        </div>
      </div> : <>
      <Accordion value={chatExpanded} onValueChange={changeChatExpanded} className="shrink-0 rounded-none border-0">
      <AccordionItem value="chat" className="data-open:bg-transparent">
      <div className="flex items-center gap-2 px-2">
        <div className="min-w-0 flex-1">
          <AccordionTrigger className="items-center gap-2 px-1 py-2" disabled={!history.length && !generations.length && !status}>
            <MessageCircleIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{status || chats.find((chat) => chat.id === chatId)?.title || (storyboard ? "Storyboard chat" : "Chat with canvas")}</span>
          </AccordionTrigger>
        </div>
        {saving && <span role="status" className="flex size-8 shrink-0 items-center justify-center text-muted-foreground" title="Saving…"><CloudUploadIcon aria-hidden="true" className="size-4 motion-safe:animate-pulse" /><span className="sr-only">Saving…</span></span>}
        <Combobox items={chats} value={chats.find((chat) => chat.id === chatId) ?? null} itemToStringLabel={(chat) => chat.title} isItemEqualToValue={(a, b) => a.id === b.id} inputValue={historySearch} onInputValueChange={setHistorySearch} open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (open) setHistorySearch(""); }} onValueChange={(chat) => { if (chat) openChat(chat); }}>
          <Tip label="Chat history"><ComboboxTrigger render={<Button variant="ghost" size="icon-sm" />} className="[&>svg:last-child]:hidden" aria-label="Chat history" disabled={!chatId || !!status || saving || !!adding || voiceMode || !!storageError}><HistoryIcon /></ComboboxTrigger></Tip>
          <ComboboxContent side="top" align="end" className="w-80">
            <ComboboxInput aria-label="Search chats" placeholder="Search chats…" showTrigger={false} />
            <ComboboxEmpty>{chats.length ? "No chats found." : "No saved chats yet."}</ComboboxEmpty>
            <ComboboxList aria-label="Chat history">
              {(chat: Chat) => {
                const offset = swipe?.id === chat.id ? swipe.offset : undefined;
                const confirmDelete = () => { setHistoryOpen(false); setDeleting(chat); };
                return <div key={chat.id} className="relative touch-pan-y overflow-hidden rounded-xl" {...bindSwipe(chat.id, !status && !saving, confirmDelete)}>
                  {offset !== undefined && <div aria-hidden="true" className={`pointer-events-none absolute inset-0 flex items-center justify-end pr-2 text-destructive motion-safe:transition-colors ${offset <= swipeDeleteThreshold ? "bg-destructive/20" : "bg-destructive/10"}`}><TrashIcon className="size-4" /></div>}
                  <div className="flex items-center bg-popover" style={offset === undefined ? undefined : { transform: `translateX(${offset}px)` }}>
                    <ComboboxItem value={chat} className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-1 items-center gap-2"><span className="min-w-0 flex-1 truncate">{chat.title}</span><span className="shrink-0 text-xs text-muted-foreground">{new Date(chat.updatedAt).toLocaleDateString()}</span></span>
                    </ComboboxItem>
                    <Button variant="ghost" size="sm" className="sr-only focus-visible:not-sr-only" aria-label={`Delete ${chat.title}`} onClick={confirmDelete}>Delete</Button>
                  </div>
                </div>;
              }}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {storyboard && <Button variant="ghost" size="sm" onClick={() => setCharactersOpen(true)}>Cast ({storyboard.characters?.length ?? 0})</Button>}
        {storyboard?.shots && <Button variant="ghost" size="sm" onClick={() => setShotsOpen(true)}>
          <PanelsTopLeftIcon data-icon="inline-start" />View storyboard
        </Button>}
        <Tip label="New chat"><Button variant="ghost" size="icon-sm" aria-label="New chat" disabled={!chatId || !!status || saving || !!adding || voiceMode || !!storageError} onClick={() => openChat()}><PlusIcon /></Button></Tip>
      </div>
      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Delete chat?</DialogTitle><DialogDescription>“{deleting?.title}” will be permanently deleted. Files already on the canvas will stay.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" onClick={() => void deleteChat()}>Delete chat</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {(history.length > 0 || generations.length > 0 || status) && <AccordionContent className="border-b pb-2">
      <div ref={transcript} className="flex max-h-[40dvh] flex-col gap-3 overflow-y-auto overscroll-contain py-2 [&>*]:shrink-0" aria-label="Generation results" aria-busy={!!status}>
        {chatTimeline(history, generations).map(({ message, tasks }, index) => <div key={index} className="flex flex-col gap-1">
        {message && <div className={message.role === "user" ? "ml-auto flex max-w-[85%] flex-col items-end gap-1 px-3" : "flex flex-col gap-1 px-3"}>
          <span className="text-xs text-muted-foreground">{message.role === "user" ? "You" : "Lomra"}</span>
          {!!message.images?.length && <div className={message.role === "user" ? "flex max-w-full gap-2 overflow-x-auto py-1" : "flex gap-2 overflow-x-auto py-1"} aria-label="Attached images">
            {message.images.map(({ name, url }, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={index} src={url} alt={name || "Attached image"} className="size-24 shrink-0 rounded-xl border bg-muted object-contain" />
            ))}
          </div>}
          {message.role === "user" ? <p className="whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-1.5 text-sm">{message.content}</p> : <MarkdownMessage>{message.content}</MarkdownMessage>}
        </div>}
        {tasks.length > 0 && <Accordion value={expanded} onValueChange={setExpanded} multiple className="rounded-none border-0">
        {tasks.map((task) => <AccordionItem key={task.id} value={task.id} className="relative data-open:bg-transparent">
          <AccordionTrigger className="items-center px-3 py-2">{task.category === "picture" ? "Image" : task.category === "3d" ? "3D" : "Video"} · {canvasResults(task.files ?? [], task.category).some((file) => canvasFiles[file.url]) ? "Added to canvas" : task.status}</AccordionTrigger>
          <div className="absolute top-1 right-9 flex">
            {task.files?.filter((file) => canvasFiles[file.url]).map((file) => <Button key={file.url} variant="ghost" size="icon-sm" aria-label={`View ${file.name} on canvas`} title={`View ${file.name} on canvas`} onClick={() => {
              try { onFocusFile?.(canvasFiles[file.url]); }
              catch (cause) {
                notifyError(cause instanceof Error ? cause.message : "Could not find this item on canvas");
                setCanvasFiles((current) => { const next = { ...current }; delete next[file.url]; return next; });
                setExpanded((current) => current.includes(task.id) ? current : [...current, task.id]);
              }
            }}><EyeIcon /></Button>)}
          </div>
          <AccordionContent className="flex flex-col gap-2 px-3">
          <p className="text-muted-foreground">{task.model}</p>
          <p className="text-muted-foreground">{task.prompt}</p>
          {task.views && <div className="flex gap-2 overflow-x-auto" aria-label="Submitted views">{Object.entries(task.views).map(([view, image]) => <div key={view} className="flex w-20 shrink-0 flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={`${view}: ${image.name}`} className="h-16 w-full rounded-lg border object-contain" />
            <span className="text-xs">{view}</span>
          </div>)}</div>}
          {task.error && <div className="leading-6">
            <span role="alert" className="text-destructive">{task.error}</span>
            <Tip label={task.requestId ? "Check job" : "Try again"}><Button variant="ghost" size="icon-xs" className="ml-1 inline-flex align-middle text-destructive hover:text-destructive" aria-label={task.requestId ? "Check job" : "Try again"} disabled={!!status} onClick={() => void checkJob(task)}><RefreshCwIcon /></Button></Tip>
          </div>}
          {task.files?.map((file) => <div key={file.url} className="flex items-center gap-2 rounded-xl border bg-background p-1">
            <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
              {file.kind === "image"
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={file.url} alt={file.name} className="size-full object-cover" />
                : file.kind === "video"
                  ? <video src={file.url} muted playsInline preload="metadata" className="size-full object-cover" />
                  : <BoxIcon className="size-5" />}
            </div>
            <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>{file.name}</span>
            {!canvasFiles[file.url] && onAddToCanvas && canvasResults(task.files ?? [], task.category).includes(file) && <Tip label="Retry adding to canvas"><Button variant="ghost" size="icon-sm" aria-label="Retry adding to canvas" disabled={!!adding || !!status} onClick={() => void addToCanvas(file, task.files)}>{adding === file.url ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}</Button></Tip>}
            <Tip label={`Download ${file.name}`}><Button variant="ghost" size="icon-sm" aria-label={`Download ${file.name}`} render={<a href={file.url} target="_blank" rel="noopener noreferrer" download={file.url.startsWith("/api/storage/files/") ? `${file.name}.glb` : file.url.startsWith("data:") || file.url.startsWith("blob:") ? file.name : undefined} />} nativeButton={false}><DownloadIcon /></Button></Tip>
          </div>)}
          </AccordionContent>
        </AccordionItem>)}
        </Accordion>}
        </div>)}
        {agentText && <div className="flex flex-col gap-1 px-3"><span className="text-xs text-muted-foreground">Lomra</span><MarkdownMessage>{agentText}</MarkdownMessage></div>}
        {waitingForReply && <div className="flex flex-col gap-1 px-3 text-muted-foreground">
          <span className="text-xs">Lomra</span>
          <span className="flex items-center gap-2 text-sm"><Loader2Icon aria-hidden="true" className="size-4 motion-safe:animate-spin" />{status}</span>
        </div>}
      </div>
      </AccordionContent>}
      </AccordionItem>
      </Accordion>
      {storyboard && <StoryboardCharacters open={charactersOpen} onOpenChange={setCharactersOpen}
        characters={storyboard.characters ?? []} images={storyImages} status={status}
        onAdd={() => setStoryboard((current) => current && (current.characters?.length ?? 0) < maxStoryCharacters
          ? { ...current, characters: [...(current.characters ?? []), { name: "", notes: "", image: null }] } : current)}
        onEdit={editCharacter} onRemove={removeCharacter}
        onGenerate={(index) => void generateCharacter(index, storyboard.characters![index], storyboard.story)}
        onStop={() => active.current?.abort()} />}
      {storyboard?.shots && <StoryboardShots open={shotsOpen} onOpenChange={setShotsOpen} shots={storyboard.shots} images={storyImages} characters={storyboard.characters ?? []}
        busy={!!status} status={status} onEdit={editShot} onGenerate={(index) => void generateShot(index, storyboard)} onStop={() => active.current?.abort()} />}
      {storyboard && !storyboard.shots && <Field className="gap-2 px-3">
        <FieldLabel htmlFor="story-draft">Story draft</FieldLabel>
        <Textarea id="story-draft" rows={4} maxLength={storyLimit} value={storyboard.story} disabled={!!status}
          onChange={(event) => setStoryboard({ ...storyboard, story: event.target.value })} />
        <Button size="sm" className="self-end" disabled={!!status || !storyboard.story.trim()} onClick={() => void makeShots(storyboard)}>Use this story</Button>
      </Field>}
      {!storyboard && selection.some(({ file }) => !storyboardQueued || canvasFileKind(file) === "image") && <div aria-label="Selected canvas items" className="flex max-h-36 gap-2 overflow-x-auto px-3 py-2">
        {selection.filter(({ file }) => !storyboardQueued || canvasFileKind(file) === "image").map((item) => <div key={item.id} title={item.file.name} className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
          {canvasFileKind(item.file) === "image" ? (
            // Canvas blob URLs are already owned by the canvas.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt={item.file.name || "Selected image"} className="size-full object-contain" />
          ) : canvasFileKind(item.file) === "video" ? <video src={item.url} preload="metadata" muted aria-label={item.file.name} className="size-full object-contain" /> : <CanvasModelViewer src={item.url} name={item.file.name} />}
        </div>)}
      </div>}
      <div className="flex w-full min-w-0 items-center gap-2">
      {voiceMode && <VoiceRecorder
        onCancel={() => setVoiceMode(false)}
        onTranscribed={(text) => {
          setPrompt((current) => current ? `${current.trimEnd()} ${text}` : text);
          setVoiceMode(false);
        }}
      />}
      <div className={voiceMode ? "hidden" : "flex w-full min-w-0 flex-col gap-2"}>
      {!storyboard?.shots && <div className="relative min-w-0">
      {storyboardQueued && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={storyboardOverlay} className="relative mx-3 mt-2 h-5 text-base leading-5 md:text-sm">
          <Badge variant="secondary" className="absolute top-0 left-0">storyboard</Badge>
          {!prompt && <span className="ml-21 block truncate text-muted-foreground">{promptPlaceholder}</span>}
        </div>
      </div>}
      <Textarea
        ref={promptInput}
        value={storyboardQueued ? storyboardMarker + prompt : prompt}
        onChange={(event) => {
          const value = event.target.value;
          setCommandsDismissed(false);
          setPrompt(storyboardQueued ? value.replace(storyboardMarker, "") : value);
          if (storyboardQueued && !value.startsWith(storyboardMarker)) setStoryboardQueued(false);
        }}
        onFocus={() => setPromptFocused(true)}
        onBlur={() => setPromptFocused(false)}
        onScroll={(event) => {
          if (storyboardOverlay.current) storyboardOverlay.current.style.translate = `0 -${event.currentTarget.scrollTop}px`;
        }}
        disabled={!!status}
        maxLength={8000 + Number(storyboardQueued)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (commandsOpen && (event.key === "ArrowDown" || event.key === "Escape")) {
            event.preventDefault();
            if (event.key === "Escape") setCommandsDismissed(true);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        aria-label="Prompt"
        aria-controls={commandsOpen ? commandsId : undefined}
        aria-activedescendant={commandsOpen ? storyboardOptionId : undefined}
        aria-description={storyboardQueued ? "Storyboard command selected. Delete the badge at the start to cancel." : undefined}
        placeholder={promptPlaceholder}
        rows={1}
        className={`min-h-9 max-h-[min(8.5rem,calc(100dvh-5rem))] w-full min-w-0 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2 leading-5 shadow-none field-sizing-content focus-visible:border-transparent focus-visible:ring-0${storyboardQueued ? " indent-21" : ""}`}
      />
      <Popover open={commandsOpen} onOpenChange={(open) => { if (!open) setCommandsDismissed(true); }}>
        <PopoverContent anchor={promptInput} side="top" align="start" initialFocus={false} finalFocus={false}
          id={commandsId} role="listbox" aria-label="Commands" className="w-max max-w-(--available-width) gap-0 p-1">
          <div className="px-3 py-2 text-xs text-muted-foreground" aria-hidden="true">Commands</div>
          <Button type="button" variant="secondary" size="sm" role="option" aria-selected="true" id={storyboardOptionId}
            tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={chooseStoryboard} className="justify-start">
            <PanelsTopLeftIcon data-icon="inline-start" /><span className="font-mono">{storyboardCommand}</span><span className="text-muted-foreground">Draft a storyboard</span>
          </Button>
        </PopoverContent>
      </Popover>
      </div>}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="touch-none cursor-grab select-none active:cursor-grabbing"
            aria-label="Move prompt editor. Drag or use arrow keys."
            title="Drag to move · Arrow keys to reposition"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              const bounds = panel.current!.getBoundingClientRect();
              drag.current = {
                pointerId: event.pointerId,
                x: event.clientX - bounds.x,
                y: event.clientY - bounds.y,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (active?.pointerId === event.pointerId) {
                moveTo(event.clientX - active.x, event.clientY - active.y);
              }
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onLostPointerCapture={() => { drag.current = null; }}
            onKeyDown={(event) => {
              const direction = {
                ArrowLeft: [-1, 0], ArrowRight: [1, 0],
                ArrowUp: [0, -1], ArrowDown: [0, 1],
              }[event.key];
              if (!direction) return;
              event.preventDefault();
              const bounds = panel.current!.getBoundingClientRect();
              const step = event.shiftKey ? 40 : 10;
              moveTo(bounds.x + direction[0] * step, bounds.y + direction[1] * step);
            }}
          >
            <GripVerticalIcon />
          </Button>
      {threeDModel && <div aria-label="3D model input requirements" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{multiview ? "Multiview" : requiresImage(threeDModel) ? "Single image" : "Text to 3D"}</span>
        <span aria-hidden="true">·</span>
        <span>{multiview ? multiviewRequirements(threeDModel) : requiresImage(threeDModel) ? "1 image" : "Text only"}</span>
      </div>}
          <div className="ml-auto flex min-w-0 items-center gap-2">
          {!storyboard?.shots && <CharacterPicker disabled={!!status} selectedImage={selectedCharacterImage} onPick={(name) => {
            setPrompt((current) => {
              const text = current.replace(/(^|\s)@[\p{L}\p{M}\p{N}_-]*$/u, "$1").trimEnd();
              const next = `${text}${text ? " " : ""}@${name} `;
              return next.length <= 8000 ? next : current;
            });
            requestAnimationFrame(() => promptInput.current?.focus());
          }} />}
          {localEngine && agentEfforts[localEngine.engine] && <EffortPicker levels={agentEfforts[localEngine.engine] ?? []} value={efforts[localEngine.engine]}
            onChange={(level) => changeEffort(localEngine.engine, level)} disabled={!!status} />}
          <ModelSelector models={models} onModelsChange={setModels} disabled={!!status} />
          {!storyboard?.shots && <SpeechMenu><Button variant="ghost" size="icon-sm" aria-label="Record audio" title="Record audio · right-click for speech models" disabled={!!status} onClick={() => setVoiceMode(true)}>
            <MicIcon />
          </Button></SpeechMenu>}
          <span role="status" className="sr-only">{status}</span>
          {(!storyboard?.shots || status) && <Tip label={status ? `${status} · Stop generation` : "Send prompt"}><Button
            size="icon-sm"
            disabled={!chatId || (!status && !prompt.trim())}
            aria-label={status ? "Stop generation" : "Send prompt"}
            onClick={() => status ? active.current?.abort() : void send()}
          >
            {status ? <PauseIcon /> : <ArrowUpIcon />}
          </Button></Tip>}
          </div>
      </div>
      </div>
      </div>
      </>}
    </section>
  );
}

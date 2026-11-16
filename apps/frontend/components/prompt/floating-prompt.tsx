"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, CloudUploadIcon, GripVerticalIcon, HistoryIcon, MessageCircleIcon, MicIcon, PauseIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chatStorage, persistentUrl, restoreGenerations, type Chat } from "./chat-storage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { promptContent } from "./media";
import { mediaToolModel, type ToolSource } from "./media-tools";
import { VoiceRecorder } from "./voice-recorder";
import { MarkdownMessage } from "./markdown-message";
import { chatTimeline } from "./chat-timeline";
import { ModelSelector } from "./model-selector";
import { toast } from "@/components/ui/toast";
import { useApiProviders } from "@/components/api-provider";
import { multiviewRequirements } from "./multiview";
import { canvasResults, generate, selectedModel, isMultiview, requiresImage, multiviewError, modelViews, type ModelViews, type ConversationMessage, type GeneratedFile, type Generation, type GenerationTask } from "./generation";
import type { VisibleImage } from "@/components/image-canvas";
import { CanvasModelViewer } from "@/components/canvas-model-viewer";
import { canvasFileError, canvasFileKind } from "@/lib/image-canvas/image-canvas-storage";
import { getSetting, saveSetting } from "@/lib/settings";

function notifyError(title: string) { toast.add({ title, type: "error" }); }

export function FloatingPrompt({ canvasId = "default", loading = false, onAddToCanvas, onFocusFile, selection = [], onModelPreview }: { canvasId?: string; loading?: boolean; onAddToCanvas?: (files: File[]) => Promise<void>; onFocusFile?: (file: File) => void; selection?: VisibleImage[]; onModelPreview?: (id: string) => string }) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const threeDModel = selectedModel(models, "3d") ?? "";
  const multiview = isMultiview(threeDModel);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState("");
  const [canvasFiles, setCanvasFiles] = useState<Record<string, File>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [chatExpanded, setChatExpanded] = useState<string[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [storageError, setStorageError] = useState("");
  const [saving, setSaving] = useState(false);
  const saves = useRef(Promise.resolve());
  const importing = useRef(false);
  const { keys, request } = useApiProviders();
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const positionLoaded = useRef(false);

  useEffect(() => {
    if (storageError) toast.add({ id: "chat-storage-error", title: storageError, type: "error" });
  }, [storageError]);

  function openChat(chat?: Chat) {
    setChatId(chat?.id ?? crypto.randomUUID());
    setHistory(chat?.history ?? []);
    setGenerations(restoreGenerations(chat?.generations ?? []));
    if (chat) setModels(chat.models);
    setPrompt("");
    setCanvasFiles({});
    setExpanded([]);
    setChatExpanded(chat ? ["chat"] : []);
    setHistoryOpen(false);
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([chatStorage(undefined, canvasId), getSetting<{ x: number; y: number }>('prompt-position')]).then(([saved, savedPosition]) => {
      if (cancelled) return;
      setChats(saved);
      openChat(saved[0]);
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
    const chat: Chat = { id: chatId, canvasId, title: history.find((message) => message.role === "user")?.content.slice(0, 80) || "New chat", updatedAt: Date.now(), history, generations, models };
    let cancelled = false;
    saves.current = saves.current.then(async () => {
      if (!cancelled) setSaving(true);
      const saved = await chatStorage(chat, canvasId);
      if (!cancelled) { setChats(saved); setStorageError(""); }
    }).catch(() => { setStorageError("Could not save chat history to database. Keep this tab open and check the backend connection before retrying."); }).finally(() => { if (!cancelled) setSaving(false); });
    return () => { cancelled = true; };
  }, [chatId, canvasId, history, generations, models]);

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

  async function addToCanvas(file: GeneratedFile, files: GeneratedFile[] = []) {
    if (!mounted.current || !onAddToCanvas || importing.current) return;
    importing.current = true;
    setAdding(file.url);
    try {
      const response = await fetch(file.url, { credentials: file.url.startsWith("/api/storage/files/") ? "same-origin" : "omit", signal: AbortSignal.timeout(60_000) });
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
      await onAddToCanvas([imported]);
      setCanvasFiles((current) => ({ ...current, [file.url]: imported }));
      return true;
    } catch (cause) {
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

  async function send() {
    if (active.current || !chatId || !prompt.trim()) return;
    setChatExpanded(["chat"]);
    const llm = selectedModel(models, "llm");
    if (!llm || !keys.openrouter) {
      notifyError(!llm ? "Select an LLM first" : "Enter your OpenRouter API key in Settings first");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setStatus(selection.length ? "Preparing selected media…" : "Thinking…");
    const messages: ConversationMessage[] = [...history.slice(-20), { role: "user", content: prompt.trim() }];
    const fullHistory: ConversationMessage[] = [...history, messages[messages.length - 1]];
    try {
      const content = await promptContent(`${prompt.trim()}\n\nSelected 3D model: ${threeDModel || "none"}. ${multiview ? `Multiview: ${multiviewRequirements(threeDModel)}.` : requiresImage(threeDModel) ? "Image-to-3D: requires one image." : "Text-to-3D: no images required."}`, selection, controller.signal, onModelPreview);
      const images = Array.isArray(content) ? content.filter((part) => part.type === "image_url") : [];
      const imageUrl = images.length === 1 ? images[0].image_url.url : undefined;
      controller.signal.throwIfAborted();
      setStatus("Thinking…");
      const input = [...messages.slice(0, -1), { role: "user", content }];
      const plan = await request("openrouter", { action: "route", model: llm, input, signal: controller.signal }) as { text: string; tasks: GenerationTask[] };
      const tasks = plan.tasks.map((task): Generation => {
        const model = task.mediaTool ? mediaToolModel(task.mediaTool) : task.operation ? "Local image tools" : selectedModel(models, task.category);
        if (!model) throw new Error(`Select a ${task.category === "picture" ? "image" : task.category} model first`);
        if (task.category === "3d" && !task.mediaTool && !keys.fal) throw new Error("Enter your Fal API key in Settings to generate 3D models");
        if (task.mediaTool && model !== "Local media tools" && !keys.fal) throw new Error("Enter your Fal API key in Settings to run AI media tools");
        let views: ModelViews | undefined;
        if (task.category === "3d" && isMultiview(model)) {
          views = {};
          for (const view of modelViews) {
            const index = task.viewIndices?.[view];
            if (index === undefined) continue;
            if (!Number.isInteger(index) || index < 0 || !images[index]) throw new Error("Could not match the selected views. Please select the required images and retry.");
            views[view] = { url: images[index].image_url.url, name: `Selected image ${index + 1}` };
          }
          const error = multiviewError(model, views);
          if (error) throw new Error(error);
        }
        return { ...task, views, id: crypto.randomUUID(), model, status: "Waiting", messageIndex: fullHistory.length };
      });
      setPrompt("");
      const nextHistory: ConversationMessage[] = [...fullHistory, ...(plan.text || tasks.length ? [{ role: "assistant" as const, content: plan.text.slice(0, 8000) }] : [])];
      setHistory(nextHistory);
      setGenerations((current) => [...current, ...tasks]);
      setExpanded((current) => [...current, ...tasks.map((task) => task.id)]);
      const outcomes: string[] = [];
      for (const task of tasks) {
        if (controller.signal.aborted) {
          updateGeneration(task.id, { status: "Not submitted", error: "Stopped before submission" });
          continue;
        }
        setStatus(`Generating ${task.category === "picture" ? "image" : task.category} · ${task.model}`);
        outcomes.push(await runTask(task, controller.signal, imageUrl, images.map((image) => image.image_url.url), selection));
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

    setPosition({
      x: Math.max(16, Math.min(x, window.innerWidth - bounds.width - 16)),
      y: Math.max(16, Math.min(y, window.innerHeight - bounds.height - 16)),
    });
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
      className="fixed flex max-h-[calc(100dvh-2rem)] min-h-13.5 w-184 max-w-[calc(100%-2rem)] flex-col gap-2 overflow-y-auto rounded-3xl border border-border bg-card p-2 text-card-foreground shadow-xl"
      style={position
        ? { left: position.x, top: position.y }
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
      <Accordion value={chatExpanded} onValueChange={setChatExpanded} className="shrink-0 rounded-none border-0">
      <AccordionItem value="chat" className="data-open:bg-transparent">
      <div className="flex items-center gap-2 px-2">
        <div className="min-w-0 flex-1">
          <AccordionTrigger className="items-center gap-2 px-1 py-2" disabled={!history.length && !generations.length && !status}>
            <MessageCircleIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{status || chats.find((chat) => chat.id === chatId)?.title || "Chat with canvas"}</span>
          </AccordionTrigger>
        </div>
        {saving && <span role="status" className="flex size-8 shrink-0 items-center justify-center text-muted-foreground" title="Saving…"><CloudUploadIcon aria-hidden="true" className="size-4 motion-safe:animate-pulse" /><span className="sr-only">Saving…</span></span>}
        <Combobox items={chats} value={chats.find((chat) => chat.id === chatId) ?? null} itemToStringLabel={(chat) => chat.title} isItemEqualToValue={(a, b) => a.id === b.id} inputValue={historySearch} onInputValueChange={setHistorySearch} open={historyOpen} onOpenChange={(open) => { setHistoryOpen(open); if (open) setHistorySearch(""); }} onValueChange={(chat) => { if (chat) openChat(chat); }}>
          <ComboboxTrigger render={<Button variant="ghost" size="icon-sm" />} className="[&>svg:last-child]:hidden" aria-label="Chat history" title="Chat history" disabled={!chatId || !!status || saving || !!adding || voiceMode || !!storageError}><HistoryIcon /></ComboboxTrigger>
          <ComboboxContent side="top" align="end" className="w-80">
            <ComboboxInput aria-label="Search chats" placeholder="Search chats…" showTrigger={false} />
            <ComboboxEmpty>{chats.length ? "No chats found." : "No saved chats yet."}</ComboboxEmpty>
            <ComboboxList aria-label="Chat history">
              {(chat: Chat) => <div key={chat.id} className="flex items-center gap-1">
                <ComboboxItem value={chat} className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-1 items-center gap-2"><span className="min-w-0 flex-1 truncate">{chat.title}</span><span className="shrink-0 text-xs text-muted-foreground">{new Date(chat.updatedAt).toLocaleDateString()}</span></span>
                </ComboboxItem>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${chat.title}`} onClick={() => { setHistoryOpen(false); setDeleting(chat); }}><TrashIcon /></Button>
              </div>}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" disabled={!chatId || !!status || saving || !!adding || voiceMode || !!storageError} onClick={() => openChat()}><PlusIcon /></Button>
      </div>
      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Delete chat?</DialogTitle><DialogDescription>“{deleting?.title}” will be permanently deleted. Files already on the canvas will stay.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" onClick={() => void deleteChat()}>Delete chat</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {(history.length > 0 || generations.length > 0 || status) && <AccordionContent className="border-b pb-2">
      <div className="flex max-h-[40dvh] flex-col gap-3 overflow-y-auto overscroll-contain py-2 [&>*]:shrink-0" aria-label="Generation results" aria-busy={!!status}>
        {chatTimeline(history, generations).map(({ message, tasks }, index) => <div key={index} className="flex flex-col gap-1">
        {message && <div className="flex flex-col gap-1 px-3"><span className="text-xs text-muted-foreground">{message.role === "user" ? "You" : "Lomra"}</span>{message.role === "user" ? <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p> : <MarkdownMessage>{message.content}</MarkdownMessage>}</div>}
        {tasks.length > 0 && <Accordion value={expanded} onValueChange={setExpanded} multiple className="rounded-none border-0">
        {tasks.map((task) => <AccordionItem key={task.id} value={task.id} className="data-open:bg-transparent">
          <AccordionTrigger>{task.category === "picture" ? "Image" : task.category === "3d" ? "3D" : "Video"} · {canvasResults(task.files ?? [], task.category).some((file) => canvasFiles[file.url]) ? "Added to canvas" : task.status}</AccordionTrigger>
          {task.files?.filter((file) => canvasFiles[file.url]).map((file) => <Button key={file.url} variant="link" size="sm" className="mx-4 mb-2 px-0" onClick={() => {
            try { onFocusFile?.(canvasFiles[file.url]); }
            catch (cause) {
              notifyError(cause instanceof Error ? cause.message : "Could not find this item on canvas");
              setCanvasFiles((current) => { const next = { ...current }; delete next[file.url]; return next; });
              setExpanded((current) => current.includes(task.id) ? current : [...current, task.id]);
            }
          }}>{file.name} · View on canvas</Button>)}
          <AccordionContent className="flex flex-col gap-2">
          <p className="text-muted-foreground">{task.model}</p>
          <p className="text-muted-foreground">{task.prompt}</p>
          {task.views && <div className="flex gap-2 overflow-x-auto" aria-label="Submitted views">{Object.entries(task.views).map(([view, image]) => <div key={view} className="flex w-20 shrink-0 flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={`${view}: ${image.name}`} className="h-16 w-full rounded-lg border object-contain" />
            <span className="text-xs">{view}</span>
          </div>)}</div>}
          {task.error && <p role="alert" className="text-destructive">{task.error}</p>}
          {task.error && <Button variant="outline" size="sm" disabled={!!status} onClick={() => void checkJob(task)}>{task.requestId ? "Check job" : "Try again"}</Button>}
          {task.files?.map((file) => <div key={file.url} className="flex flex-col gap-1">
            <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.url.startsWith("/api/storage/files/") ? `${file.name}.glb` : file.url.startsWith("data:") || file.url.startsWith("blob:") ? file.name : undefined} className="underline">Download {file.name}</a>
            {!canvasFiles[file.url] && onAddToCanvas && canvasResults(task.files ?? [], task.category).includes(file) && <Button variant="outline" size="sm" disabled={!!adding || !!status} onClick={() => void addToCanvas(file, task.files)}>{adding === file.url ? "Adding…" : "Retry adding to canvas"}</Button>}
          </div>)}
          </AccordionContent>
        </AccordionItem>)}
        </Accordion>}
        </div>)}
      </div>
      </AccordionContent>}
      </AccordionItem>
      </Accordion>
      {selection.length > 0 && <div aria-label="Selected canvas items" className="flex max-h-36 gap-2 overflow-x-auto px-3 py-2">
        {selection.map((item) => <div key={item.id} title={item.file.name} className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
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
      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={!!status}
        maxLength={8000}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        aria-label="Prompt"
        placeholder="Describe what you want to generate..."
        rows={1}
        className="min-h-9 max-h-[min(8.5rem,calc(100dvh-5rem))] w-full min-w-0 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-2 leading-5 shadow-none field-sizing-content focus-visible:border-transparent focus-visible:ring-0"
      />
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
          <ModelSelector models={models} onModelsChange={setModels} disabled={!!status} />
          <Button variant="ghost" size="icon-sm" aria-label="Record audio" disabled={!!status} onClick={() => setVoiceMode(true)}>
            <MicIcon />
          </Button>
          <span role="status" className="sr-only">{status}</span>
          <Button
            size="icon-sm"
            disabled={!chatId || (!status && !prompt.trim())}
            aria-label={status ? "Stop generation" : "Send prompt"}
            title={status ? `${status} · Stop generation` : "Send prompt"}
            onClick={() => status ? active.current?.abort() : void send()}
          >
            {status ? <PauseIcon /> : <ArrowUpIcon />}
          </Button>
          </div>
      </div>
      </div>
      </div>
      </>}
    </section>
  );
}

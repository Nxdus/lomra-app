"use client";

import { ConfirmDelete } from "@/components/confirm-delete";
import { Tip } from "@/components/tip";
import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { ArrowUpIcon, ClapperboardIcon, BoxIcon, CheckIcon, PencilIcon, CloudUploadIcon, DownloadIcon, EyeIcon, GripVerticalIcon, HistoryIcon, ImagesIcon, Loader2Icon, MessageCircleIcon, MicIcon, SquareIcon, PlayIcon, PlusIcon, RefreshCwIcon, PanelsTopLeftIcon, Rows3Icon, ScanEyeIcon, TrashIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chatStorage, persistentUrl, restoreGenerations, type Chat } from "./chat-storage";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EffortPicker } from "./effort-picker";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { imagePreview, MAX_MEDIA_ITEMS, promptContent, type MediaPart } from "./media";
import { isLocalPictureModel, mediaToolModel, pictureAiOperation, type ToolSource } from "./media-tools";
import { downloadPictureAiModel } from "@/hooks/use-picture-ai";
import { localModelSize } from "@/components/ollama-settings";
import { SpeechMenu } from "./speech-menu";
import { VoiceRecorder } from "./voice-recorder";
import { MarkdownMessage } from "./markdown-message";
import { chatTimeline } from "./chat-timeline";
import { ModelSelector } from "./model-selector";
import { useSd } from "@/hooks/use-sd";
import { filterSdSettings, incompatibleSdSettings, pictureCapabilities, sdModelUnavailable } from "@/lib/picture-capabilities";
import { SdSettingsPopover } from "./sd-settings-popover";
import { toast } from "@/components/ui/toast";
import { MissingApiKeyError, useApiProviders, type KeyedProvider } from "@/components/api-provider";
import { ModelSetupDialog } from "@/components/first-run/model-setup-dialog";
import { multiviewRequirements, resolveMultiview } from "./multiview";
import { canvasResults, generate, llmProvider as providerOf, type Category, selectedModel, isMultiview, isSdModel, sdPrefix, requiresImage, isLocal3dModel, videoStartImage, type ConversationMessage, type GeneratedFile, type Generation, type GenerationTask } from "./generation";
import type { CanvasHandle, VisibleImage } from "@/components/image-canvas";
import type { CanvasHarness } from "@/lib/image-canvas/canvas-harness";
import { CanvasModelViewer } from "@/components/canvas-model-viewer";
import { canvasFileError, canvasFileKind, isCanvasFilePending, loadCanvasFile } from "@/lib/image-canvas/image-canvas-storage";
import { getSetting, saveSetting } from "@/lib/settings";
import type { SdSettings } from "@/lib/sd-settings";
import { changeSdSettings, loadSdSettings, sdSettingsOf } from "@/lib/sd-settings-store";
import { aspectRatios, canMakeVariationsFromProvenance, canUsePictureSetup, planVariationSlot, resolveSetupFromProvenance, validAspectRatio, variationSeeds } from "@/lib/image-canvas/provenance-setup";
import { characterNameKey, type Character } from "@/lib/characters";
import { isRemoteOllama } from "@/lib/ollama-url";
import { desktopAgents, desktopOllama, desktopPictureAi, desktopSd, desktopVideo, type AgentToolResult, type DesktopVideoApi, type PictureAiModel } from "@/lib/desktop";
import { swipeDeleteThreshold, useSwipeToDelete } from "@/hooks/use-swipe-to-delete";
import { agentEfforts, agentLabels, localAgentModel, runAgentChat } from "./agent-chat";
import { saveAgentLimits } from "./agent-limits";
import { draftedShots, draftShotsInstruction, draftStoryInstruction, ensureShotIds, mergeStoryCharacters, moveShot, shotImagePrompt, storyCharacterNotesLimit, storyLimit, storyReply, type Shot, type Storyboard, type StoryCharacter } from "./storyboard-data";
import { storyboardLayout } from "@/lib/image-canvas/storyboard-layout";
import { StoryboardShots, defaultSpot, shotsFrame } from "./storyboard-shots";
import { StoryboardReferenceSetDialog } from "./storyboard-reference-set-dialog";
import { applyReferenceSet } from "./storyboard-reference-sets";
import { StoryboardCharacters } from "./storyboard-characters";
import { StoryboardExport } from "./storyboard-export";
import { StoryboardPreview } from "./storyboard-preview";
import { StoryboardTakes } from "./storyboard-take-controls";
import { generateShotTake, normalizeShotTakes, selectedShotTake, selectShotTake } from "./storyboard-takes";
import { StoryboardTimeline } from "./storyboard-timeline";
import { StoryboardReview } from "./storyboard-review";
import { resolveStoryboardTimeline, storyboardTimelineRenderInput, type StoryboardTimelinePlan } from "./storyboard-timeline-data";
import { preflightStoryboardVideo } from "./storyboard-preflight";
import { characterMarker, promptText, PromptBadgeText, setStoryboardCaret, storyboardMarker, StoryboardInput } from "./storyboard-input";
import { storageFile } from "@/lib/storage";
import { characterContext, characterGeneration, listCharacters, loadCharacterReferences } from "./character-references";

function notifyError(title: string) { toast.add({ title, type: "error" }); }
function notifyBlockers(blockers: { message: string }[]) {
  if (blockers.length === 0) return;
  if (blockers.length === 1) notifyError(blockers[0].message);
  else toast.add({ title: blockers[0].message, description: blockers.slice(1).map((b) => b.message).join("\n"), type: "error" });
}
const storyboardCommand = "/storyboard";

function downloadStoryboardVideo(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "storyboard.mp4";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function timelineCaptionsUrl(captions: StoryboardTimelinePlan["captions"]) {
  if (!captions.length) return;
  const timestamp = (seconds: number) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  const cues = captions.map(({ start, end, text }) => `${timestamp(start)} --> ${timestamp(end)}\n${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}\n\n`);
  return URL.createObjectURL(new Blob(["WEBVTT\n\n", ...cues], { type: "text/vtt" }));
}

function canvasInputNames(items: VisibleImage[]) {
  return items.slice(0, MAX_MEDIA_ITEMS).map(item => ({ id: item.id, name: (item.harness?.title ?? item.file.name).slice(0, 512) }));
}

export type PromptHandle = {
  useSetup: (item: VisibleImage, canvasItems: VisibleImage[]) => Promise<void>;
  makeVariations: (item: VisibleImage, canvasItems: VisibleImage[]) => Promise<void>;
  generateAgain: (item: VisibleImage, canvasItems: VisibleImage[]) => Promise<void>;
};

export function FloatingPrompt({ ref, canvasId = "default", loading = false, onAddToCanvas, onFocusFile, selection = [], onModelPreview, onDeselect, onSelectItems, onBusyChange, storyboardHost, storyboardOrigin = { x: 0, y: 0 }, videoBounds, onVideoItem, onRemoveFromCanvas }: { ref?: Ref<PromptHandle>; videoBounds?: { x: number; y: number; width: number; height: number } | null; onVideoItem?: (id: string | undefined) => void; onRemoveFromCanvas?: (ids: string[]) => void; storyboardHost?: HTMLElement | null; storyboardOrigin?: { x: number; y: number }; canvasId?: string; loading?: boolean; onAddToCanvas?: CanvasHandle["addFiles"]; onFocusFile?: (file: File) => void; selection?: VisibleImage[]; onModelPreview?: (id: string) => string; onDeselect?: (ids: string[]) => void; onSelectItems?: (ids: string[]) => void; onBusyChange?: (busy: boolean) => void }) {
  const panel = useRef<HTMLElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const storyboardInput = useRef<HTMLDivElement>(null);
  const promptAnchor = useRef<HTMLDivElement>(null);
  const suggestionsId = useId();
  const storyboardOptionId = `${suggestionsId}-storyboard`;
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [chatBottom, setChatBottom] = useState<number | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [draft, setDraft] = useState("");
  const storyboardQueued = draft.includes(storyboardMarker);
  const hasPromptBadges = storyboardQueued || draft.includes(characterMarker);
  const prompt = promptText(draft);
  const [promptFocused, setPromptFocused] = useState(false);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [promptCaret, setPromptCaret] = useState<number | null>(null);
  const [characterOptions, setCharacterOptions] = useState<Character[] | false | null>(null);
  const [characterIndex, setCharacterIndex] = useState(0);
  const [models, setModels] = useState<string[]>([]);
  const [{ prices: modelPrices, vision }, setCatalogInfo] = useState<{ prices: ReadonlyMap<string, string>; vision: ReadonlyMap<string, boolean> }>(() => ({ prices: new Map(), vision: new Map() }));
  const [selectableModels, setSelectableModels] = useState<ReadonlySet<string>>();
  const [aspectRatio, setAspectRatio] = useState("");
  const sd = useSd();
  const videoModel = selectedModel(models, "video") ?? "";
  const videoPrice = modelPrices.get(`video:${videoModel}`);
  const llm = selectedModel(models, "llm");
  const localEngine = localAgentModel(llm);
  const pictureModel = selectedModel(models, "picture") ?? "";
  const threeDModel = selectedModel(models, "3d") ?? "";
  const multiview = isMultiview(threeDModel);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [storyboard, setStoryboard] = useState<Storyboard>();
  const [boardDialog, setBoardDialog] = useState<"preview" | "export" | "timeline" | "review" | "references" | null>(null);
  const [timelineDownload, setTimelineDownload] = useState<{ plan: StoryboardTimelinePlan; action: "preview" | "export"; bytes: number } | null>(null);
  const [startingTimeline, setStartingTimeline] = useState(false);
  const [renderingTimeline, setRenderingTimeline] = useState(false);
  const [timelinePreview, setTimelinePreview] = useState<{ video: string; captions?: string; blob: Blob } | null>(null);
  const renderedTimeline = useRef<{ key: string; blob: Blob } | null>(null);
  useEffect(() => () => {
    if (timelinePreview) URL.revokeObjectURL(timelinePreview.video);
    if (timelinePreview?.captions) URL.revokeObjectURL(timelinePreview.captions);
  }, [timelinePreview]);
  const [editingStory, setEditingStory] = useState(false);
  const [storyDraft, setStoryDraft] = useState<string | null>(null);
  // Where the storyboard is while its section is being dragged; committed (and recorded for Undo) on release.
  const [moving, setMoving] = useState<{ x: number; y: number } | null>(null);
  // The storyboard belongs to the canvas, not to the open chat: it stays on the canvas while another chat is open.
  // Its pictures, and the chat it was written in (which stores it), travel with it.
  const [storyImages, setStoryImages] = useState<NonNullable<ConversationMessage["images"]>>([]);
  const [boardOwner, setBoardOwner] = useState<string>();
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
  // The storyboard of the open chat; the story text and the prompt only work on this one.
  const chatStoryboard = storyboard && boardOwner === chatId ? storyboard : undefined;
  const promptPlaceholder = `${chatStoryboard ? "What story would you like to tell or revise?" : "Describe what you want to generate."} Use @ for Characters or / for commands…`;
  const suggestionsAllowed = promptFocused && !suggestionsDismissed && !status && !voiceMode;
  const caret = promptCaret;
  const textBeforeCaret = caret === null ? "" : draft.slice(0, caret);
  const command = /\/[a-z]*$/i.exec(textBeforeCaret);
  const commandsOpen = suggestionsAllowed && !!chatId && !!command && storyboardCommand.startsWith(command[0].toLowerCase());
  const mention = /@([\p{L}\p{M}\p{N}_-]*)$/u.exec(textBeforeCaret);
  const characterMenuOpen = suggestionsAllowed && !!mention;
  const characterQuery = mention ? characterNameKey(mention[1]) : "";
  const matchingCharacters = characterMenuOpen && characterOptions
    ? characterOptions.filter(({ name }) => characterNameKey(name).startsWith(characterQuery))
    : [];
  const activeCharacterIndex = Math.min(characterIndex, matchingCharacters.length - 1);
  const activeCharacter = matchingCharacters[activeCharacterIndex];
  const activeOptionId = commandsOpen ? storyboardOptionId
    : characterMenuOpen && activeCharacter ? `${suggestionsId}-${activeCharacter.id}` : undefined;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [redrafting, setRedrafting] = useState(false);
  const [videoPlan, setVideoPlan] = useState<{ clips: number; resumes: number; stale: number; pictures: number; model: string; toolBytes: number } | null>(null);
  const videoChecking = useRef(false);
  const [checkingVideo, setCheckingVideo] = useState(false);
  const [startingVideo, setStartingVideo] = useState(false);
  const [startingVideoDownload, setStartingVideoDownload] = useState(false);
  const [takePlan, setTakePlan] = useState<{ shotId: string; model: string } | null>(null);
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [modelSetupTarget, setModelSetupTarget] = useState<{ provider?: KeyedProvider; modelName?: string } | null>(null);
  const [pictureChoice, setPictureChoice] = useState<{ models: PictureAiModel[]; canUseFal: boolean; resolve: (choice: "download" | "fal" | "cancel") => void } | null>(null);
  const [startingPictureDownload, setStartingPictureDownload] = useState(false);
  const { swipe, bind: bindSwipe } = useSwipeToDelete();
  const [storageError, setStorageError] = useState("");
  const [saving, setSaving] = useState(false);
  const saves = useRef(Promise.resolve());
  const addQueue = useRef<Promise<void>>(Promise.resolve());
  const { keys, keysReady, storageError: keyStorageError, request } = useApiProviders();
  const reviewProvider = llm ? providerOf(llm) : undefined;
  const reviewUnavailable = !llm || localEngine || vision.get(llm) === false
    ? "Select a chat model that can read images to review these shots."
    : reviewProvider && reviewProvider !== "ollama" && !keys[reviewProvider] ? "Add the chat provider’s API key in Settings." : undefined;
  const active = useRef<AbortController | null>(null);
  const agentMessageIndex = useRef(0);
  const agentSelection = useRef<VisibleImage[] | null>(null);
  const agentCharacters = useRef<Awaited<ReturnType<typeof loadCharacterReferences>>>([]);
  const toolQueue = useRef<Promise<unknown>>(Promise.resolve());
  const toolHandler = useRef<(name: string, args: Record<string, unknown>) => Promise<AgentToolResult>>(async () => ({ text: "" }));
  const mounted = useRef(true);
  const positionLoaded = useRef(false);
  const latestSelection = useRef(selection);
  latestSelection.current = selection;
  useEffect(() => { onBusyChange?.(!!status); }, [status, onBusyChange]);

  // The canvas reads and restores shot node positions for Organize canvas and Undo.
  const latestStoryboard = useRef(storyboard);
  useEffect(() => { latestStoryboard.current = storyboard; });
  const origin = moving ?? storyboard?.origin ?? storyboardOrigin;
  const videoItemId = storyboard?.videoItemId;
  useEffect(() => { onVideoItem?.(videoItemId); }, [onVideoItem, videoItemId]);

  // Dragging the section title moves the whole storyboard (cast card and shots) and pins it there.
  function startMove(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || !event.isPrimary || !latestStoryboard.current) return;
    const target = event.currentTarget;
    const scale = target.getBoundingClientRect().width / target.offsetWidth || 1;
    const from = { x: event.clientX, y: event.clientY };
    const start = latestStoryboard.current.origin ?? storyboardOrigin;
    let latest = start;
    let moved = false;
    target.setPointerCapture(event.pointerId);
    function move(next: globalThis.PointerEvent) {
      if (!moved && Math.hypot(next.clientX - from.x, next.clientY - from.y) < 3) return;
      moved = true;
      latest = { x: start.x + (next.clientX - from.x) / scale, y: start.y + (next.clientY - from.y) / scale };
      setMoving(latest);
    }
    function end() {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setMoving(null);
      if (!moved) return;
      const layout = storyboardLayout.read();
      if (layout) storyboardLayout.record?.(layout);
      setStoryboard((current) => current ? { ...current, origin: latest } : current);
    }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }
  // Pin a new storyboard where the canvas had room for it, once the canvas is ready, so it no longer follows the pictures.
  if (!loading && storyboard && !storyboard.origin) setStoryboard({ ...storyboard, origin: storyboardOrigin });
  useEffect(() => {
    storyboardLayout.read = () => {
      const current = latestStoryboard.current;
      return current ? { origin: current.origin, shots: current.shots?.map((shot) => shot.position) ?? [], shotIds: current.shots?.map((shot) => shot.id) } : null;
    };
    storyboardLayout.write = (layout) => setStoryboard((current) => {
      const { shotIds } = layout;
      if (!current) return current;
      if (shotIds && (shotIds.length !== current.shots?.length || current.shots.some((shot) => !shotIds.includes(shot.id)))) return current;
      const next = { ...current, origin: layout.origin };
      if (!next.origin) delete next.origin;
      if (current.shots?.length === layout.shots.length) {
        next.shots = current.shots.map((shot, index) => {
          const moved = { ...shot, position: layout.shots[shotIds?.indexOf(shot.id) ?? index] };
          if (!moved.position) delete moved.position;
          return moved;
        });
      }
      return next;
    });
    return () => { storyboardLayout.read = () => null; storyboardLayout.write = () => {}; };
  }, []);

  useEffect(() => {
    if (!characterMenuOpen) return;
    let cancelled = false;
    void listCharacters().then(
      (items) => { if (!cancelled) setCharacterOptions(items); },
      () => { if (!cancelled) setCharacterOptions(false); },
    );
    return () => { cancelled = true; };
  }, [characterMenuOpen]);

  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  useEffect(() => {
    const list = transcript.current;
    if (waitingForReply && list) list.scrollTop = list.scrollHeight;
  }, [waitingForReply, history.length]);

  useEffect(() => {
    if (storageError) toast.add({ id: "chat-storage-error", title: storageError, type: "error" });
  }, [storageError]);

  // A chat that holds a storyboard puts it on the canvas; any other chat leaves the one already there.
  function showStoryboard(chat: Chat) {
    setBoardDialog(null);
    setTakePlan(null);
    setVideoPlan(null);
    setTimelineDownload(null);
    setTimelinePreview(null);
    renderedTimeline.current = null;
    setStoryboard(chat.storyboard && ensureShotIds(chat.storyboard));
    setBoardOwner(chat.id);
    setStoryImages(chat.history[0]?.images ?? []);
  }

  function openChat(chat?: Chat) {
    const id = chat?.id ?? crypto.randomUUID();
    setChatId(id);
    setHistory(chat?.history ?? []);
    if (chat?.storyboard) showStoryboard(chat);
    setEditingStory(false);
    setGenerations(restoreGenerations(chat?.generations ?? []));
    setAgentSession(chat?.agentSession);
    setAgentText("");
    if (chat) setModels(chat.models);
    setDraft("");
    setCanvasFiles({});
    setExpanded([]);
    setChatExpanded(chat ? ["chat"] : []);
    setHistoryOpen(false);
    return id;
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
      // The canvas keeps showing the storyboard it last had, whichever chat is open.
      const latest = saved.filter((chat) => chat.storyboard).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (latest) showStoryboard(latest);
      if (savedPosition) moveTo(savedPosition.x, savedPosition.y);
      positionLoaded.current = true;
    }).catch(() => { if (!cancelled) setStorageError("Could not load chat history. Reload to retry; existing chats have not been changed."); });
    return () => { cancelled = true; };
    // Runs once per canvas; openChat only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const chat: Chat = { id: chatId, canvasId, title: history.find((message) => message.role === "user")?.content.slice(0, 80) || "New chat", updatedAt: Date.now(), history, generations, models, storyboard: chatStoryboard, ...(agentSession && { agentSession }) };
    let cancelled = false;
    saves.current = saves.current.then(async () => {
      if (!cancelled) setSaving(true);
      const saved = await chatStorage(chat, canvasId);
      if (!cancelled) { setChats(saved); setStorageError(""); }
    }).catch(() => { setStorageError("Could not save chat history to the workspace. Keep Lomra open and retry your change."); }).finally(() => { if (!cancelled) setSaving(false); });
    return () => { cancelled = true; };
  }, [chatId, canvasId, history, generations, models, agentSession, chatStoryboard]);

  // Edits made while another chat is open are saved into the chat that stores the storyboard, read fresh so nothing else in it is overwritten.
  useEffect(() => {
    if (!storyboard || !boardOwner || boardOwner === chatId || !positionLoaded.current) return;
    saves.current = saves.current.then(async () => {
      const owner = (await chatStorage(undefined, canvasId)).find(({ id }) => id === boardOwner);
      if (!owner) return;
      const [first, ...rest] = owner.history;
      const imagesChanged = first?.role === "user" && JSON.stringify(first.images ?? []) !== JSON.stringify(storyImages);
      if (!imagesChanged && JSON.stringify(owner.storyboard) === JSON.stringify(storyboard)) return;
      const history = imagesChanged ? [{ ...first, images: storyImages }, ...rest] : owner.history;
      setChats(await chatStorage({ ...owner, storyboard, history }, canvasId));
    }).catch(() => { setStorageError("Could not save the storyboard to the workspace. Keep Lomra open and retry your change."); });
  }, [storyboard, boardOwner, chatId, canvasId, storyImages]);

  async function persistStoryboardChange(change: (current: Storyboard) => Storyboard) {
    if (!boardOwner) throw new Error("The storyboard chat is unavailable.");
    const save = saves.current.then(async () => {
      const owner = (await chatStorage(undefined, canvasId)).find(({ id }) => id === boardOwner);
      if (!owner?.storyboard) throw new Error("The storyboard is missing from its workspace chat.");
      setChats(await chatStorage({ ...owner, storyboard: change(owner.storyboard) }, canvasId));
      setStoryboard((current) => current ? change(current) : current);
      setStorageError("");
    });
    saves.current = save.catch(() => {});
    await save;
  }

  async function deleteChat() {
    if (!deleting || status || saving) throw new Error("Wait for the chat to finish, then try again.");
    const saved = await chatStorage(deleting.id, canvasId);
    setChats(saved);
    if (deleting.id === chatId) openChat();
    if (deleting.id === boardOwner) { setStoryboard(undefined); setBoardOwner(undefined); setStoryImages([]); }
    setStorageError("");
  }

  async function addToCanvas(file: GeneratedFile, files: GeneratedFile[] = [], signal?: AbortSignal, at?: Parameters<CanvasHandle["addFiles"]>[1], task?: Generation, options?: Parameters<CanvasHandle["addFiles"]>[3]) {
    if (!mounted.current || !onAddToCanvas) {
      if (signal) throw new Error("Canvas is unavailable.");
      return;
    }
    const run = addQueue.current.then(async () => {
      if (!mounted.current || !onAddToCanvas) throw new Error("Canvas is unavailable.");
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
        if (!mounted.current) throw new Error("Canvas closed before the result could be added.");
        signal?.throwIfAborted();
        const harness: CanvasHarness = { role: "Output" };
        if (task) harness.provenance = {
          model: task.model.slice(0, 512),
          prompt: task.prompt.slice(0, 8000),
          ...(validAspectRatio(task.aspectRatio) && { aspectRatio: task.aspectRatio }),
          selectedInputs: task.canvasInputs,
          ...(task.sd && { sd: task.sd }),
        };
        const [id] = await onAddToCanvas([imported], at, harness, options);
        if (!id) throw new Error("Could not add this result to canvas.");
        setCanvasFiles((current) => ({ ...current, [file.url]: imported }));
        return id;
      } finally {
        if (mounted.current) setAdding("");
      }
    });
    addQueue.current = run.then(() => undefined, () => undefined);
    try {
      return await run;
    } catch (cause) {
      if (signal) throw cause;
      notifyError(cause instanceof Error ? cause.message : "Could not add this result to canvas");
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);

  function stopGeneration() {
    if (!active.current || active.current.signal.aborted) return;
    active.current.abort();
    setStatus("Stopping…");
  }

  function updateGeneration(id: string, change: Partial<Generation>) {
    setGenerations((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  async function runTask(task: Generation, signal: AbortSignal, imageUrl?: string, images?: string[], sources?: ToolSource[]) {
    try {
      let summary = "";
      let sd: Generation["sd"];
      const results = await generate(task, request, signal, (change) => { if (change.summary) summary = change.summary; if (change.sd) sd = change.sd; if (change.status && !signal.aborted) setStatus(change.status); updateGeneration(task.id, signal.aborted ? { ...change, status: "Stopping…" } : change); }, imageUrl, images, sources);
      const files = await Promise.all(results.map(async (file) => ({ ...file, url: await persistentUrl(file.url, file.kind === "file") })));
      results.forEach((file) => { if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url); });
      updateGeneration(task.id, { status: "Done", files, error: undefined });
      const candidates = canvasResults(files, task.category);
      let imported = candidates.length > 0;
      if (!imported && !summary) notifyError("No supported 3D model was returned. Download the result files to inspect them.");
      for (const file of candidates) {
        if (!await addToCanvas(file, files, undefined, undefined, sd ? { ...task, sd } : task)) imported = false;
      }
      if (imported) setExpanded((current) => current.filter((id) => id !== task.id));
      return summary || `${task.category} generated with ${task.model}: ${task.prompt}`;
    } catch (cause) {
      const message = signal.aborted ? (cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Request aborted. This provider may still finish submitted work and charge for it.") : cause instanceof Error ? cause.message : "Generation failed";
      if (signal.aborted) toast.add({ title: message });
      else notifyError(message);
      updateGeneration(task.id, { status: "Failed", error: message });
      return `${task.category} did not complete: ${message}`;
    }
  }

  async function useSetup(item: VisibleImage, canvasItems: VisibleImage[]) {
    if (active.current) {
      notifyError("Wait for the current generation to finish, or stop it first.");
      return;
    }
    const provenance = item.harness?.provenance;
    if (!provenance || !canUsePictureSetup(provenance)) return;
    const [freshSd] = await Promise.all([sd.refresh(), loadSdSettings().catch(() => {})]);
    if (active.current) return;
    const sdModels = freshSd?.models ?? sd.status?.models ?? [];
    const resolved = resolveSetupFromProvenance(
      provenance,
      canvasItems,
      (model) => {
        const key = `picture:${model}`;
        if (isSdModel(model)) {
          const id = model.slice(sdPrefix.length);
          if (!freshSd || sdModelUnavailable(sdModels.find((entry) => entry.id === id))) return "not-installed";
          return models.includes(key) || selectableModels?.has(key) ? "selectable" : "not-in-picker";
        }
        return models.includes(key) || selectableModels?.has(key) ? "selectable" : "unavailable";
      },
      (model) => (isSdModel(model) ? sdModels.find((entry) => entry.id === model.slice(sdPrefix.length))?.name : undefined),
      freshSd,
    );

    const previousDraft = draft;
    const previousModels = models;
    const previousAspectRatio = aspectRatio;
    const previousSelection = latestSelection.current.map((entry) => entry.id);
    const previousSd = resolved.sdModelId ? { modelId: resolved.sdModelId, settings: sdSettingsOf(resolved.sdModelId) } : undefined;
    const saveFailed = () => {
      toast.add({ title: "Could not save the image settings", description: "They apply until you close the app.", type: "error" });
    };

    setDraft(resolved.prompt);
    setPromptCaret(null);
    setSuggestionsDismissed(true);
    if (resolved.model) {
      const value = `picture:${resolved.model}`;
      setModels((current) => [...current.filter((entry) => !entry.startsWith("picture:")), value]);
    }
    setAspectRatio(resolved.aspectRatio);
    if (resolved.sdModelId && resolved.sdSettings) {
      changeSdSettings(resolved.sdModelId, resolved.sdSettings, saveFailed);
    }
    onSelectItems?.(resolved.selectedInputIds);
    focusPromptAt(resolved.prompt.length);

    const id = toast.add({
      title: resolved.warnings.length ? "Setup partially restored" : "Setup restored",
      description: resolved.warnings.join(" ") || "Prompt and settings are ready. Press Send when you want to generate.",
      type: resolved.warnings.length ? "warning" : "info",
      timeout: 10_000,
      actionProps: {
        children: "Undo",
        "aria-label": "Undo restored setup",
        onClick: () => {
          toast.close(id);
          setDraft(previousDraft);
          setModels(previousModels);
          setAspectRatio(previousAspectRatio);
          if (previousSd) changeSdSettings(previousSd.modelId, previousSd.settings, saveFailed);
          onSelectItems?.(previousSelection);
        },
      },
    });
  }

  // Reruns a recorded local picture directly, without the chat: 4 new seeds, or the recorded seed once.
  async function runRecorded(original: VisibleImage, canvasItems: VisibleImage[], again: boolean) {
    if (active.current || !chatId) {
      notifyError("Wait for the current generation to finish, or stop it first.");
      return;
    }
    const provenance = original.harness?.provenance;
    if (!canMakeVariationsFromProvenance(provenance) || !provenance?.sd) return;
    if (!desktopSd()) {
      notifyError("Local image models require the Lomra desktop app.");
      return;
    }
    const freshSd = await sd.refresh();
    if (active.current) return;
    const sdModelId = provenance.model.slice(sdPrefix.length);
    const modelEntry = freshSd?.models.find((entry) => entry.id === sdModelId);
    if (!modelEntry?.installed) {
      notifyError(`Download ${modelEntry?.name ?? sdModelId} in Settings → Local models first.`);
      return;
    }

    const isImg2Img = !!provenance.sd.image;
    let sourceItem: VisibleImage | undefined;
    if (isImg2Img) {
      const sourceId = provenance.selectedInputs?.[0]?.id;
      sourceItem = sourceId ? canvasItems.find((entry) => entry.id === sourceId && canvasFileKind(entry.file) === "image") : undefined;
      if (!sourceItem) {
        notifyError("The source picture of this result is no longer on the canvas.");
        return;
      }
    }

    const controller = new AbortController();
    active.current = controller;
    setStatus(again ? "Generating · Preparing to generate again" : "Generating · Preparing 4 variations");
    try {
      let sourceImages: string[] | undefined;
      if (sourceItem) {
        const sourceFile = isCanvasFilePending(sourceItem.file) ? await loadCanvasFile(sourceItem) : sourceItem.file;
        const content = await promptContent("", [{ id: sourceItem.id, file: sourceFile }], controller.signal);
        sourceImages = typeof content === "string" ? [] : content.flatMap((part) => (part.type === "image_url" ? [part.image_url.url] : []));
        if (!sourceImages.length) throw new Error("Could not read the source picture.");
      }

      const seeds = again ? [provenance.sd.seed] : variationSeeds(provenance.sd.seed, 4);
      const label = (index: number) => (again ? "Generating again" : `Variation ${index + 1} of ${seeds.length}`);
      const recordedSettings: SdSettings = {
        negativePrompt: provenance.sd.negativePrompt ?? "",
        steps: provenance.sd.steps,
        cfg: provenance.sd.cfg,
        ...(isImg2Img && provenance.sd.strength !== undefined ? { strength: provenance.sd.strength } : {}),
      };
      const caps = pictureCapabilities(provenance.model, freshSd);
      const baseSettings = filterSdSettings(recordedSettings, caps);
      const issues = incompatibleSdSettings(baseSettings, caps);
      if (issues.length) throw new Error([...issues, "Choose a compatible profile in Settings → Local models."].join(" "));
      if (isImg2Img ? !caps.imageToImage : !caps.textToImage) {
        throw new Error("The current model profile does not support the original generation mode.");
      }
      const ratio = validAspectRatio(provenance.aspectRatio) ? provenance.aspectRatio : undefined;
      const tasks: Generation[] = seeds.map((seed) => ({
        id: crypto.randomUUID(),
        category: "picture",
        model: provenance.model,
        prompt: provenance.prompt,
        ...(ratio ? { aspectRatio: ratio } : {}),
        ...(isImg2Img ? { startImage: true, canvasInputs: provenance.selectedInputs } : {}),
        status: "Queued",
        sdSettings: { ...baseSettings, seed },
      }));
      setGenerations((current) => [...current, ...tasks]);
      setExpanded((current) => [...current, ...tasks.map((task) => task.id)]);

      let groupOrigin: { x: number; y: number } | undefined;
      let cellSize: { width: number; height: number } | undefined;
      const placedIds: string[] = [];

      for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index];
        if (controller.signal.aborted) {
          updateGeneration(task.id, { status: "Failed", error: "Stopped before submission" });
          continue;
        }
        setStatus(`Generating · ${label(index)}`);
        try {
          let usedSd: Generation["sd"];
          const results = await generate(
            task,
            request,
            controller.signal,
            (change) => {
              if (change.sd) usedSd = change.sd;
              if (change.status && !controller.signal.aborted) setStatus(`${change.status} · ${label(index)}`);
              updateGeneration(task.id, change);
            },
            sourceImages?.[0],
            sourceImages,
          );
          const files = await Promise.all(results.map(async (file) => ({ ...file, url: await persistentUrl(file.url, file.kind === "file") })));
          results.forEach((file) => { if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url); });
          updateGeneration(task.id, { status: "Done", files, error: undefined });
          const picture = canvasResults(files, "picture")[0];
          if (picture) {
            const addedId = await addToCanvas(
              picture,
              files,
              undefined,
              undefined,
              usedSd ? { ...task, sd: usedSd } : task,
              {
                exact: true,
                select: false,
                place: (size, existing) => {
                  cellSize ??= size;
                  const placed = planVariationSlot(original, index, cellSize, existing, groupOrigin);
                  groupOrigin ??= placed.groupOrigin;
                  return placed.position;
                },
              },
            );
            if (!addedId) throw new Error("Could not place the picture on the canvas.");
            placedIds.push(addedId);
            onSelectItems?.([...placedIds]);
          }
        } catch (cause) {
          const message = controller.signal.aborted ? "Generation stopped" : cause instanceof Error ? cause.message : "Generation failed";
          updateGeneration(task.id, { status: "Failed", error: message });
          for (const rest of tasks.slice(index + 1)) {
            updateGeneration(rest.id, { status: "Failed", error: controller.signal.aborted ? "Stopped before submission" : "Stopped after previous error" });
          }
          if (!controller.signal.aborted) notifyError(message);
          else toast.add({ title: again ? "Generation stopped" : "Stopped remaining variations" });
          break;
        }
      }
    } catch (cause) {
      if (controller.signal.aborted) toast.add({ title: "Generation stopped." });
      else notifyError(cause instanceof Error ? cause.message : "Could not start the generation");
    } finally {
      active.current = null;
      setStatus("");
    }
  }

  useImperativeHandle(ref, () => ({
    useSetup,
    makeVariations: (item, canvasItems) => runRecorded(item, canvasItems, false),
    generateAgain: (item, canvasItems) => runRecorded(item, canvasItems, true),
  }));

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
      { category, prompt: text, aspectRatio: typeof args.aspect_ratio === "string" ? args.aspect_ratio.slice(0, 16) : (category === "picture" && aspectRatio ? aspectRatio : undefined), id: crypto.randomUUID(), model, status: "Queued", messageIndex: agentMessageIndex.current, views, canvasInputs: canvasInputNames(needsViews ? selectedImages : selected) },
      images.map((image) => image.image_url.url), agentCharacters.current,
    );
    setGenerations((current) => [...current, task]);
    setExpanded((current) => [...current, task.id]);
    setStatus(`Generating · ${kind} · ${model}`);
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
    const message: ConversationMessage = { role: "user", content: prompt.trim(), ...(hasPromptBadges && { display: draft.trim() }), ...(images.length > 0 && { images }) };
    setHistory((current) => [...current, message]);
    setDraft("");
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
    setStatus(`Generating · ${label}`);
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
        onTool: (name) => { if (!controller.signal.aborted) setStatus(`Generating · ${label} · ${name}`); },
        onLimits: (windows) => { if (engine === "claude") void saveAgentLimits(windows).catch(() => {}); },
      });
      if (result.sessionId) setAgentSession({ engine, id: result.sessionId, modelId });
      setHistory((current) => [...current, { role: "assistant", content: (result.text || `${label} finished without a reply.`).slice(0, 8000) }]);
    } catch (cause) {
      if (controller.signal.aborted) toast.add({ title: "Generation stopped." });
      else notifyError(cause instanceof Error ? cause.message : `${label} failed`);
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
      setStatus("Generating · Starting Ollama");
      await ollama.start();
    }
    signal.throwIfAborted();
  }

  function notifyMissingApiKey(error: MissingApiKeyError) {
    if (!keysReady) {
      notifyError(keyStorageError || "API keys are still loading. Try again shortly.");
      return;
    }
    const id = toast.add({
      title: error.message,
      type: "error",
      actionProps: {
        children: "Set up",
        "aria-label": "Set up models",
        onClick: () => {
          toast.close(id);
          setModelSetupTarget({ provider: error.provider });
          setModelSetupOpen(true);
        },
      },
    });
  }

  async function runStoryboard(label: string, work: (signal: AbortSignal) => Promise<void>, onFailure?: () => void) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus(label);
    try {
      await work(controller.signal);
    } catch (cause) {
      onFailure?.();
      if (controller.signal.aborted) toast.add({ title: "Generation stopped." });
      else if (cause instanceof MissingApiKeyError) notifyMissingApiKey(cause);
      else notifyError(cause instanceof Error ? cause.message : "Storyboard request failed");
    } finally {
      active.current = null;
      setStatus("");
    }
  }

  async function storyboardCompletion(instruction: string, text: string, images: typeof storyImages, signal: AbortSignal, prior: ConversationMessage[] = []) {
    if (!llm) throw new Error("Select an LLM for Storyboard.");
    if (localEngine) {
      // Agent CLIs answer in plain text, so the JSON contract is requested in the prompt and parsed like an LLM reply.
      const { engine, modelId } = localEngine;
      const transcript = prior.slice(-20).map(({ role, content }) => `${role}: ${content}`).join("\n\n");
      const names = images.map((image, index) => `Selected image ${index}: ${image.name}`).join("\n");
      const message = `${instruction}\n\nDo not call any tools. Reply with only the JSON object, no other text.`
        + (transcript ? `\n\nConversation so far:\n${transcript}` : "")
        + (names ? `\n\n${names}\n(Images are not attached here; use their names and indices only.)` : "")
        + `\n\n${text}`;
      const reply = await runAgentChat(engine, message, { modelId, effort: efforts[engine], signal });
      return { choices: [{ message: { content: reply.text } }] };
    }
    const provider = providerOf(llm);
    if (provider === "ollama") {
      await startLocalLlm(signal);
      setStatus(instruction === draftStoryInstruction ? "Generating · Refining story" : "Generating · Drafting shots");
    }
    return storyboardChat(llm, instruction, text, images, signal, prior);
  }

  function storyboardChat(model: string, instruction: string, text: string, images: typeof storyImages, signal: AbortSignal, prior: ConversationMessage[] = []) {
    const content: MediaPart[] = [{ type: "text", text }];
    for (const [index, image] of images.entries()) {
      content.push({ type: "text", text: `Selected image ${index}: ${image.name}` }, { type: "image_url", image_url: { url: image.url } });
    }
    return request(providerOf(model), {
      action: "chat", model, signal,
      input: [{ role: "system", content: instruction }, ...prior.slice(-20).map(({ role, content }) => ({ role, content })), { role: "user", content }],
    });
  }

  async function completeStoryboardReview(instruction: string, text: string, images: typeof storyImages, signal: AbortSignal) {
    if (!llm || reviewUnavailable) throw new Error(reviewUnavailable ?? "Select a chat model.");
    if (reviewProvider === "ollama") {
      const response = await fetch("/api/ollama", { signal, cache: "no-store" });
      const catalog = response.ok ? await response.json() as { models?: { id: string; vision: boolean }[] } : undefined;
      if (!catalog?.models?.some(({ id, vision }) => llm === `ollama/${id}` && vision)) {
        throw new Error("Choose a running Ollama model that reports vision support.");
      }
    }
    return storyboardChat(llm, instruction, text, images, signal);
  }

  async function refineStory() {
    await runStoryboard("Generating · Refining story", async (signal) => {
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
      const cast = mergeStoryCharacters(chatStoryboard?.characters ?? [], imported);
      const input = JSON.stringify({ userRequest: text, currentDraft: chatStoryboard?.story ?? "", cast: cast.map(({ name, notes, image }) => ({ name, notes, image })) });
      const reply = storyReply(await storyboardCompletion(draftStoryInstruction, input, images, signal, prior), images.length);
      signal.throwIfAborted();
      const owner = storyboardQueued && (history.length || generations.length) ? openChat() : chatId;
      setChatExpanded(["chat"]);
      const conversation: ConversationMessage[] = [...prior, { role: "user", content: text, ...(hasPromptBadges && { display: draft.trim() }) }, { role: "assistant", content: reply.reply }];
      if (images.length) conversation[0] = { ...conversation[0], images };
      setHistory(conversation);
      setStoryboard({ ...chatStoryboard, story: reply.story, characters: mergeStoryCharacters(cast, reply.characters) });
      setBoardOwner(owner);
      setStoryImages(images);
      setDraft("");
      if (references.length) onDeselect?.(references.map(({ id }) => id));
    });
  }

  async function makeShots(story: Storyboard) {
    if (!story.story.trim()) return;
    await runStoryboard("Generating · Drafting shots", async (signal) => {
      const characters = story.characters ?? [];
      const input = JSON.stringify({ story: story.story, cast: characters.map(({ name, notes, image }, index) => ({ index, name, notes, image })) });
      const shots = draftedShots(await storyboardCompletion(draftShotsInstruction, input, storyImages, signal), storyImages.length, characters);
      signal.throwIfAborted();
      setStoryboard(ensureShotIds({ ...story, shots }));
    });
  }

  function editShot(index: number, change: Partial<Shot>) {
    setStoryboard((current) => current?.shots ? {
      ...current, shots: current.shots.map((shot, position) => {
        if (position !== index) return shot;
        const next = { ...normalizeShotTakes(shot), ...change };
        if (!next.position) delete next.position;
        if (!next.videoId) delete next.videoId;
        if ("videoId" in change && !change.videoId) delete next.selectedTakeId;
        return next;
      }),
    } : current);
  }

  function reorderShots(from: number, to: number) {
    setStoryboard((current) => {
      if (!current?.shots) return current;
      const shots = moveShot(current.shots, from, to);
      return shots === current.shots ? current : { ...current, shots };
    });
  }

  function updateShotById(id: string, update: (shot: Shot) => Shot) {
    setStoryboard((current) => current?.shots?.some((shot) => shot.id === id)
      ? { ...current, shots: current.shots.map((shot) => shot.id === id ? update(shot) : shot) }
      : current);
  }

  function editCharacter(index: number, change: Partial<StoryCharacter>) {
    setStoryboard((current) => current ? {
      ...current, characters: current.characters?.map((character, position) => position === index ? { ...character, ...change } : character),
    } : current);
  }

  async function removeCharacter(index: number) {
    await persistStoryboardChange((current) => {
      if (!current.characters?.[index]) throw new Error("The character is no longer in the storyboard.");
      return {
        ...current, characters: current.characters.filter((_, position) => position !== index),
        shots: current.shots?.map((shot) => ({ ...shot, characters: shot.characters?.filter((position) => position !== index)
          .map((position) => position > index ? position - 1 : position) })),
      };
    });
  }

  // Storyboard pictures and clips live on their cast and shot nodes, not on the canvas, so they are saved as plain workspace files.
  async function saveStoryboardFile(file: GeneratedFile, name: string, signal: AbortSignal) {
    const response = await fetch(file.url, { credentials: file.url.startsWith("/api/storage/files/") ? "same-origin" : "omit", signal });
    if (!response.ok) throw new Error("Could not download the generated file.");
    const blob = await response.blob();
    const id = crypto.randomUUID();
    await storageFile(id, new File([blob], name, { type: blob.type }));
    return id;
  }

  async function renderStoryboardImage(name: string, prompt: string, images: string[], signal: AbortSignal) {
    const model = selectedModel(models, "picture");
    if (!model) throw new Error("Select an image model in the prompt toolbar first.");
    const task: Generation = { id: crypto.randomUUID(), category: "picture", model, status: "Queued", prompt };
    const files = await generate(task, request, signal, ({ status }) => { if (status && !signal.aborted) setStatus(status); }, undefined, images);
    try {
      signal.throwIfAborted();
      const file = files.find((file) => file.kind === "image");
      if (!file) throw new Error("The image model did not return a picture.");
      return await saveStoryboardFile(file, name, signal);
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

  /** Draws the picture of one shot from its description, its characters and the references. Returns the saved file id. */
  async function renderShot(index: number, story: Storyboard, signal: AbortSignal) {
    const shot = story.shots![index];
    const model = selectedModel(models, "picture");
    if (!model) throw new Error("Select an image model in the prompt toolbar first.");
    const useImages = pictureCapabilities(model, sd.status).referencePictures;
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
    const unused = !useImages && (shot.references.length > 0 || (shot.characters ?? []).some((position) => {
      const { image, approved, generatedId } = story.characters![position];
      return image !== null || (approved && generatedId);
    }));
    // One notice for a whole storyboard: the same ID replaces the previous one.
    if (unused) toast.add({ id: "storyboard-text-only", title: "Reference pictures are not used", description: "The selected image model draws shots from their descriptions and character notes only. Choose another image model to use the references.", type: "info" });
    const prompt = shotImagePrompt(shot.description, story.story, details);
    const generatedId = await renderStoryboardImage(`Storyboard shot ${index + 1}`, prompt, references, signal);
    return generatedId;
  }

  async function generateShot(index: number, story: Storyboard) {
    const shot = story.shots?.[index];
    if (!shot?.description.trim() || shot.image !== null || shot.generatedId) return;
    await runStoryboard(`Generating image for shot ${index + 1}…`, async (signal) => {
      editShot(index, { generatedId: await renderShot(index, story, signal) });
    });
  }

  /** The picture of a shot as a data URL, the first frame of its clip. */
  async function shotPicture(shot: Shot, signal: AbortSignal) {
    if (shot.generatedId) {
      const blob = await storageFile(shot.generatedId);
      if (!blob) throw new Error("Could not load a shot image.");
      return imagePreview(new File([blob], "Shot"), signal);
    }
    return storyImages[shot.image!].url;
  }

  function createTake(shot: Shot, model: string, label: string, signal: AbortSignal, aspectRatio?: string, resume = false) {
    return generateShotTake({
      shot, model, aspectRatio, resume, request, signal, loadPicture: shotPicture, updateShot: updateShotById,
      saveFile: (file, signal) => saveStoryboardFile(file, label, signal),
      onStatus: (next) => { if (!signal.aborted) setStatus(`${next} · ${label}`); },
    });
  }

  function runShotTake(id: string, model: string, resume = false) {
    const index = storyboard?.shots?.findIndex((shot) => shot.id === id) ?? -1;
    const shot = storyboard?.shots?.[index];
    if (!shot) return;
    const label = `Shot ${index + 1} clip`;
    void runStoryboard(`Preparing ${label.toLowerCase()}…`, async (signal) => {
      await createTake(shot, model, label, signal, storyboard?.timeline?.aspectRatio, resume);
    });
  }

  // Asks before spending anything: every missing clip is one video generation, and the video tool is a one-time download.
  async function checkStoryboardVideo(story: Storyboard, model: string, starting = false) {
    if (videoChecking.current || active.current) return;
    videoChecking.current = true;
    setCheckingVideo(true);
    setStartingVideo(starting);
    try {
      const bridge = desktopVideo();
      const pictureModel = selectedModel(models, "picture") ?? "";
      return await preflightStoryboardVideo({
        story,
        videoModel: model,
        pictureModel,
        keys,
        storyImages,
        desktopVideo: bridge,
        desktopAgents: desktopAgents(),
        desktopSd: desktopSd(),
        storageFile,
      });
    } catch (cause) {
      notifyError(cause instanceof Error ? cause.message : "Could not check the storyboard. Try again.");
    } finally {
      videoChecking.current = false;
      setCheckingVideo(false);
      setStartingVideo(false);
    }
  }

  async function planStoryboardVideo(story: Storyboard) {
    const preflight = await checkStoryboardVideo(story, videoModel);
    if (!preflight || latestStoryboard.current !== story) return;
    if (!preflight.ok) {
      notifyBlockers(preflight.blockers);
      return;
    }
    setVideoPlan({
      clips: preflight.clips,
      resumes: preflight.resumes,
      stale: preflight.stale,
      pictures: preflight.pictures,
      model: videoModel,
      toolBytes: preflight.toolBytes,
    });
  }

  async function ensureVideoTool(bridge: DesktopVideoApi, signal: AbortSignal, onStarted?: () => void) {
    const alreadyInstalled = (await bridge.status()).installed;
    signal.throwIfAborted();
    if (!alreadyInstalled && !(await bridge.download())) throw new Error("Could not start downloading the video tool.");
    onStarted?.();
    if (alreadyInstalled) return;
    if (signal.aborted) {
      void bridge.cancelDownload();
      signal.throwIfAborted();
    }
    const stop = () => void bridge.cancelDownload();
    signal.addEventListener("abort", stop, { once: true });
    try {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        signal.throwIfAborted();
        const tool = await bridge.status();
        if (tool.installed) return;
        if (tool.error) throw new Error(tool.error);
        if (!tool.downloading) throw new Error("The video tool did not finish downloading.");
        setStatus(`Generating · Downloading the video tool · ${Math.round((tool.downloading.received / Math.max(1, tool.downloading.total)) * 100)}%`);
      }
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }

  async function renderStoryboardPlan(bridge: DesktopVideoApi, plan: StoryboardTimelinePlan, signal: AbortSignal) {
    const key = JSON.stringify(plan);
    if (renderedTimeline.current?.key === key) return renderedTimeline.current.blob;
    setStatus("Generating · Loading timeline media");
    const input = await storyboardTimelineRenderInput(plan, storageFile);
    signal.throwIfAborted();
    setStatus("Generating · Rendering timeline");
    const runId = crypto.randomUUID();
    const unlisten = bridge.onProgress((event) => {
      if (event.runId === runId && !signal.aborted) setStatus(`Generating · Rendering timeline · ${Math.round((event.seconds / Math.max(1, event.total)) * 100)}%`);
    });
    const cancel = () => bridge.cancel(runId);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await bridge.stitch(runId, input);
      if ("error" in result) throw new Error(result.error);
      signal.throwIfAborted();
      const blob = new Blob([result.video as BlobPart], { type: "video/mp4" });
      renderedTimeline.current = { key, blob };
      return blob;
    } finally {
      unlisten();
      signal.removeEventListener("abort", cancel);
    }
  }

  function returnToTimeline() {
    setTimelineDownload(null);
    setTimelinePreview(null);
  }

  async function renderFromTimeline(plan: StoryboardTimelinePlan, action: "preview" | "export") {
    const bridge = desktopVideo();
    if (!bridge) throw new Error("Rendering a timeline needs the Lomra desktop app.");
    const cached = renderedTimeline.current?.key === JSON.stringify(plan);
    if (!cached) {
      const tool = await bridge.status();
      if (!tool.supported) throw new Error("Timeline rendering is unavailable on this computer.");
      if (!tool.installed) {
        setTimelineDownload({ plan, action, bytes: tool.bytes });
        return;
      }
    }
    if (active.current) throw new Error("Wait for the current generation to finish.");
    await finishTimelineRender(bridge, plan, action, false);
  }

  async function finishTimelineRender(bridge: DesktopVideoApi, plan: StoryboardTimelinePlan, action: "preview" | "export", downloadTool: boolean) {
    if (active.current) { returnToTimeline(); return; }
    if (downloadTool) setStartingTimeline(true);
    setRenderingTimeline(true);
    try {
      await runStoryboard("Generating · Preparing timeline", async (signal) => {
        if (downloadTool) await ensureVideoTool(bridge, signal, () => {
          setTimelineDownload(null);
          setStartingTimeline(false);
        });
        const blob = await renderStoryboardPlan(bridge, plan, signal);
        signal.throwIfAborted();
        if (action === "export") downloadStoryboardVideo(blob);
        else setTimelinePreview({ blob, video: URL.createObjectURL(blob), captions: timelineCaptionsUrl(plan.captions) });
      }, returnToTimeline);
    } finally {
      setRenderingTimeline(false);
      setStartingTimeline(false);
    }
  }

  // One clip per shot from its picture, then one video from all the clips. Finished pictures and clips stay on their shots, so a stopped run resumes.
  async function makeStoryboardVideo(story: Storyboard, model: string) {
    const bridge = desktopVideo();
    if (!bridge || !story.shots) return;
    const preflight = await checkStoryboardVideo(story, model, true);
    if (!preflight || latestStoryboard.current !== story) return;
    if (!preflight.ok) {
      setVideoPlan(null);
      notifyBlockers(preflight.blockers);
      return;
    }
    if (preflight.toolBytes > 0 && !videoPlan?.toolBytes) {
      setVideoPlan({ ...preflight, model });
      return;
    }
    if (preflight.toolBytes > 0) setStartingVideoDownload(true);
    else setVideoPlan(null);
    await runStoryboard("Generating · Preparing video", async (signal) => {
      await ensureVideoTool(bridge, signal, () => {
        setVideoPlan(null);
        setStartingVideoDownload(false);
      });
      const shots = [...story.shots!];
      for (const [index, first] of shots.entries()) {
        signal.throwIfAborted();
        const label = `Shot ${index + 1} of ${shots.length}`;
        if (selectedShotTake(first)) continue;
        let shot = first;
        if (shot.image === null && !shot.generatedId) {
          if (!shot.description.trim()) throw new Error(`Shot ${index + 1} needs a description.`);
          setStatus(`Generating · ${label} · Drawing the picture`);
          const generatedId = await renderShot(index, { ...story, shots }, signal);
          if (shot.id) updateShotById(shot.id, (current) => ({ ...current, generatedId }));
          shot = { ...shot, generatedId };
        }
        setStatus(`Generating · Clip ${index + 1} of ${shots.length}`);
        const take = await createTake(shot, model, `Storyboard clip ${index + 1}`, signal, story.timeline?.aspectRatio);
        shots[index] = { ...shot, selectedTakeId: take.fileId, videoId: take.fileId };
      }
      const blob = await renderStoryboardPlan(bridge, resolveStoryboardTimeline({ ...story, shots }), signal);
      signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      try {
        const frame = shotsFrame(shots.map((shot, index) => shot.position ?? defaultSpot(index)));
        const base = { x: origin.x, y: origin.y };
        const itemId = await addToCanvas({ url, name: "Storyboard", kind: "video" }, [], signal, { x: base.x + frame.left + frame.width + 100, y: base.y + frame.anchorY });
        if (!itemId) throw new Error("Could not add the video to the canvas.");
        if (signal.aborted) {
          onRemoveFromCanvas?.([itemId]);
          signal.throwIfAborted();
        }
        if (story.videoItemId) onRemoveFromCanvas?.([story.videoItemId]);
        setStoryboard((current) => current ? { ...current, videoItemId: itemId } : current);
      } finally { URL.revokeObjectURL(url); }
    });
    setStartingVideoDownload(false);
  }

  function focusPromptAt(offset: number) {
    requestAnimationFrame(() => {
      const editor = storyboardInput.current;
      if (editor) {
        editor.focus();
        setStoryboardCaret(editor, offset);
      } else {
        promptInput.current?.focus();
        promptInput.current?.setSelectionRange(offset, offset);
      }
    });
  }

  function chooseStoryboard() {
    if (!chatId || active.current) return;
    const onlyCommand = prompt.trim().toLowerCase() === storyboardCommand;
    const start = onlyCommand ? 0 : command?.index;
    const end = onlyCommand ? draft.length : caret;
    if (start === undefined || end === null) return;
    const before = draft.slice(0, start).replace(storyboardMarker, "");
    const after = draft.slice(end).replace(storyboardMarker, "");
    const badge = chatStoryboard ? "" : storyboardMarker;
    setDraft(before + badge + after);
    setSuggestionsDismissed(true);
    focusPromptAt(before.length + badge.length);
  }

  function chooseCharacter(name: string) {
    if (!mention || caret === null) return;
    const prefix = draft.slice(0, mention.index);
    const before = `${prefix}${/[@\p{L}\p{M}\p{N}_]$/u.test(promptText(prefix)) ? " " : ""}${characterMarker}@${name}${characterMarker}`;
    const after = draft.slice(caret);
    const space = !after || /^[@\p{L}\p{M}\p{N}_-]/u.test(promptText(after)) ? " " : "";
    const next = before + space + after;
    if (promptText(next).length > 8000) return;
    setDraft(next);
    setSuggestionsDismissed(true);
    focusPromptAt(before.length + Number(!!space || after.startsWith(" ")));
  }

  function editPrompt(value: string, offset: number | null) {
    setSuggestionsDismissed(false);
    setPromptCaret(offset);
    setCharacterIndex(0);
    setDraft(value);
    if (hasPromptBadges && !value.includes(storyboardMarker) && !value.includes(characterMarker)) focusPromptAt(offset ?? value.length);
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((commandsOpen || characterMenuOpen) && event.key === "Escape") {
      event.preventDefault();
      setSuggestionsDismissed(true);
      return;
    }
    if ((commandsOpen || characterMenuOpen) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const count = matchingCharacters.length;
      if (count) setCharacterIndex((activeCharacterIndex + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (characterMenuOpen) {
        if (activeCharacter) chooseCharacter(activeCharacter.name);
      } else void send();
    }
  }

  const promptAttributes = {
    "aria-label": "Prompt",
    "aria-controls": commandsOpen || characterMenuOpen ? suggestionsId : undefined,
    "aria-activedescendant": activeOptionId,
    onFocus: () => setPromptFocused(true),
    onBlur: () => setPromptFocused(false),
    onKeyDown: handlePromptKeyDown,
  };

  async function send() {
    if (active.current || !chatId || !prompt.trim()) return;
    if (commandsOpen || prompt.trim().toLowerCase() === storyboardCommand) { chooseStoryboard(); return; }
    setChatExpanded(["chat"]);
    if (storyboardQueued || chatStoryboard) {
      await refineStory();
      return;
    }
    if (localEngine) return sendToAgent(localEngine);
    if (!llm) {
      notifyError("Select an LLM first");
      return;
    }
    const llmProvider = providerOf(llm);
    if (llmProvider !== "ollama" && !keys[llmProvider]) {
      notifyMissingApiKey(new MissingApiKeyError(llmProvider));
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setStatus(selection.length ? "Generating · Preparing selected media" : "Generating · Chat response");
    try {
      if (llmProvider === "ollama") {
        await startLocalLlm(controller.signal);
        setStatus(selection.length ? "Generating · Preparing selected media" : "Generating · Chat response");
      }
      const characters = await loadCharacterReferences(prompt, controller.signal);
      const routingPrompt = `${prompt.trim()}${characterContext(characters, false)}\n\nSelected 3D model: ${threeDModel || "none"}. ${multiview ? `Multiview: ${multiviewRequirements(threeDModel)}.` : requiresImage(threeDModel) ? "Image-to-3D: requires one image." : "Text-to-3D: no images required."}`;
      if (characters.length && routingPrompt.length > 8000) throw new Error("The prompt is too long. Shorten it before sending.");
      const content = await promptContent(routingPrompt, selection, controller.signal, onModelPreview);
      const images = Array.isArray(content) ? content.filter((part) => part.type === "image_url") : [];
      const imageUrl = images.length === 1 ? images[0].image_url.url : undefined;
      const message = await submitMessage(controller.signal);
      const fullHistory = [...history, message];
      setStatus("Generating · Chat response");
      const input = [...history.slice(-20).map(({ role, content }) => ({ role, content })), { role: "user", content }];
      const plan = await request(llmProvider, { action: "route", model: llm, input, signal: controller.signal }) as { text: string; tasks: GenerationTask[] };
      const pictureBridge = desktopPictureAi();
      const pictureStatus = pictureBridge && plan.tasks.some((task) => task.mediaTool && pictureAiOperation(task.mediaTool))
        ? await pictureBridge.status() : undefined;
      let useFalForPictureTools = false;
      if (pictureBridge && pictureStatus) {
        const needed = new Map<string, PictureAiModel>();
        for (const task of plan.tasks) {
          const op = task.mediaTool ? pictureAiOperation(task.mediaTool) : undefined;
          const local = op ? pictureStatus.models.find((m) => m.operation === op) : undefined;
          if (local && !local.installed) needed.set(local.id, local);
        }
        if (needed.size > 0) {
          setStatus("Queued · Waiting for download consent");
          const missing = [...needed.values()];
          const choice = await new Promise<"download" | "fal" | "cancel">((resolve) => {
            const settle = (value: "download" | "fal" | "cancel") => {
              controller.signal.removeEventListener("abort", onAbort);
              if (value === "download") setStartingPictureDownload(true);
              else setPictureChoice(null);
              resolve(value);
            };
            const onAbort = () => settle("cancel");
            controller.signal.addEventListener("abort", onAbort, { once: true });
            setPictureChoice({ models: missing, canUseFal: !!keys.fal, resolve: settle });
          });
          if (choice === "cancel") {
            setHistory([...fullHistory, ...(plan.text ? [{ role: "assistant" as const, content: plan.text.slice(0, 8000) }] : [])]);
            return;
          }
          if (choice === "download") {
            try {
              for (const item of missing) await downloadPictureAiModel(pictureBridge, item.id, item.name, controller.signal, (detail) => {
                setStartingPictureDownload(false);
                setPictureChoice(null);
                if (!controller.signal.aborted) setStatus(detail.startsWith("Waiting") ? `Queued · ${detail}` : `Generating · ${detail}`);
              });
            } finally {
              setStartingPictureDownload(false);
              setPictureChoice(null);
            }
          } else {
            useFalForPictureTools = true;
          }
        }
      }
      const prepared = plan.tasks.map((task) => {
        const pictureOp = task.mediaTool ? pictureAiOperation(task.mediaTool) : undefined;
        const localPicture = pictureOp && pictureStatus && !useFalForPictureTools
          ? pictureStatus.models.find((m) => m.operation === pictureOp) : undefined;
        const model = task.mediaTool ? mediaToolModel(task.mediaTool, localPicture?.id) : task.operation ? "Local image tools" : selectedModel(models, task.category);
        if (!model) throw new Error(`Select a ${task.category === "picture" ? "image" : task.category} model first`);
        if (task.category === "3d" && !task.mediaTool && !isLocal3dModel(model) && !keys.fal) throw new Error("Enter your Fal API key in Settings to generate 3D models");
        if (task.mediaTool && model !== "Local media tools" && !isLocalPictureModel(model) && !keys.fal) throw new Error("Enter your Fal API key in Settings to run AI media tools");
        const views = task.category === "3d" && isMultiview(model)
          ? resolveMultiview(model, task.viewIndices, images.map(({ image_url }, index) => ({ url: image_url.url, name: `Selected image ${index + 1}` })))
          : undefined;
        return characterGeneration(
          { ...task, ...(task.category === "picture" && aspectRatio && !task.aspectRatio ? { aspectRatio } : {}), views, id: crypto.randomUUID(), model, status: "Queued", messageIndex: fullHistory.length, canvasInputs: canvasInputNames(selection) },
          images.map((image) => image.image_url.url), characters, sd.status,
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
          updateGeneration(task.id, { status: "Failed", error: "Stopped before submission" });
          continue;
        }
        setStatus(`Generating · ${task.category === "picture" ? "image" : task.category} · ${task.model}`);
        outcomes.push(await runTask(task, controller.signal, imageUrl, generationImages, selection));
      }
      if (outcomes.length) setHistory([...nextHistory, { role: "assistant", content: outcomes.join("\n").slice(0, 8000) }] as ConversationMessage[]);
    } catch (cause) {
      if (controller.signal.aborted) toast.add({ title: "Generation stopped." });
      else notifyError(cause instanceof Error ? cause.message : "Could not send prompt");
    } finally {
      active.current = null;
      setStatus("");
    }
  }

  async function checkJob(task: Generation) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus("Generating · Checking existing job");
    updateGeneration(task.id, { error: undefined, status: "Generating · Checking existing job" });
    try {
      // A local edit starts over, so it needs its picture again; hosted jobs only check what was submitted.
      const needsSelection = (isSdModel(task.model) && task.startImage)
        || (isLocalPictureModel(task.model) && (task.mediaTool?.name === "remove_background" || task.mediaTool?.name === "upscale_image"));
      const pictures = needsSelection ? selection.filter(({ file }) => ["image", "3d"].includes(canvasFileKind(file) ?? "")) : [];
      const content = pictures.length ? await promptContent("", pictures, controller.signal, onModelPreview) : "";
      const images = typeof content === "string" ? undefined : content.flatMap((part) => part.type === "image_url" ? [part.image_url.url] : []);
      const outcome = await runTask(task, controller.signal, undefined, images, selection);
      setHistory((current) => [...current, { role: "assistant" as const, content: outcome.slice(0, 8000) }]);
    } catch (cause) {
      const message = controller.signal.aborted ? "Generation stopped." : cause instanceof Error ? cause.message : "Could not try again";
      if (controller.signal.aborted) toast.add({ title: message });
      else notifyError(message);
      updateGeneration(task.id, { status: "Failed", error: message });
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
      <ModelSetupDialog
        open={modelSetupOpen}
        onOpenChange={(nextOpen) => {
          setModelSetupOpen(nextOpen);
          if (!nextOpen) setModelSetupTarget(null);
        }}
        targetProvider={modelSetupTarget?.provider}
        modelName={modelSetupTarget?.modelName}
      />
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
        <div className="min-w-0 flex-1 overflow-hidden">
          <AccordionTrigger className="w-full min-w-0 items-center gap-2 px-1 py-2" disabled={!history.length && !generations.length && !status}>
            <MessageCircleIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{status || history.find((message) => message.role === "user")?.content || chats.find((chat) => chat.id === chatId)?.title || (chatStoryboard ? "Storyboard chat" : "Chat with canvas")}</span>
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
        <Tip label="New chat"><Button variant="ghost" size="icon-sm" aria-label="New chat" disabled={!chatId || !!status || saving || !!adding || voiceMode || !!storageError} onClick={() => openChat()}><PlusIcon /></Button></Tip>
      </div>
      <Dialog open={!!videoPlan} onOpenChange={(open) => { if (!open && !startingVideo && !startingVideoDownload) setVideoPlan(null); }}>
        {videoPlan && <DialogContent showCloseButton={!startingVideo && !startingVideoDownload}>
          <DialogHeader>
            <DialogTitle>Make video?</DialogTitle>
            <DialogDescription>
              {videoPlan.clips > 0
                ? `Lomra will make ${videoPlan.clips} new clip${videoPlan.clips === 1 ? "" : "s"} with ${videoPlan.model}${videoPlan.pictures > 0 ? ` (after drawing ${videoPlan.pictures} missing shot image${videoPlan.pictures === 1 ? "" : "s"})` : ""}. New clips use your video model's credits or limits.`
                : "Lomra will use your existing clips and saved jobs."}
              {videoPlan.clips > 0 && modelPrices.has(`video:${videoPlan.model}`) && ` Model rate: ${modelPrices.get(`video:${videoPlan.model}`)}.`}
              {videoPlan.resumes > 0 && ` Saved jobs to resume: ${videoPlan.resumes}.`}
              {videoPlan.stale > 0 && ` Selected takes using earlier shot inputs: ${videoPlan.stale}.`}
              {" Lomra will join the clips into one video on the canvas."}
              {videoPlan.toolBytes > 0 && ` Joining needs a small video tool (about ${Math.round(videoPlan.toolBytes / 1_000_000)} MB), downloaded once.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" autoFocus disabled={startingVideo || startingVideoDownload} onClick={() => setVideoPlan(null)}>Not now</Button>
            <Button disabled={startingVideo || startingVideoDownload} onClick={() => { if (storyboard) void makeStoryboardVideo(storyboard, videoPlan.model); }}>{startingVideo ? "Checking storyboard…" : startingVideoDownload ? "Starting…" : videoPlan.toolBytes > 0 ? "Download and make video" : "Make video"}</Button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      <Dialog open={!!timelineDownload} onOpenChange={(open) => { if (!open && !startingTimeline) returnToTimeline(); }}>
        {timelineDownload && <DialogContent showCloseButton={!startingTimeline}>
          <DialogHeader>
            <DialogTitle>Download video tool?</DialogTitle>
            <DialogDescription>Rendering needs a one-time download of about {Math.round(timelineDownload.bytes / 1_000_000)} MB.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" autoFocus disabled={startingTimeline} onClick={returnToTimeline}>Not now</Button>
            <Button disabled={startingTimeline} onClick={() => {
              const bridge = desktopVideo();
              if (bridge) void finishTimelineRender(bridge, timelineDownload.plan, timelineDownload.action, true);
              else returnToTimeline();
            }}>{startingTimeline ? "Starting…" : "Download"}</Button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      <Dialog open={!!timelinePreview} onOpenChange={(open) => { if (!open) returnToTimeline(); }}>
        {timelinePreview && <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Timeline preview</DialogTitle>
            <DialogDescription>Play the rendered edit before exporting.</DialogDescription>
          </DialogHeader>
          <video src={timelinePreview.video} controls playsInline className="max-h-[60vh] w-full rounded-md bg-black">
            {timelinePreview.captions && <track kind="subtitles" label="Storyboard subtitles" src={timelinePreview.captions} default />}
          </video>
          <DialogFooter>
            <Button variant="outline" onClick={returnToTimeline}>Back to timeline</Button>
            <Button onClick={() => downloadStoryboardVideo(timelinePreview.blob)}>Download MP4</Button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      <Dialog open={!!takePlan} onOpenChange={(open) => { if (!open) setTakePlan(null); }}>
        {takePlan && <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate clip take?</DialogTitle>
            <DialogDescription>
              Generate one clip with {takePlan.model} using your video model’s credits or limits.
              {modelPrices.has(`video:${takePlan.model}`) && ` Model rate: ${modelPrices.get(`video:${takePlan.model}`)}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTakePlan(null)}>Cancel</Button>
            <Button onClick={() => { setTakePlan(null); runShotTake(takePlan.shotId, takePlan.model); }}>Generate take</Button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      <Dialog open={storyDraft !== null} onOpenChange={(open) => { if (!open) setStoryDraft(null); }}>
        {storyDraft !== null && <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit story</DialogTitle>
            <DialogDescription>Changing the story does not change the shots. Use Redraft shots to rebuild them from the new story.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Story" rows={8} maxLength={storyLimit} value={storyDraft} onChange={(event) => setStoryDraft(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setStoryDraft(null)}>Cancel</Button>
            <Button disabled={!storyDraft.trim()} onClick={() => { setStoryboard((current) => current ? { ...current, story: storyDraft } : current); setStoryDraft(null); }}>Save</Button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      <Dialog open={redrafting} onOpenChange={setRedrafting}>
        <DialogContent><DialogHeader><DialogTitle>Redraft shots?</DialogTitle><DialogDescription>Your shot edits and generated shot images will be replaced.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRedrafting(false)}>Cancel</Button><Button onClick={() => { setRedrafting(false); if (storyboard) void makeShots(storyboard); }}>Redraft shots</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDelete open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="Delete chat?" description={`“${deleting?.title}” will be permanently deleted. Files already on the canvas will stay.`}
        disabled={!!status || saving} onConfirm={deleteChat} />
      <Dialog open={!!pictureChoice} onOpenChange={(open) => { if (!open && pictureChoice && !startingPictureDownload) pictureChoice.resolve("cancel"); }}>
        {pictureChoice && <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Download {pictureChoice.models.map((m) => m.name).join(" and ")}?</DialogTitle>
            <DialogDescription className="flex flex-col gap-2">
              <span>Run background removal and upscaling locally on your computer without an API key.</span>
              <span className="text-xs">{pictureChoice.models.map((m) => `${m.name} (${m.bytes > 0 ? localModelSize(m.bytes) : "Size unavailable"}, ${m.license})`).join(" · ")}</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" autoFocus disabled={startingPictureDownload} onClick={() => pictureChoice.resolve("cancel")}>Not now</Button>
            {pictureChoice.canUseFal && <Button variant="secondary" disabled={startingPictureDownload} onClick={() => pictureChoice.resolve("fal")}>Use Fal</Button>}
            <Button disabled={startingPictureDownload} onClick={() => pictureChoice.resolve("download")}>{startingPictureDownload ? "Starting…" : "Download"}</Button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
      {(history.length > 0 || generations.length > 0 || status) && <AccordionContent className="border-b pb-2">
      <div ref={transcript} className="flex max-h-[40dvh] flex-col gap-3 overflow-y-auto overscroll-contain py-2 [&>*]:shrink-0" aria-label="Generation results" aria-busy={!!status}>
        {chatTimeline(history, generations).map(({ message, tasks }, index) => <div key={index} className="flex flex-col gap-1">
        {message && !(chatStoryboard && message.role === "assistant") && <div className={message.role === "user" ? "ml-auto flex max-w-[85%] flex-col items-end gap-1 px-3" : "flex flex-col gap-1 px-3"}>
          <span className="text-xs text-muted-foreground">{message.role === "user" ? "You" : "Lomra"}</span>
          {!!message.images?.length && <div className={message.role === "user" ? "flex max-w-full gap-2 overflow-x-auto py-1" : "flex gap-2 overflow-x-auto py-1"} aria-label="Attached images">
            {message.images.map(({ name, url }, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={index} src={url} alt={name || "Attached image"} className="size-24 shrink-0 rounded-xl border bg-muted object-contain" />
            ))}
          </div>}
          {message.role === "user" ? <p className="whitespace-pre-wrap break-words rounded-2xl bg-muted px-3 py-1.5 text-sm">{message.display ? <PromptBadgeText value={message.display} /> : message.content}</p> : <MarkdownMessage>{message.content}</MarkdownMessage>}
        </div>}
        {tasks.length > 0 && <Accordion value={expanded} onValueChange={setExpanded} multiple className="rounded-none border-0">
        {tasks.map((task) => <AccordionItem key={task.id} value={task.id} className="relative data-open:bg-transparent">
          <AccordionTrigger className="items-center px-3 py-2">{task.category === "picture" ? "Image" : task.category === "3d" ? "3D" : "Video"} · {canvasResults(task.files ?? [], task.category).some((file) => canvasFiles[file.url]) ? "Added to canvas" : task.status === "Completed" ? "Done" : task.status === "Interrupted" || task.error ? "Failed" : task.status}</AccordionTrigger>
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
            {!canvasFiles[file.url] && onAddToCanvas && canvasResults(task.files ?? [], task.category).includes(file) && <Tip label="Retry adding to canvas"><Button variant="ghost" size="icon-sm" aria-label="Retry adding to canvas" disabled={!!adding || !!status} onClick={() => void addToCanvas(file, task.files, undefined, undefined, task)}>{adding === file.url ? <Loader2Icon aria-hidden="true" className="motion-safe:animate-spin" /> : <PlusIcon />}</Button></Tip>}
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
      {chatStoryboard && <section aria-label="Storyboard" className="flex flex-col gap-4 px-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Lomra</span>
          {editingStory && !chatStoryboard.shots
            ? <Textarea aria-label="Story draft" rows={6} maxLength={storyLimit} value={chatStoryboard.story} disabled={!!status}
              onChange={(event) => setStoryboard({ ...chatStoryboard, story: event.target.value })} />
            : <MarkdownMessage>{chatStoryboard.story}</MarkdownMessage>}
          {/* Once the shots exist the story is a record; Make video, Redraft and Edit story live on the canvas. */}
          {!chatStoryboard.shots && <div className="flex gap-1 self-end">
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={editingStory ? "Done" : "Edit"} disabled={!!status} onClick={() => setEditingStory(!editingStory)} />}>
              {editingStory ? <CheckIcon /> : <PencilIcon />}
            </TooltipTrigger>
              <TooltipContent>{editingStory ? "Done" : "Edit"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<Button size="icon-sm" aria-label="Use this story" disabled={!!status || !chatStoryboard.story.trim()} onClick={() => { setEditingStory(false); void makeShots(chatStoryboard); }} />}>
              <ClapperboardIcon />
            </TooltipTrigger>
              <TooltipContent>Use this story</TooltipContent>
            </Tooltip>
          </div>}
        </div>
      </section>}
      </div>
      </AccordionContent>}
      </AccordionItem>
      </Accordion>
      {storyboard && storyboardHost && createPortal(<>
        {storyboard.shots && <div className="absolute top-0 left-0" style={{ transform: `translate(${origin.x}px, ${origin.y}px)` }}>
        <StoryboardShots shots={storyboard.shots} images={storyImages} characters={storyboard.characters ?? []}
          busy={!!status} status={checkingVideo ? "Checking storyboard…" : status} onEdit={editShot} onReorder={reorderShots} onGenerate={(index) => void generateShot(index, storyboard)} onStop={stopGeneration}
          renderCharacterReference={(index, close) => <StoryboardCharacters characters={storyboard.characters ?? []} index={index} images={storyImages} status={status}
            onEdit={editCharacter} onRemove={async () => { await removeCharacter(index); close(); }}
            onGenerate={() => void generateCharacter(index, storyboard.characters![index], storyboard.story)}
            onStop={stopGeneration} />}
          renderTakeControls={(shot, close) => shot.id && <StoryboardTakes shot={shot} model={videoStartImage(videoModel) ? videoModel : ""} aspectRatio={storyboard.timeline?.aspectRatio} disabled={!!status} price={videoPrice}
            onSelect={(id) => updateShotById(shot.id!, (current) => selectShotTake(current, id))}
            onGenerate={(action) => {
              close();
              if (action === "resume") runShotTake(shot.id!, videoModel, true);
              else setTakePlan({ shotId: shot.id!, model: videoModel });
            }} />}
          toolbarActions={<>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Apply reference set" onClick={() => setBoardDialog("references")} />}><ImagesIcon /></TooltipTrigger><TooltipContent>Apply reference set</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Preview storyboard" onClick={() => setBoardDialog("preview")} />}><PlayIcon /></TooltipTrigger><TooltipContent>Preview storyboard</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Export storyboard" onClick={() => setBoardDialog("export")} />}><DownloadIcon /></TooltipTrigger><TooltipContent>Export storyboard</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit timeline" onClick={() => setBoardDialog("timeline")} />}><Rows3Icon /></TooltipTrigger><TooltipContent>Edit timeline</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="AI storyboard review" onClick={() => setBoardDialog("review")} />}><ScanEyeIcon /></TooltipTrigger><TooltipContent>AI storyboard review</TooltipContent></Tooltip>
          </>}
          video={videoBounds && { ...videoBounds, x: videoBounds.x - origin.x, y: videoBounds.y - origin.y }} onMoveStart={startMove} onMakeVideo={() => void planStoryboardVideo(storyboard)} onEditStory={() => setStoryDraft(storyboard.story)} onRedraft={() => setRedrafting(true)} />
        </div>}
      </>, storyboardHost)}
      {storyboard?.shots && <>
        {boardDialog === "references" && <StoryboardReferenceSetDialog key={boardOwner} shots={storyboard.shots} images={storyImages}
          onClose={() => setBoardDialog(null)}
          onApply={(set, shotIds) => {
            const next = applyReferenceSet(storyboard, storyImages, set.images, shotIds);
            if (boardOwner === chatId) {
              setHistory(([first, ...rest]) => [{ ...first, images: next.images }, ...rest]);
            }
            setStoryImages(next.images);
            setStoryboard(next.board);
            toast.add({ title: `Applied ${set.name}`, type: "success" });
          }} />}
        <StoryboardPreview storyboard={storyboard} images={storyImages} open={boardDialog === "preview"} onOpenChange={(open) => setBoardDialog(open ? "preview" : null)} />
        <StoryboardExport storyboard={storyboard} images={storyImages} open={boardDialog === "export"} onOpenChange={(open) => setBoardDialog(open ? "export" : null)} />
        <StoryboardTimeline storyboard={storyboard} images={storyImages} open={boardDialog === "timeline"} onOpenChange={(open) => setBoardDialog(open ? "timeline" : null)}
          suspended={!!timelineDownload || !!timelinePreview || renderingTimeline}
          onSave={(timeline, takes) => persistStoryboardChange((current) => ({
            ...current,
            timeline,
            shots: current.shots?.map((shot) => {
              const fileId = shot.id && takes.get(shot.id);
              return fileId ? selectShotTake(shot, fileId) : shot;
            }),
          }))}
          onPreview={(plan) => renderFromTimeline(plan, "preview")} onExport={(plan) => renderFromTimeline(plan, "export")} />
        <StoryboardReview storyboard={storyboard} images={storyImages} open={boardDialog === "review"} onOpenChange={(open) => setBoardDialog(open ? "review" : null)}
          contextKey={JSON.stringify([canvasId, boardOwner, llm])} unavailableReason={reviewUnavailable} complete={completeStoryboardReview} onUpdate={setStoryboard} />
      </>}
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
          setDraft((current) => current ? `${current.trimEnd()} ${text}` : text);
          setVoiceMode(false);
        }}
      />}
      <div className={voiceMode ? "hidden" : "flex w-full min-w-0 flex-col gap-2"}>
      <div ref={promptAnchor} className="relative min-w-0">
      {hasPromptBadges ? <StoryboardInput
        {...promptAttributes}
        inputRef={storyboardInput}
        value={draft}
        disabled={!!status}
        aria-description="Use Backspace or Delete to remove a badge."
        onEdit={editPrompt}
        onCaretChange={setPromptCaret}
        className="min-h-9 max-h-[min(8.5rem,calc(100dvh-5rem))] w-full min-w-0 overflow-y-auto px-3 py-2 text-base leading-5 wrap-break-word whitespace-pre-wrap rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:opacity-50 md:text-sm"
      /> : <Textarea
        {...promptAttributes}
        ref={promptInput}
        value={draft}
        onChange={(event) => editPrompt(promptText(event.target.value), event.target.selectionStart)}
        onSelect={(event) => {
          const { selectionStart, selectionEnd } = event.currentTarget;
          setPromptCaret(selectionStart === selectionEnd ? selectionStart : null);
        }}
        disabled={!!status}
        maxLength={8000}
        placeholder={promptPlaceholder}
        rows={1}
        className="min-h-9 max-h-[min(8.5rem,calc(100dvh-5rem))] w-full min-w-0 resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-3 py-2 leading-5 shadow-none field-sizing-content focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />}
      <Popover open={commandsOpen || characterMenuOpen} onOpenChange={(open) => { if (!open) setSuggestionsDismissed(true); }}>
        <PopoverContent anchor={promptAnchor} side="top" align="start" initialFocus={false} finalFocus={false}
          id={suggestionsId} role="listbox" aria-label={characterMenuOpen ? "Characters" : "Commands"} className="w-max min-w-48 max-w-(--available-width) gap-0 p-1">
          <div className="px-3 py-2 text-xs text-muted-foreground" aria-hidden="true">{characterMenuOpen ? "Characters" : "Commands"}</div>
          {characterMenuOpen ? matchingCharacters.length ? matchingCharacters.map(({ id, name }, index) => (
            <Button key={id} type="button" variant={index === activeCharacterIndex ? "secondary" : "ghost"} size="sm"
              role="option" aria-selected={index === activeCharacterIndex} id={`${suggestionsId}-${id}`}
              tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={() => chooseCharacter(name)} className="justify-start">
              <span className="truncate">@{name}</span>
            </Button>
          )) : <div role="option" aria-selected="false" aria-disabled="true" className="px-3 py-2 text-sm text-muted-foreground">
            {characterOptions === null ? "Loading…" : characterOptions === false ? "Could not load Characters." : "No matching Characters."}
          </div> :
          <Button type="button" variant="secondary" size="sm" role="option" aria-selected="true" id={storyboardOptionId}
            tabIndex={-1} onPointerDown={(event) => event.preventDefault()} onClick={chooseStoryboard}
            className="h-auto items-start justify-start gap-2 rounded-xl py-2 text-left">
            <PanelsTopLeftIcon data-icon="inline-start" className="mt-0.5" />
            <span className="flex flex-col">
              <span className="font-mono">{storyboardCommand}</span>
              <span className="text-xs text-muted-foreground">Draft a storyboard</span>
            </span>
          </Button>}
        </PopoverContent>
      </Popover>
      </div>
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
          {localEngine && agentEfforts[localEngine.engine] && <EffortPicker levels={agentEfforts[localEngine.engine] ?? []} value={efforts[localEngine.engine]}
            onChange={(level) => changeEffort(localEngine.engine, level)} disabled={!!status} />}
          {(pictureModel || aspectRatio) && (() => {
            const ratioOptions = aspectRatio && !aspectRatios.includes(aspectRatio as (typeof aspectRatios)[number])
              ? [aspectRatio, ...aspectRatios]
              : aspectRatios;
            const ratioItems = [{ value: "", label: "Auto" }, ...ratioOptions.map((value) => ({ value, label: value }))];
            return (
              <Select items={ratioItems} value={aspectRatio} onValueChange={(value) => setAspectRatio(value ?? "")} disabled={!!status}>
                <Tip label="Image aspect ratio">
                  <SelectTrigger size="sm" variant="ghost" aria-label="Image aspect ratio" className="w-auto min-w-0 px-2 text-xs">
                    <SelectValue>{aspectRatio || "Auto"}</SelectValue>
                  </SelectTrigger>
                </Tip>
                <SelectContent side="top" align="end" alignItemWithTrigger={false}>
                  <SelectGroup>
                    {ratioItems.map((item) => (
                      <SelectItem key={item.value || "auto"} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            );
          })()}
          {isSdModel(pictureModel) && <SdSettingsPopover model={pictureModel.slice(sdPrefix.length)} sdStatus={sd.status} disabled={!!status} />}
          <ModelSelector
            models={models}
            onModelsChange={setModels}
            onCatalogInfoChange={setCatalogInfo}
            onSelectableChange={setSelectableModels}
            onOpenModelSetup={(target) => {
              setModelSetupTarget(target ?? null);
              setModelSetupOpen(true);
            }}
            disabled={!!status}
          />
          <Tooltip><SpeechMenu><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Record audio" disabled={!!status} onClick={() => setVoiceMode(true)} />}>
            <MicIcon />
          </TooltipTrigger></SpeechMenu><TooltipContent>Record audio · right-click for speech models</TooltipContent></Tooltip>
          <span role="status" className="sr-only">{status}</span>
          <Tip label={status ? `${status} · Stop generation` : "Send prompt"}><Button
            size="icon-sm"
            disabled={!chatId || status === "Stopping…" || (!status && !prompt.trim())}
            aria-label={status ? "Stop generation" : "Send prompt"}
            onClick={() => status ? stopGeneration() : void send()}
          >
            {status ? <SquareIcon /> : <ArrowUpIcon />}
          </Button></Tip>
          </div>
      </div>
      </div>
      </div>
      </>}
    </section>
  );
}

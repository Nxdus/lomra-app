export type AgentStats = { days: number; sessions: number; prompts: number; tokens: number; cost: number };
export type AgentInfo = { id: string; label: string; available: boolean };
export type AgentToolResult = { text: string; isError?: boolean; images?: string[] };

/** One usage window of an agent plan (for example 5 hr or Weekly). `resetsAt` is in epoch seconds. */
export type AgentLimit = { id: string; label: string; usedPercent: number; resetsAt: number };

export type AgentChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'session'; sessionId: string }
  | { type: 'limits'; windows: AgentLimit[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Bridge exposed by the Electron preload script; absent in a normal browser. */
export type DesktopAgentApi = {
  list(): Promise<AgentInfo[]>;
  models?(id: string): Promise<{ id: string; name: string }[]>;
  accountEmail(id: string): Promise<string | null>;
  hasCodexSubscription?(): Promise<boolean>;
  /** Opens the ChatGPT sign-in window; resolves true once signed in, false if it was closed first. */
  browserSignIn?(): Promise<boolean>;
  browserImage?(id: string, input: { prompt: string; images: string[]; aspectRatio?: string }): Promise<{ image: string; warning?: string } | { error: string }>;
  /** Opens the Gemini sign-in window; resolves true once signed in, false if it was closed first. */
  browserSignInGemini?(): Promise<boolean>;
  /** Makes one image or video in the signed-in Gemini web app. */
  browserGemini?(id: string, input: { kind: "image" | "video"; prompt: string; images: string[]; aspectRatio?: string }): Promise<({ image: string } | { video: string }) & { warning?: string } | { error: string }>;
  cancelBrowserImage?(id: string): void;
  /** Usage windows the agent can report without a request (Codex); empty otherwise. */
  limits(id: string): Promise<AgentLimit[]>;
  stats?(id: string): Promise<AgentStats | null>;
  start(id: string, cols: number, rows: number): Promise<{ replay: string }>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  /** Start one non-interactive chat turn; events follow through onChat. */
  chat(runId: string, id: string, prompt: string, sessionId?: string, model?: string, effort?: string): Promise<void>;
  cancelChat(runId: string): void;
  onChat(callback: (event: { runId: string; event: AgentChatEvent }) => void): () => void;
  /** Tool calls from a running agent. Answer each with toolResult. */
  onTool(callback: (call: { callId: string; name: string; args: Record<string, unknown> }) => void): () => void;
  toolResult(callId: string, result: AgentToolResult): void;
  kill(id: string): void;
  onData(callback: (event: { id: string; data: string }) => void): () => void;
  onExit(callback: (event: { id: string; exitCode: number }) => void): () => void;
};

export function desktopAgents(): DesktopAgentApi | undefined {
  return (window as unknown as { lomra?: { agent?: DesktopAgentApi } }).lomra?.agent;
}

export type SpeechModel = { id: string; name: string; quality: string; note: string; bytes: number; recommended: boolean; installed: boolean };

/** Local speech models of the desktop app. */
export type DesktopSpeechApi = {
  /** The models and which one is downloading, or null when voice input uses an external Whisper. */
  models(): Promise<{ models: SpeechModel[]; downloading: string | null } | null>;
  /** Start downloading a model (the default when omitted); the caller asks the user first. Resolves true once it has started. */
  downloadModel(id?: string): Promise<boolean>;
  /** Remove a downloaded model from disk. */
  deleteModel(id: string): Promise<boolean>;
};

export function desktopSpeech(): DesktopSpeechApi | undefined {
  return (window as unknown as { lomra?: { speech?: DesktopSpeechApi } }).lomra?.speech;
}

/** Ollama (local models) as seen by the desktop app, which can find the CLI and start its server. */
export type DesktopOllamaApi = {
  /** `installed`: the CLI exists. `managed`: the app may start it (false when OLLAMA_URL points elsewhere). */
  status(): Promise<{ installed: boolean; running: boolean; managed: boolean; /** How `install` works here: winget runs it, download opens the download page. */ installMethod: 'winget' | 'download' }>;
  /** Run `ollama serve` if it is not running. Resolves true once the server answers. */
  start(): Promise<boolean>;
  /** Installs the CLI with winget (Windows) or opens the download page; the caller asks the user first. */
  install(): Promise<'installed' | 'failed' | 'manual'>;
  /** Stops Ollama and removes the CLI with winget (Windows); the caller asks the user first. Models stay on disk. */
  uninstall(): Promise<'uninstalled' | 'failed' | 'manual'>;
};

export function desktopOllama(): DesktopOllamaApi | undefined {
  return (window as unknown as { lomra?: { ollama?: DesktopOllamaApi } }).lomra?.ollama;
}

export type SdModel = {
  id: string; name: string; quality: string; note: string; bytes: number; recommended: boolean; installed: boolean;
  /** Added from Hugging Face rather than one of the built-in models; `note` is then its repository. */
  custom: boolean;
};
/** What a checkpoint is, which decides the image size and steps used: `sd15`, `sdxl` or `turbo`. */
export type SdFamily = { id: string; name: string; note: string };
export type SdDownloadRequest = string | { repo: string; file: string; family: string };
export type SdStatus = {
  /** False on a computer the image engine has no build for. */
  supported: boolean;
  /** The image engine (stable-diffusion.cpp) is downloaded. */
  engine: boolean;
  engineBytes: number;
  /** The download in progress; `stage` says whether it is the engine or the model, and the byte counts cover that stage. */
  downloading: { id: string; name: string; stage: "engine" | "model"; received: number; total: number } | null;
  /** Why the last download failed, ready to show. */
  error: string | null;
  families: SdFamily[];
  models: SdModel[];
};

/** Local image generation (Stable Diffusion) of the desktop app. */
export type DesktopSdApi = {
  status(): Promise<SdStatus>;
  /** Download the engine (if missing) and a built-in model by id, or a Hugging Face checkpoint, in the background; the caller asks the user first. Resolves false if it could not start. */
  download(request?: SdDownloadRequest): Promise<boolean>;
  /** A Hugging Face `owner/name` or link gives `repo` (and `file` for a file link); other text searches text-to-image models. */
  search(query: string): Promise<{ result: { repo?: string; file?: string; models: { id: string; downloads: number }[] } } | { error: string }>;
  /** Single-file checkpoints at the top of a Hugging Face repository. */
  files(repo: string): Promise<{ result: { file: string; bytes: number; sha256: string }[] } | { error: string }>;
  cancelDownload(): Promise<void>;
  /** Delete a downloaded model; the engine goes with the last one. */
  remove(id: string): Promise<boolean>;
  /** Make one image from a downloaded model. `runId` is a UUID. */
  generate(runId: string, input: { model: string; prompt: string; aspectRatio?: string }): Promise<{ image: string } | { error: string }>;
  cancel(runId: string): void;
  onProgress(callback: (event: { runId: string; step: number; total: number }) => void): () => void;
};

export function desktopSd(): DesktopSdApi | undefined {
  return (window as unknown as { lomra?: { sd?: DesktopSdApi } }).lomra?.sd;
}

export type VideoToolStatus = {
  /** False on a computer the video tool has no build for. */
  supported: boolean;
  installed: boolean;
  /** Download size in bytes. */
  bytes: number;
  downloading: { received: number; total: number } | null;
  /** Why the last download failed, ready to show. */
  error: string | null;
};

/** Joins the clips of a storyboard into one video (ffmpeg, downloaded after the user agrees) in the desktop app. */
export type DesktopVideoApi = {
  status(): Promise<VideoToolStatus>;
  /** Download the video tool in the background; the caller asks the user first. Resolves false if it could not start. */
  download(): Promise<boolean>;
  cancelDownload(): Promise<void>;
  remove(): Promise<boolean>;
  /** Join clips (1-12, each at most 100 MB) into one MP4; each is cut or held to `seconds`. `runId` is a UUID. */
  stitch(runId: string, input: {
    clips: { data: Uint8Array; seconds: number; start?: number; mute?: boolean }[];
    aspectRatio?: string;
    audio?: { data: Uint8Array; start: number; gain?: number }[];
    captions?: { start: number; end: number; text: string }[];
  }): Promise<{ video: Uint8Array } | { error: string }>;
  cancel(runId: string): void;
  onProgress(callback: (event: { runId: string; seconds: number; total: number }) => void): () => void;
};

export function desktopVideo(): DesktopVideoApi | undefined {
  return (window as unknown as { lomra?: { video?: DesktopVideoApi } }).lomra?.video;
}

export type Local3dModel = {
  id: string; name: string; quality: string; note: string; license: string; bytes: number; recommended: boolean; installed: boolean;
  /** The graphics card has enough memory for this model. */
  fits: boolean;
};
export type Local3dStatus = {
  /** False without a supported NVIDIA graphics card; `reason` then says why. */
  supported: boolean;
  reason: string | null;
  /** The shared Python environment is installed. */
  engine: boolean;
  engineBytes: number;
  /** The installation in progress; `received` and `total` are 0 while packages install and no size is known. */
  installing: { id: string; name: string; stage: "download" | "python" | "packages" | "model"; label: string; received: number; total: number } | null;
  /** Why the last installation failed, ready to show. */
  error: string | null;
  models: Local3dModel[];
};

/** Local image-to-3D generation (Hunyuan3D, TripoSR) of the desktop app. */
export type DesktopLocal3dApi = {
  status(): Promise<Local3dStatus>;
  /** Install the 3D engine (if missing) and a model by id in the background; the caller asks the user first. Resolves false if it could not start. */
  install(id: string): Promise<boolean>;
  cancelInstall(): Promise<void>;
  /** Delete a model; the engine goes with the last one. */
  remove(id: string): Promise<boolean>;
  /** Make one 3D model (a GLB data URL) from one picture (an image data URL). `runId` is a UUID. */
  generate(runId: string, input: { model: string; image: string }): Promise<{ model: string } | { error: string }>;
  cancel(runId: string): void;
  onProgress(callback: (event: { runId: string; stage: string }) => void): () => void;
};

export function desktopLocal3d(): DesktopLocal3dApi | undefined {
  return (window as unknown as { lomra?: { local3d?: DesktopLocal3dApi } }).lomra?.local3d;
}

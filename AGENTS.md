# AGENTS.md

## File organization

- Organize files by feature or responsibility. Reuse existing directories before creating new ones; keep related components, helpers, and unit tests close to the feature they support.
- Move code to shared locations only when it is actually reused across features, except for frontend components as described below. Avoid catch-all directories mixing unrelated responsibilities and folders wrapping a single file without a concrete reason.
- Preserve framework entrypoints, routing conventions, configuration locations, and the configured migration structure.
- Follow each app's existing import conventions and prefer direct imports over unnecessary barrel exports. When moving files, update all affected imports, configuration, and documentation.

## Desktop (`apps/desktop`)

- Electron shell, plain ESM (`.mjs`) with no build step; the sandboxed preload is `src/preload.cjs`. Keep the main process small: window, Next.js child process, workspace folder, `safeStorage` secret, and the agent bridge.
- Keep local speech-to-text in `src/whisper.mjs` / `src/whisper-worker.mjs` (child process; `onnxruntime-node` must stay asar-unpacked and other platforms' binaries are excluded per platform in `package.json`). Keep agent CLI logic in `src/agents.mjs` with `bun:test` tests beside it. The renderer may only start presets by id; never accept a command line from it, validate IPC senders with `isTrustedSender`, and do not pass `LOMRA_*` variables to the agent.
- Packaging is configured in `package.json` (`electron-builder`): `bun run pack` (unpacked) and `bun run dist` (installer). The Next.js `standalone` output ships in `resources/web`; `scripts/after-pack.cjs` copies its `node_modules`, and `@lydell/node-pty` must stay asar-unpacked.
- Verify changes with `bun test` and a launch with `LOMRA_SMOKE=1` (it loads the app, checks the agent bridge and quits).

## Data

- The app is local-first: no accounts, database or cloud storage. `/api/storage` (`apps/frontend/app/api/storage/`) reads and writes the workspace folder (`LOMRA_DATA_DIR`, default `~/Documents/Lomra`) through `apps/frontend/lib/local-store/`: `canvas/`, `chats/`, `settings/` and `keys/` as JSON (keys AES-GCM encrypted) and media in `files/`.
- Saved state is validated in `lib/local-store/validation.ts`; update it together with any change to the saved canvas, chat or settings shapes. Keep IDs matching `^[w-]{1,128}$` so they are safe file names.
- Local LLMs run through Ollama, no API key. The server is the `ollama-url` setting (Settings → Local models; may be another computer), else `OLLAMA_URL`, else `http://127.0.0.1:11434`; the desktop app finds the CLI and starts `ollama serve` only for a local server (`apps/desktop/src/ollama.mjs`). `app/api/ollama/` lists, installs (streamed pull) and removes models; chat and routing go through `app/api/providers` with provider `ollama` and model IDs `ollama/<name>`. Only models that report the `tools` capability are offered, because chat is routed by tool calls. Install UI: `components/ollama-settings.tsx` (Settings → Local models).
- Local image generation runs stable-diffusion.cpp's `sd-cli` from the desktop app (`apps/desktop/src/sd.mjs`, pinned engine build and checkpoints with SHA-256 in `src/sd-models.mjs`, `bun:test` beside it). Files go to userData `stable-diffusion/`; downloads start only after the user agrees in `components/sd-settings.tsx` (Settings → Local models). The renderer reaches it over the `sd:*` IPC (`lomra.sd`, typed in `lib/desktop.ts`) with a model id, prompt and aspect ratio only, never a path or command line. Besides the built-in models, any single-file `.safetensors`/`.gguf` checkpoint on Hugging Face can be added (`components/sd-huggingface.tsx`; only huggingface.co `owner/name` repos, verified against the hash Hugging Face lists, saved in `custom/` with a record, run with the settings of the chosen family). Picture models are `sd/<id>` and are generated in `components/prompt/generation.ts` (text-to-image only).
- Local image-to-3D runs from the desktop app (`apps/desktop/src/local3d.mjs`, pins and the model list in `src/local3d-models.mjs`, worker scripts in `src/local3d-worker/`, `bun:test` beside it). After the user agrees in `components/local3d-settings.tsx` (Settings → Local models; NVIDIA GPU with 6 GB+, Windows x64) it installs one shared environment into userData `local3d/` (the uv installer, a private Python 3.10, CUDA PyTorch, pinned libraries and the Hunyuan3D `hy3dgen` code), then the weights of each model the user picks (Hunyuan3D 2 Mini, Hunyuan3D 2, TripoSR; shape only, TripoSR adds vertex colors). Everything is SHA-256 checked or an exact version, and `torchmcubes` is replaced by a scikit-image shim so nothing has to be compiled. Each run starts `worker.py` as a fresh process with `HF_HUB_OFFLINE=1`; the renderer reaches it over the `local3d:*` IPC (`lomra.local3d`, typed in `lib/desktop.ts`) with a model id and one picture, never a path. 3D models are `local3d/<id>` and are generated in `components/prompt/generation.ts`; they need no Fal key. To add a model, add an entry to `local3dModels` (and a worker `kind` if it needs new code); bump `local3dVersion` when an engine pin changes.
- Voice input calls a Whisper service (`WHISPER_URL`) directly from `app/api/transcriptions`. The desktop app starts a bundled one (`apps/desktop/src/whisper-worker.mjs`, transformers.js, models listed in `src/speech-models.mjs`, cached in userData and downloaded only after the user agrees in a native dialog; the mic button's right-click menu in `components/prompt/speech-menu.tsx` manages them); without it use `docker compose up -d whisper`. The browser converts recordings to 16 kHz WAV first (`components/prompt/wav.ts`).

## Frontend (`apps/frontend`)

### File organization

- Keep Next.js App Router routes, layouts, and route handlers under `app/`, preserving special filenames such as `page.tsx` and `layout.tsx`. Colocate route-specific helpers, hooks, and tests with the route.
- Put standalone UI components under the existing `components/`, even when currently used by only one route. Keep UI primitives in `components/ui/` and feature or navigation components outside `components/ui/`. Group by feature only when useful; do not create a folder just to wrap one component.
- Put genuinely shared hooks in `hooks/` (already configured in `components.json`) only when needed. Keep shared non-UI utilities in the existing `lib/`, including `lib/utils.ts`; keep feature-only helpers with their feature.
- Keep saved-data and workspace file logic server-side in `lib/local-store/`; client code reaches it only through `lib/storage.ts`. Bridge types for the Electron preload live in `lib/desktop.ts`.
- Follow the existing `@/*` alias rooted at `apps/frontend` and the aliases in `components.json`; use local relative imports where appropriate. Preserve app-root Next.js, TypeScript, ESLint, and shadcn configuration and `app/globals.css`.

### UI components

- Prefer shadcn/ui components before building UI from scratch, including forms, inputs, buttons, dialogs, and tables.
- Check existing project components first. If a suitable shadcn/ui component is missing, add it using the shadcn CLI and compose or customize it to fit the app.
- Build a custom component only when existing project components and shadcn/ui cannot reasonably meet the requirement. Keep styling consistent with the project's theme and preserve accessibility.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from `apps/frontend`; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Using Lomra

See the [README](../README.md#run-from-source) to install and run Lomra.

## Desktop app

`apps/desktop` is an Electron shell that runs the Next.js app on a random
`127.0.0.1` port and keeps all data as plain files in a workspace folder
(default `Documents/Lomra`, override with `LOMRA_WORKSPACE`), so an agent CLI can
read it: `canvas/`, `chats/` and `settings/` as JSON, media in `files/`. API keys
are AES-GCM encrypted; their secret is protected by the OS through Electron
`safeStorage`. There are no accounts, database or cloud storage; data does not
sync between machines (copy or version the folder if you need that).

`bun run pack` builds an unpacked app in `apps/desktop/dist` and `bun run dist`
builds the installer for the current OS (the packaged app runs Next.js
`standalone` output from its resources; code signing is not configured yet).
Running `bun run dev` in `apps/frontend` alone uses the same folder
(`LOMRA_DATA_DIR`, default `~/Documents/Lomra`). Voice input needs the Whisper
service below.

Select an installed Claude Code, Codex, or OpenCode model in the prompt panel
to run its CLI in the workspace folder. Use **Settings → Agents** to choose
which agents appear. The desktop bridge starts agents by preset ID and excludes
`LOMRA_*` variables from their environment. `LOMRA_SMOKE=1` launches the app,
checks the agent bridge and voice input, and quits.
Run `bun test` in `apps/desktop` for its unit tests.

### Data and providers

- Canvas files and chat history are stored in your workspace. Local GLB
  inspection and optimization run on your machine.
- Bundled Whisper, stable-diffusion.cpp, and local image-to-3D run inference on
  your machine after setup. Ollama runs on the server you configure. Initial
  setup may download engines and model files from their distributors, and
  searching Hugging Face for an image model sends it your search text as you
  type (from three characters).
- Hosted providers receive the prompts and attachments needed for the request.
  Agent CLIs can access the workspace and apply their own permissions and data
  handling. Enabling browser generation submits your prompt and selected
  references to ChatGPT or Gemini using your signed-in session.

## Canvas

Drop images, videos, and GLBs onto the canvas. Select files to attach them to a
prompt; prompt-driven media tools need a tool-capable chat model.

- **Canvas history** creates, reopens, and renames separate canvases. Resize and
  layer files freely, or use **Reorganize canvas** to arrange them in rows.
- **Open / Edit** on an image adds arrows, shapes, or text and saves a new PNG.
  With a compatible image model you can also erase or edit a brushed area, or
  recompose the picture for a new aspect ratio (not with local Stable
  Diffusion). With local Stable Diffusion an ordinary checkpoint follows your
  words but can leave visible edges; an inpainting checkpoint blends in better
  but keeps closer to what is around the area. **Remove BG** and **Upscale 2× / 4×** run locally on desktop once downloaded (or via Fal.AI).
- **Inspect model** opens a GLB viewer: orbit, adjust lighting, show the
  skeleton, play animations at different speeds, and save the current view as a
  PNG up to 2048 px.
- **Save as Character** on an image stores a named reference with appearance
  notes. Type `@name` in a prompt to reuse it.
- `/storyboard` develops a story and drafts a shot list. Edit each shot's
  description, duration, and cast, then pick an existing image or generate a
  still with a configured image model.
- Crop, split, resize, rotate, or flip images. Edits create new files and keep
  the originals.

## Generate images, video, and 3D

- **Images:** local Stable Diffusion (set up under **Settings → Local models**,
  where added checkpoints can also switch between compatible
  profiles) or a hosted image model through OpenRouter or Fal.AI. Local Stable
  Diffusion redraws the picture you select, one at a time; describe the result
  you want. **Image settings** next to the model picker sets seed, steps, and
  (where the model profile supports them) negative prompt, CFG scale and edit
  strength. **Canvas details** shows what was used and lets you reuse
  the setup in the prompt, generate a local picture again with the same seed
  and settings (without the chat), or make 4 local variations. Select 2 to 4 pictures to compare them
  side by side, or use the slider to compare 2.
- **Video:** text to video with a supported hosted model.
- **3D:** turn one image into a GLB with local Hunyuan3D or TripoSR, or use
  Fal.AI for text-to-3D and supported multiview models.
- **Signed-in accounts (desktop):** generate images through a signed-in ChatGPT
  or Gemini session, and video through Gemini if your account has access.
  Hosted generation uses your provider credits.

## Settings

Open **Canvas menu → Settings**.

### API keys

Enter your own provider keys under **API keys**. Each provider (OpenRouter,
Fal.AI, Google AI) has **Save key**, **Remove**, and **Test connection**
controls. Keys are encrypted in the workspace folder (see Desktop app above).
Saving a key does not validate it. Connection checks do not generate content.
Fal's connection check reads model pricing and requires permission for that API.
You can check OpenRouter and Fal.AI credit usage, and see the Google AI usage
Lomra recorded this month.

Create keys at [OpenRouter](https://openrouter.ai/settings/keys) and
[Fal.AI](https://fal.ai/dashboard/keys). API reference:
[OpenRouter authentication](https://openrouter.ai/docs/api/reference/authentication),
[Fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue), and
[Fal pricing](https://fal.ai/docs/documentation/model-apis/pricing).

For UI integration, `useApiProviders()` exposes `keys`, `setKey`, and
`request(provider, options)`. Examples:

```tsx
const { request } = useApiProviders();
await request("openrouter", {
  action: "chat", model: "<author/model>",
  input: [{ role: "user", content: "Hello" }],
});
const job = await request("fal", {
  action: "submit", model: "<owner/app/model-path>", input: { prompt: "A cat" },
});
// Use the returned request_id with action: "status", then "result";
// supply the same model and requestId for both calls.
```

Requests go through `POST /api/providers`, with the user's key in `x-api-key`.
The proxy uses fixed provider hosts, disables caching and redirects, and never
stores keys. Deploy over HTTPS and keep API-key headers out of infrastructure
logs. Generation calls use the user's provider credits.

### Local models

**Local models** downloads or removes models for chat, image generation, and
image-to-3D. Downloads start only after you agree. Image and 3D models queue up
and can be stopped; an unfinished download can be resumed or deleted later, also
after a restart.

- **Ollama** runs chat models on this computer or on another machine you point
  Lomra to. Only models that report the `tools` capability are offered.
- **Stable Diffusion** models run through stable-diffusion.cpp. The search field
  finds other models on Hugging Face (not ones marked for adults), or takes an
  `owner/name` or a checkpoint link, including files in subfolders. Only
  single-file Stable Diffusion 1.x/2.x and SDXL checkpoints (`.safetensors` or
  `.gguf`) work; Lomra reads the file's header to tell before you download it.
  Turn on **Few-step model** for Turbo, Lightning and LCM models if it is not
  already. Use **Add a file from this computer** to use a checkpoint in place,
  or **Scan a model folder** to add several checkpoints from ComfyUI (including
  portable installs), A1111, Forge, or another model folder. If the scan reaches
  its limit, pick a narrower folder to find more. Use **Locate…** if the file moved or reconnect the drive
  if it was unplugged. **Remove from Lomra** keeps the original file.
- **Image-to-3D** (Hunyuan3D 2 Mini, Hunyuan3D 2, TripoSR) requires Windows x64
  and an NVIDIA GPU with at least 6 GB of VRAM.

Local image and 3D runs take turns on the graphics card, and Ollama models loaded
on this computer are unloaded before each run. A chat sent to Ollama during a run
is not queued: Ollama loads its model again next to the run.

### Agents

**Agents** shows which Claude Code, Codex, and OpenCode CLIs are installed and
lets you choose which appear in the model picker. It also shows available Codex
or Claude Code usage limits and OpenCode session and token counts.

## Voice input

Record audio in the floating prompt, then stop to automatically transcribe and
append the text to your prompt. Failed requests can be retried without recording
again; cancel keeps your existing prompt. The recording is converted to 16 kHz WAV
in the browser before upload and must be at most 25 MB. Microphone access requires
localhost or HTTPS.

The desktop app runs speech recognition itself, so it needs no extra service: it starts a
local Whisper (quantized ONNX, CPU) from `apps/desktop/src/whisper-worker.mjs` and
detects the spoken language. Right-click the microphone button to see the models
(`apps/desktop/src/speech-models.mjs`: Tiny, Base, Small), choose which one is used,
download one, or delete it from disk. Models are not downloaded until you agree:
the first recording asks in an app dialog, then stores the model in the app's
user-data folder (`whisper-models`). Nothing is fetched before that, and later
launches load it from disk with no network.

When you run the frontend alone (`bun run dev` in `apps/frontend`) or set
`WHISPER_URL`, the app calls that
[Whisper ASR Webservice](https://ahmetoner.github.io/whisper-asr-webservice/)-compatible
service instead (default `http://127.0.0.1:9000`; override in
`apps/frontend/.env.local`). The desktop app also respects a `WHISPER_URL` from
its environment and then skips the bundled one.

## Canvas media tools

### Inspect and optimize GLBs

Select a GLB on the canvas and ask "inspect this model" or "optimize this model".
`inspect_3d` reports file size, stored geometry counts, materials, textures,
skins and animations. `optimize_3d` aims to halve the triangle count, removes duplicate/unused resources and
downsizes PNG/JPEG textures to a maximum edge of 2048 pixels by default
(512/1024/2048/4096 can be requested). It adds a new GLB only when smaller,
keeps the original, and reports before/after statistics in chat.

Generated GLB results are stored as binary files; chat history stores durable
file links instead of base64 payloads. Older inline GLB results are moved to
file storage when the chat is next saved.
Ask "reduce this model to 100,000 triangles" to set an approximate budget.
Use `target_triangles: 0` (or ask to preserve polygon detail) to disable mesh
simplification. Protected borders, small parts and a 1% geometric error limit
can prevent reaching the requested count; the report shows actual counts.
Geometry and texture detail can decrease, including deformation quality on
rigged models; UV, skin, morph and animation data are retained. Topology repair
is not included. Processing runs locally without Fal credits; chat routing requires a tool-capable model. Self-contained GLBs up to
100 MB are supported, excluding Draco input and unknown extensions. Texture
resizing uses the browser decoder for textures above 16 megapixels (up to
64 megapixels). Larger textures or textures that cannot be resized are kept
unchanged with a warning while other optimization steps continue.

### Rig and animate a character

Select a biped GLB and describe the motion in chat, such as
“walk with short waddling steps, keeping arms clear of the belly”. Uses your
existing Fal key: Meshy rigs the selected model (up to 20 MB), Hunyuan Motion
creates a new FBX motion from the full description, and the browser fits it to
the character's rest pose and leg proportions. The result is a new animated GLB.
Both provider stages use credits; saved job IDs let Check job resume without
resubmitting. Stop pauses checking; submitted jobs may still run and charge.
Requires a recognizable Meshy/Mixamo biped rig. Does not guarantee foot contact,
collision-free limbs or support quadrupeds. Older preset jobs still resume.

### Images and video

Select source files on the canvas and ask in chat, for example: “remove the background”,
“upscale 2x”, “extract frames at 1 and 3 seconds”, “trim from 2 to 8 seconds”, or
“render front, right, back and left views”. Results become new canvas files.
Background removal and 2x or 4x upscaling run locally in the desktop app (BiRefNet Lite and Real-ESRGAN x4v3 on CPU once downloaded under **Settings → Local models**) or through [Fal BiRefNet V2](https://fal.ai/models/fal-ai/birefnet/v2/api) and [Fal ESRGAN](https://fal.ai/models/fal-ai/esrgan/api) with a Fal key.
Frame extraction (up to 16 PNGs) and GLB views (1024px PNGs, model axes) run locally.
Trimming runs in compatible browsers such as Chrome, preserves audio, and re-encodes
to WebM at up to 30fps in real time. Keep the tab active; clips are limited to
120 seconds and 8.3 megapixels per frame. Originals are preserved.

## Third-party models and assets

Dependencies, provider marks, and separately downloaded models
are subject to their respective terms. The desktop app downloads model weights
when you set up a model. See the upstream terms for
[Stable Diffusion 1.5](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5),
[SD Turbo](https://huggingface.co/stabilityai/sd-turbo),
[SDXL Turbo](https://huggingface.co/stabilityai/sdxl-turbo),
[Hunyuan3D 2 and 2 Mini](https://github.com/Tencent-Hunyuan/Hunyuan3D-2),
[TripoSR](https://huggingface.co/stabilityai/TripoSR), and
[Whisper](https://github.com/openai/whisper).

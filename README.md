<p align="center">
  <img src="apps/desktop/build/icon.png" width="96" alt="Lomra icon">
</p>

<h1 align="center">Lomra</h1>

<p align="center">
  <strong>A local-first desktop canvas for images, video, and 3D.</strong><br>
  Arrange references, work with AI models, and bring the results back onto the same canvas.
</p>

<p align="center">
  <a href="#run-from-source"><strong>Run from source</strong></a> ·
  <a href="#what-you-can-do">Features</a> ·
  <a href="#try-it">Try it</a> ·
  <a href="docs/usage.md">Usage guide</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <img src="docs/lomra-canvas.png" width="960" alt="Lomra with an illustration on the canvas and its reference attached in the prompt panel">
</p>

## What you can do

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/canvas.webp"><picture><source srcset="docs/demos/canvas.webp" type="image/webp"><img src="docs/demos/canvas.poster.jpg" width="420" alt="A desk lamp image, turntable clip, and 3D model being arranged on a Lomra canvas and selected as prompt references"></picture></a>
      <p><strong>Organize a canvas</strong><br>
      Create a canvas for each project and reopen or rename it in <strong>Canvas history</strong>. Import images, videos, and GLBs, then move, resize, and layer them or use <strong>Reorganize canvas</strong> to arrange them in rows. Select multiple files to use as references in a prompt.</p>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/picture-editor.webp"><picture><source srcset="docs/demos/picture-editor.webp" type="image/webp"><img src="docs/demos/picture-editor.poster.jpg" width="420" alt="A desk lamp marked up with an arrow, text, and an ellipse before saving the edited picture to a Lomra canvas"></picture></a>
      <p><strong>Edit a picture on the canvas</strong><br>
      Choose <strong>Open / Edit</strong> to add arrows, shapes, or text and save a new PNG. Use a compatible image model to erase a brushed area or recompose a picture for a new aspect ratio. <strong>Remove BG</strong> and <strong>Upscale 2× / 4×</strong> run locally on desktop (after model download) or through Fal.AI.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/generate-media.webp"><picture><source srcset="docs/demos/generate-media.webp" type="image/webp"><img src="docs/demos/generate-media.poster.jpg" width="420" alt="A generated toy robot image, a video of a robot waving, and a 3D robot model on a Lomra canvas"></picture></a>
      <p><strong>Generate images, clips, and 3D assets</strong><br>
      Generate images locally from text with Stable Diffusion or use a hosted image model. Generate video from text with a supported hosted model. Turn one image into a GLB with local Hunyuan3D or TripoSR, or use Fal.AI for text-to-3D, image-to-3D, and supported multiview models.</p>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/model-inspector.webp"><picture><source srcset="docs/demos/model-inspector.webp" type="image/webp"><img src="docs/demos/model-inspector.poster.jpg" width="420" alt="A robot in the Lomra model inspector as its lighting is adjusted, its skeleton is shown, and its wave animation is played before saving a PNG"></picture></a>
      <p><strong>Preview a 3D model</strong><br>
      In <strong>Inspect model</strong>, orbit around a GLB, adjust lighting, show its skeleton, or play animations at different speeds. Save the current view as a PNG at up to 2048 px.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/dictate-prompt.webp"><picture><source srcset="docs/demos/dictate-prompt.webp" type="image/webp"><img src="docs/demos/dictate-prompt.poster.jpg" width="420" alt="Lomra recording a spoken instruction and appending the local Whisper transcription to an existing prompt"></picture></a>
      <p><strong>Dictate a prompt</strong><br>
      Use the mic to record and append a local Whisper transcription to your prompt.</p>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/edit-media.webp"><picture><source srcset="docs/demos/edit-media.webp" type="image/webp"><img src="docs/demos/edit-media.poster.jpg" width="420" alt="A contact sheet split into two images and a turntable clip trimmed with two still frames on a Lomra canvas."></picture></a>
      <p><strong>Edit images and video</strong><br>
      Crop, split, resize, rotate, or flip images. Extract PNG frames at specific timestamps or trim a clip to WebM. Remove image backgrounds or upscale images 2× or 4× locally in the desktop app (or with a Fal.AI key). Edits create new files and keep the originals.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/signed-in-chatgpt.webp"><picture><source srcset="docs/demos/signed-in-chatgpt.webp" type="image/webp"><img src="docs/demos/signed-in-chatgpt.poster.jpg" width="420" alt="Lomra sends a lamp reference to a signed-in ChatGPT session and adds the generated terracotta variant to the canvas."></picture></a>
      <p><strong>Generate with a signed-in account</strong><br>
      On desktop, generate images through a signed-in ChatGPT or Gemini session. Generate video through Gemini if your account has access.</p>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/reuse-a-character.webp"><picture><source srcset="docs/demos/reuse-a-character.webp" type="image/webp"><img src="docs/demos/reuse-a-character.poster.jpg" width="420" alt="Save two views of PIP-07 with appearance notes, then use @PIP-07 on a new canvas to attach the chosen cover to a storyboard prompt."></picture></a>
      <p><strong>Reuse a character</strong><br>
      Choose <strong>Save as Character</strong> on an image to store a named reference with appearance notes. Type <code>@name</code> to reuse it in a prompt.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/optimize-glb.webp"><picture><source srcset="docs/demos/optimize-glb.webp" type="image/webp"><img src="docs/demos/optimize-glb.poster.jpg" width="420" alt="Inspect a lamp GLB, reduce its triangle count and texture size, and render four orthographic views."></picture></a>
      <p><strong>Inspect and optimize GLBs</strong><br>
      Get triangle counts, texture dimensions, and the number of animations in chat. Render front, right, back, and left PNG views, or reduce polygons and texture sizes locally.</p>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/rig-and-animate.webp"><picture><source srcset="docs/demos/rig-and-animate.webp" type="image/webp"><img src="docs/demos/rig-and-animate.poster.jpg" width="420" alt="Generate a custom walk for a humanoid GLB and play it in the model inspector with the skeleton visible."></picture></a>
      <p><strong>Rig and animate a character</strong><br>
      Select a humanoid GLB and ask Lomra to rig it or describe a motion, such as a slow walk with short steps. Meshy rigs the character and Hunyuan Motion generates motion that Lomra applies to a new GLB. Requires a Fal.AI key and credits.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/story-into-shots.webp"><picture><source srcset="docs/demos/story-into-shots.webp" type="image/webp"><img src="docs/demos/story-into-shots.poster.jpg" width="420" alt="Draft a three-shot storyboard from selected stills and edit a shot&#x27;s description and duration."></picture></a>
      <p><strong>Turn a story into shots</strong><br>
      Start with <code>/storyboard</code>, refine the story, and draft a shot list. Edit shot descriptions and durations and see the cast for each shot. Use selected canvas images as stills or generate them with a configured image model.</p>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/local-models.webp"><picture><source srcset="docs/demos/local-models.webp" type="image/webp"><img src="docs/demos/local-models.poster.jpg" width="420" alt="Connect to Ollama, download and remove a chat model, and browse local image and 3D models."></picture></a>
      <p><strong>Manage local models</strong><br>
      In <strong>Settings → Local models</strong>, download or remove models for chat, image generation, and image-to-3D. Run Ollama on this computer or connect to another machine. Local image-to-3D requires Windows x64 and an NVIDIA GPU with at least 6 GB of VRAM.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/api-keys-usage.webp"><picture><source srcset="docs/demos/api-keys-usage.webp" type="image/webp"><img src="docs/demos/api-keys-usage.poster.jpg" width="420" alt="Test and save a masked OpenRouter key, refresh credit usage, and view Fal.AI and Google AI usage."></picture></a>
      <p><strong>Manage API keys and usage</strong><br>
      In <strong>Settings → API keys</strong>, save and test OpenRouter, Fal.AI, and Google AI keys. Check OpenRouter and Fal.AI credit usage or view the Google AI usage Lomra recorded this month.</p>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/choose-agents.webp"><picture><source srcset="docs/demos/choose-agents.webp" type="image/webp"><img src="docs/demos/choose-agents.poster.jpg" width="420" alt="Disable Codex in Settings, see it disappear from the provider list, then enable it and add its default model."></picture></a>
      <p><strong>Choose which agents to use</strong><br>
      In <strong>Settings → Agents</strong>, see which Claude Code, Codex, and OpenCode CLIs are installed and choose which appear in the model picker. View available Codex or Claude Code usage limits and OpenCode session and token counts.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="docs/demos/canvas-handoff.webp"><picture><source srcset="docs/demos/canvas-handoff.webp" type="image/webp"><img src="docs/demos/canvas-handoff.poster.jpg" width="420" alt="A Roblox supply crate brief and reference linked to a concept image on the Lomra canvas, then exported as a ZIP"></picture></a>
      <p><strong>Hand off work from the canvas</strong><br>
      Link a brief, reference images, and an output in <strong>Canvas details</strong>. Select the items you want to share, edit the Markdown, and download a ZIP with the selected files.</p>
    </td>
    <td></td>
  </tr>
</table>

Prompt-driven media tools need a tool-capable chat model. See the
[usage guide](docs/usage.md) for provider setup and media limits.

## Run from source

Install [Bun 1.3.14](https://bun.sh/) and [Node.js 22+](https://nodejs.org/), then run:

```sh
git clone https://github.com/Nxdus/lomra-app.git
cd lomra-app
bun install --cwd apps/frontend --frozen-lockfile
bun install --cwd apps/desktop --frozen-lockfile
bun run --cwd apps/desktop dev
```

The desktop command starts the local Next.js server and opens Lomra in Electron.
See the [usage guide](docs/usage.md#desktop-app-local-first) for packaging commands.

## Try it

1. Drop an image, video, or GLB onto the canvas.
2. To use prompts, choose a chat model. Configure local models or provider keys in **Canvas menu → Settings**.
3. Select a file and describe what you want. Try “Extract frames at 1 and 3 seconds” with a video, or “Inspect this model” with a GLB.

## Your workspace

Lomra saves canvases, chat history, and media in a folder on your machine.
Local inference runs on your machine after setup. Ollama runs on the server
you configure. Hosted providers receive the prompts and attachments needed
for each request, and agent CLIs can access your workspace.
See the [data and provider details](docs/usage.md#data-and-providers).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and pull requests.
Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE) · [NOTICE](NOTICE) · [Third-party models and assets](docs/usage.md#third-party-models-and-assets)

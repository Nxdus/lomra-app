<h1 align="center">Lomra</h1>

<p align="center">
  <strong>A local-first desktop canvas for images, video, and 3D.</strong><br>
  Arrange references, work with AI models, and bring the results back onto the same canvas.
</p>

<p align="center">
  <a href="#run-from-source"><strong>Run from source</strong></a> ·
  <a href="#try-it">Try it</a> ·
  <a href="docs/usage.md">Usage guide</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <img src="docs/lomra-canvas.png" width="960" alt="Lomra with an illustration on the canvas and its reference attached in the prompt panel">
</p>

## What you can do

| Workflow | In Lomra |
| --- | --- |
| Work with references | Drop images, clips, and GLBs onto a canvas. Select files to include them in your prompt and reuse character references with `@mentions`. |
| Build a storyboard | Use `/storyboard` to develop a story, organize its characters, and draft a sequence of shots. Generate a frame for a shot with a configured image model. |
| Edit and inspect media | Extract video frames, render model views, or inspect and optimize a GLB locally. New media goes back onto the canvas, and inspection reports appear in chat. |
| Pick how AI runs | Use Ollama for chat, local models for image or 3D generation, or optional hosted providers. The desktop prompt panel can also use installed Claude Code, Codex, and OpenCode CLIs. |

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

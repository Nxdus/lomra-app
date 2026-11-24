# Testing with the first 5–10 people

For the person running the test. Give testers the
[tester guide](tester-guide.md) ([ภาษาไทย](tester-guide.th.md)) and adapt the
[invitation draft](invitation.md). Steps match Lomra 0.0.7. Where the unreleased
build after it differs, the guide says "after 0.0.7"; re-check every step when it
is released.

## Who to recruit

Aim for 5 first, fix what stops them, then invite 5 more.

| Slot | Computer | Person |
| --- | --- | --- |
| 1–2 | NVIDIA GPU, 8 GB+ VRAM | Makes 3D or game assets |
| 3 | NVIDIA GPU, 6 GB VRAM | Any creative work |
| 4 | AMD or Intel GPU | Makes images or storyboards |
| 5 | No dedicated GPU, 16 GB RAM | Not a developer |
| 6–10 | Repeat the weakest slots | At least three people who prefer Thai and two who never used a local model |

- Everyone needs Windows 10/11 x64, about 30 GB of free disk space, and a
  connection that can download 13 GB or more.
- Ask adults you can talk to, on a computer they own. Not a work computer:
  company policy can block unsigned apps and winget.
- In the EU, UK or South Korea, do not use the Hunyuan3D models: their license
  does not cover those places. TripoSR (MIT) is fine.
- Skip anyone whose only computer has Smart App Control turned on. Lomra is not
  signed and Windows can block it. Never ask a tester to turn off a security
  feature.

## How to run it

1. Send the invitation and guide a day early. Downloads can take hours, so they
   happen outside the timed part.
2. Give each person a code (T1, T2 …). Use the code in notes, not a name.
3. Watch by screen share if they agree, and stay quiet for the first two minutes
   of any problem. Do not record the screen without asking.
4. Keep the hands-on part to 20–30 minutes. Skip a step rather than run over.
5. Afterwards, file bugs in GitHub with the code only, and delete recordings
   within 30 days.

## What to record for each tester

| Field | Example |
| --- | --- |
| Code, date, Lomra version | T3, 2026-12-02, 0.0.7 |
| Windows version, RAM, GPU, VRAM, free disk | 11 24H2, 16 GB, RTX 3060, 12 GB, 80 GB |
| Windows warning on install | none / SmartScreen / blocked |
| Hands-on minutes per step, without downloads | install 3, chat 5, image 4 |
| Download time and size per model | SD Turbo 18 min |
| Result of each step | done / done with help / failed / skipped |
| Exact error text | copied, with keys and paths removed |
| Generation seconds | image 12 s, 3D 40 s |
| Local or hosted model used | local |
| Hardest moment, what they expected, would they open it again (1–5) | |

## Pass and fail

A step passes when the tester finishes it without help. Count only people whose
computer meets the step's requirement.

| Measure | Pass | Investigate | Fail |
| --- | --- | --- | --- |
| Installs and reaches the canvas | 4 of 5 | 3 of 5 | Fewer |
| Local chat answers | 4 of 5 | 3 of 5 | Fewer |
| Local image reaches the canvas | 4 of 5 | 3 of 5 | Fewer |
| Local 3D model reaches the canvas (NVIDIA, 6 GB+) | 2 of 3 | 1 of 3 | None |
| Unsupported computers get a clear 3D message | All | – | Any crash or silent failure |
| Storyboard shows shots | 3 of 5 | 2 of 5 | Fewer |
| Uninstalls and finds their files | All | – | Any problem |
| Hands-on time, median | 30 min or less | 31–45 min | Over 45 min |
| Would open it again, median | 4 or 5 | 3 | 1 or 2 |

With 10 testers, double the counts. Stop the round and fix first if anyone loses
work, an API key or private file shows up where it should not, a download runs
without being asked for, or Windows or the graphics driver crashes.

Five people find problems; they do not prove a rate. Do not publish these counts
as statistics.

## What leaves the computer

There is no account, and the code has no analytics or crash reporting. Network
traffic at 0.0.7 and in the build after it:

| When | Where | What is sent |
| --- | --- | --- |
| Lomra starts | `api.github.com` | Update check for the latest release |
| Lomra starts or the Add model dialog opens | `openrouter.ai`, and `api.fal.ai` for 3D | Request for the public model and price list; with a saved Fal.AI key, that key for prices |
| Settings → Local models, Ollama running | `ollama.com` | Model library lookup, including the model family you look at |
| Installing a local model, after you agree, or resuming one (after 0.0.7) | GitHub, Hugging Face, PyPI, PyTorch, winget and the Ollama registry | File downloads |
| Settings → Local models → Hugging Face search field (after 0.0.7; 0.0.7 does not show it) | `huggingface.co` | The search text as you type, or the model name or link you enter; the start of a file you choose is read |
| Recording voice input | `cdn.jsdelivr.net` | Download of the voice detector; the audio stays on the computer |
| Settings → Agents, if Claude Code is signed in | `api.anthropic.com` | A usage check with that CLI's own sign-in |
| Choosing a hosted model, an agent or browser generation | That provider | The prompt and the files the request needs; an agent can read the workspace |
| Local chat, image and 3D generation | Nowhere, unless the Ollama server is set to another computer or the model is an Ollama cloud model | – |

Each of these services sees the computer's IP address. The test uses local
models only and needs no API key.

Privacy traps to mention:

- **Settings → Agents** shows the email of a signed-in Claude Code or Codex
  account. Leave it out of screenshots.
- `Documents\Lomra` can be inside OneDrive. If it is, OneDrive uploads it.
- Canvases, chats and media are plain files. Only API keys are encrypted.

## Where data stays and how to remove it

| Place | Contents | Removed by uninstall? |
| --- | --- | --- |
| `%LOCALAPPDATA%\Programs\desktop` | The app | Yes |
| `Documents\Lomra` | Canvases, chats, settings, media, encrypted keys | No |
| `%APPDATA%\desktop` | Image, 3D and voice models, FFmpeg, the key that decrypts saved API keys, ChatGPT/Gemini browser sign-ins | No |
| `%LOCALAPPDATA%\desktop-updater` | A copy of the installer | No |
| `%TEMP%\lomra-update`, `%TEMP%\lomra-mcp` | Downloaded update, temporary agent files | No |
| `%USERPROFILE%\.ollama`, and Ollama itself | Chat models | No |

The folder is named `desktop` after the app's package name, so another program
could use it too. Delete `%APPDATA%\desktop` only if it contains
`storage-secret.bin`. Deleting that file makes saved API keys unreadable.
**Uninstall Ollama** in Lomra removes every Ollama model on the computer,
including ones that were there before.

## How testers report

- Bugs and feedback: the [issue forms](https://github.com/Nxdus/lomra-app/issues/new/choose).
  Issues are public and need a GitHub account.
- No GitHub account, or something they do not want public: reply to the
  invitation, and the person running the test files it with the tester's code.
- Anything that looks like a security problem: [SECURITY.md](../../SECURITY.md),
  never a public issue.

## What was checked

The labels in the guide come from the packaged 0.0.7 build, run with an empty
workspace and profile, or from the code. In the build after it, the first run,
**Settings → Local models**, **Add model** for a chat and an image model, an image
on the canvas, and pausing and resuming a download were repeated on Windows 11
with an RTX 3050; the rest was compared in the code. The install folder, the updater folder
and the uninstall entry come from an installed copy. Not repeated for this kit:
a clean install on another computer, the large downloads, chat, image, 3D and
storyboard generation, and the uninstall itself. The person running the test
should go through the guide once before inviting anyone.

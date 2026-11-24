# Lomra tester guide

[ภาษาไทย](tester-guide.th.md) · about 30 minutes, after the downloads

Thank you for trying Lomra, a desktop canvas that makes images and 3D models on
your own computer. We test the app, not you. Stop whenever you like.

## Before you start

- Windows 10 or 11 (64-bit) and about 30 GB of free disk space. 16 GB of memory
  is best. 3D needs an NVIDIA graphics card with 6 GB or more; everything else
  runs without one.
- Downloads: the app 160 MB, Ollama and a chat model (2–3 GB for the model), an
  image model 5.2 GB, and for 3D 5.3 GB. Start them earlier in the day.
- Use your own computer and pictures you are happy to share. Do not use private,
  work or client files. **You need no API key or paid account.**
- Local models run on your computer. Lomra still contacts the internet for
  updates, model lists and the downloads you agree to
  ([full list](README.md#what-leaves-the-computer)).
- If `Documents` is backed up to OneDrive, your Lomra folder is uploaded too.

Note the time when you start each part, and whether you used help.

## 1. Install (5 minutes)

1. Open the [latest release](https://github.com/Nxdus/lomra-app/releases/latest)
   and download `Lomra-<version>-windows-x64.exe`. Use only this page.
2. Check the file: in PowerShell run
   `Get-FileHash .\Lomra-<version>-windows-x64.exe` in the download folder, and
   compare it with the `sha256` next to the file on the release page. Capital
   letters do not matter. If it differs, stop and tell us.
3. Run it. Lomra is not signed yet, so Windows may say **Windows protected your
   PC**. If the hash matched and you are comfortable, choose **More info → Run
   anyway**. If not, stop here; that is a useful result too.
4. If Windows blocks it completely, stop and tell us. Do not turn off any
   Windows protection.
5. Lomra installs for your user without questions and opens.

## 2. First run and downloads (5 minutes, then wait)

1. In **Welcome to Lomra** choose **Start with blank canvas**.
2. Open the menu button at the lower left, then **Settings** → **Local models**.
3. **Ollama**: choose the download icon, then **Install**. Windows may ask for
   permission. If it opens a web page instead, install from there and choose
   **Check again**. Already have Ollama? If it says **Not running**, choose the
   start icon.
4. When Ollama says **Running**, download **Qwen 3 4B** (about 2.5 GB), or
   **Llama 3.2 3B** (about 2 GB) on a computer with 8 GB of memory.
5. **Stable Diffusion**: download **SD Turbo** and choose **Download** in the
   dialog.
6. **3D models**: download **TripoSR** if your graphics card is supported. If
   Lomra says local 3D needs an NVIDIA card or more memory, write down the
   sentence and skip part 5. That is an expected result.
7. Wait until SD Turbo and TripoSR say **Installed** and the chat model is
   listed under Ollama. You can close Settings meanwhile, but keep Lomra open.
   After 0.0.7, an image or 3D download that stops shows **Paused**: choose the
   play icon (**Resume download**) to continue it.

## 3. Chat with a local model (5 minutes)

1. In the prompt panel, open the model list and choose **+** next to **LLM**.
   Set **Provider** to **Ollama**, pick your model, and choose **Add model**.
2. Open the list again. The local model should be the ticked one under **LLM**.
   The names listed at the start are paid online models.
3. Type `Suggest three ideas for a poster about the sea.` and press Enter.
4. Pass: you get an answer. Note the seconds it took.

Lomra uses this chat model to understand every request, so do this part before
the next ones.

## 4. Make an image on your computer (5 minutes)

1. Model list → **+** next to **Image** → **Provider: Stable Diffusion** →
   **SD Turbo** → **Add model**.
2. Type `Make a picture of a small red robot on a white background.` and press
   Enter.
3. Pass: a picture appears on the canvas. Note the seconds. If you only get
   text, try once more with `Generate an image of a small red robot.` and tell
   us.

## 5. Make a 3D model (5 minutes, NVIDIA 6 GB+ only)

1. Model list → **+** next to **Model 3D** → **Provider: 3D models** →
   **TripoSR** → **Add model**.
2. Select the robot picture on the canvas.
3. Type `Turn the selected picture into a 3D model.` and press Enter.
4. Pass: a 3D model appears and you can drag inside it to turn it.

In the EU, UK or South Korea, do not use the Hunyuan3D models; their license
does not cover those places.

## 6. Storyboard (5 minutes)

1. Click an empty part of the canvas so nothing is selected.
2. Type `/storyboard` and press Enter, then write
   `A red robot finds a lost kitten in the rain. Three shots.` and press Enter.
3. Read the story in the chat panel and choose **Use this story** (the
   clapperboard icon).
4. Pass: shots appear on the canvas. Right-click one and choose **Generate
   image**.
5. Do **not** choose **Make video**. It uses a paid online model.

## 7. Finish (3 minutes)

1. Close Lomra and open it again. Is your work still there?
2. Tell us the hardest moment, what you expected instead, and how likely you are
   to open it again from 1 to 5.

## Report

- [Feedback or bug form](https://github.com/Nxdus/lomra-app/issues/new/choose)
  (public, needs a GitHub account), or reply to the person who invited you.
- Include the Lomra version (bottom of Settings), Windows version, graphics card
  and its memory, and the exact error text.
- **Do not send API keys, passwords, private files, or a screenshot of Settings
  → Agents, which can show your email.**
- Report a possible security problem privately on the
  [security page](https://github.com/Nxdus/lomra-app/security/advisories/new).

## Uninstall

1. To free space first: **Settings → Local models**, remove the image and 3D
   models. **Uninstall Ollama** there deletes *all* Ollama models on your
   computer, so use it only if you did not have Ollama before.
2. Windows **Settings → Apps → Installed apps → Lomra → Uninstall**.
3. These stay until you delete them:
   - `Documents\Lomra` – your canvases, chats and pictures. Copy what you want
     to keep.
   - `%APPDATA%\desktop` – models, settings and browser sign-ins. Delete it only
     if it contains `storage-secret.bin`.
   - `%LOCALAPPDATA%\desktop-updater` – a copy of the installer.
   - `%TEMP%\lomra-update` and `%TEMP%\lomra-mcp`, if present.
   - `%USERPROFILE%\.ollama` – chat models, if you keep Ollama.

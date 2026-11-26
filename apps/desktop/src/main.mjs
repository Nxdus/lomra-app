import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import pty from '@lydell/node-pty';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSessions, isTrustedSender } from './agents.mjs';
import { claudeLiveWindows, codexWindows } from './limits.mjs';
import { createOllama } from './ollama.mjs';
import { unloadOllama } from './ollama-unload.mjs';
import { createGpuQueue } from './gpu-queue.mjs';
import { createFfmpeg } from './ffmpeg.mjs';
import { createSd } from './sd.mjs';
import { validLocalPick } from './sd-local.mjs';
import { createPictureAi } from './picture-ai.mjs';
import { createLocal3d, nvidiaMemory } from './local3d.mjs';
import { createToolBridge, toolConfig } from './tool-bridge.mjs';
import { generateBrowserImage } from './browser-image.mjs';
import { generateGeminiMedia } from './browser-gemini.mjs';
import { openChatGPTPage, openGeminiPage, signInChatGPT, signInGemini } from './browser-image-page.mjs';
import { defaultSpeechModel, speechModelInstalled, speechModels } from './speech-models.mjs';
import { createUpdates, isReleaseUrl } from './updates.mjs';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend');
const smoke = process.env.LOMRA_SMOKE === '1';
let server;
let whisper;
let whisperUrl;
let whisperPort;
let appOrigin;
let mainWindow;
let quitting = false;
const ollama = createOllama();
// Local pictures and local 3D share one graphics card: one run at a time, after an Ollama on this computer has let go of its models.
const gpuQueue = createGpuQueue({ prepare: (signal) => unloadOllama({ workspace: workspaceDir(), signal }) });
const updates = createUpdates({ currentVersion: app.getVersion(), isPackaged: app.isPackaged });
let updateController = null;
// Local image generation (stable-diffusion.cpp); created on first use because userData is only known once the app is ready.
let ffmpegInstance;
const ffmpeg = () => ffmpegInstance ??= createFfmpeg({ dir: join(app.getPath('userData'), 'ffmpeg') });
let sdInstance;
const sd = () => sdInstance ??= createSd({ dir: join(app.getPath('userData'), 'stable-diffusion'), gpuQueue, gpuMemory: async () => await nvidiaMemory({ env: process.env, spawnProcess: spawn }) * 1024 * 1024 });
let pictureAiInstance;
const pictureAi = () => pictureAiInstance ??= createPictureAi({ dir: join(app.getPath('userData'), 'picture-ai') });
let local3dInstance;
// The first version of local 3D only had Hunyuan3D and kept it in `hunyuan3d`; carry that install over instead of downloading it again.
const local3dDir = () => {
  const dir = join(app.getPath('userData'), 'local3d');
  const old = join(app.getPath('userData'), 'hunyuan3d');
  if (!existsSync(dir) && existsSync(old)) try { renameSync(old, dir); } catch { /* the old folder stays unused */ }
  return dir;
};
const local3d = () => local3dInstance ??= createLocal3d({ dir: local3dDir(), gpuQueue });

if (!app.requestSingleInstanceLock()) app.quit();

/** Workspace folder: plain files an agent CLI can read. Override with LOMRA_WORKSPACE. */
function workspaceDir() {
  const dir = process.env.LOMRA_WORKSPACE ?? join(app.getPath('documents'), 'Lomra');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The key that encrypts saved API keys, itself protected by the OS (DPAPI / Keychain / libsecret). */
async function storageSecret() {
  if (!await safeStorage.isAsyncEncryptionAvailable()) return undefined;
  const file = join(app.getPath('userData'), 'storage-secret.bin');
  if (existsSync(file)) {
    try { return (await safeStorage.decryptStringAsync(readFileSync(file))).result; } catch { /* regenerate below */ }
  }
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, await safeStorage.encryptStringAsync(secret));
  return secret;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(`Next.js exited with code ${server.exitCode}`);
    try {
      if ((await fetch(`${url}/api/storage/settings`)).ok) return;
    } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Next.js did not start in time');
}

/** The packaged app runs the Next.js standalone server from resources; development runs `next dev`. */
function serverCommand(port) {
  if (app.isPackaged) {
    const cwd = join(process.resourcesPath, 'web');
    return { args: [join(cwd, 'server.js')], cwd, env: { PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' } };
  }
  return { args: [join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(port), '-H', '127.0.0.1'], cwd: frontend, env: {} };
}

/**
 * Local speech-to-text for voice input, so users need no external service. It listens on a free local port and
 * downloads its model into userData on first run. A WHISPER_URL set by the user is used instead.
 */
async function startWhisper() {
  if (process.env.WHISPER_URL) return process.env.WHISPER_URL;
  whisperPort = await freePort();
  spawnWhisper();
  return `http://127.0.0.1:${whisperPort}`;
}

const modelsDir = () => join(app.getPath('userData'), 'whisper-models');

function spawnWhisper() {
  whisper = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'whisper-worker.mjs')], {
    windowsHide: true,
    // The open stdin pipe tells the worker when this process is gone.
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LOMRA_WHISPER_PORT: String(whisperPort), LOMRA_WHISPER_CACHE: modelsDir() },
  });
  whisper.on('error', (error) => console.error('Speech recognition could not start', error));
}

async function startServer() {
  if (process.env.LOMRA_URL) return process.env.LOMRA_URL;
  const port = await freePort();
  whisperUrl = await startWhisper();
  const secret = await storageSecret();
  const command = serverCommand(port);
  server = spawn(process.execPath, command.args, {
    cwd: command.cwd,
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...command.env,
      ELECTRON_RUN_AS_NODE: '1',
      LOMRA_DATA_DIR: workspaceDir(),
      WHISPER_URL: whisperUrl,
      ...(secret ? { LOMRA_SECRET: secret } : {}),
    },
  });
  const url = `http://127.0.0.1:${port}`;
  await waitFor(url);
  return url;
}

function createWindow(url) {
  const origin = new URL(url).origin;
  appOrigin = origin;
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, backgroundColor: '#0a0a0a',
    ...(process.platform === 'win32' ? {
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#0a0a0a', height: 32 },
    } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs') },
  });
  mainWindow = window;
  window.once('closed', () => app.quit());
  window.once('ready-to-show', () => window.show());
  // Keep the window on the local app; send every other link to the system browser.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== origin) {
      event.preventDefault();
      if (/^https?:/.test(target)) void shell.openExternal(target);
    }
  });
  return window.loadURL(url).then(() => window);
}

// Tools the app offers to an agent (generate media, read the canvas selection) run in the window.
let toolPort;
const toolBridge = createToolBridge({
  dispatch(callId, name, args) {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The Lomra window is not open');
    mainWindow.webContents.send('agent:tool', { callId, name, args });
  },
});
const mcpServer = join(dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs');
const agentTools = {
  prepare(runId, id) {
    if (!toolPort || (id !== 'claude' && id !== 'codex')) return undefined;
    const token = toolBridge.issue();
    const config = toolConfig({ id, port: toolPort, token, runId, serverPath: mcpServer, execPath: process.execPath, dir: join(app.getPath('temp'), 'lomra-mcp') });
    return { args: config.args, dispose() { config.dispose(); toolBridge.revoke(token); } };
  },
};

const agents = createAgentSessions({
  pty,
  tools: agentTools,
  get cwd() { return workspaceDir(); },
  emit: (type, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`agent:${type}`, payload); },
});

// Handlers refuse any sender other than the app's own top-level page.
const trusted = (event) => isTrustedSender(event, appOrigin);
const imageRuns = new Map();
ipcMain.handle('agent:list', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.list(); });
ipcMain.handle('agent:models', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.models(id); });
ipcMain.handle('agent:accountEmail', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.accountEmail(id); });
ipcMain.handle('agent:hasCodexSubscription', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.hasCodexSubscription(); });
ipcMain.handle('agent:browserSignIn', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return signInChatGPT(); });
ipcMain.handle('agent:browserImage', async (event, id, input) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || imageRuns.has(id)) throw new Error('Invalid image run.');
  const controller = new AbortController();
  imageRuns.set(id, controller);
  try {
    if (!await agents.hasCodexSubscription()) throw new Error('Sign in to Codex with a ChatGPT subscription to use ChatGPT images.');
    return await generateBrowserImage(input, controller.signal, openChatGPTPage);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'ChatGPT image generation failed.' };
  } finally {
    imageRuns.delete(id);
  }
});
ipcMain.handle('agent:browserSignInGemini', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return signInGemini(); });
ipcMain.handle('agent:browserGemini', async (event, id, input) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || imageRuns.has(id)) throw new Error('Invalid Gemini run.');
  const controller = new AbortController();
  imageRuns.set(id, controller);
  try {
    return await generateGeminiMedia(input, controller.signal, openGeminiPage);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'Gemini generation failed.' };
  } finally {
    imageRuns.delete(id);
  }
});
ipcMain.on('agent:browserImage-cancel', (event, id) => { if (trusted(event)) imageRuns.get(id)?.abort(); });
// Voice input models. The app asks before downloading (components/prompt/speech-download.tsx).
const speechModel = (id) => speechModels.find((model) => model.id === (id ?? defaultSpeechModel));
// null when voice input uses an external Whisper (WHISPER_URL), which the app does not manage.
ipcMain.handle('speech:models', async (event) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  if (!whisper) return null;
  const { downloading = null } = await fetch(`${whisperUrl}/status`).then((response) => response.json(), () => ({}));
  return {
    downloading,
    models: speechModels.map(({ id, name, quality, note, bytes, default: recommended }) => ({
      id, name, quality, note, bytes, recommended: Boolean(recommended),
      installed: speechModelInstalled(modelsDir(), speechModel(id)),
    })),
  };
});
ipcMain.handle('speech:downloadModel', async (event, id) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  const model = speechModel(id);
  if (!whisper || !model) return false;
  await fetch(`${whisperUrl}/download?model=${model.id}`, { method: 'POST' });
  return true;
});
ipcMain.handle('speech:deleteModel', async (event, id) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  const model = speechModel(id);
  if (!whisper || !model) return false;
  // Stop the worker first so nothing holds the model files, then start a fresh one.
  const stopped = whisper.exitCode === null ? new Promise((resolve) => whisper.once('exit', resolve)) : undefined;
  whisper.kill();
  await stopped;
  rmSync(join(modelsDir(), model.repo), { recursive: true, force: true });
  spawnWhisper();
  return true;
});
// Local image generation. The app asks before downloading (components/sd-settings.tsx); the renderer only names a model and sends prompts, bounded settings and picture bytes (checked in sd-input.mjs), never a path or command.
ipcMain.handle('sd:status', async (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); await sd().probe(); return sd().status(); });
// `request` is a preset id, or `{ repo, file, family }` for a Hugging Face checkpoint; sd.mjs validates both.
ipcMain.handle('sd:download', (event, request) => { if (!trusted(event)) throw new Error('Untrusted sender'); return sd().download(request); });
const sdLookup = async (lookup) => { try { return { result: await lookup() }; } catch (cause) { return { error: cause instanceof Error ? cause.message : 'Could not reach Hugging Face.' }; } };
ipcMain.handle('sd:search', (event, query) => { if (!trusted(event)) throw new Error('Untrusted sender'); return sdLookup(() => sd().search(query)); });
ipcMain.handle('sd:files', (event, repo, file) => { if (!trusted(event)) throw new Error('Untrusted sender'); return sdLookup(() => sd().files(repo, file)); });
ipcMain.handle('sd:inspect', (event, repo, file) => { if (!trusted(event)) throw new Error('Untrusted sender'); return sdLookup(() => sd().inspect(repo, file)); });
const localLookup = async (action) => {
  try { return { result: await action() }; }
  catch (cause) { return { error: cause instanceof Error && !cause.code ? cause.message : 'Could not access the checkpoint.' }; }
};
let pickingCheckpoint = false;
ipcMain.handle('sd:pickLocal', (event, mode, id) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  return localLookup(async () => {
    if (pickingCheckpoint || !sd().supported) return null;
    const folder = mode === 'folder';
    if (!validLocalPick(mode, id) || (mode === 'locate' && !sd().canLocate(id))) throw new Error('Invalid checkpoint selection.');
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    pickingCheckpoint = true;
    try {
      const choice = await dialog.showOpenDialog(window, folder
        ? { title: 'Scan for Stable Diffusion checkpoints', properties: ['openDirectory'] }
        : { title: mode === 'locate' ? 'Locate checkpoint' : 'Add a model from this computer', properties: ['openFile'], filters: [{ name: 'Model checkpoints', extensions: ['safetensors', 'gguf'] }] });
      if (choice.canceled || !choice.filePaths[0] || event.sender.isDestroyed() || !trusted(event)) return null;
      return await sd().pickLocal(choice.filePaths[0], folder, id);
    } finally { pickingCheckpoint = false; }
  });
});
let addingCheckpoint = false;
ipcMain.handle('sd:addLocal', (event, id, family, downloadEngine) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  return localLookup(async () => {
    if (addingCheckpoint) throw new Error('Wait for the current checkpoint to finish.');
    addingCheckpoint = true;
    try { return await sd().addLocal(id, family, downloadEngine); }
    finally { addingCheckpoint = false; }
  });
});
ipcMain.handle('sd:cancelDownload', async (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); if (id === undefined || typeof id === 'string') await sd().cancelDownload(id); });
ipcMain.handle('sd:remove', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return typeof id === 'string' && sd().remove(id); });
ipcMain.handle('sd:setProfile', async (event, id, profileId) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  return typeof id === 'string' && typeof profileId === 'string' && await sd().setProfile(id, profileId);
});
ipcMain.handle('sd:generate', async (event, runId, input) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  try {
    return await sd().generate(runId, input, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('sd:progress', { runId, ...progress }); });
  } catch (cause) {
    return { error: cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Stopped.' };
  }
});
ipcMain.on('sd:cancel', (event, runId) => { if (trusted(event) && typeof runId === 'string') sd().cancel(runId); });

// Local background removal and upscaling (CPU ONNX). Downloads start only after the user agrees.
ipcMain.handle('picture:status', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return pictureAi().status(); });
ipcMain.handle('picture:download', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return typeof id === 'string' && pictureAi().download(id); });
ipcMain.handle('picture:cancelDownload', async (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); if (id === undefined || typeof id === 'string') await pictureAi().cancelDownload(id); });
ipcMain.handle('picture:remove', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return typeof id === 'string' && pictureAi().remove(id); });
ipcMain.handle('picture:run', async (event, runId, input) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  try {
    return await pictureAi().run(runId, input, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('picture:progress', { runId, ...progress }); });
  } catch (cause) {
    return { error: cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Stopped.' };
  }
});
ipcMain.on('picture:cancel', (event, runId) => { if (trusted(event) && typeof runId === 'string') pictureAi().cancel(runId); });

// Joining the clips of a storyboard into one video. The app asks before downloading ffmpeg; the renderer sends clip bytes only, never a path or a command.
ipcMain.handle('video:status', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return ffmpeg().status(); });
ipcMain.handle('video:download', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return ffmpeg().download(); });
ipcMain.handle('video:cancelDownload', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); ffmpeg().cancelDownload(); });
ipcMain.handle('video:remove', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return ffmpeg().remove(); });
ipcMain.handle('video:stitch', async (event, runId, input) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  try {
    return { video: await ffmpeg().stitch(runId, input, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('video:progress', { runId, ...progress }); }) };
  } catch (cause) {
    return { error: cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Stopped.' };
  }
});
ipcMain.on('video:cancel', (event, runId) => { if (trusted(event) && typeof runId === 'string') ffmpeg().cancel(runId); });
// Local 3D generation. The app asks before installing (components/local3d-settings.tsx); the renderer only names a model and passes a picture.
ipcMain.handle('local3d:status', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return local3d().status(); });
ipcMain.handle('local3d:install', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return typeof id === 'string' && local3d().install(id); });
ipcMain.handle('local3d:cancelInstall', async (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); if (id === undefined || typeof id === 'string') await local3d().cancelInstall(id); });
ipcMain.handle('local3d:remove', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return typeof id === 'string' && local3d().remove(id); });
ipcMain.handle('local3d:generate', async (event, runId, input) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  try {
    return { model: await local3d().generate(runId, input, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('local3d:progress', { runId, ...progress }); }) };
  } catch (cause) {
    return { error: cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Stopped.' };
  }
});
ipcMain.on('local3d:cancel', (event, runId) => { if (trusted(event) && typeof runId === 'string') local3d().cancel(runId); });
// Local models: the Ollama CLI is found and its server started here; models are managed over its HTTP API.
ipcMain.handle('ollama:status', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return ollama.status(); });
// The app asks the user in its own modal first (components/ollama-settings.tsx), like speech downloads.
ipcMain.handle('ollama:install', async (event) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  const result = await ollama.install();
  if (result === 'manual') await shell.openExternal('https://ollama.com/download');
  return result;
});
ipcMain.handle('ollama:uninstall', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return ollama.uninstall(); });
ipcMain.handle('ollama:start', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return ollama.start(); });
ipcMain.handle('agent:limits', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return id === 'codex' ? codexWindows() : id === 'claude' ? claudeLiveWindows() : []; });
ipcMain.handle('agent:stats', (event, id) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.stats(id); });
ipcMain.handle('agent:start', (event, id, cols, rows) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.start(id, cols, rows); });
ipcMain.on('agent:write', (event, id, data) => { if (trusted(event)) agents.write(id, data); });
ipcMain.on('agent:resize', (event, id, cols, rows) => { if (trusted(event)) agents.resize(id, cols, rows); });
ipcMain.handle('agent:chat', (event, runId, id, prompt, sessionId, model, effort) => { if (!trusted(event)) throw new Error('Untrusted sender'); agents.chat(runId, id, prompt, sessionId, model, effort); });
ipcMain.on('agent:chat-cancel', (event, runId) => { if (trusted(event)) agents.cancelChat(runId); });
ipcMain.on('agent:tool-result', (event, callId, result) => { if (trusted(event) && typeof callId === 'string') toolBridge.settle(callId, result); });
ipcMain.on('agent:kill', (event, id) => { if (trusted(event)) agents.kill(id); });
ipcMain.handle('app:version', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return app.getVersion(); });
ipcMain.handle('app:checkUpdate', (event, force) => { if (!trusted(event)) throw new Error('Untrusted sender'); return updates.check(Boolean(force)); });
ipcMain.handle('app:openRelease', async (event, url) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  if (!isReleaseUrl(url)) return false;
  await shell.openExternal(url);
  return true;
});
ipcMain.handle('app:installUpdate', async (event) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  if (updateController) return { ok: false, error: 'An update is already downloading.' };
  const controller = new AbortController();
  updateController = controller;
  try {
    const result = await updates.install({
      dir: join(app.getPath('temp'), 'lomra-update'),
      signal: controller.signal,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:updateProgress', progress);
      },
    });
    if (!result.ok) return result;
    updates.launch(result.path);
    if (updateController === controller) updateController = null;
    app.quit();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Update failed.' };
  } finally {
    if (updateController === controller) updateController = null;
  }
});
ipcMain.handle('app:cancelUpdate', (event) => {
  if (!trusted(event)) throw new Error('Untrusted sender');
  updateController?.abort();
});

/** Send one second of silence through the voice route; 200 means the bundled speech model loaded and ran. A missing model is downloaded without asking here. */
async function smokeVoice(url) {
  const wav = Buffer.alloc(44 + 32000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  for (let attempt = 0; attempt < 120; attempt++) {
    const body = new FormData();
    body.append('file', new File([wav], 'smoke.wav', { type: 'audio/wav' }));
    const { status } = await fetch(`${url}/api/transcriptions`, { method: 'POST', body });
    if (status === 409) await fetch(`${whisperUrl}/download?model=${defaultSpeechModel}`, { method: 'POST' }); // smoke only; users are asked first
    else if (status !== 503) return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return 503;
}

app.whenReady().then(async () => {
  try {
    toolPort = await toolBridge.listen();
    const url = await startServer();
    const window = await createWindow(url);
    if (smoke) {
      if (process.platform === 'win32') {
        const titleBarFits = await window.webContents.executeJavaScript(`(() => {
          const overlay = navigator.windowControlsOverlay;
          const canvasTop = document.querySelector('main')?.getBoundingClientRect().top;
          return overlay?.visible && canvasTop >= overlay.getTitlebarAreaRect().height;
        })()`);
        if (!titleBarFits) throw new Error('Window controls overlap the Lomra canvas');
      }
      const agent = await window.webContents.executeJavaScript(`(async () => {
        const api = window.lomra?.agent;
        if (!api) return 'no bridge';
        if (typeof await api.hasCodexSubscription() !== 'boolean' || typeof api.browserImage !== 'function' || typeof api.browserGemini !== 'function') throw new Error('Browser generation bridge unavailable');
        const list = await api.list();
        const modelCatalog = await api.models('claude');
        if (!modelCatalog.length) throw new Error('Agent model catalog unavailable');
        const first = list.find((item) => item.available);
        if (!first) return JSON.stringify(list);
        const output = new Promise((resolve) => { const off = api.onData((event) => { off(); resolve(event.data.length); }); setTimeout(() => resolve(0), 30000); });
        await api.start(first.id, 100, 30);
        const bytes = await output;
        api.kill(first.id);
        return JSON.stringify({ list, started: first.id, firstOutputBytes: bytes });
      })()`);
      console.log(`LOMRA_SMOKE agent=${agent}`);
      console.log(`LOMRA_SMOKE voice=${await smokeVoice(url)}`);
      console.log(`LOMRA_SMOKE ok title=${JSON.stringify(window.getTitle())} workspace=${workspaceDir()}`);
      app.quit();
    }
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

app.on('second-instance', () => {
  if (mainWindow?.isDestroyed()) return;
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  updateController?.abort();
  for (const controller of imageRuns.values()) controller.abort();
  agents.killAll();
  toolBridge.close();
  server?.kill();
  whisper?.kill();
  ollama.stop();
  sdInstance?.stop(); pictureAiInstance?.stop(); local3dInstance?.stop(); ffmpegInstance?.stop();
});
process.on('exit', () => { if (!quitting) { server?.kill(); whisper?.kill(); ollama.stop(); sdInstance?.stop(); pictureAiInstance?.stop(); local3dInstance?.stop(); ffmpegInstance?.stop(); } });

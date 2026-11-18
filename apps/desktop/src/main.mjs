import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import pty from '@lydell/node-pty';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSessions, isTrustedSender } from './agents.mjs';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend');
const smoke = process.env.LOMRA_SMOKE === '1';
let server;
let appOrigin;
let mainWindow;
let quitting = false;

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

async function startServer() {
  if (process.env.LOMRA_URL) return process.env.LOMRA_URL;
  const port = await freePort();
  const secret = await storageSecret();
  const command = serverCommand(port);
  server = spawn(process.execPath, command.args, {
    cwd: command.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...command.env,
      ELECTRON_RUN_AS_NODE: '1',
      LOMRA_DATA_DIR: workspaceDir(),
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs') },
  });
  mainWindow = window;
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

const agents = createAgentSessions({
  pty,
  get cwd() { return workspaceDir(); },
  emit: (type, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`agent:${type}`, payload); },
});

// Handlers refuse any sender other than the app's own top-level page.
const trusted = (event) => isTrustedSender(event, appOrigin);
ipcMain.handle('agent:list', (event) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.list(); });
ipcMain.handle('agent:start', (event, id, cols, rows) => { if (!trusted(event)) throw new Error('Untrusted sender'); return agents.start(id, cols, rows); });
ipcMain.on('agent:write', (event, id, data) => { if (trusted(event)) agents.write(id, data); });
ipcMain.on('agent:resize', (event, id, cols, rows) => { if (trusted(event)) agents.resize(id, cols, rows); });
ipcMain.on('agent:kill', (event, id) => { if (trusted(event)) agents.kill(id); });

app.whenReady().then(async () => {
  try {
    const url = await startServer();
    const window = await createWindow(url);
    if (smoke) {
      const agent = await window.webContents.executeJavaScript(`(async () => {
        const api = window.lomra?.agent;
        if (!api) return 'no bridge';
        const list = await api.list();
        const first = list.find((item) => item.available);
        if (!first) return JSON.stringify(list);
        const output = new Promise((resolve) => { const off = api.onData((event) => { off(); resolve(event.data.length); }); setTimeout(() => resolve(0), 30000); });
        await api.start(first.id, 100, 30);
        const bytes = await output;
        api.kill(first.id);
        return JSON.stringify({ list, started: first.id, firstOutputBytes: bytes });
      })()`);
      console.log(`LOMRA_SMOKE agent=${agent}`);
      console.log(`LOMRA_SMOKE ok title=${JSON.stringify(window.getTitle())} workspace=${workspaceDir()}`);
      app.quit();
    }
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window?.isMinimized()) window.restore();
  window?.focus();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  agents.killAll();
  server?.kill();
});
process.on('exit', () => { if (!quitting) server?.kill(); });

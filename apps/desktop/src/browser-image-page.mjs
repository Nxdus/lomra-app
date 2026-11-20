import { BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { sameUrl } from './browser-image.mjs';

// Debugging aid: LOMRA_SHOW_CHATGPT=1 keeps the browser window visible and leaves it open after the run.
const debug = process.env.LOMRA_SHOW_CHATGPT === '1';
const googleOrigins = ['https://accounts.google.com', 'https://accounts.youtube.com', 'https://myaccount.google.com'];

const sites = {
  chatgpt: {
    name: 'ChatGPT', home: 'https://chatgpt.com/', partition: 'persist:lomra-chatgpt', signInUrl: 'https://chatgpt.com/auth/login',
    composer: '#prompt-textarea',
    origins: ['https://auth.openai.com', ...googleOrigins, 'https://appleid.apple.com', 'https://login.microsoftonline.com', 'https://login.live.com'],
    // Google blocks sign-in from embedded browsers that announce themselves as Electron.
    spoofUserAgent: false,
  },
  gemini: {
    name: 'Gemini', // The control names are matched in English, so the page is pinned to English whatever the account language is.
    home: 'https://gemini.google.com/app?hl=en', partition: 'persist:lomra-gemini',
    signInUrl: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp%3Fhl%3Den',
    composer: 'rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"]',
    origins: googleOrigins, spoofUserAgent: true,
  },
};

function createBrowserSite(site) {
const { home, signInUrl } = site;
const homeOrigin = new URL(home).origin;
const signInOrigins = new Set([homeOrigin, ...site.origins]);
let signInWindow;

function createWindow() {
  const window = new BrowserWindow({
    width: 1100, height: 800, show: false, autoHideMenuBar: true,
    webPreferences: {
      partition: site.partition, contextIsolation: true, sandbox: true,
      nodeIntegration: false, backgroundThrottling: false,
    },
  });
  const contents = window.webContents;
  if (site.spoofUserAgent) contents.session.setUserAgent(contents.getUserAgent().replace(/\s(?:Electron|lomra)\/\S+/gi, ''), 'en-US,en');
  contents.session.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => {
    const origin = new URL(event.url).origin;
    if (origin !== homeOrigin && !(signInWindow === window && signInOrigins.has(origin))) event.preventDefault();
  });
  return window;
}

// Resolves true once the window shows a signed-in home page, false if it is closed or aborted first.
function waitForSignIn(window, signal) {
  return new Promise((resolve) => {
    const finish = (ok) => {
      clearInterval(poll);
      window.removeListener('closed', onClosed);
      signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onClosed = () => finish(false);
    const onAbort = () => {
      if (!window.isDestroyed()) window.destroy();
      finish(false);
    };
    const poll = setInterval(async () => {
      if (window.isDestroyed() || !sameUrl(window.webContents.getURL(), home)) return;
      const ready = await window.webContents.executeJavaScript(`(() => {
        const login = Array.from(document.querySelectorAll('button, a')).some(el => /^(Log in|Sign in)$/i.test(el.textContent.trim()));
        return !login && !!document.querySelector(${JSON.stringify(site.composer)});
      })()`, true).catch(() => false);
      if (ready) finish(true);
    }, 700);
    window.once('closed', onClosed);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Opens the sign-in window up front (when adding the model). Resolves true once ChatGPT is signed in,
// false if the window is closed first. The window stays hidden if the saved session is still valid.
async function signInSite() {
  if (signInWindow && !signInWindow.isDestroyed()) {
    signInWindow.show();
    return false;
  }
  const window = createWindow();
  signInWindow = window;
  window.once('closed', () => { if (signInWindow === window) signInWindow = undefined; });
  const reveal = setTimeout(() => { if (!window.isDestroyed()) window.show(); }, 2500);
  void window.loadURL(signInUrl).catch(() => { if (!window.isDestroyed()) window.destroy(); });
  try {
    return await waitForSignIn(window);
  } finally {
    clearTimeout(reveal);
    if (!window.isDestroyed()) window.destroy();
  }
}

async function open(signal) {
  const window = createWindow();
  const contents = window.webContents;
  const session = contents.session;
  const close = () => {
    signal.removeEventListener('abort', close);
    if (signInWindow !== window && !debug && !window.isDestroyed()) window.destroy();
  };
  signal.addEventListener('abort', close, { once: true });
  if (debug) window.showInactive();
  const protocol = (method, params) => {
    signal.throwIfAborted();
    return contents.debugger.sendCommand(method, params);
  };
  const guard = url => {
    signal.throwIfAborted();
    if (!sameUrl(contents.getURL(), url)) throw new Error(`The ${site.name} page navigated away from this request.`);
  };
  async function act(node, url, operation) {
    guard(url);
    const { object } = await protocol('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
    try {
      guard(url);
      const result = await protocol('Runtime.callFunctionOn', {
        objectId: object.objectId, functionDeclaration: `function () { ${operation} }`, userGesture: true,
      });
      if (result.exceptionDetails) throw new Error(`Could not use a ${site.name} control.`);
    } finally {
      if (!contents.isDestroyed()) await contents.debugger.sendCommand('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    }
  }
  const click = (node, url) => act(node, url, 'this.click()');
  try {
    signal.throwIfAborted();
    await window.loadURL(home);
    contents.debugger.attach();
  } catch (error) {
    close();
    throw error;
  }
  return {
    async state() {
      const url = contents.getURL();
      const { nodes } = await protocol('Accessibility.getFullAXTree');
      signal.throwIfAborted();
      const current = contents.getURL();
      return { url: current, nodes: sameUrl(current, url) ? nodes : [] };
    },
    click,
    // Empties the composer's text (attachments are separate) so a leftover draft never joins the prompt.
    async clear(url) {
      guard(url);
      await contents.executeJavaScript(`(() => {
        const editor = document.querySelector(${JSON.stringify(site.composer)});
        if (!editor) return;
        editor.focus();
        document.execCommand('selectAll');
        document.execCommand('delete');
      })()`, true);
      guard(url);
    },
    // Focuses the composer with the caret at the end, so text lands after any tool chip such as "Create image".
    // Looks the editor up again because choosing a tool can re-render it and stale the node from the snapshot.
    async fill(node, url, text) {
      if (signInWindow && !signInWindow.isDestroyed()) signInWindow.destroy();
      guard(url);
      const ready = await contents.executeJavaScript(`(() => {
        const editor = document.querySelector(${JSON.stringify(site.composer)});
        if (!editor) return false;
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      })()`, true);
      if (!ready) await act(node, url, 'this.focus()');
      guard(url);
      await protocol('Input.insertText', { text });
    },
    async upload(url, files) {
      // The file input is created lazily and its attributes change between ChatGPT releases: poll and fall back.
      const selectors = ['input[type="file"][multiple]:not([capture])', 'input[type="file"]:not([capture])'];
      for (let attempt = 0; attempt < 20; attempt++) {
        guard(url);
        const { root } = await protocol('DOM.getDocument');
        for (const selector of selectors) {
          const { nodeId } = await protocol('DOM.querySelector', { nodeId: root.nodeId, selector });
          if (!nodeId) continue;
          guard(url);
          await protocol('DOM.setFileInputFiles', { nodeId, files });
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error(`Could not find the ${site.name} reference upload control.`);
    },
    // For pages that create their file input only when the upload item is chosen. `open()` starts the upload; the files
    // go to the native chooser it triggers (intercepted) or to a file input that appears, and as a last resort are pasted.
    async chooseFiles(url, files, open) {
      guard(url);
      let chooser;
      const onMessage = (_event, method, params) => { if (method === 'Page.fileChooserOpened') chooser = params; };
      contents.debugger.on('message', onMessage);
      try {
        await protocol('Page.enable');
        await protocol('Page.setInterceptFileChooserDialog', { enabled: true });
        await open();
        for (let attempt = 0; attempt < 16; attempt++) {
          guard(url);
          if (chooser) {
            await protocol('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files });
            return;
          }
          const { result } = await protocol('Runtime.evaluate', { expression: "document.querySelector('input[type=\"file\"]:not([capture])')" });
          if (result.objectId) {
            await protocol('DOM.setFileInputFiles', { objectId: result.objectId, files });
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const encoded = await Promise.all(files.map(async file => ({
          name: basename(file), type: `image/${extname(file).slice(1).replace('jpg', 'jpeg')}`, data: (await readFile(file)).toString('base64'),
        })));
        guard(url);
        const pasted = await contents.executeJavaScript(`(() => {
          const editor = document.querySelector(${JSON.stringify(site.composer)});
          if (!editor) return false;
          const transfer = new DataTransfer();
          for (const { name, type, data } of ${JSON.stringify(encoded)}) {
            const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
            transfer.items.add(new File([bytes], name, { type }));
          }
          editor.focus();
          return editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })) === false;
        })()`, true);
        if (!pasted) throw new Error(`${site.name} did not open its file picker.`);
      } finally {
        contents.debugger.removeListener('message', onMessage);
        if (!contents.isDestroyed()) await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      }
    },
    async responseText(url) {
      guard(url);
      const text = await contents.executeJavaScript("Array.from(document.querySelectorAll('model-response')).at(-1)?.innerText?.trim() ?? ''");
      guard(url);
      return text;
    },
    // Fallback to the download button: reads the generated image or video the page shows, as base64.
    async fetchMedia(url, kind, limit) {
      guard(url);
      const data = await contents.executeJavaScript(`(async () => {
        const kind = ${JSON.stringify(kind)};
        let source;
        if (kind === 'video') {
          const video = Array.from(document.querySelectorAll('video')).find(item => item.currentSrc || item.src);
          source = video && (video.currentSrc || video.src);
        } else {
          source = Array.from(document.images)
            .filter(image => image.complete && image.naturalWidth >= 256 && /^(https:|blob:)/.test(image.src))
            .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0]?.src;
        }
        if (!source) return null;
        const response = await fetch(source, { credentials: 'include' });
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob.type.startsWith(kind + '/') || blob.size > ${Number(limit)}) return null;
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })()`, true);
      guard(url);
      return typeof data === 'string' ? data : undefined;
    },
    download(node, url, output, timeout = 45_000) {
      return new Promise((resolve, reject) => {
        let item;
        const finish = (error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', stop);
          session.removeListener('will-download', onDownload);
          if (error) reject(error);
          else resolve();
        };
        const stop = () => {
          if (!contents.isDestroyed()) item?.cancel();
          finish(signal.reason ?? new Error(`${site.name} download timed out.`));
        };
        const onDownload = (_event, download, source) => {
          if (source !== contents || item) return;
          item = download;
          item.setSavePath(output);
          item.once('done', (_event, status) => finish(status === 'completed' ? undefined : new Error(`Could not download the original ${site.name} file.`)));
        };
        const timer = setTimeout(stop, timeout);
        session.on('will-download', onDownload);
        signal.addEventListener('abort', stop, { once: true });
        void click(node, url).catch(finish);
      });
    },
    // Fallback to the download button: fetches the largest image on the page with the signed-in session, as base64.
    async fetchImage(url, limit) {
      guard(url);
      const data = await contents.executeJavaScript(`(async () => {
        const images = Array.from(document.images)
          .filter(image => image.complete && image.naturalWidth >= 256 && image.src.startsWith('https:'))
          .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
        if (!images.length) return null;
        const response = await fetch(images[0].src, { credentials: 'include' });
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size > ${Number(limit)}) return null;
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })()`, true);
      guard(url);
      return typeof data === 'string' ? data : undefined;
    },
    async openArchiveMenu(url) {
      guard(url);
      return contents.executeJavaScript(`(() => {
        if (location.href !== ${JSON.stringify(url)}) return false;
        const link = Array.from(document.querySelectorAll('a[href]')).find(a => a.href === location.href);
        const button = (link?.closest('[role="group"]') ?? link?.parentElement)?.querySelector('button[aria-label="Chat actions"]');
        if (!button) return false;
        button.click();
        return true;
      })()`, true);
    },
    // Shows the sign-in window and waits. On success the page returns to ChatGPT, ready to continue.
    async signIn() {
      signal.throwIfAborted();
      if (signInWindow && !signInWindow.isDestroyed()) {
        signInWindow.show();
        return false;
      }
      signInWindow = window;
      window.once('closed', () => { if (signInWindow === window) signInWindow = undefined; });
      contents.debugger.detach();
      void window.loadURL(signInUrl).catch(() => {});
      window.show();
      if (!await waitForSignIn(window, signal)) return false;
      signInWindow = undefined;
      if (!debug) window.hide();
      await window.loadURL(home);
      contents.debugger.attach();
      return true;
    },
    close,
  };
}
return { signIn: signInSite, open };
}

const chatgpt = createBrowserSite(sites.chatgpt);
const gemini = createBrowserSite(sites.gemini);
export const signInChatGPT = chatgpt.signIn;
export const openChatGPTPage = chatgpt.open;
export const signInGemini = gemini.signIn;
export const openGeminiPage = gemini.open;

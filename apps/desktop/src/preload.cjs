const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('lomra', {
  agent: {
    list: () => ipcRenderer.invoke('agent:list'),
    models: (id) => ipcRenderer.invoke('agent:models', id),
    accountEmail: (id) => ipcRenderer.invoke('agent:accountEmail', id),
    hasCodexSubscription: () => ipcRenderer.invoke('agent:hasCodexSubscription'),
    browserSignIn: () => ipcRenderer.invoke('agent:browserSignIn'),
    browserImage: (id, input) => ipcRenderer.invoke('agent:browserImage', id, input),
    browserSignInGemini: () => ipcRenderer.invoke('agent:browserSignInGemini'),
    browserGemini: (id, input) => ipcRenderer.invoke('agent:browserGemini', id, input),
    cancelBrowserImage: (id) => ipcRenderer.send('agent:browserImage-cancel', id),
    limits: (id) => ipcRenderer.invoke('agent:limits', id),
    stats: (id) => ipcRenderer.invoke('agent:stats', id),
    start: (id, cols, rows) => ipcRenderer.invoke('agent:start', id, cols, rows),
    write: (id, data) => ipcRenderer.send('agent:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('agent:resize', id, cols, rows),
    chat: (runId, id, prompt, sessionId, model, effort) => ipcRenderer.invoke('agent:chat', runId, id, prompt, sessionId, model, effort),
    cancelChat: (runId) => ipcRenderer.send('agent:chat-cancel', runId),
    onChat: (callback) => subscribe('agent:chat', callback),
    onTool: (callback) => subscribe('agent:tool', callback),
    toolResult: (callId, result) => ipcRenderer.send('agent:tool-result', callId, result),
    kill: (id) => ipcRenderer.send('agent:kill', id),
    onData: (callback) => subscribe('agent:data', callback),
    onExit: (callback) => subscribe('agent:exit', callback),
  },
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    start: () => ipcRenderer.invoke('ollama:start'),
    install: () => ipcRenderer.invoke('ollama:install'),
    uninstall: () => ipcRenderer.invoke('ollama:uninstall'),
  },
  sd: {
    status: () => ipcRenderer.invoke('sd:status'),
    download: (request) => ipcRenderer.invoke('sd:download', request),
    search: (query) => ipcRenderer.invoke('sd:search', query),
    files: (repo) => ipcRenderer.invoke('sd:files', repo),
    cancelDownload: () => ipcRenderer.invoke('sd:cancelDownload'),
    remove: (id) => ipcRenderer.invoke('sd:remove', id),
    generate: (runId, input) => ipcRenderer.invoke('sd:generate', runId, input),
    cancel: (runId) => ipcRenderer.send('sd:cancel', runId),
    onProgress: (callback) => subscribe('sd:progress', callback),
  },
  video: {
    status: () => ipcRenderer.invoke('video:status'),
    download: () => ipcRenderer.invoke('video:download'),
    cancelDownload: () => ipcRenderer.invoke('video:cancelDownload'),
    remove: () => ipcRenderer.invoke('video:remove'),
    stitch: (runId, input) => ipcRenderer.invoke('video:stitch', runId, input),
    cancel: (runId) => ipcRenderer.send('video:cancel', runId),
    onProgress: (callback) => subscribe('video:progress', callback),
  },
  local3d: {
    status: () => ipcRenderer.invoke('local3d:status'),
    install: (id) => ipcRenderer.invoke('local3d:install', id),
    cancelInstall: () => ipcRenderer.invoke('local3d:cancelInstall'),
    remove: (id) => ipcRenderer.invoke('local3d:remove', id),
    generate: (runId, input) => ipcRenderer.invoke('local3d:generate', runId, input),
    cancel: (runId) => ipcRenderer.send('local3d:cancel', runId),
    onProgress: (callback) => subscribe('local3d:progress', callback),
  },
  speech: {
    models: () => ipcRenderer.invoke('speech:models'),
    downloadModel: (id) => ipcRenderer.invoke('speech:downloadModel', id),
    deleteModel: (id) => ipcRenderer.invoke('speech:deleteModel', id),
  },
});

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('lomra', {
  agent: {
    list: () => ipcRenderer.invoke('agent:list'),
    start: (id, cols, rows) => ipcRenderer.invoke('agent:start', id, cols, rows),
    write: (id, data) => ipcRenderer.send('agent:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('agent:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('agent:kill', id),
    onData: (callback) => subscribe('agent:data', callback),
    onExit: (callback) => subscribe('agent:exit', callback),
  },
});

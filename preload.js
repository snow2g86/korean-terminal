const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminal', {
  // PTY
  create: (opts) => ipcRenderer.invoke('pty:create', opts),
  write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  destroy: (id) => ipcRenderer.send('pty:destroy', { id }),
  onData: (callback) => {
    ipcRenderer.on('pty:data', (event, payload) => callback(payload));
  },
  onExit: (callback) => {
    ipcRenderer.on('pty:exit', (event, payload) => callback(payload));
  },

  // System Info
  getSysinfo: () => ipcRenderer.invoke('sysinfo'),

  // Filesystem
  listDir: (dir, filter, onlyDirs) => ipcRenderer.invoke('fs:listDir', { dir, filter, onlyDirs }),
  getCwd: (id) => ipcRenderer.invoke('pty:getCwd', { id }),

  // IME
  getInputSource: () => ipcRenderer.invoke('ime:getSource'),

  // Clipboard
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => ipcRenderer.send('clipboard:write', text),

  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.send('settings:save', data),

});

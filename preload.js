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

  // Settings (layout)
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.send('settings:save', data),

  // Preferences (user config)
  loadPrefs: () => ipcRenderer.invoke('prefs:load'),
  savePrefs: (data) => ipcRenderer.send('prefs:save', data),

  // File operations
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, content) => ipcRenderer.send('fs:writeFile', { filePath, content }),
  findFiles: (dir, pattern) => ipcRenderer.invoke('fs:findFiles', { dir, pattern }),

  // File dialogs
  openFile: (opts) => ipcRenderer.invoke('dialog:openFile', opts || {}),
  saveFile: (content, defaultName) => ipcRenderer.invoke('dialog:saveFile', { content, defaultName }),

});

/* =============================================================
   Tauri Bridge — Electron의 preload.js를 대체
   window.terminal API를 Tauri invoke/event로 구현
   ============================================================= */

(function() {
  var invoke = window.__TAURI__.core.invoke;
  var listen = window.__TAURI__.event.listen;

  // PTY data/exit 콜백 저장
  var _dataCallbacks = [];
  var _exitCallbacks = [];

  // Tauri 이벤트 리스너 등록
  listen('pty:data', function(event) {
    var payload = event.payload;
    for (var i = 0; i < _dataCallbacks.length; i++) {
      _dataCallbacks[i](payload);
    }
  });

  listen('pty:exit', function(event) {
    var payload = event.payload;
    for (var i = 0; i < _exitCallbacks.length; i++) {
      _exitCallbacks[i](payload);
    }
  });

  window.terminal = {
    // PTY
    create: function(opts) {
      return invoke('pty_create', { opts: opts });
    },
    write: function(id, data) {
      invoke('pty_write', { id: id, data: data });
    },
    resize: function(id, cols, rows) {
      invoke('pty_resize', { id: id, cols: cols, rows: rows });
    },
    destroy: function(id) {
      invoke('pty_destroy', { id: id });
    },
    onData: function(callback) {
      _dataCallbacks.push(callback);
    },
    onExit: function(callback) {
      _exitCallbacks.push(callback);
    },

    // System Info
    getSysinfo: function() {
      return invoke('get_sysinfo');
    },

    // Filesystem
    listDir: function(dir, filter, onlyDirs) {
      return invoke('list_dir', { dir: dir || null, filter: filter || null, onlyDirs: onlyDirs || false });
    },
    getCwd: function(id) {
      return invoke('pty_get_cwd', { id: id });
    },

    // IME
    getInputSource: function() {
      return invoke('get_input_source');
    },

    // Clipboard (Tauri plugin)
    clipboardRead: function() {
      var cm = window.__TAURI_PLUGIN_CLIPBOARD_MANAGER__ || (window.__TAURI__ && window.__TAURI__.clipboardManager);
      if (cm) return cm.readText();
      return Promise.resolve('');
    },
    clipboardWrite: function(text) {
      var cm = window.__TAURI_PLUGIN_CLIPBOARD_MANAGER__ || (window.__TAURI__ && window.__TAURI__.clipboardManager);
      if (cm) return cm.writeText(text);
      return Promise.resolve();
    },

    // Settings (layout)
    loadSettings: function() {
      return invoke('load_settings');
    },
    saveSettings: function(data) {
      invoke('save_settings', { data: data });
    },

    // Preferences
    loadPrefs: function() {
      return invoke('load_prefs');
    },
    savePrefs: function(data) {
      invoke('save_prefs', { data: data });
    },

    // File operations
    readFile: function(filePath) {
      return invoke('read_file', { filePath: filePath });
    },
    writeFile: function(filePath, content) {
      invoke('write_file', { filePath: filePath, content: content });
    },
    findFiles: function(dir, pattern) {
      return invoke('find_files', { dir: dir, pattern: pattern });
    },

    // File dialogs (Tauri dialog plugin)
    openFile: async function(opts) {
      try {
        var dlg = window.__TAURI_PLUGIN_DIALOG__ || (window.__TAURI__ && window.__TAURI__.dialog);
        if (!dlg) return null;
        var result = await dlg.open({
          filters: (opts && opts.filters) || [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!result) return null;
        return await invoke('read_file', { filePath: result });
      } catch(e) { return null; }
    },
    saveFile: async function(content, defaultName) {
      try {
        var dlg = window.__TAURI_PLUGIN_DIALOG__ || (window.__TAURI__ && window.__TAURI__.dialog);
        if (!dlg) return false;
        var path = await dlg.save({
          defaultPath: defaultName || 'theme.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return false;
        return await invoke('write_file', { filePath: path, content: content });
      } catch(e) { return false; }
    },
  };
})();

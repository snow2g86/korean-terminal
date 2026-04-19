/* =============================================================
   Tauri Bridge — Electron의 preload.js를 대체
   window.terminal API를 Tauri invoke/event로 구현
   ============================================================= */

(function() {
  if (!window.__TAURI__) {
    console.error('[tauri-bridge] window.__TAURI__ 미정의 — Tauri 컨텍스트에서 실행되지 않음');
    return;
  }
  var invoke = window.__TAURI__.core.invoke;
  var listen = window.__TAURI__.event.listen;

  // pty id → 콜백 Map — pane 파괴 시 off()로 해제 가능
  // 배열 누적 대신 id별 1개 콜백만 유지하여 메모리 누수 방지
  var _dataHandlers = new Map();
  var _exitHandlers = new Map();

  // 전역 이벤트 리스너는 1회만 등록 (앱 생애주기 동안)
  listen('pty:data', function(event) {
    var payload = event.payload;
    var h = _dataHandlers.get(payload.id);
    if (h) {
      try { h(payload); }
      catch (e) { console.error('[pty:data] 콜백 오류', e); }
    }
  }).catch(function(e) { console.error('[pty:data] listen 실패', e); });

  listen('pty:exit', function(event) {
    var payload = event.payload;
    var h = _exitHandlers.get(payload.id);
    if (h) {
      try { h(payload); }
      catch (e) { console.error('[pty:exit] 콜백 오류', e); }
    }
  }).catch(function(e) { console.error('[pty:exit] listen 실패', e); });

  window.terminal = {
    // PTY
    create: function(opts) {
      return invoke('pty_create', { opts: opts });
    },
    write: function(id, data) {
      return invoke('pty_write', { id: id, data: data })
        .catch(function(e) { console.error('[pty_write]', e); });
    },
    resize: function(id, cols, rows) {
      return invoke('pty_resize', { id: id, cols: cols, rows: rows })
        .catch(function(e) { console.error('[pty_resize]', e); });
    },
    destroy: function(id) {
      // 핸들러 먼저 해제 → Rust에 kill 신호
      _dataHandlers.delete(id);
      _exitHandlers.delete(id);
      return invoke('pty_destroy', { id: id })
        .catch(function(e) { console.error('[pty_destroy]', e); });
    },
    // pane 단위 콜백 등록 — 기존 콜백이 있으면 덮어씀
    onData: function(id, callback) {
      if (typeof id === 'function') {
        // 구 API 호환: onData(callback) — 즉시 경고
        console.warn('[tauri-bridge] onData(callback) 구 API, onData(id, callback) 사용 권장');
        return;
      }
      _dataHandlers.set(id, callback);
    },
    onExit: function(id, callback) {
      if (typeof id === 'function') {
        console.warn('[tauri-bridge] onExit(callback) 구 API, onExit(id, callback) 사용 권장');
        return;
      }
      _exitHandlers.set(id, callback);
    },
    offData: function(id) { _dataHandlers.delete(id); },
    offExit: function(id) { _exitHandlers.delete(id); },

    // System Info
    getSysinfo: function() {
      return invoke('get_sysinfo');
    },

    // Filesystem
    listDir: function(dir, filter, onlyDirs) {
      return invoke('list_dir', {
        dir: dir || null,
        filter: filter || null,
        onlyDirs: onlyDirs || false,
      });
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
      var cm = window.__TAURI_PLUGIN_CLIPBOARD_MANAGER__
        || (window.__TAURI__ && window.__TAURI__.clipboardManager);
      if (cm && cm.readText) return cm.readText();
      return Promise.resolve('');
    },
    clipboardWrite: function(text) {
      var cm = window.__TAURI_PLUGIN_CLIPBOARD_MANAGER__
        || (window.__TAURI__ && window.__TAURI__.clipboardManager);
      if (cm && cm.writeText) return cm.writeText(text);
      return Promise.resolve();
    },

    // Settings (layout) — save가 이제 Result를 반환
    loadSettings: function() {
      return invoke('load_settings')
        .catch(function(e) { console.error('[load_settings]', e); return null; });
    },
    saveSettings: function(data) {
      return invoke('save_settings', { data: data })
        .catch(function(e) { console.error('[save_settings]', e); });
    },

    // Preferences
    loadPrefs: function() {
      return invoke('load_prefs')
        .catch(function(e) { console.error('[load_prefs]', e); return null; });
    },
    savePrefs: function(data) {
      return invoke('save_prefs', { data: data })
        .catch(function(e) { console.error('[save_prefs]', e); });
    },

    // File operations
    readFile: function(filePath) {
      return invoke('read_file', { filePath: filePath });
    },
    writeFile: function(filePath, content) {
      return invoke('write_file', { filePath: filePath, content: content });
    },
    findFiles: function(dir, pattern) {
      return invoke('find_files', { dir: dir, pattern: pattern });
    },

    // File dialogs (Tauri dialog plugin)
    openFile: async function(opts) {
      try {
        var dlg = window.__TAURI_PLUGIN_DIALOG__
          || (window.__TAURI__ && window.__TAURI__.dialog);
        if (!dlg) return null;
        var result = await dlg.open({
          filters: (opts && opts.filters) || [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!result) return null;
        return await invoke('read_file', { filePath: result });
      } catch (e) {
        console.error('[openFile]', e);
        return null;
      }
    },
    saveFile: async function(content, defaultName) {
      try {
        var dlg = window.__TAURI_PLUGIN_DIALOG__
          || (window.__TAURI__ && window.__TAURI__.dialog);
        if (!dlg) return false;
        var path = await dlg.save({
          defaultPath: defaultName || 'theme.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return false;
        return await invoke('write_file', { filePath: path, content: content });
      } catch (e) {
        console.error('[saveFile]', e);
        return false;
      }
    },
  };
})();

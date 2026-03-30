/* =============================================================
   패널 생성 및 PTY 연결
   ============================================================= */

function createTerminalPane(tabId) {
  var id = ++paneCounter;

  var el = document.createElement('div');
  el.className = 'pane-leaf focused';
  el.dataset.paneId = id;

  // Header
  var header = document.createElement('div');
  header.className = 'pane-header';
  var headerLeft = document.createElement('div');
  headerLeft.className = 'pane-header-left';
  var icon = document.createElement('span');
  icon.className = 'pane-type-icon';
  icon.textContent = '>_';
  headerLeft.appendChild(icon);

  var paneName = document.createElement('span');
  paneName.className = 'pane-name';
  paneName.textContent = '\ud130\ubbf8\ub110 ' + id;
  paneName.title = '\ub354\ube14\ud074\ub9ad\ud558\uc5ec \uc774\ub984 \ubcc0\uacbd';
  paneName.addEventListener('dblclick', function(e) { e.stopPropagation(); startEditPaneName(pane); });
  headerLeft.appendChild(paneName);

  var headerRight = document.createElement('div');
  headerRight.className = 'pane-header-right';
  headerRight.appendChild(createIconBtn('rows-2', '\uac00\ub85c \ubd84\ud560', function() { splitPane(id, 'h'); }));
  headerRight.appendChild(createIconBtn('columns-2', '\uc138\ub85c \ubd84\ud560', function() { splitPane(id, 'v'); }));
  headerRight.appendChild(createIconBtn('globe', '\ube0c\ub77c\uc6b0\uc800\ub85c \uc804\ud658', function() { togglePaneType(id); }));
  headerRight.appendChild(createIconBtn('x', '\ud328\ub110 \ub2eb\uae30', function() { closePane(id); }));
  header.appendChild(headerLeft);
  header.appendChild(headerRight);
  el.appendChild(header);

  // Terminal area
  var area = document.createElement('div');
  area.className = 'pane-terminal-area';
  el.appendChild(area);

  // xterm.js
  var term = new XTerminal({
    fontFamily: "'Noto Sans Mono', 'D2Coding', 'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 14,
    theme: {
      background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff',
      selectionBackground: '#264f78',
      black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
      brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
      brightCyan: '#56d364', brightWhite: '#f0f6fc',
    },
    scrollback: 10000,
    cursorBlink: true,
    allowProposedApi: true,
  });
  var fitAddon = new XFitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new XWebLinksAddon());

  // 활동 알림 뱃지
  var notifyDot = document.createElement('span');
  notifyDot.className = 'pane-notify-dot';
  notifyDot.style.display = 'none';
  headerLeft.appendChild(notifyDot);

  var pane = {
    paneId: id, type: 'leaf', paneType: 'terminal', tabId: tabId,
    el: el, headerEl: header, areaEl: area,
    nameEl: paneName, paneName: '\ud130\ubbf8\ub110 ' + id,
    term: term, fitAddon: fitAddon,
    ptyId: null, parent: null,
    notifyDot: notifyDot, hasNotify: false,
  };

  allPanes.set(id, pane);
  setTimeout(function() { if (window.lucide) lucide.createIcons({ node: el }); }, 0);
  return pane;
}

async function connectPane(pane) {
  if (pane.paneType !== 'terminal') return;

  pane.term.open(pane.areaEl);
  pane.fitAddon.fit();

  if (pane.term.textarea) {
    pane.term.textarea.addEventListener('focus', function() { focusPane(pane.paneId); });
  }

  // WKWebView 한글 IME 패치 — insertReplacementText 가로채기
  var imeHandle = WkHangulIme.attach(pane.term, function(text) {
    if (pane.ptyId) window.terminal.write(pane.ptyId, text);
  });

  var cols = pane.term.cols;
  var rows = pane.term.rows;
  var ptyId = await window.terminal.create({ cols: cols, rows: rows, cwd: pane._restoreCwd || '' });
  pane.ptyId = ptyId;

  // PTY output -> xterm + 활동 알림 (출력 완료 감지)
  pane._notifyTimer = null;
  window.terminal.onData(function(payload) {
    if (payload.id === pane.ptyId) {
      pane.term.write(payload.data);
      if (focusedPaneId !== pane.paneId) {
        clearTimeout(pane._notifyTimer);
        pane._notifyTimer = setTimeout(function() {
          if (focusedPaneId !== pane.paneId) showPaneNotify(pane);
        }, 800);
      }
    }
  });

  // PTY exit
  window.terminal.onExit(function(payload) {
    if (payload.id === pane.ptyId) {
      pane.term.write('\r\n[\ud504\ub85c\uc138\uc2a4 \uc885\ub8cc]\r\n');
      pane.ptyId = null;
      updateTabStatusDot(pane.tabId);
    }
  });

  // xterm input -> PTY (cd autocomplete)
  var inputBuf = '';
  var dirPopupEl = document.createElement('div');
  dirPopupEl.className = 'dir-popup';
  dirPopupEl.style.display = 'none';
  pane.areaEl.appendChild(dirPopupEl);
  dirPopupEl._entries = [];
  dirPopupEl._selectedIdx = 0;

  pane.term.onData(function(data) {
    if (!pane.ptyId) return;

    // WKWebView IME: 이미 flush된 한글 누출 차단
    if (imeHandle && imeHandle.shouldSkip(data)) return;

    // 디렉토리 자동완성 팝업 처리
    if (dirPopupEl.style.display !== 'none' && dirPopupEl._entries.length > 0) {
      if (data === '\x1b[A') { dirPopupEl._selectedIdx = Math.max(0, dirPopupEl._selectedIdx - 1); renderDirPopup(dirPopupEl, dirPopupEl._entries, dirPopupEl._selectedIdx); return; }
      if (data === '\x1b[B') { dirPopupEl._selectedIdx = Math.min(dirPopupEl._entries.length - 1, dirPopupEl._selectedIdx + 1); renderDirPopup(dirPopupEl, dirPopupEl._entries, dirPopupEl._selectedIdx); return; }
      if (data === '\t' || data === '\r') {
        var sel = dirPopupEl._entries[dirPopupEl._selectedIdx];
        if (sel) {
          var partial = inputBuf.replace(/^cd\s+/, '');
          var lastSlash = partial.lastIndexOf('/');
          var filterPart = lastSlash !== -1 ? partial.substring(lastSlash + 1) : partial;
          var dirPrefix = lastSlash !== -1 ? partial.substring(0, lastSlash + 1) : '';
          for (var bi = 0; bi < filterPart.length; bi++) window.terminal.write(pane.ptyId, '\x7f');
          var insert = sel.name + (sel.isDir ? '/' : '');
          window.terminal.write(pane.ptyId, insert);
          inputBuf = 'cd ' + dirPrefix + insert;
          hideDirPopup();
          if (data === '\r') { window.terminal.write(pane.ptyId, '\r'); inputBuf = ''; }
        }
        return;
      }
      if (data === '\x1b' || data === '\x03') { hideDirPopup(); inputBuf = ''; window.terminal.write(pane.ptyId, data); return; }
    }

    // IME 조합 중이면 PTY 전송 차단
    if (imeHandle && imeHandle.isComposing() && data.length === 1 && WkHangulIme.isHangul(data)) return;

    // 일반 입력
    if (data === '\r') { if (imeHandle) imeHandle.flush(); inputBuf = ''; hideDirPopup(); }
    else if (data === '\x7f') { inputBuf = inputBuf.slice(0, -1); }
    else if (data === '\x03') { inputBuf = ''; hideDirPopup(); }
    else if (data.charCodeAt(0) >= 32 && !data.startsWith('\x1b')) { inputBuf += data; }
    else { inputBuf = ''; hideDirPopup(); }

    window.terminal.write(pane.ptyId, data);

    if (inputBuf.match(/^cd\s+/)) {
      showDirAutocomplete(pane, inputBuf.replace(/^cd\s+/, ''), dirPopupEl);
    } else {
      hideDirPopup();
    }
  });

  function hideDirPopup() {
    dirPopupEl.style.display = 'none';
    dirPopupEl._entries = [];
    dirPopupEl._selectedIdx = 0;
  }

  pane.term.onResize(function(size) {
    if (pane.ptyId) window.terminal.resize(pane.ptyId, size.cols, size.rows);
  });

  delete pane._restoreCwd;

  updateTabStatusDot(pane.tabId);
  setStatus(true);
  pane.term.focus();
}

function focusPane(paneId) {
  if (focusedPaneId === paneId) return;
  if (focusedPaneId) {
    var old = allPanes.get(focusedPaneId);
    if (old && old.el) {
      old.el.classList.remove('focused');
      // 비포커스 헤더 색상 복원
      if (old.headerEl) { old.headerEl.style.background = ''; old.headerEl.style.color = ''; }
    }
  }
  focusedPaneId = paneId;
  var pane = allPanes.get(paneId);
  if (pane && pane.el) {
    pane.el.classList.add('focused');
    // 포커스 헤더에 테마 accent 적용
    if (pane.headerEl) {
      var accent = getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim() || '#58a6ff';
      pane.headerEl.style.background = accent;
      pane.headerEl.style.color = '#fff';
    }
    setStatus(pane.paneType === 'terminal' ? !!pane.ptyId : true);
    if (pane.term) pane.term.focus();
    clearPaneNotify(pane);
  }
}

function destroyPaneResources(pane) {
  if (pane.ptyId) { window.terminal.destroy(pane.ptyId); pane.ptyId = null; }
  if (pane.term) { pane.term.dispose(); pane.term = null; }
  allPanes.delete(pane.paneId);
}

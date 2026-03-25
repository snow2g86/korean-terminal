/* =============================================================
   우클릭 컨텍스트 메뉴
   ============================================================= */

var ctxMenuEl = null;

function initContextMenu() {
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.className = 'ctx-menu';
  ctxMenuEl.style.display = 'none';
  document.body.appendChild(ctxMenuEl);

  document.addEventListener('click', function() { hideContextMenu(); });
  document.addEventListener('contextmenu', function(e) {
    var paneEl = e.target.closest('.pane-leaf');
    if (!paneEl) { hideContextMenu(); return; }

    e.preventDefault();
    var paneId = parseInt(paneEl.dataset.paneId);
    var pane = allPanes.get(paneId);
    if (!pane) return;

    showContextMenu(e.clientX, e.clientY, pane);
  });
}

function showContextMenu(x, y, pane) {
  var items = [];
  var hasSelection = pane.term && pane.term.hasSelection();

  items.push({ label: '복사', icon: 'copy', disabled: !hasSelection, action: function() {
    if (pane.term && pane.term.hasSelection()) {
      window.terminal.clipboardWrite(pane.term.getSelection());
    }
  }});
  items.push({ label: '붙여넣기', icon: 'clipboard-paste', action: async function() {
    if (pane.ptyId) {
      var text = await window.terminal.clipboardRead();
      if (text) window.terminal.write(pane.ptyId, text);
    }
  }});
  items.push({ type: 'separator' });
  items.push({ label: '터미널 지우기', icon: 'eraser', action: function() {
    if (pane.term) pane.term.clear();
  }});
  items.push({ type: 'separator' });
  items.push({ label: '가로 분할', icon: 'rows-2', action: function() { splitPane(pane.paneId, 'h'); }});
  items.push({ label: '세로 분할', icon: 'columns-2', action: function() { splitPane(pane.paneId, 'v'); }});
  items.push({ type: 'separator' });
  items.push({ label: '패널 닫기', icon: 'x', action: function() { closePane(pane.paneId); }});

  // 기존 자식 노드 모두 제거 (innerHTML 대신 안전한 DOM 조작)
  while (ctxMenuEl.firstChild) ctxMenuEl.removeChild(ctxMenuEl.firstChild);

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.type === 'separator') {
      var sep = document.createElement('div');
      sep.className = 'ctx-menu-sep';
      ctxMenuEl.appendChild(sep);
      continue;
    }
    var el = document.createElement('div');
    el.className = 'ctx-menu-item' + (item.disabled ? ' disabled' : '');
    var ico = document.createElement('i');
    ico.setAttribute('data-lucide', item.icon);
    el.appendChild(ico);
    var lbl = document.createElement('span');
    lbl.textContent = item.label;
    el.appendChild(lbl);
    if (!item.disabled) {
      el.addEventListener('click', (function(act) { return function(e) { e.stopPropagation(); hideContextMenu(); act(); }; })(item.action));
    }
    ctxMenuEl.appendChild(el);
  }

  // 위치 계산 (화면 밖으로 나가지 않도록)
  ctxMenuEl.style.display = 'block';
  var menuW = ctxMenuEl.offsetWidth;
  var menuH = ctxMenuEl.offsetHeight;
  if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4;
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;
  ctxMenuEl.style.left = x + 'px';
  ctxMenuEl.style.top = y + 'px';

  setTimeout(function() { if (window.lucide) lucide.createIcons({ node: ctxMenuEl }); }, 0);
}

function hideContextMenu() {
  if (ctxMenuEl) ctxMenuEl.style.display = 'none';
}

initContextMenu();

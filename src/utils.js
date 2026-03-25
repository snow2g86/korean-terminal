/* =============================================================
   유틸리티 함수
   ============================================================= */

function findFirstLeaf(node) {
  if (!node) return null;
  if (node.type === 'leaf') return node;
  return findFirstLeaf(node.children[0]);
}

function setStatus(ok) {
  statusDot.classList.toggle('disconnected', !ok);
  statusText.textContent = ok ? '\uc5f0\uacb0\ub428' : '\uc5f0\uacb0 \ub04a\uae40';
}

function updateTabStatusDot(tabId) {
  var tab = tabs.get(tabId);
  if (!tab) return;
  var hasLive = false;
  forEachLeaf(tab.paneRoot, function(p) { if (p.ptyId) hasLive = true; });
  tab.tabStatusDot.className = hasLive ? 'tab-status' : 'tab-status dead';
}

function forEachLeaf(node, fn) {
  if (!node) return;
  if (node.type === 'leaf') { fn(node); return; }
  forEachLeaf(node.children[0], fn);
  forEachLeaf(node.children[1], fn);
}

function fitAllPanesInTab(tabId) {
  var tab = tabs.get(tabId);
  if (!tab) return;
  forEachLeaf(tab.paneRoot, function(p) {
    if (p.paneType === 'terminal' && p.fitAddon && p.term && p.term.element) {
      try { p.fitAddon.fit(); } catch(e) {}
    }
  });
}

function findTabIdFromNode(node) {
  if (node.tabId) return node.tabId;
  if (node.children) {
    for (var i = 0; i < node.children.length; i++) {
      var id = findTabIdFromNode(node.children[i]);
      if (id) return id;
    }
  }
  return null;
}

function createIconBtn(iconName, title, onClick) {
  var btn = document.createElement('button');
  btn.className = 'pane-header-btn';
  btn.title = title;
  var ico = document.createElement('i');
  ico.setAttribute('data-lucide', iconName);
  btn.appendChild(ico);
  btn.addEventListener('click', function(e) { e.stopPropagation(); onClick(); });
  return btn;
}

function startEditPaneName(pane) {
  var nameEl = pane.nameEl;
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'pane-name-input';
  input.value = pane.paneName;
  nameEl.style.display = 'none';
  nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
  input.focus();
  input.select();
  function finish() {
    var n = input.value.trim();
    if (n) { pane.paneName = n; nameEl.textContent = n; }
    nameEl.style.display = '';
    if (input.parentNode) input.parentNode.removeChild(input);
  }
  input.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { e.preventDefault(); nameEl.style.display = ''; if (input.parentNode) input.parentNode.removeChild(input); }
  });
  input.addEventListener('blur', finish);
}

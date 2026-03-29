/* =============================================================
   패널 분할 / 닫기 / 리사이즈 / 타입 전환
   ============================================================= */

function splitPane(paneId, direction) {
  var pane = allPanes.get(paneId);
  if (!pane) return;
  var tab = tabs.get(pane.tabId);
  if (!tab) return;
  var parentEl = pane.el.parentNode;
  var newPane = createTerminalPane(pane.tabId);
  var splitEl = document.createElement('div');
  splitEl.className = 'pane-split ' + direction;
  var handleEl = document.createElement('div');
  handleEl.className = 'resize-handle ' + direction;
  var originalFlex = pane.el.style.flex || '1 1 0%';
  parentEl.replaceChild(splitEl, pane.el);
  splitEl.style.flex = originalFlex;
  pane.el.style.flex = '1 1 0%';
  newPane.el.style.flex = '1 1 0%';
  splitEl.appendChild(pane.el);
  splitEl.appendChild(handleEl);
  splitEl.appendChild(newPane.el);

  var oldParent = pane.parent;
  var splitNode = { type: 'split', direction: direction, ratio: 0.5, children: [pane, newPane], el: splitEl, handleEl: handleEl, parent: oldParent };
  pane.parent = splitNode;
  newPane.parent = splitNode;

  if (oldParent && oldParent.type === 'split') {
    for (var ci = 0; ci < oldParent.children.length; ci++) {
      if (oldParent.children[ci] === pane) { oldParent.children[ci] = splitNode; break; }
    }
  }
  if (tab.paneRoot === pane) tab.paneRoot = splitNode;
  setupResizeHandle(handleEl, splitNode);
  focusPane(newPane.paneId);
  setTimeout(function() {
    connectPane(newPane);
    fitAllPanesInTab(pane.tabId);
    scheduleSave();
  }, 100);
}

function closePane(paneId) {
  var pane = allPanes.get(paneId);
  if (!pane) return;
  var tab = tabs.get(pane.tabId);
  if (!tab) return;
  if (tab.paneRoot === pane) {
    // 마지막 패널 → 탭 닫기 (탭이 1개면 무시)
    if (tabs.size > 1) closeTab(pane.tabId);
    return;
  }
  var splitNode = pane.parent;
  if (!splitNode || splitNode.type !== 'split') return;
  var siblingIdx = splitNode.children[0] === pane ? 1 : 0;
  var sibling = splitNode.children[siblingIdx];
  splitNode.el.parentNode.replaceChild(sibling.el, splitNode.el);
  sibling.el.style.flex = '1 1 0%';
  sibling.parent = splitNode.parent;

  var grandParent = splitNode.parent;
  if (grandParent && grandParent.type === 'split') {
    for (var ci = 0; ci < grandParent.children.length; ci++) {
      if (grandParent.children[ci] === splitNode) { grandParent.children[ci] = sibling; break; }
    }
  }
  if (tab.paneRoot === splitNode) tab.paneRoot = sibling;
  destroyPaneResources(pane);
  var firstLeaf = findFirstLeaf(sibling);
  if (firstLeaf) focusPane(firstLeaf.paneId);
  setTimeout(function() { fitAllPanesInTab(tab.id); }, 50);
  scheduleSave();
}

function setupResizeHandle(handleEl, splitNode) {
  handleEl.addEventListener('mousedown', function(e) {
    e.preventDefault();
    document.body.style.cursor = splitNode.direction === 'h' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    var onMove = function(e2) {
      var rect = splitNode.el.getBoundingClientRect();
      var ratio = splitNode.direction === 'h' ? (e2.clientY - rect.top) / rect.height : (e2.clientX - rect.left) / rect.width;
      ratio = Math.max(0.1, Math.min(0.9, ratio));
      splitNode.ratio = ratio;
      splitNode.children[0].el.style.flex = ratio + ' 1 0%';
      splitNode.children[1].el.style.flex = (1 - ratio) + ' 1 0%';
    };
    var onUp = function() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      var tabId = findTabIdFromNode(splitNode);
      if (tabId) fitAllPanesInTab(tabId);
      scheduleSave();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function togglePaneType(paneId) {
  var pane = allPanes.get(paneId);
  if (!pane) return;
  if (pane.paneType === 'terminal') {
    convertToBrowser(pane);
  } else {
    convertToTerminal(pane);
  }
}

function convertToBrowser(pane) {
  destroyPaneResources(pane);
  while (pane.areaEl.firstChild) pane.areaEl.removeChild(pane.areaEl.firstChild);
  pane.areaEl.className = 'pane-browser-area';
  pane.paneType = 'browser';

  // 네비게이션 바
  var navBar = document.createElement('div');
  navBar.className = 'browser-nav-bar';

  var backBtn = document.createElement('button');
  backBtn.className = 'browser-nav-btn';
  backBtn.title = '뒤로';
  var backIco = document.createElement('i');
  backIco.setAttribute('data-lucide', 'arrow-left');
  backBtn.appendChild(backIco);
  backBtn.addEventListener('click', function() { if (pane.webviewEl) try { pane.webviewEl.contentWindow.history.back(); } catch(e){} });
  navBar.appendChild(backBtn);

  var fwdBtn = document.createElement('button');
  fwdBtn.className = 'browser-nav-btn';
  fwdBtn.title = '앞으로';
  var fwdIco = document.createElement('i');
  fwdIco.setAttribute('data-lucide', 'arrow-right');
  fwdBtn.appendChild(fwdIco);
  fwdBtn.addEventListener('click', function() { if (pane.webviewEl) try { pane.webviewEl.contentWindow.history.forward(); } catch(e){} });
  navBar.appendChild(fwdBtn);

  var reloadBtn = document.createElement('button');
  reloadBtn.className = 'browser-nav-btn';
  reloadBtn.title = '새로고침';
  var reloadIco = document.createElement('i');
  reloadIco.setAttribute('data-lucide', 'refresh-cw');
  reloadBtn.appendChild(reloadIco);
  reloadBtn.addEventListener('click', function() { if (pane.webviewEl) try { pane.webviewEl.contentWindow.location.reload(); } catch(e){} });
  navBar.appendChild(reloadBtn);

  // URL 입력
  var urlInput = document.createElement('input');
  urlInput.className = 'browser-url-input';
  urlInput.type = 'text';
  urlInput.placeholder = 'URL 입력 또는 검색...';
  urlInput.value = 'https://www.google.com';
  urlInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') browserNavigate(pane, urlInput.value);
  });
  navBar.appendChild(urlInput);

  // 즐겨찾기 버튼
  var starBtn = document.createElement('button');
  starBtn.className = 'browser-nav-btn';
  starBtn.title = 'URL 즐겨찾기';
  var starIco = document.createElement('i');
  starIco.setAttribute('data-lucide', 'star');
  starBtn.appendChild(starIco);
  starBtn.addEventListener('click', function() {
    var url = pane.urlInputEl ? pane.urlInputEl.value : '';
    if (!url || url === 'about:blank') return;
    var name = url.replace(/^https?:\/\//, '').split('/')[0];
    if (!currentPrefs.browserFavorites) currentPrefs.browserFavorites = [];
    for (var i = 0; i < currentPrefs.browserFavorites.length; i++) {
      if (currentPrefs.browserFavorites[i].url === url) return;
    }
    currentPrefs.browserFavorites.push({ name: name, url: url });
    savePrefs();
    renderBrowserFavBar(pane);
  });
  navBar.appendChild(starBtn);

  pane.areaEl.appendChild(navBar);

  // 즐겨찾기 바
  var favBar = document.createElement('div');
  favBar.className = 'browser-fav-bar';
  pane.browserFavBar = favBar;
  pane.areaEl.appendChild(favBar);

  // iframe (Tauri에서는 webview 대신 iframe 사용)
  var webview = document.createElement('iframe');
  webview.className = 'browser-webview';
  webview.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  webview.src = 'https://www.google.com';

  webview.addEventListener('load', function() {
    try {
      urlInput.value = webview.contentWindow.location.href;
      var title = webview.contentDocument && webview.contentDocument.title;
      if (title) {
        pane.paneName = title;
        pane.nameEl.textContent = title;
      }
    } catch(e) { /* cross-origin */ }
  });

  pane.areaEl.appendChild(webview);
  pane.webviewEl = webview;
  pane.urlInputEl = urlInput;
  pane.el.querySelector('.pane-type-icon').textContent = '\uD83C\uDF10';
  allPanes.set(pane.paneId, pane);

  renderBrowserFavBar(pane);
  setTimeout(function() { if (window.lucide) lucide.createIcons({ node: navBar }); }, 0);
}

function browserNavigate(pane, input) {
  if (!pane.webviewEl) return;
  var url = input.trim();
  if (!url) return;
  // 검색어인지 URL인지 판별
  if (url.match(/^https?:\/\//)) { /* 그대로 */ }
  else if (url.match(/^localhost/) || url.match(/^\d+\.\d+/) || url.indexOf('.') !== -1) {
    url = 'https://' + url;
  } else {
    url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
  }
  pane.webviewEl.src = url;
  if (pane.urlInputEl) pane.urlInputEl.value = url;
}

function renderBrowserFavBar(pane) {
  var favBar = pane.browserFavBar;
  if (!favBar) return;
  while (favBar.firstChild) favBar.removeChild(favBar.firstChild);
  var favs = (currentPrefs && currentPrefs.browserFavorites) || [];
  if (favs.length === 0) { favBar.style.display = 'none'; return; }
  favBar.style.display = '';
  for (var i = 0; i < favs.length; i++) {
    var btn = document.createElement('button');
    btn.className = 'browser-fav-btn';
    btn.textContent = favs[i].name;
    btn.title = favs[i].url;
    btn.addEventListener('click', (function(url) {
      return function() { if (pane.webviewEl) { pane.webviewEl.src = url; if (pane.urlInputEl) pane.urlInputEl.value = url; } };
    })(favs[i].url));
    // 삭제 (우클릭)
    btn.addEventListener('contextmenu', (function(idx) {
      return function(e) {
        e.preventDefault();
        currentPrefs.browserFavorites.splice(idx, 1);
        savePrefs();
        renderBrowserFavBar(pane);
      };
    })(i));
    favBar.appendChild(btn);
  }
}

function convertToTerminal(pane) {
  while (pane.areaEl.firstChild) pane.areaEl.removeChild(pane.areaEl.firstChild);
  pane.areaEl.className = 'pane-terminal-area';
  pane.paneType = 'terminal';
  pane.webviewEl = null;
  pane.urlInputEl = null;
  pane.browserFavBar = null;
  var newPane = createTerminalPane(pane.tabId);
  pane.el.parentNode.replaceChild(newPane.el, pane.el);
  newPane.parent = pane.parent;
  if (pane.parent && pane.parent.children) {
    var idx = pane.parent.children.indexOf(pane);
    if (idx >= 0) pane.parent.children[idx] = newPane;
  }
  var tab = tabs.get(pane.tabId);
  if (tab && tab.paneRoot === pane) tab.paneRoot = newPane;
  allPanes.delete(pane.paneId);
  connectPane(newPane);
  focusPane(newPane.paneId);
}

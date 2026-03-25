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
  if (tab.paneRoot === pane) return;
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
    destroyPaneResources(pane);
    while (pane.areaEl.firstChild) pane.areaEl.removeChild(pane.areaEl.firstChild);
    pane.areaEl.className = 'pane-browser-area';
    pane.paneType = 'browser';
    var urlBar = document.createElement('div');
    urlBar.className = 'browser-url-bar';
    var urlInput = document.createElement('input');
    urlInput.className = 'browser-url-input';
    urlInput.type = 'text';
    urlInput.placeholder = 'URL \uc785\ub825...';
    urlInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { var url = urlInput.value; if (url && !url.match(/^https?:\/\//)) url = 'https://' + url; if (url) pane.iframeEl.src = url; }
    });
    urlBar.appendChild(urlInput);
    var iframe = document.createElement('iframe');
    iframe.className = 'browser-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.src = 'about:blank';
    pane.areaEl.appendChild(urlBar);
    pane.areaEl.appendChild(iframe);
    pane.iframeEl = iframe;
    pane.urlInputEl = urlInput;
    pane.el.querySelector('.pane-type-icon').textContent = '\uD83C\uDF10';
    allPanes.set(paneId, pane);
  } else {
    while (pane.areaEl.firstChild) pane.areaEl.removeChild(pane.areaEl.firstChild);
    pane.areaEl.className = 'pane-terminal-area';
    pane.paneType = 'terminal';
    pane.iframeEl = null;
    pane.urlInputEl = null;
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
}

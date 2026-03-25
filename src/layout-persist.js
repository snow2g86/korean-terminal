/* =============================================================
   레이아웃 저장 / 복원
   ============================================================= */

function serializeNode(node) {
  if (!node) return null;
  if (node.type === 'split') {
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      children: [serializeNode(node.children[0]), serializeNode(node.children[1])],
    };
  }
  return {
    type: 'leaf',
    paneType: node.paneType || 'terminal',
    paneName: node.paneName || '',
    cwd: node._cachedCwd || '',
  };
}

function serializeLayout() {
  var tabsArr = [];
  tabs.forEach(function(tab) {
    tabsArr.push({ id: tab.id, tree: serializeNode(tab.paneRoot) });
  });
  return { tabs: tabsArr, activeTabId: activeTabId };
}

function saveLayout() {
  var data = serializeLayout();
  window.terminal.saveSettings(data);
}

// 디바운스된 저장 (레이아웃 변경 시 호출)
var saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLayout, 500);
}

// 주기적으로 모든 패널의 cwd를 캐시 (3초마다)
setInterval(function() {
  allPanes.forEach(function(pane) {
    if (pane.paneType === 'terminal' && pane.ptyId) {
      window.terminal.getCwd(pane.ptyId).then(function(cwd) {
        pane._cachedCwd = cwd;
      }).catch(function() {});
    }
  });
}, 3000);

// --- 복원 ---

async function restoreLayout(data) {
  if (!data || !data.tabs || data.tabs.length === 0) return false;

  var pendingPanes = []; // DOM 붙인 뒤 연결할 pane 목록

  for (var ti = 0; ti < data.tabs.length; ti++) {
    var tabData = data.tabs[ti];
    var tabId = ++tabCounter;
    var contentEl = document.createElement('div');
    contentEl.className = 'tab-content';
    contentEl.dataset.tabId = tabId;
    terminalPanel.appendChild(contentEl);

    var tabBtn = document.createElement('button');
    tabBtn.className = 'tab-btn';
    tabBtn.dataset.tabId = tabId;
    tabBtn.title = '터미널 ' + tabId;
    tabBtn.textContent = tabId;
    var tabStatusDot = document.createElement('span');
    tabStatusDot.className = 'tab-status';
    tabBtn.appendChild(tabStatusDot);
    var closeBtn = document.createElement('button');
    closeBtn.className = 'tab-btn-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', (function(tid) { return function(e) { e.stopPropagation(); closeTab(tid); }; })(tabId));
    tabBtn.appendChild(closeBtn);
    tabBtn.addEventListener('click', (function(tid) { return function() { switchTab(tid); }; })(tabId));
    sidebar.insertBefore(tabBtn, addTabBtn);

    var tab = { id: tabId, paneRoot: null, contentEl: contentEl, tabBtn: tabBtn, tabStatusDot: tabStatusDot };
    tabs.set(tabId, tab);

    // 1단계: DOM 트리만 구성 (connectPane 없이)
    var root = buildNodeDOM(tabData.tree, tabId, null, pendingPanes);
    tab.paneRoot = root;
    root.el.style.flex = '1 1 0%';
    contentEl.appendChild(root.el);
  }

  // 활성 탭 전환 (DOM이 보이도록)
  var firstTabId = tabs.keys().next().value;
  switchTab(firstTabId);

  // 2단계: DOM이 붙은 뒤 모든 pane 연결
  await new Promise(function(r) { setTimeout(r, 100); });
  for (var pi = 0; pi < pendingPanes.length; pi++) {
    await connectPane(pendingPanes[pi]);
  }

  return true;
}

function buildNodeDOM(nodeData, tabId, parentNode, pendingPanes) {
  if (!nodeData) return null;

  if (nodeData.type === 'leaf') {
    var pane = createTerminalPane(tabId);
    if (nodeData.paneName) {
      pane.paneName = nodeData.paneName;
      pane.nameEl.textContent = nodeData.paneName;
    }
    pane.parent = parentNode;
    pane._restoreCwd = nodeData.cwd || '';
    pendingPanes.push(pane);
    return pane;
  }

  // split node
  var splitEl = document.createElement('div');
  splitEl.className = 'pane-split ' + nodeData.direction;
  var handleEl = document.createElement('div');
  handleEl.className = 'resize-handle ' + nodeData.direction;

  var ratio = nodeData.ratio || 0.5;
  var splitNode = {
    type: 'split', direction: nodeData.direction, ratio: ratio,
    children: [null, null], el: splitEl, handleEl: handleEl, parent: parentNode,
  };

  var child0 = buildNodeDOM(nodeData.children[0], tabId, splitNode, pendingPanes);
  var child1 = buildNodeDOM(nodeData.children[1], tabId, splitNode, pendingPanes);
  splitNode.children[0] = child0;
  splitNode.children[1] = child1;

  child0.el.style.flex = ratio + ' 1 0%';
  child1.el.style.flex = (1 - ratio) + ' 1 0%';

  splitEl.appendChild(child0.el);
  splitEl.appendChild(handleEl);
  splitEl.appendChild(child1.el);

  setupResizeHandle(handleEl, splitNode);
  return splitNode;
}

// beforeunload 시 저장
window.addEventListener('beforeunload', function() {
  saveLayout();
});

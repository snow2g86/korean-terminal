/* =============================================================
   탭 관리
   ============================================================= */

function createTab(startCwd) {
  var tabId = ++tabCounter;
  var contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.dataset.tabId = tabId;
  terminalPanel.appendChild(contentEl);

  var tabBtn = document.createElement('button');
  tabBtn.className = 'tab-btn';
  tabBtn.dataset.tabId = tabId;
  tabBtn.title = '\ud130\ubbf8\ub110 ' + tabId;
  tabBtn.textContent = tabId;
  var tabStatusDot = document.createElement('span');
  tabStatusDot.className = 'tab-status';
  tabBtn.appendChild(tabStatusDot);
  var closeBtn = document.createElement('button');
  closeBtn.className = 'tab-btn-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', function(e) { e.stopPropagation(); closeTab(tabId); });
  tabBtn.appendChild(closeBtn);
  tabBtn.addEventListener('click', function() { switchTab(tabId); });
  sidebar.insertBefore(tabBtn, addTabBtn);

  var pane = createTerminalPane(tabId);
  if (startCwd) pane._restoreCwd = startCwd;
  contentEl.appendChild(pane.el);
  var tab = { id: tabId, paneRoot: pane, contentEl: contentEl, tabBtn: tabBtn, tabStatusDot: tabStatusDot };
  tabs.set(tabId, tab);
  switchTab(tabId);
  renumberTabs();
  setTimeout(function() { connectPane(pane); scheduleSave(); }, 100);
  return tabId;
}

function switchTab(tabId) {
  if (settingsOpen) toggleSettings();
  if (favoritesOpen) toggleFavorites();
  activeTabId = tabId;
  tabs.forEach(function(tab, id) {
    if (id === tabId) { tab.contentEl.classList.add('active'); tab.tabBtn.classList.add('active'); }
    else { tab.contentEl.classList.remove('active'); tab.tabBtn.classList.remove('active'); }
  });
  var tab = tabs.get(tabId);
  if (tab) {
    termTitle.textContent = '\ud130\ubbf8\ub110 ' + tabId;
    var firstLeaf = findFirstLeaf(tab.paneRoot);
    if (firstLeaf) focusPane(firstLeaf.paneId);
    setTimeout(function() { fitAllPanesInTab(tabId); }, 50);
  }
}

function closeTab(tabId) {
  if (tabs.size <= 1) return;
  var tab = tabs.get(tabId);
  if (!tab) return;
  destroyTree(tab.paneRoot);
  tab.contentEl.remove();
  tab.tabBtn.remove();
  tabs.delete(tabId);
  if (activeTabId === tabId) switchTab(tabs.keys().next().value);
  renumberTabs();
  scheduleSave();
}

function renumberTabs() {
  var idx = 1;
  tabs.forEach(function(tab) {
    // 숫자 표시용 텍스트 노드만 교체 — 자식 element들을 유지해 이벤트 리스너 누수 방지
    tab.tabBtn.title = '터미널 ' + idx;
    // 첫 텍스트 노드 찾기
    var textNode = null;
    for (var ci = 0; ci < tab.tabBtn.childNodes.length; ci++) {
      if (tab.tabBtn.childNodes[ci].nodeType === Node.TEXT_NODE) {
        textNode = tab.tabBtn.childNodes[ci];
        break;
      }
    }
    if (textNode) {
      textNode.nodeValue = String(idx);
    } else {
      // 없으면 맨 앞에 추가
      tab.tabBtn.insertBefore(document.createTextNode(String(idx)), tab.tabBtn.firstChild);
    }
    idx++;
  });
}

function destroyTree(node) {
  if (!node) return;
  if (node.type === 'split') { destroyTree(node.children[0]); destroyTree(node.children[1]); }
  else destroyPaneResources(node);
}

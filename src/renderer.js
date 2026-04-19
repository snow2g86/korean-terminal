/* =============================================================
   한텀 — 메인 진입점
   모듈 로드 순서: utils → pane → tabs → split → dir-autocomplete → hw-monitor → renderer
   ============================================================= */

// xterm.js UMD globals
var XTerminal = window.Terminal.Terminal || window.Terminal;
var XFitAddon = window.FitAddon.FitAddon || window.FitAddon;
var XWebLinksAddon = window.WebLinksAddon.WebLinksAddon || window.WebLinksAddon;

// --- Global State (모든 모듈에서 공유) ---
var tabs = new Map();
var allPanes = new Map();
var focusedPaneId = null;
var activeTabId = null;
var tabCounter = 0;
var paneCounter = 0;

// --- DOM refs ---
var terminalPanel = document.getElementById('terminalPanel');
var sidebar = document.getElementById('sidebar');
var addTabBtn = document.getElementById('addTabBtn');
var statusDot = document.getElementById('statusDot');
var statusText = document.getElementById('statusText');
var termTitle = document.getElementById('termTitle');

// --- Global event listeners ---
addTabBtn.addEventListener('click', function() { createTab(); });
var resizeTimer = null;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    if (activeTabId) fitAllPanesInTab(activeTabId);
    if (typeof updateImePosition === 'function') updateImePosition();
  }, 100);
});
// 주: PTY 정리는 Rust의 WindowEvent::CloseRequested/Destroyed 및 RunEvent::Exit이 담당.
// 브라우저 beforeunload는 동기 IPC 보장이 없어 race 상태만 유발하므로 destroy는 호출하지 않음.

// --- Start (설정 로드 → 레이아웃 복원 또는 시작 탭) ---
(async function() {
  // 에러 로그 Rust로 전송
  setTimeout(function() {
    if (window._errorLog && window._errorLog.length > 0) {
      for (var i = 0; i < window._errorLog.length; i++) {
        try { window.__TAURI__.core.invoke('log_from_js', { msg: window._errorLog[i] }); } catch(e) {}
      }
    }
  }, 3000);

  await loadPrefs();
  var saved = await window.terminal.loadSettings();
  var restored = saved ? await restoreLayout(saved) : false;
  if (!restored) createStartTabs();
})();

function createStartTabs() {
  var startTabs = currentPrefs.startTabs;
  if (!startTabs || startTabs.length === 0) {
    createTab();
    return;
  }
  for (var i = 0; i < startTabs.length; i++) {
    var st = startTabs[i];
    var tabId = createTab(st.cwd || '');
    if (st.name) {
      var tab = tabs.get(tabId);
      if (tab) {
        var leaf = findFirstLeaf(tab.paneRoot);
        if (leaf) {
          leaf.paneName = st.name;
          leaf.nameEl.textContent = st.name;
        }
      }
    }
  }
}

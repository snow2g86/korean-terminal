/* =============================================================
   한글 터미널 — 메인 진입점
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
window.addEventListener('resize', function() { if (activeTabId) fitAllPanesInTab(activeTabId); });
window.addEventListener('beforeunload', function() { tabs.forEach(function(tab) { destroyTree(tab.paneRoot); }); });

// --- Start ---
createTab();

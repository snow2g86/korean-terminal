/* =============================================================
   cd 디렉토리 자동완성
   ============================================================= */

var dirFetchTimer = null;

function showDirAutocomplete(pane, partial, popupEl) {
  clearTimeout(dirFetchTimer);
  dirFetchTimer = setTimeout(async function() {
    var cwd = await window.terminal.getCwd(pane.ptyId);
    var targetDir = cwd;
    var filter = partial;
    if (partial.indexOf('/') !== -1) {
      var ls = partial.lastIndexOf('/');
      var dirPart = partial.substring(0, ls + 1);
      filter = partial.substring(ls + 1);
      targetDir = dirPart.startsWith('/') ? dirPart : cwd + '/' + dirPart;
    }
    var result = await window.terminal.listDir(targetDir, filter, true);
    if (!result || !result.entries || result.entries.length === 0) {
      popupEl.style.display = 'none';
      return;
    }
    popupEl._entries = result.entries.slice(0, 20);
    popupEl._selectedIdx = 0;
    renderDirPopup(popupEl, popupEl._entries, 0);
    popupEl.style.display = '';
  }, 150);
}

function renderDirPopup(popupEl, entries, selectedIdx) {
  while (popupEl.firstChild) popupEl.removeChild(popupEl.firstChild);
  for (var i = 0; i < entries.length; i++) {
    var item = document.createElement('div');
    item.className = 'dir-popup-item' + (i === selectedIdx ? ' selected' : '');
    var ic = document.createElement('span');
    ic.className = 'dir-icon ' + (entries[i].isDir ? 'folder' : 'file');
    ic.textContent = entries[i].isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
    var nm = document.createElement('span');
    nm.className = 'dir-name' + (entries[i].isDir ? ' folder' : '');
    nm.textContent = entries[i].name;
    item.appendChild(ic);
    item.appendChild(nm);
    popupEl.appendChild(item);
  }
  var sel = popupEl.querySelector('.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

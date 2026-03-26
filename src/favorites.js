/* =============================================================
   즐겨찾기 — 디렉토리 + 브라우저 URL 통합 관리
   ============================================================= */

var _favActiveTab = 'dir';
var favoritesPanelEl = document.getElementById('favoritesPanel');
var favoritesBtn = document.getElementById('favoritesBtn');
var favoritesOpen = false;

function toggleFavorites() {
  // 설정이 열려있으면 먼저 닫기
  if (settingsOpen) toggleSettings();
  favoritesOpen = !favoritesOpen;
  if (favoritesOpen) {
    renderFavoritesPanel();
    favoritesPanelEl.style.display = '';
    terminalPanel.style.display = 'none';
    favoritesBtn.classList.add('active');
    tabs.forEach(function(tab) { tab.tabBtn.classList.remove('active'); });
  } else {
    favoritesPanelEl.style.display = 'none';
    terminalPanel.style.display = '';
    favoritesBtn.classList.remove('active');
    if (activeTabId) switchTab(activeTabId);
  }
}

function renderFavoritesPanel() {
  while (favoritesPanelEl.firstChild) favoritesPanelEl.removeChild(favoritesPanelEl.firstChild);
  var container = document.createElement('div');
  container.className = 'settings-container';
  var header = document.createElement('div');
  header.className = 'settings-header';
  var title = document.createElement('h2');
  title.textContent = '즐겨찾기';
  header.appendChild(title);
  container.appendChild(header);
  container.appendChild(renderFavCombinedSection());
  favoritesPanelEl.appendChild(container);
}

favoritesBtn.addEventListener('click', toggleFavorites);

// --- 통합 즐겨찾기 렌더링 (탭 전환) ---

function renderFavCombinedSection() {
  var wrap = document.createElement('div');

  // 탭 버튼
  var tabBar = document.createElement('div');
  tabBar.className = 'fav-tab-bar';

  var dirTab = document.createElement('button');
  dirTab.className = 'fav-tab-btn' + (_favActiveTab === 'dir' ? ' active' : '');
  dirTab.textContent = '\uD83D\uDCC2 디렉토리';
  var urlTab = document.createElement('button');
  urlTab.className = 'fav-tab-btn' + (_favActiveTab === 'url' ? ' active' : '');
  urlTab.textContent = '\uD83C\uDF10 브라우저';

  tabBar.appendChild(dirTab);
  tabBar.appendChild(urlTab);
  wrap.appendChild(tabBar);

  // 컨텐츠 영역
  var content = document.createElement('div');
  content.className = 'fav-tab-content';

  function renderContent() {
    while (content.firstChild) content.removeChild(content.firstChild);
    dirTab.className = 'fav-tab-btn' + (_favActiveTab === 'dir' ? ' active' : '');
    urlTab.className = 'fav-tab-btn' + (_favActiveTab === 'url' ? ' active' : '');
    if (_favActiveTab === 'dir') {
      content.appendChild(renderDirFavList());
    } else {
      content.appendChild(renderUrlFavList());
    }
  }

  dirTab.addEventListener('click', function() { _favActiveTab = 'dir'; renderContent(); });
  urlTab.addEventListener('click', function() { _favActiveTab = 'url'; renderContent(); });

  renderContent();
  wrap.appendChild(content);

  return wrap;
}

// --- 디렉토리 즐겨찾기 ---

function renderDirFavList() {
  var wrap = document.createElement('div');

  var list = document.createElement('div');
  list.className = 'fav-list';
  for (var i = 0; i < currentPrefs.favorites.length; i++) {
    list.appendChild(createFavItem(i));
  }
  wrap.appendChild(list);

  if (currentPrefs.favorites.length === 0) {
    var hint = document.createElement('div');
    hint.className = 'settings-hint';
    hint.textContent = '터미널에서 우클릭 → "즐겨찾기에 추가"로 현재 디렉토리를 등록하세요.';
    wrap.appendChild(hint);
  }

  var addBtn = document.createElement('button');
  addBtn.className = 'settings-btn-action';
  addBtn.textContent = '+ 디렉토리 추가';
  addBtn.addEventListener('click', function() {
    currentPrefs.favorites.push({ name: '새 폴더', path: '' });
    saveAndRender();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function createFavItem(idx) {
  var fav = currentPrefs.favorites[idx];
  var item = document.createElement('div');
  item.className = 'fav-item';

  var icon = document.createElement('span');
  icon.className = 'fav-icon';
  icon.textContent = '\uD83D\uDCC2';
  item.appendChild(icon);

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'fav-name-input';
  nameInput.value = fav.name;
  nameInput.placeholder = '이름';
  nameInput.addEventListener('input', function() {
    currentPrefs.favorites[idx].name = nameInput.value;
    savePrefs();
  });
  item.appendChild(nameInput);

  var pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.className = 'fav-path-input';
  pathInput.value = fav.path;
  pathInput.placeholder = '/Users/...';
  pathInput.addEventListener('input', function() {
    currentPrefs.favorites[idx].path = pathInput.value;
    savePrefs();
  });
  item.appendChild(pathInput);

  var delBtn = document.createElement('button');
  delBtn.className = 'fav-del-btn';
  delBtn.textContent = '\u00d7';
  delBtn.title = '삭제';
  delBtn.addEventListener('click', function() {
    currentPrefs.favorites.splice(idx, 1);
    saveAndRender();
  });
  item.appendChild(delBtn);

  return item;
}

// --- 브라우저 즐겨찾기 ---

function renderUrlFavList() {
  var wrap = document.createElement('div');
  if (!currentPrefs.browserFavorites) currentPrefs.browserFavorites = [];
  var favs = currentPrefs.browserFavorites;

  var list = document.createElement('div');
  list.className = 'fav-list';
  for (var i = 0; i < favs.length; i++) {
    list.appendChild(createBrowserFavItem(i));
  }
  wrap.appendChild(list);

  if (favs.length === 0) {
    var hint = document.createElement('div');
    hint.className = 'settings-hint';
    hint.textContent = '브라우저 패널에서 ⭐ 버튼으로 URL을 등록하세요.';
    wrap.appendChild(hint);
  }

  var addBtn = document.createElement('button');
  addBtn.className = 'settings-btn-action';
  addBtn.textContent = '+ URL 추가';
  addBtn.addEventListener('click', function() {
    currentPrefs.browserFavorites.push({ name: '새 사이트', url: 'https://' });
    saveAndRender();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function createBrowserFavItem(idx) {
  var fav = currentPrefs.browserFavorites[idx];
  var item = document.createElement('div');
  item.className = 'fav-item';

  var icon = document.createElement('span');
  icon.className = 'fav-icon';
  icon.textContent = '\uD83C\uDF10';
  item.appendChild(icon);

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'fav-name-input';
  nameInput.value = fav.name || '';
  nameInput.placeholder = '이름';
  nameInput.addEventListener('input', function() {
    currentPrefs.browserFavorites[idx].name = nameInput.value;
    savePrefs();
  });
  item.appendChild(nameInput);

  var urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'fav-path-input';
  urlInput.value = fav.url || '';
  urlInput.placeholder = 'https://...';
  urlInput.addEventListener('input', function() {
    currentPrefs.browserFavorites[idx].url = urlInput.value;
    savePrefs();
  });
  item.appendChild(urlInput);

  var delBtn = document.createElement('button');
  delBtn.className = 'fav-del-btn';
  delBtn.textContent = '\u00d7';
  delBtn.title = '삭제';
  delBtn.addEventListener('click', function() {
    currentPrefs.browserFavorites.splice(idx, 1);
    saveAndRender();
  });
  item.appendChild(delBtn);

  return item;
}

// --- 즐겨찾기 추가/이동 ---

async function addCurrentDirToFavorites(pane) {
  if (!pane || !pane.ptyId) return;
  var cwd = pane._cachedCwd || '';
  if (!cwd) {
    try { cwd = await window.terminal.getCwd(pane.ptyId); } catch(e) {}
  }
  if (!cwd) return;
  for (var i = 0; i < currentPrefs.favorites.length; i++) {
    if (currentPrefs.favorites[i].path === cwd) return;
  }
  var name = cwd.split('/').pop() || cwd;
  currentPrefs.favorites.push({ name: name, path: cwd });
  savePrefs();
}

function navigateToFavorite(pane, fav) {
  if (!pane || !pane.ptyId || !fav.path) return;
  window.terminal.write(pane.ptyId, 'cd ' + fav.path + '\r');
}

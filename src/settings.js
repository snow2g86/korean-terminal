/* =============================================================
   설정 패널 — SSH 프로필, 테마, 폰트
   ============================================================= */

var settingsPanelEl = document.getElementById('settingsPanel');
var settingsBtn = document.getElementById('settingsBtn');
var settingsOpen = false;

// 기본 설정값
var defaultPrefs = {
  sshProfiles: [],
  aiProfiles: [],
  favorites: [],
  startTabs: [{ name: '', cwd: '' }],
  theme: 'dark',
  customThemes: null,
  browserFavorites: [],
  fontFamily: "'Noto Sans Mono', 'D2Coding', 'Menlo', monospace",
  fontSize: 14,
};

// AI 프로필 프리셋
var aiProfilePresets = [
  { name: 'Claude Code', command: 'claude', icon: '🤖', desc: 'Anthropic CLI', mdPattern: '\\.md$' },
  { name: 'Aider', command: 'aider', icon: '🛠', desc: 'AI pair programming', mdPattern: '\\.md$' },
  { name: 'Ollama', command: 'ollama run llama3', icon: '🦙', desc: 'Local LLM', mdPattern: '' },
  { name: 'GitHub Copilot', command: 'gh copilot suggest', icon: '🐙', desc: 'GitHub CLI', mdPattern: '' },
];

var currentPrefs = Object.assign({}, defaultPrefs);

// 테마 프리셋
var themePresets = {
  dark: {
    name: '다크', background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff',
    selectionBackground: '#264f78',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#b1bac4',
  },
  monokai: {
    name: '모노카이', background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0',
    selectionBackground: '#49483e',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
  },
  solarized: {
    name: '솔라라이즈드', background: '#002b36', foreground: '#839496', cursor: '#93a1a1',
    selectionBackground: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
  },
  nord: {
    name: '노드', background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
    selectionBackground: '#434c5e',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
  },
  light: {
    name: '라이트', background: '#ffffff', foreground: '#24292e', cursor: '#0366d6',
    selectionBackground: '#c8e1ff',
    black: '#24292e', red: '#d73a49', green: '#22863a', yellow: '#b08800',
    blue: '#0366d6', magenta: '#6f42c1', cyan: '#1b7c83', white: '#fafbfc',
  },
};

var fontOptions = [];

// 시스템 폰트 목록 로드
async function loadSystemFonts() {
  try {
    var fonts = await document.fonts.ready;
    var fontSet = new Set();
    // queryLocalFonts API (Electron/Chromium 지원)
    if (window.queryLocalFonts) {
      var localFonts = await window.queryLocalFonts();
      for (var i = 0; i < localFonts.length; i++) {
        fontSet.add(localFonts[i].family);
      }
    }
    // 폴백: 알려진 모노스페이스 폰트 체크
    if (fontSet.size === 0) {
      var knownFonts = [
        'Menlo', 'Monaco', 'Courier New', 'Consolas', 'D2Coding', 'D2 Coding',
        'Noto Sans Mono', 'Fira Code', 'JetBrains Mono', 'Source Code Pro',
        'SF Mono', 'Hack', 'IBM Plex Mono', 'Ubuntu Mono', 'Inconsolata',
        'Cascadia Code', 'Cascadia Mono', 'Roboto Mono', 'Anonymous Pro',
        'Nanum Gothic Coding', 'NanumGothicCoding', 'Pretendard',
      ];
      for (var k = 0; k < knownFonts.length; k++) {
        if (document.fonts.check('12px "' + knownFonts[k] + '"')) {
          fontSet.add(knownFonts[k]);
        }
      }
    }
    fontOptions = Array.from(fontSet).sort(function(a, b) { return a.localeCompare(b); });
  } catch(e) {
    fontOptions = ['Menlo', 'Monaco', 'Courier New', 'D2Coding', 'Noto Sans Mono'];
  }
}

// --- 설정 패널 렌더링 ---

function renderSettingsPanel() {
  while (settingsPanelEl.firstChild) settingsPanelEl.removeChild(settingsPanelEl.firstChild);

  var container = document.createElement('div');
  container.className = 'settings-container';

  // 헤더
  var header = document.createElement('div');
  header.className = 'settings-header';
  var title = document.createElement('h2');
  title.textContent = '설정';
  header.appendChild(title);
  container.appendChild(header);

  // === 시작 탭 섹션 ===
  container.appendChild(createSection('시작 탭', renderStartTabsSection()));

  // === AI 프로필 섹션 ===
  container.appendChild(createSection('AI 프로필', renderAiSection()));

  // === SSH 프로필 섹션 ===
  container.appendChild(createSection('SSH 프로필', renderSshSection()));

  // === 테마 섹션 ===
  container.appendChild(createSection('테마', renderThemeSection()));

  // === 폰트 섹션 ===
  container.appendChild(createSection('폰트', renderFontSection()));

  settingsPanelEl.appendChild(container);
}

function createSection(title, content) {
  var section = document.createElement('div');
  section.className = 'settings-section';
  var h3 = document.createElement('h3');
  h3.textContent = title;
  section.appendChild(h3);
  section.appendChild(content);
  return section;
}

// --- 시작 탭 ---

function renderStartTabsSection() {
  var wrap = document.createElement('div');

  if (!currentPrefs.startTabs || currentPrefs.startTabs.length === 0) {
    currentPrefs.startTabs = [{ name: '', cwd: '' }];
  }

  var list = document.createElement('div');
  list.className = 'start-tab-list';
  for (var i = 0; i < currentPrefs.startTabs.length; i++) {
    list.appendChild(createStartTabItem(i));
  }
  wrap.appendChild(list);

  var addBtn = document.createElement('button');
  addBtn.className = 'settings-btn-action';
  addBtn.textContent = '+ 시작 탭 추가';
  addBtn.addEventListener('click', function() {
    currentPrefs.startTabs.push({ name: '', cwd: '' });
    saveAndRender();
  });
  wrap.appendChild(addBtn);

  var hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = '디렉토리를 비워두면 홈(~) 디렉토리에서 시작합니다.';
  wrap.appendChild(hint);

  return wrap;
}

function createStartTabItem(idx) {
  var st = currentPrefs.startTabs[idx];
  var item = document.createElement('div');
  item.className = 'start-tab-item';

  var numLabel = document.createElement('span');
  numLabel.className = 'start-tab-num';
  numLabel.textContent = (idx + 1);
  item.appendChild(numLabel);

  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'settings-input';
  nameInput.placeholder = '탭 이름 (선택)';
  nameInput.value = st.name || '';
  nameInput.style.maxWidth = '120px';
  nameInput.addEventListener('input', function() {
    currentPrefs.startTabs[idx].name = nameInput.value;
    savePrefs();
  });
  item.appendChild(nameInput);

  var cwdInput = document.createElement('input');
  cwdInput.type = 'text';
  cwdInput.className = 'settings-input';
  cwdInput.placeholder = '~/Desktop/workspace';
  cwdInput.value = st.cwd || '';
  cwdInput.addEventListener('input', function() {
    currentPrefs.startTabs[idx].cwd = cwdInput.value;
    savePrefs();
  });
  item.appendChild(cwdInput);

  // 최소 1개는 유지
  if (currentPrefs.startTabs.length > 1) {
    var delBtn = document.createElement('button');
    delBtn.className = 'fav-del-btn';
    delBtn.textContent = '\u00d7';
    delBtn.title = '삭제';
    delBtn.addEventListener('click', function() {
      currentPrefs.startTabs.splice(idx, 1);
      saveAndRender();
    });
    item.appendChild(delBtn);
  }

  return item;
}

// --- AI 프로필 ---

function renderAiSection() {
  var wrap = document.createElement('div');

  // 등록된 프로필 목록
  var list = document.createElement('div');
  list.className = 'ai-profile-list';
  for (var i = 0; i < currentPrefs.aiProfiles.length; i++) {
    list.appendChild(createAiProfileItem(i));
  }
  wrap.appendChild(list);

  // 추가 버튼 영역
  var btnRow = document.createElement('div');
  btnRow.className = 'settings-btn-row';

  var addBtn = document.createElement('button');
  addBtn.className = 'settings-btn-action';
  addBtn.textContent = '+ 직접 추가';
  addBtn.addEventListener('click', function() {
    currentPrefs.aiProfiles.push({ name: '새 AI', command: '', icon: '🤖', desc: '' });
    saveAndRender();
  });
  btnRow.appendChild(addBtn);

  // 프리셋에서 추가
  var presetSelect = document.createElement('select');
  presetSelect.className = 'settings-select';
  var defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '프리셋에서 추가...';
  presetSelect.appendChild(defaultOpt);
  for (var pi = 0; pi < aiProfilePresets.length; pi++) {
    var opt = document.createElement('option');
    opt.value = pi;
    opt.textContent = aiProfilePresets[pi].icon + ' ' + aiProfilePresets[pi].name;
    presetSelect.appendChild(opt);
  }
  presetSelect.addEventListener('change', function() {
    if (!presetSelect.value) return;
    var preset = aiProfilePresets[parseInt(presetSelect.value)];
    currentPrefs.aiProfiles.push(Object.assign({}, preset));
    presetSelect.value = '';
    saveAndRender();
  });
  btnRow.appendChild(presetSelect);

  wrap.appendChild(btnRow);
  return wrap;
}

function createAiProfileItem(idx) {
  var p = currentPrefs.aiProfiles[idx];
  var item = document.createElement('div');
  item.className = 'ai-profile-item';

  // 헤더 (아이콘 + 이름 + 실행 버튼)
  var header = document.createElement('div');
  header.className = 'ai-profile-header';
  var iconSpan = document.createElement('span');
  iconSpan.className = 'ai-profile-icon';
  iconSpan.textContent = p.icon || '🤖';
  header.appendChild(iconSpan);
  var nameSpan = document.createElement('span');
  nameSpan.className = 'ai-profile-name';
  nameSpan.textContent = p.name;
  header.appendChild(nameSpan);

  var launchBtn = document.createElement('button');
  launchBtn.className = 'settings-btn-launch';
  launchBtn.textContent = '실행';
  launchBtn.addEventListener('click', function() {
    launchAiProfile(p);
  });
  header.appendChild(launchBtn);
  item.appendChild(header);

  // 편집 필드
  var fields = [
    { label: '이름', key: 'name', type: 'text', placeholder: 'Claude Code' },
    { label: '명령어', key: 'command', type: 'text', placeholder: 'claude' },
    { label: '아이콘', key: 'icon', type: 'text', placeholder: '🤖' },
    { label: '설명', key: 'desc', type: 'text', placeholder: 'AI 도구 설명' },
    { label: 'MD 패턴', key: 'mdPattern', type: 'text', placeholder: '\\.md$ (정규식, 비워두면 비활성)' },
  ];

  for (var fi = 0; fi < fields.length; fi++) {
    var f = fields[fi];
    var row = document.createElement('div');
    row.className = 'settings-row';
    var lbl = document.createElement('label');
    lbl.textContent = f.label;
    var inp = document.createElement('input');
    inp.type = f.type;
    inp.className = 'settings-input';
    inp.placeholder = f.placeholder;
    inp.value = p[f.key] || '';
    inp.addEventListener('input', (function(index, key) {
      return function(e) {
        currentPrefs.aiProfiles[index][key] = e.target.value;
        savePrefs();
      };
    })(idx, f.key));
    row.appendChild(lbl);
    row.appendChild(inp);
    item.appendChild(row);
  }

  // 삭제
  var delBtn = document.createElement('button');
  delBtn.className = 'settings-btn-danger';
  delBtn.textContent = '삭제';
  delBtn.addEventListener('click', function() {
    currentPrefs.aiProfiles.splice(idx, 1);
    saveAndRender();
  });
  item.appendChild(delBtn);

  return item;
}

// AI 프로필로 새 패널 열기
function launchAiProfile(profile) {
  if (settingsOpen) toggleSettings();

  // 항상 새 탭 생성
  var newTabId = createTab();
  var newTab = tabs.get(newTabId);
  var newPane = findFirstLeaf(newTab.paneRoot);
  if (newPane) {
    newPane.paneName = profile.icon + ' ' + profile.name;
    newPane.nameEl.textContent = newPane.paneName;
    newPane._aiProfile = profile;
    setTimeout(function() {
      if (newPane.ptyId && profile.command) {
        window.terminal.write(newPane.ptyId, profile.command + '\r');
      }
      // MD 사이드바 연결
      if (profile.mdPattern && typeof attachMdSidebar === 'function') {
        setTimeout(function() { attachMdSidebar(newPane, profile); }, 500);
      }
    }, 800);
  }
  scheduleSave();
}

// --- SSH 프로필 ---

function renderSshSection() {
  var wrap = document.createElement('div');

  // 프로필 목록
  var list = document.createElement('div');
  list.className = 'ssh-profile-list';
  for (var i = 0; i < currentPrefs.sshProfiles.length; i++) {
    list.appendChild(createSshProfileItem(i));
  }
  wrap.appendChild(list);

  // 추가 버튼
  var addBtn = document.createElement('button');
  addBtn.className = 'settings-btn-action';
  addBtn.textContent = '+ SSH 프로필 추가';
  addBtn.addEventListener('click', function() {
    currentPrefs.sshProfiles.push({ name: '새 서버', host: '', port: 22, username: '', password: '', key: '' });
    saveAndRender();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

function createSshProfileItem(idx) {
  var p = currentPrefs.sshProfiles[idx];
  var item = document.createElement('div');
  item.className = 'ssh-profile-item';

  var fields = [
    { label: '이름', key: 'name', type: 'text', placeholder: '서버 이름' },
    { label: '호스트', key: 'host', type: 'text', placeholder: '192.168.1.1' },
    { label: '포트', key: 'port', type: 'number', placeholder: '22' },
    { label: '사용자', key: 'username', type: 'text', placeholder: 'root' },
    { label: '비밀번호', key: 'password', type: 'password', placeholder: '(선택)' },
    { label: '키 경로', key: 'key', type: 'text', placeholder: '~/.ssh/id_rsa' },
  ];

  for (var fi = 0; fi < fields.length; fi++) {
    var f = fields[fi];
    var row = document.createElement('div');
    row.className = 'settings-row';
    var lbl = document.createElement('label');
    lbl.textContent = f.label;
    var inp = document.createElement('input');
    inp.type = f.type;
    inp.className = 'settings-input';
    inp.placeholder = f.placeholder;
    inp.value = p[f.key] || '';
    inp.addEventListener('input', (function(index, key) {
      return function(e) {
        currentPrefs.sshProfiles[index][key] = e.target.value;
        savePrefs();
      };
    })(idx, f.key));
    row.appendChild(lbl);
    row.appendChild(inp);
    item.appendChild(row);
  }

  // 삭제 버튼
  var delBtn = document.createElement('button');
  delBtn.className = 'settings-btn-danger';
  delBtn.textContent = '삭제';
  delBtn.addEventListener('click', function() {
    currentPrefs.sshProfiles.splice(idx, 1);
    saveAndRender();
  });
  item.appendChild(delBtn);

  return item;
}

// --- 테마 ---

function renderThemeSection() {
  var outer = document.createElement('div');

  var wrap = document.createElement('div');
  wrap.className = 'theme-grid';

  // 프리셋 + 커스텀 테마 통합
  var allThemes = Object.assign({}, themePresets);
  if (currentPrefs.customThemes) {
    for (var ck in currentPrefs.customThemes) allThemes[ck] = currentPrefs.customThemes[ck];
  }

  var keys = Object.keys(allThemes);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var preset = allThemes[key];
    var card = document.createElement('div');
    card.className = 'theme-card' + (currentPrefs.theme === key ? ' active' : '');
    card.style.background = preset.background;
    card.style.color = preset.foreground;
    card.style.borderColor = currentPrefs.theme === key ? '#58a6ff' : '#30363d';

    var label = document.createElement('span');
    label.className = 'theme-card-label';
    label.textContent = preset.name;

    var preview = document.createElement('div');
    preview.className = 'theme-card-preview';
    var colors = [preset.red, preset.green, preset.yellow, preset.blue, preset.magenta, preset.cyan];
    for (var ci = 0; ci < colors.length; ci++) {
      var dot = document.createElement('span');
      dot.style.background = colors[ci];
      dot.className = 'theme-color-dot';
      preview.appendChild(dot);
    }

    card.appendChild(label);
    card.appendChild(preview);
    card.addEventListener('click', (function(k) {
      return function() {
        currentPrefs.theme = k;
        applyTheme();
        saveAndRender();
      };
    })(key));
    wrap.appendChild(card);
  }

  outer.appendChild(wrap);

  // Import / Export 버튼
  var btnRow = document.createElement('div');
  btnRow.className = 'settings-btn-row';

  var importBtn = document.createElement('button');
  importBtn.className = 'settings-btn-action';
  importBtn.textContent = '테마 가져오기 (JSON)';
  importBtn.addEventListener('click', async function() {
    var content = await window.terminal.openFile({});
    if (!content) return;
    try {
      var theme = JSON.parse(content);
      if (!theme.name || !theme.background || !theme.foreground) {
        alert('유효하지 않은 테마 파일입니다.');
        return;
      }
      var themeKey = 'custom_' + Date.now();
      if (!currentPrefs.customThemes) currentPrefs.customThemes = {};
      currentPrefs.customThemes[themeKey] = theme;
      currentPrefs.theme = themeKey;
      applyTheme();
      saveAndRender();
    } catch(e) { alert('JSON 파싱 오류: ' + e.message); }
  });
  btnRow.appendChild(importBtn);

  var exportBtn = document.createElement('button');
  exportBtn.className = 'settings-btn-action';
  exportBtn.textContent = '현재 테마 내보내기';
  exportBtn.addEventListener('click', async function() {
    var allT = Object.assign({}, themePresets, currentPrefs.customThemes || {});
    var theme = allT[currentPrefs.theme] || themePresets.dark;
    var json = JSON.stringify(theme, null, 2);
    var name = (theme.name || 'theme').replace(/\s+/g, '_') + '.json';
    await window.terminal.saveFile(json, name);
  });
  btnRow.appendChild(exportBtn);

  outer.appendChild(btnRow);
  return outer;
}

// --- 폰트 ---

function renderFontSection() {
  var wrap = document.createElement('div');

  var previewSample = 'Hello, World! 한텀 터미널 ~$ ls -la 가나다라 0123456789 {}[]()<>';

  // 미리보기
  var preview = document.createElement('div');
  preview.className = 'font-preview';
  preview.style.fontFamily = currentPrefs.fontFamily;
  preview.style.fontSize = currentPrefs.fontSize + 'px';
  preview.textContent = previewSample;
  wrap.appendChild(preview);

  // 현재 폰트 표시 + 변경 버튼
  var fontRow = document.createElement('div');
  fontRow.className = 'settings-row';
  var fontLabel = document.createElement('label');
  fontLabel.textContent = '폰트';
  var fontNameDisplay = document.createElement('span');
  fontNameDisplay.className = 'font-current-name';
  fontNameDisplay.textContent = currentPrefs.fontFamily.split("'")[1] || currentPrefs.fontFamily;
  var changeBtn = document.createElement('button');
  changeBtn.className = 'settings-btn-action';
  changeBtn.textContent = '변경';
  changeBtn.addEventListener('click', function() {
    openFontModal(preview, fontNameDisplay);
  });
  fontRow.appendChild(fontLabel);
  fontRow.appendChild(fontNameDisplay);
  fontRow.appendChild(changeBtn);
  wrap.appendChild(fontRow);

  // 폰트 크기
  var sizeRow = document.createElement('div');
  sizeRow.className = 'settings-row';
  sizeRow.style.marginTop = '12px';
  var sizeLabel = document.createElement('label');
  sizeLabel.textContent = '크기';
  var sizeWrap = document.createElement('div');
  sizeWrap.className = 'settings-size-wrap';
  var sizeInput = document.createElement('input');
  sizeInput.type = 'range';
  sizeInput.min = '10';
  sizeInput.max = '24';
  sizeInput.value = currentPrefs.fontSize;
  sizeInput.className = 'settings-range';
  var sizeVal = document.createElement('span');
  sizeVal.className = 'settings-size-val';
  sizeVal.textContent = currentPrefs.fontSize + 'px';
  sizeInput.addEventListener('input', function() {
    currentPrefs.fontSize = parseInt(sizeInput.value);
    sizeVal.textContent = currentPrefs.fontSize + 'px';
    preview.style.fontSize = currentPrefs.fontSize + 'px';
    applyFont();
    savePrefs();
  });
  sizeWrap.appendChild(sizeInput);
  sizeWrap.appendChild(sizeVal);
  sizeRow.appendChild(sizeLabel);
  sizeRow.appendChild(sizeWrap);
  wrap.appendChild(sizeRow);

  return wrap;
}

// --- 폰트 선택 모달 ---

function openFontModal(previewEl, nameDisplayEl) {
  // 오버레이
  var overlay = document.createElement('div');
  overlay.className = 'font-modal-overlay';

  var modal = document.createElement('div');
  modal.className = 'font-modal';

  // 헤더
  var header = document.createElement('div');
  header.className = 'font-modal-header';
  var title = document.createElement('span');
  title.textContent = '폰트 선택';
  header.appendChild(title);
  var closeBtn = document.createElement('button');
  closeBtn.className = 'font-modal-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', function() { overlay.remove(); });
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // 검색
  var searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'font-modal-search';
  searchInput.placeholder = '폰트 이름 검색...';
  modal.appendChild(searchInput);

  // 리스트
  var list = document.createElement('div');
  list.className = 'font-modal-list';
  modal.appendChild(list);

  function renderList(filter) {
    while (list.firstChild) list.removeChild(list.firstChild);
    var filtered = fontOptions;
    if (filter) {
      var f = filter.toLowerCase();
      filtered = fontOptions.filter(function(name) { return name.toLowerCase().indexOf(f) !== -1; });
    }
    for (var i = 0; i < filtered.length; i++) {
      var fontName = filtered[i];
      var fontFamily = "'" + fontName + "', monospace";
      var item = document.createElement('div');
      item.className = 'font-modal-item' + (currentPrefs.fontFamily === fontFamily ? ' active' : '');

      var sample = document.createElement('span');
      sample.className = 'font-modal-item-sample';
      sample.style.fontFamily = fontFamily;
      sample.textContent = 'AaBb 가나다 012';

      var name = document.createElement('span');
      name.className = 'font-modal-item-name';
      name.textContent = fontName;

      item.appendChild(sample);
      item.appendChild(name);

      item.addEventListener('click', (function(ff, fn) {
        return function() {
          currentPrefs.fontFamily = ff;
          applyFont();
          savePrefs();
          if (previewEl) previewEl.style.fontFamily = ff;
          if (nameDisplayEl) nameDisplayEl.textContent = fn;
          overlay.remove();
        };
      })(fontFamily, fontName));

      list.appendChild(item);
    }
  }

  renderList('');
  searchInput.addEventListener('input', function() { renderList(searchInput.value); });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  searchInput.focus();

  // 오버레이 클릭으로 닫기
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
}

// --- 테마/폰트 적용 ---

function applyTheme() {
  var allT = Object.assign({}, themePresets, currentPrefs.customThemes || {});
  var theme = allT[currentPrefs.theme] || themePresets.dark;

  // CSS 변수로 전체 UI에 적용
  var root = document.documentElement;
  // 밝기 판단 (라이트 테마 감지)
  var bg = theme.background || '#0d1117';
  var fg = theme.foreground || '#c9d1d9';
  var isLight = isLightColor(bg);
  var surfaceBg = isLight ? darkenColor(bg, 0.05) : lightenColor(bg, 0.04);
  var surfaceBg2 = isLight ? darkenColor(bg, 0.1) : lightenColor(bg, 0.08);
  var borderColor = isLight ? darkenColor(bg, 0.15) : lightenColor(bg, 0.12);
  var mutedFg = isLight ? lightenColor(fg, 0.4) : darkenColor(fg, 0.35);

  root.style.setProperty('--theme-bg', bg);
  root.style.setProperty('--theme-fg', fg);
  root.style.setProperty('--theme-surface', surfaceBg);
  root.style.setProperty('--theme-surface2', surfaceBg2);
  root.style.setProperty('--theme-border', borderColor);
  root.style.setProperty('--theme-muted', mutedFg);
  root.style.setProperty('--theme-accent', theme.blue || '#58a6ff');
  root.style.setProperty('--theme-cursor', theme.cursor || '#58a6ff');

  // body
  document.body.style.background = bg;
  document.body.style.color = fg;

  // 타이틀바
  var titlebar = document.querySelector('.titlebar');
  if (titlebar) { titlebar.style.background = surfaceBg; titlebar.style.borderColor = borderColor; }

  // HW 바
  var hwBar = document.getElementById('hwBar');
  if (hwBar) { hwBar.style.background = bg; hwBar.style.borderColor = borderColor; }

  // 사이드바
  var sb = document.getElementById('sidebar');
  if (sb) { sb.style.background = surfaceBg; sb.style.borderColor = borderColor; }

  // 터미널 패널 배경
  document.querySelectorAll('.pane-terminal-area').forEach(function(el) {
    el.style.background = bg;
  });

  // 패널 헤더 (비포커스)
  document.querySelectorAll('.pane-leaf:not(.focused) .pane-header').forEach(function(el) {
    el.style.background = surfaceBg2;
    el.style.color = mutedFg;
  });
  // 패널 헤더 (포커스) — accent 색상 적용
  document.querySelectorAll('.pane-leaf.focused .pane-header').forEach(function(el) {
    el.style.background = theme.blue || '#58a6ff';
    el.style.color = '#fff';
  });

  // 설정 패널
  if (settingsPanelEl) settingsPanelEl.style.background = bg;

  // xterm 테마
  allPanes.forEach(function(pane) {
    if (pane.term) {
      pane.term.options.theme = {
        background: bg, foreground: fg, cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
        black: theme.black, red: theme.red, green: theme.green, yellow: theme.yellow,
        blue: theme.blue, magenta: theme.magenta, cyan: theme.cyan, white: theme.white,
      };
    }
  });
}

// 색상 유틸리티
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return { r: parseInt(hex.substr(0,2),16), g: parseInt(hex.substr(2,2),16), b: parseInt(hex.substr(4,2),16) };
}
function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(function(c) { return Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2,'0'); }).join('');
}
function isLightColor(hex) {
  var c = hexToRgb(hex);
  return (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) > 128;
}
function lightenColor(hex, amount) {
  var c = hexToRgb(hex);
  return rgbToHex(c.r + (255 - c.r) * amount, c.g + (255 - c.g) * amount, c.b + (255 - c.b) * amount);
}
function darkenColor(hex, amount) {
  var c = hexToRgb(hex);
  return rgbToHex(c.r * (1 - amount), c.g * (1 - amount), c.b * (1 - amount));
}

function applyFont() {
  allPanes.forEach(function(pane) {
    if (pane.term) {
      pane.term.options.fontFamily = currentPrefs.fontFamily;
      pane.term.options.fontSize = currentPrefs.fontSize;
      if (pane.fitAddon) try { pane.fitAddon.fit(); } catch(e) {}
    }
  });
}

function applyAllPrefs() {
  applyTheme();
  applyFont();
}

// --- 저장/로드 ---

function savePrefs() {
  window.terminal.savePrefs(currentPrefs);
}

function saveAndRender() {
  savePrefs();
  renderSettingsPanel();
}

async function loadPrefs() {
  await loadSystemFonts();
  var saved = await window.terminal.loadPrefs();
  if (saved) {
    currentPrefs = Object.assign({}, defaultPrefs, saved);
  }
  applyAllPrefs();
}

// --- 설정 패널 토글 ---

function toggleSettings() {
  if (favoritesOpen) toggleFavorites();
  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    renderSettingsPanel();
    settingsPanelEl.style.display = '';
    terminalPanel.style.display = 'none';
    settingsBtn.classList.add('active');
    // 탭 비활성화
    tabs.forEach(function(tab) { tab.tabBtn.classList.remove('active'); });
  } else {
    settingsPanelEl.style.display = 'none';
    terminalPanel.style.display = '';
    settingsBtn.classList.remove('active');
    if (activeTabId) switchTab(activeTabId);
  }
}

settingsBtn.addEventListener('click', toggleSettings);

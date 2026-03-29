/* =============================================================
   AI 프로필 — MD 파일 사이드바 + 편집기
   ============================================================= */

// paneId -> { sidebarEl, editorEl, files, activeFile, profile }
var mdSidebars = new Map();

async function attachMdSidebar(pane, profile) {
  if (!profile.mdPattern) return;

  // cwd 확인
  var cwd = '';
  if (pane.ptyId) {
    try { cwd = await window.terminal.getCwd(pane.ptyId); } catch(e) {}
  }
  if (!cwd) cwd = '/';

  // 파일 검색
  var files = await window.terminal.findFiles(cwd, profile.mdPattern);
  if (!files || files.length === 0) return;

  // 사이드바 컨테이너 생성
  var wrapper = document.createElement('div');
  wrapper.className = 'md-pane-wrapper';

  // MD 사이드바
  var sidebar = document.createElement('div');
  sidebar.className = 'md-sidebar';

  var sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'md-sidebar-header';
  var headerTitle = document.createElement('span');
  headerTitle.textContent = 'MD 파일';
  sidebarHeader.appendChild(headerTitle);
  var closeBtn = document.createElement('button');
  closeBtn.className = 'md-sidebar-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', function() { detachMdSidebar(pane.paneId); });
  sidebarHeader.appendChild(closeBtn);
  sidebar.appendChild(sidebarHeader);

  var fileList = document.createElement('div');
  fileList.className = 'md-file-list';
  for (var i = 0; i < files.length; i++) {
    var fileItem = createMdFileItem(pane.paneId, files[i], i);
    fileList.appendChild(fileItem);
  }
  sidebar.appendChild(fileList);

  // 에디터 영역
  var editor = document.createElement('div');
  editor.className = 'md-editor';
  editor.style.display = 'none';

  var editorHeader = document.createElement('div');
  editorHeader.className = 'md-editor-header';
  var editorTitle = document.createElement('span');
  editorTitle.className = 'md-editor-title';
  editorTitle.textContent = '';
  editorHeader.appendChild(editorTitle);
  var saveBtn = document.createElement('button');
  saveBtn.className = 'md-editor-save';
  saveBtn.textContent = '저장';
  saveBtn.addEventListener('click', function() { saveMdFile(pane.paneId); });
  editorHeader.appendChild(saveBtn);
  var backBtn = document.createElement('button');
  backBtn.className = 'md-editor-back';
  backBtn.textContent = '닫기';
  backBtn.addEventListener('click', function() { closeMdEditor(pane.paneId); });
  editorHeader.appendChild(backBtn);
  editor.appendChild(editorHeader);

  var textarea = document.createElement('textarea');
  textarea.className = 'md-editor-textarea';
  textarea.spellcheck = false;
  editor.appendChild(textarea);

  // pane의 기존 영역을 wrapper로 감싸기
  var paneEl = pane.el;
  var termArea = pane.areaEl;

  // wrapper 구조: [sidebar] [editor] [termArea]
  wrapper.appendChild(sidebar);
  wrapper.appendChild(editor);

  // termArea를 wrapper 안으로 이동
  paneEl.insertBefore(wrapper, termArea);
  wrapper.appendChild(termArea);

  mdSidebars.set(pane.paneId, {
    wrapperEl: wrapper,
    sidebarEl: sidebar,
    editorEl: editor,
    editorTitle: editorTitle,
    textarea: textarea,
    files: files,
    activeFile: null,
    profile: profile,
  });
}

function createMdFileItem(paneId, file, idx) {
  var item = document.createElement('div');
  item.className = 'md-file-item';

  var icon = document.createElement('span');
  icon.className = 'md-file-icon';
  icon.textContent = '\uD83D\uDCC4';
  item.appendChild(icon);

  var name = document.createElement('span');
  name.className = 'md-file-name';
  name.textContent = file.name;
  name.title = file.path;
  item.appendChild(name);

  item.addEventListener('click', function() {
    openMdFile(paneId, file);
  });

  return item;
}

async function openMdFile(paneId, file) {
  var state = mdSidebars.get(paneId);
  if (!state) return;

  var content = await window.terminal.readFile(file.path);
  if (content === null) content = '';

  state.activeFile = file;
  state.editorTitle.textContent = file.name;
  state.textarea.value = content;
  state.editorEl.style.display = '';

  // 활성 파일 표시
  var items = state.sidebarEl.querySelectorAll('.md-file-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', state.files[i] && state.files[i].path === file.path);
  }
}

function saveMdFile(paneId) {
  var state = mdSidebars.get(paneId);
  if (!state || !state.activeFile) return;
  window.terminal.writeFile(state.activeFile.path, state.textarea.value);
  // 저장 표시
  var btn = state.editorEl.querySelector('.md-editor-save');
  btn.textContent = '저장됨';
  setTimeout(function() { btn.textContent = '저장'; }, 1500);
}

function closeMdEditor(paneId) {
  var state = mdSidebars.get(paneId);
  if (!state) return;
  state.editorEl.style.display = 'none';
  state.activeFile = null;
  var items = state.sidebarEl.querySelectorAll('.md-file-item');
  for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
}

function detachMdSidebar(paneId) {
  var state = mdSidebars.get(paneId);
  if (!state) return;
  var pane = allPanes.get(paneId);
  if (!pane) return;

  // termArea를 wrapper 밖으로 복원
  var termArea = pane.areaEl;
  pane.el.appendChild(termArea);
  state.wrapperEl.remove();
  mdSidebars.delete(paneId);

  if (pane.fitAddon) try { pane.fitAddon.fit(); } catch(e) {}
}

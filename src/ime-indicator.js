/* =============================================================
   IME 입력 모드 표시 (한/영)
   ============================================================= */

var imeTooltipEl = null;
var imeCurrentMode = 'en';
var imePollTimer = null;

function initImeIndicator() {
  imeTooltipEl = document.createElement('div');
  imeTooltipEl.className = 'ime-tooltip';
  imeTooltipEl.textContent = 'EN';
  imeTooltipEl.style.display = 'none';
  document.body.appendChild(imeTooltipEl);

  // 주기적으로 입력 소스 감지
  pollInputSource();
  imePollTimer = setInterval(pollInputSource, 400);

  // 포커스 변경 시 위치 업데이트
  document.addEventListener('focusin', updateImePosition);
}

async function pollInputSource() {
  try {
    var mode = await window.terminal.getInputSource();
    if (mode !== imeCurrentMode) {
      imeCurrentMode = mode;
      updateImeDisplay();
    }
  } catch(e) {}
}

function updateImeDisplay() {
  if (!imeTooltipEl) return;
  if (imeCurrentMode === 'ko') {
    imeTooltipEl.textContent = '한';
    imeTooltipEl.classList.add('ko');
    imeTooltipEl.classList.remove('en');
  } else {
    imeTooltipEl.textContent = 'EN';
    imeTooltipEl.classList.remove('ko');
    imeTooltipEl.classList.add('en');
  }
  updateImePosition();
}

function updateImePosition() {
  if (!imeTooltipEl || !focusedPaneId) {
    imeTooltipEl.style.display = 'none';
    return;
  }
  var pane = allPanes.get(focusedPaneId);
  if (!pane || !pane.el) {
    imeTooltipEl.style.display = 'none';
    return;
  }

  var rect = pane.el.getBoundingClientRect();
  imeTooltipEl.style.left = (rect.right - 30) + 'px';
  imeTooltipEl.style.top = (rect.bottom - 22) + 'px';
  imeTooltipEl.style.display = '';
}

initImeIndicator();

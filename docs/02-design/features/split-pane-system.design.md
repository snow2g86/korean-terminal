# Design: Split Pane System

## 1. 아키텍처 개요

```
┌──────────────────────────────────────────────────┐
│ Tab 1                                            │
│ ┌──────────────────┬──────────────────┐          │
│ │  SplitNode (v)   │                  │          │
│ │  ratio: 0.5      │                  │          │
│ │ ┌──────┬───────┐ │                  │          │
│ │ │Leaf 1│Leaf 2 │ │     Leaf 3      │          │
│ │ │Term  │Browser│ │     Terminal    │          │
│ │ └──────┴───────┘ │                  │          │
│ └──────────────────┴──────────────────┘          │
│         SplitNode (h), ratio: 0.6                │
└──────────────────────────────────────────────────┘
```

## 2. 데이터 구조

### 2.1 패널 노드 (Pane Tree)

```javascript
// Split Node — 두 자식을 분할
{
  type: 'split',
  id: 'split-3',         // 유니크 ID
  direction: 'h' | 'v',  // h=가로(위아래), v=세로(좌우)
  ratio: 0.5,            // 첫 번째 자식의 비율 (0.1 ~ 0.9)
  children: [node, node],
  el: HTMLElement,        // 이 split의 flex container div
  handleEl: HTMLElement   // 리사이즈 핸들 div
}

// Leaf Node — 실제 콘텐츠 패널
{
  type: 'leaf',
  paneId: 1,              // 전역 유니크 ID (paneCounter++)
  paneType: 'terminal' | 'browser',
  tabId: 1,

  // DOM 참조 (직접 생성, 재생성하지 않음)
  el: HTMLElement,        // .pane-leaf container
  headerEl: HTMLElement,
  contentEl: HTMLElement,  // terminal-area 또는 browser-area

  // Terminal 전용
  ws: WebSocket | null,
  screenEl: HTMLElement,
  wrapperEl: HTMLElement,
  scrollbackViewEl: HTMLElement,
  indicatorEl: HTMLElement,
  screenRows: 24,
  screenCols: 80,
  scrollbackMode: false,
  scrollbackTotal: 0,
  scrollbackLoaded: 0,
  scrollbackLoading: false,
  lastState: null,

  // Browser 전용
  iframeEl: HTMLIFrameElement,
  urlInputEl: HTMLInputElement
}
```

### 2.2 글로벌 상태

```javascript
var tabs = new Map();        // tabId -> { id, paneRoot, contentEl, tabBtn, ... }
var allPanes = new Map();    // paneId -> LeafNode
var focusedPaneId = null;    // 현재 포커스된 패널
var paneCounter = 0;         // 패널 ID 생성기
var splitCounter = 0;        // split ID 생성기
```

## 3. Phase A: 패널 분할 시스템

### 3.1 핵심 원칙: 증분 DOM 변경

**절대 DOM을 재생성하지 않는다.** WebSocket 클로저가 DOM 참조를 유지하기 때문.

#### splitPane(paneId, direction)
```
Before:
  parentEl
    └── leafEl (pane 1)

After:
  parentEl
    └── splitEl (new flex container)
        ├── leafEl (pane 1, 기존 DOM 그대로)
        ├── handleEl (new resize handle)
        └── newLeafEl (pane 2, new)
```

1. `pane.el`의 parentNode에서 `pane.el`을 제거
2. 새 `splitEl` (flex container) 생성
3. `splitEl`에 `pane.el`, `handleEl`, `newLeafEl` 순서로 append
4. `splitEl`을 원래 parentNode에 삽입 (pane.el이 있던 위치)
5. flex 속성으로 ratio 적용

#### closePane(paneId)
```
Before:
  splitEl
    ├── leafEl (pane 1) — 닫으려는 패널
    ├── handleEl
    └── siblingEl (pane 2 or another split)

After:
  siblingEl (splitEl을 대체)
```

1. splitEl의 parentNode을 확인
2. siblingEl을 splitEl 위치에 삽입
3. splitEl 제거
4. 닫힌 패널의 WebSocket/리소스 해제

### 3.2 리사이즈 핸들

```css
.resize-handle {
  background: transparent;
  flex-shrink: 0;
}
.resize-handle.h {        /* 가로 분할 */
  height: 4px; width: 100%;
  cursor: row-resize;
}
.resize-handle.v {        /* 세로 분할 */
  width: 4px; height: 100%;
  cursor: col-resize;
}
.resize-handle:hover {
  background: #30363d;
}
```

드래그 로직:
```javascript
// mousedown on handle
// → mousemove: 마우스 위치로 ratio 계산
//   ratio = (mousePos - splitEl.offset) / splitEl.size
//   child1.style.flex = ratio
//   child2.style.flex = (1 - ratio)
// → mouseup: 드래그 종료, 터미널 패널들에 RESIZE 전송
```

### 3.3 패널 헤더 (20px)

```
┌─ >_ ──────────────────────── ⬓ ⬔ 🌐 × ─┐
```

- 좌측: 타입 아이콘 (`>_` 터미널, `🌐` 브라우저)
- 우측: 가로분할, 세로분할, 타입전환, 닫기 버튼
- 포커스된 패널: 헤더 하단에 파란 border (2px #58a6ff)

### 3.4 포커스 시스템

- `mousedown` on `.pane-leaf` → `focusPane(paneId)`
- 포커스된 패널: `.pane-leaf.focused` class
- 하단 input bar의 `send()` → `allPanes.get(focusedPaneId).ws.send()`
- 브라우저 패널 포커스 시: input bar disabled + placeholder 변경

## 4. Phase B: 브라우저 패널

### 4.1 구조

```html
<div class="pane-leaf">
  <div class="pane-header">...</div>
  <div class="pane-browser-area">
    <div class="browser-url-bar">
      <input class="browser-url-input" placeholder="URL 입력...">
    </div>
    <iframe class="browser-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
  </div>
</div>
```

### 4.2 타입 전환 (togglePaneType)

터미널 → 브라우저:
1. WebSocket 닫기 + 리소스 해제
2. contentEl 내부를 browser-area로 교체
3. paneType = 'browser'

브라우저 → 터미널:
1. iframe 제거
2. contentEl 내부를 terminal-area로 교체
3. WebSocket 연결
4. paneType = 'terminal'

## 5. Phase C: 패널 간 데이터 교환

### 5.1 메시지 버스

```javascript
var paneChannel = {
  // 특정 패널에 전송
  send: function(fromId, toId, data) {
    var target = allPanes.get(toId);
    if (!target) return;
    if (target.paneType === 'terminal' && target.ws) {
      target.ws.send(data);  // PTY에 write
    } else if (target.paneType === 'browser' && target.iframeEl) {
      // URL이면 navigate, 텍스트면 postMessage
      if (data.startsWith('http')) {
        target.iframeEl.src = data;
        target.urlInputEl.value = data;
      }
    }
  },

  // 모든 패널에 전송
  broadcast: function(fromId, data) {
    allPanes.forEach(function(pane) {
      if (pane.paneId !== fromId) {
        paneChannel.send(fromId, pane.paneId, data);
      }
    });
  }
};
```

### 5.2 UI: 전송 버튼

패널 헤더에 `→` (보내기) 버튼 추가. 클릭 시:
1. 현재 패널의 마지막 출력 라인 복사
2. 대상 패널 선택 드롭다운 표시
3. 선택한 패널에 전송

## 6. Phase D: 슬래시 명령어

### 6.1 명령어 목록

| 명령어 | 설명 | 예시 |
|--------|------|------|
| `/split-h` | 가로 분할 | `/split-h` |
| `/split-v` | 세로 분할 | `/split-v` |
| `/browser` | 브라우저로 전환 | `/browser` |
| `/terminal` | 터미널로 전환 | `/terminal` |
| `/close` | 현재 패널 닫기 | `/close` |
| `/focus` | 패널 포커스 | `/focus 2` |
| `/send` | 데이터 전송 | `/send 2 ls -la` |
| `/url` | 브라우저에 URL 열기 | `/url 3 https://google.com` |
| `/clear` | 터미널 클리어 | `/clear` |
| `/theme` | 테마 변경 (미래) | `/theme dark` |

### 6.2 팔레트 UI

```
┌─────────────────────────────────┐
│ /sp                             │  ← input
├─────────────────────────────────┤
│ ▸ /split-h    가로 분할         │  ← 선택됨 (highlight)
│   /split-v    세로 분할         │
├─────────────────────────────────┤
│ ↑↓ 선택 · Enter 실행 · Esc 취소│
└─────────────────────────────────┘
```

- input 위에 absolute positioned 팝업
- 퍼지 매칭: 입력 텍스트로 명령어 필터링
- ↑↓ 키로 선택, Enter로 실행
- Esc 또는 `/` 삭제 시 닫기

### 6.3 구현 구조

```javascript
var slashCommands = [
  { cmd: '/split-h', desc: '가로 분할', fn: function() { splitPane(focusedPaneId, 'h'); } },
  { cmd: '/split-v', desc: '세로 분할', fn: function() { splitPane(focusedPaneId, 'v'); } },
  { cmd: '/browser', desc: '브라우저로 전환', fn: function() { togglePaneType(focusedPaneId); } },
  // ...
];

// input event handler
cmdInput.addEventListener('input', function() {
  var val = cmdInput.value;
  if (val.startsWith('/')) {
    showCommandPalette(val);
  } else {
    hideCommandPalette();
  }
});
```

## 7. CSS 구조 요약

```
.pane-split            — flex container (direction에 따라 row/column)
.pane-split.h          — flex-direction: column (위아래)
.pane-split.v          — flex-direction: row (좌우)
.pane-leaf             — flex column, border, min 100px
.pane-leaf.focused     — border-color: #58a6ff
.pane-header           — 20px, #1c2128, flex between
.pane-header.focused   — border-bottom: 2px #58a6ff
.pane-terminal-area    — flex: 1
.pane-browser-area     — flex: 1
.browser-url-bar       — 28px, input + go button
.browser-iframe        — flex: 1, border: none
.resize-handle.h       — 4px height, row-resize
.resize-handle.v       — 4px width, col-resize
.cmd-palette           — absolute, bottom: 100%, popup
.cmd-palette-item      — hover/selected highlight
```

## 8. 파일 변경 범위

| 파일 | 변경 내용 |
|------|-----------|
| `static/index.html` | 전체 프론트엔드 (CSS + HTML + JS) |
| `server.py` | 변경 없음 |

## 9. 구현 체크리스트

### Phase A (분할)
- [ ] 증분 splitPane() 구현
- [ ] 증분 closePane() 구현
- [ ] 리사이즈 핸들 드래그
- [ ] 패널 헤더 (버튼들)
- [ ] 포커스 시스템
- [ ] 최소 크기 제한 (100px)
- [ ] 분할 시 터미널 RESIZE 전송

### Phase B (브라우저)
- [ ] 브라우저 패널 DOM 생성
- [ ] URL 입력 + iframe navigate
- [ ] 타입 전환 (terminal <-> browser)
- [ ] 브라우저 포커스 시 input bar 비활성화

### Phase C (데이터 교환)
- [ ] paneChannel.send() 구현
- [ ] 패널 헤더에 전송 버튼
- [ ] 대상 선택 드롭다운

### Phase D (슬래시 명령어)
- [ ] 명령어 배열 정의
- [ ] 팔레트 UI (popup)
- [ ] 퍼지 검색 필터
- [ ] ↑↓ 선택 + Enter 실행
- [ ] Esc 닫기

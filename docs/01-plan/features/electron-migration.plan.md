# Plan: Electron Migration

## 1. 목표

Python(FastAPI+WebSocket) 기반 웹 터미널을 순수 Electron 데스크톱 앱으로 전환.
기존 UI 디자인을 유지하면서, 네이티브 PTY/SSH 접근과 앱 배포를 가능하게 한다.

## 2. 삭제되는 것

- `server.py` — Python 서버 전체
- `requirements.txt` — Python 의존성
- `.venv/` — Python 가상환경
- WebSocket 프로토콜 (INIT, RESIZE, REFRESH, SCROLLBACK)
- `TerminalState` 서버측 터미널 파서
- `ScrollbackDB` SQLite 스크롤백 (xterm.js가 자체 관리)

## 3. 추가되는 것

| 구성요소 | 역할 |
|----------|------|
| `main.js` | Electron 메인 프로세스 (창 생성, IPC 핸들러) |
| `preload.js` | node-pty, ssh2, 시스템정보를 renderer에 노출 |
| `renderer.js` | UI 로직 (기존 index.html의 JS 분리) |
| `index.html` | 기존 UI (CSS + HTML만, JS는 renderer.js로) |
| `xterm.js` | 터미널 렌더링 (기존 직접 구현 대체) |
| `node-pty` | 네이티브 PTY 접근 |
| `ssh2` | SSH 연결 관리 |
| `electron-store` | 설정/프로필 영구 저장 |
| `systeminformation` | 하드웨어 모니터링 |
| `electron-builder` | .app/.exe 패키징 |

## 4. 기존 코드 재활용

| 기존 | 재활용 | 변경 |
|------|--------|------|
| 타이틀바 CSS/HTML | 그대로 | 없음 |
| 하드웨어 바 CSS/HTML | 그대로 | JS: fetch→IPC |
| 사이드바 CSS/HTML | 그대로 | 없음 |
| 하단 입력바 CSS/HTML | 그대로 | 없음 |
| 패널 분할 로직 | 새로 구현 | 설계문서 기반 |
| 터미널 렌더링 | xterm.js로 대체 | 삭제 |
| 스크롤백 | xterm.js 내장 | 삭제 |
| 색상 테마 (#0d1117 등) | 그대로 | 없음 |

## 5. 프로젝트 구조

```
korean-terminal/
├── package.json
├── main.js                  ← Electron 메인
├── preload.js               ← IPC 브릿지
├── src/
│   ├── index.html           ← UI
│   ├── renderer.js          ← UI 로직
│   ├── styles.css           ← CSS (index.html에서 분리)
│   ├── pane-manager.js      ← 패널 분할 시스템
│   ├── command-palette.js   ← 슬래시 명령어
│   └── hw-monitor.js        ← 하드웨어 모니터링
├── store/                   ← 설정 저장
│   └── (auto-generated)
├── icons/                   ← 앱 아이콘
├── docs/                    ← 문서 (유지)
└── build/                   ← 빌드 출력
```

## 6. 구현 순서

### Phase 1: 기본 Electron 앱 (터미널 1개 동작)
- [ ] package.json + Electron 설치
- [ ] main.js (BrowserWindow 생성)
- [ ] preload.js (node-pty IPC)
- [ ] index.html + renderer.js (xterm.js 1개 터미널)
- [ ] 하드웨어 모니터링 바

### Phase 2: 멀티탭 + UI 복원
- [ ] 사이드바 탭 시스템
- [ ] 탭별 PTY 관리
- [ ] 타이틀바, 하단 입력바
- [ ] 기존 디자인 복원

### Phase 3: 패널 분할
- [ ] 증분 splitPane/closePane
- [ ] 리사이즈 핸들
- [ ] 포커스 시스템
- [ ] 브라우저 패널 (BrowserView 또는 webview)

### Phase 4: SSH + 설정
- [ ] SSH 프로필 관리
- [ ] ssh2 연결
- [ ] electron-store 설정 저장
- [ ] 슬래시 명령어 팔레트

### Phase 5: 패키징
- [ ] electron-builder 설정
- [ ] macOS .dmg 빌드
- [ ] 아이콘

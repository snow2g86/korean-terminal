# Plan: Split Pane System

## 1. 개요

한글 터미널의 패널 분할 시스템. 하나의 탭 안에서 터미널과 브라우저를 자유롭게 분할/배치하고, 패널 간 데이터를 교환하며, 슬래시 명령어로 빠른 작업을 수행한다.

## 2. 현재 상태

### 안정적으로 동작하는 기능
- 서버: FastAPI + WebSocket PTY (INIT/RESIZE/REFRESH/SCROLLBACK 프로토콜)
- 서버: SQLite 스크롤백 저장소 + 세션 관리 + 메모리 제한
- 서버: psutil 하드웨어 모니터링 API
- 프론트: 멀티탭 (사이드바 + 탭 전환 + display on/off)
- 프론트: 하드웨어 모니터링 바 (htop 스타일 게이지)
- 프론트: 터미널 렌더링 (ANSI color, CJK wide char, cursor)
- 프론트: 스크롤백 히스토리 조회

### 현재 불안정한 부분
- 분할 패널: DOM 재생성 시 WebSocket 참조 깨짐
- 브라우저 패널: 구현됨이나 미테스트

## 3. 구현할 기능 (4개)

### Feature 4: 자유 분할 (수평/수직)
- 패널 트리 구조 (binary tree: split node / leaf node)
- 수평 분할 (위/아래), 수직 분할 (좌/우)
- 재귀적 분할 가능
- 드래그 리사이즈 핸들
- 패널 닫기 (sibling이 부모를 대체)
- 포커스 시스템 (클릭으로 전환, 파란색 border)

### Feature 5: 브라우저 패널
- 패널 타입 토글 (터미널 <-> 브라우저)
- URL 입력바 + iframe
- 브라우저 패널 포커스 시 하단 입력바 비활성화

### Feature 6: 패널 간 데이터 교환
- 터미널 출력 → 다른 터미널에 붙여넣기
- 터미널 출력 → 브라우저 URL로 열기
- 드래그앤드롭 또는 명령어 기반 전송
- 메시지 버스: `postMessage` 패턴으로 패널 간 통신

### Feature 7: 슬래시 명령어 팔레트
- input에 `/` 입력 시 명령어 목록 팝업
- 명령어 예시:
  - `/split-h` — 가로 분할
  - `/split-v` — 세로 분할
  - `/browser` — 브라우저 패널 열기
  - `/send <pane-id> <text>` — 다른 패널에 데이터 전송
  - `/close` — 현재 패널 닫기
  - `/focus <pane-id>` — 패널 포커스 이동
- 위/아래 키로 선택, Enter로 실행
- 퍼지 검색 지원

## 4. 기술 설계 방향

### 4.1 패널 트리 (핵심 데이터 구조)
```
SplitNode = { type: 'split', direction: 'h'|'v', ratio: 0.5, children: [Node, Node] }
LeafNode  = { type: 'leaf', paneId: N, paneType: 'terminal'|'browser', ws, screenEl, ... }
```

각 탭은 `paneRoot`를 가짐. 트리를 순회해서 DOM을 생성.

### 4.2 DOM 관리 전략 (핵심 — 이전 버그의 원인)

**문제**: `rebuildTabDOM`이 전체 DOM을 재생성하면 기존 WebSocket의 클로저가 이전 DOM 요소를 참조.

**해결**: DOM을 재생성하지 않고, **증분 변경**한다.
- `splitPane()`: 현재 leaf를 split container로 감싸고, 새 leaf를 추가
- `closePane()`: split container를 sibling으로 교체
- WebSocket의 `onmessage`는 항상 `allPanes.get(paneId)`로 최신 pane 참조를 가져옴

### 4.3 리사이즈 핸들
- CSS `flex` 기반 레이아웃
- 핸들 드래그 시 형제 요소의 `flex` 값을 조정
- 드래그 종료 시 모든 터미널 패널에 RESIZE 전송

### 4.4 패널 간 데이터 교환
- 글로벌 메시지 버스: `paneChannel`
- `paneChannel.send(fromId, toId, data)` — 특정 패널에 전송
- `paneChannel.broadcast(fromId, data)` — 모든 패널에 전송
- 터미널 패널: 수신한 데이터를 PTY에 write
- 브라우저 패널: 수신한 데이터를 URL로 navigate 또는 postMessage

### 4.5 슬래시 명령어
- input 값이 `/`로 시작하면 팝업 표시
- 명령어 목록을 필터링해서 보여줌
- Enter 시 명령어 실행 (input 초기화)
- 명령어 등록은 배열로 관리 (확장 가능)

## 5. 구현 순서

1. **Phase A**: 패널 트리 + 증분 DOM 관리 + 분할/닫기 (Feature 4)
2. **Phase B**: 브라우저 패널 타입 (Feature 5)
3. **Phase C**: 패널 간 데이터 교환 (Feature 6)
4. **Phase D**: 슬래시 명령어 팔레트 (Feature 7)

각 Phase는 이전 Phase가 안정적으로 동작한 후 진행.

## 6. 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| DOM 재생성 시 WebSocket 참조 깨짐 | 높음 | 증분 DOM 변경으로 전환 |
| iframe sandbox 제약 (CORS) | 중간 | sandbox 속성 조정, 실패 시 안내 메시지 |
| 분할 반복 시 패널 크기가 너무 작아짐 | 낮음 | 최소 크기 제한 (min-width/height: 100px) |
| 슬래시 명령어와 일반 입력 충돌 | 낮음 | `/` 이후 첫 글자로 구분 |

## 7. 서버 변경 사항

- 없음. 기존 WebSocket 프로토콜로 충분.
- 패널 간 데이터 교환은 프론트엔드 전용 (서버 경유 불필요).

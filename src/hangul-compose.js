/* =============================================================
   WKWebView 한글 IME 패치
   WebKit 버그 #274700: 한국어 IME는 composition 이벤트 대신
   inputType="insertReplacementText"를 사용함.
   xterm.js는 이를 무시하므로 여기서 가로채서 처리.
   (xterm.js PR #5704 / wk-hangul-ime 기반)
   ============================================================= */

var WkHangulIme = (function() {

  // 한글 유니코드 범위 판별
  function isHangul(str) {
    if (!str) return false;
    var code = str.charCodeAt(0);
    // 한글 완성형 (가~힣)
    if (code >= 0xAC00 && code <= 0xD7A3) return true;
    // 한글 호환 자모 (ㄱ~ㅣ)
    if (code >= 0x3131 && code <= 0x3163) return true;
    // 한글 자모 (ᄀ~ᇿ)
    if (code >= 0x1100 && code <= 0x11FF) return true;
    return false;
  }

  /**
   * xterm.js 터미널에 WKWebView 한글 IME 패치 적용
   * @param {Terminal} term - xterm.js Terminal 인스턴스 (open() 이후)
   * @param {function} onComposed - 조합 완료된 텍스트 콜백 (PTY로 보내기)
   */
  function attach(term, onComposed) {
    var ta = term.textarea;
    if (!ta) return;

    var target = ta.parentElement || ta;
    var composing = false;
    var pending = '';
    var flushTimer = null;
    var skipNextOnData = false;

    function flush() {
      clearTimeout(flushTimer);
      flushTimer = null;
      if (!composing) return;
      var text = pending;
      composing = false;
      pending = '';
      ta.value = '';
      if (text && onComposed) {
        skipNextOnData = true;
        onComposed(text);
        // 약간의 지연 후 skipNextOnData 리셋
        setTimeout(function() { skipNextOnData = false; }, 50);
      }
    }

    // 1) input 이벤트 캡처 — xterm.js보다 먼저 실행
    target.addEventListener('input', function(e) {
      // insertReplacementText = WKWebView의 한글 조합 업데이트
      if (e.inputType === 'insertReplacementText' && e.data) {
        composing = true;
        pending = e.data;
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, 300);
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }

      // insertText + 한글 = 새 음절 시작 또는 첫 자모
      if (e.inputType === 'insertText' && e.data && isHangul(e.data)) {
        if (composing) flush(); // 이전 조합 확정
        composing = true;
        pending = e.data;
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, 300);
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }

      // 한글 아닌 입력: 조합 중이면 확정
      if (composing) flush();
    }, true); // capture phase

    // 2) keydown 캡처 — IME 키(229)를 xterm.js 내부로 전달하지 않음
    target.addEventListener('keydown', function(e) {
      if (e.keyCode === 229 || e.isComposing) {
        e.stopImmediatePropagation();
        return;
      }
      // Enter, Space 등 비-IME 키: 조합 확정
      if (composing) flush();
    }, true);

    // 3) xterm.js의 customKeyEventHandler로 이중 차단
    term.attachCustomKeyEventHandler(function(event) {
      if (event.type === 'keydown' && (event.keyCode === 229 || event.isComposing)) {
        return false; // xterm 내부 처리 중단
      }
      return true;
    });

    // 4) onData 필터: 이미 flush로 보낸 문자의 누출 방지
    return {
      shouldSkip: function(data) {
        if (skipNextOnData && data.length > 0 && isHangul(data)) {
          skipNextOnData = false;
          return true;
        }
        return false;
      },
      flush: flush,
      isComposing: function() { return composing; }
    };
  }

  return { attach: attach, isHangul: isHangul };
})();

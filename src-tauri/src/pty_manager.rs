use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// UTF-8 바이트 배열에서 유효한 접미사 경계를 반환.
/// - 전체가 유효하면 data.len() 반환
/// - 끝에 불완전 시퀀스가 있으면 유효 접두부 길이 반환
/// - 첫 바이트부터 무효면 0 반환 (호출자가 크기 기반 fallback 필요)
fn find_utf8_boundary(data: &[u8]) -> usize {
    if data.is_empty() {
        return 0;
    }
    match std::str::from_utf8(data) {
        Ok(_) => data.len(),
        Err(e) => e.valid_up_to(),
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PtyDataPayload {
    pub id: u32,
    pub data: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PtyExitPayload {
    pub id: u32,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
    counter: AtomicU32,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            counter: AtomicU32::new(0),
        }
    }

    pub fn create(
        &self,
        app: &AppHandle,
        cols: u16,
        rows: u16,
        cwd: String,
    ) -> Result<u32, String> {
        let id = self.counter.fetch_add(1, Ordering::SeqCst) + 1;

        // 1~65535로 클램프 — 0이거나 터무니없이 큰 값 차단
        let cols = cols.clamp(1, 1000);
        let rows = rows.clamp(1, 1000);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty 실패: {}", e))?;

        // 기본 셸: 환경변수 SHELL → 플랫폼별 기본값
        let shell = std::env::var("SHELL").unwrap_or_else(|_| default_shell());

        let mut cmd = CommandBuilder::new(&shell);
        // login shell — 대부분의 셸에서 사용자 dotfiles 로드
        cmd.arg("-l");

        // cwd 유효성 검사 및 canonicalize
        let start_dir = resolve_cwd(&cwd);
        cmd.cwd(&start_dir);

        // 터미널 환경변수
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // LANG/LC_ALL은 시스템 값을 상속 (없을 때만 기본값)
        if std::env::var("LANG").is_err() {
            cmd.env("LANG", "en_US.UTF-8");
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn_command 실패: {}", e))?;

        // kill 신호를 읽기 스레드와 공유하기 위해 clone_killer 사용
        let killer = child.clone_killer();
        let pid = child.process_id();

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take_writer 실패: {}", e))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("try_clone_reader 실패: {}", e))?;

        // master는 PtySession에 보관 — drop 순서상 child wait 이후
        self.sessions.lock().insert(
            id,
            PtySession {
                writer,
                master: pair.master,
                killer,
                pid,
            },
        );

        // 읽기 스레드 — child ownership을 여기로 이동하여 wait() 가능
        let app_handle = app.clone();
        let sessions_ref = self.sessions.clone();
        let session_id = id;
        std::thread::Builder::new()
            .name(format!("pty-reader-{}", id))
            .spawn(move || {
                let mut buf = [0u8; 4096];
                let mut pending: Vec<u8> = Vec::with_capacity(8192);
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            pending.extend_from_slice(&buf[..n]);

                            let valid_end = find_utf8_boundary(&pending);
                            if valid_end == 0 {
                                // 안전장치: 8바이트 이상이 valid 아니면 lossy 처리로 무한 누적 방지
                                if pending.len() >= 8 {
                                    let data =
                                        String::from_utf8_lossy(&pending).to_string();
                                    pending.clear();
                                    let _ = app_handle.emit(
                                        "pty:data",
                                        PtyDataPayload {
                                            id: session_id,
                                            data,
                                        },
                                    );
                                }
                                continue;
                            }

                            let data =
                                String::from_utf8_lossy(&pending[..valid_end]).to_string();
                            pending.drain(..valid_end);

                            let _ = app_handle.emit(
                                "pty:data",
                                PtyDataPayload {
                                    id: session_id,
                                    data,
                                },
                            );
                        }
                        Err(e) => {
                            eprintln!("[pty-reader-{}] read 오류: {}", session_id, e);
                            break;
                        }
                    }
                }

                // 잔여 바이트 플러시
                if !pending.is_empty() {
                    let data = String::from_utf8_lossy(&pending).to_string();
                    let _ = app_handle.emit(
                        "pty:data",
                        PtyDataPayload {
                            id: session_id,
                            data,
                        },
                    );
                }

                // child.wait()으로 실제 exit code 획득 → zombie 방지
                let exit_code = match child.wait() {
                    Ok(status) => {
                        let code = status.exit_code();
                        // u32 → i32 안전 변환 (큰 값은 -1로)
                        if code > i32::MAX as u32 {
                            -1
                        } else {
                            code as i32
                        }
                    }
                    Err(e) => {
                        eprintln!("[pty-reader-{}] wait 오류: {}", session_id, e);
                        -1
                    }
                };

                // sessions 맵에서 자기 자신 제거 → writer/master/killer drop
                sessions_ref.lock().remove(&session_id);

                let _ = app_handle.emit(
                    "pty:exit",
                    PtyExitPayload {
                        id: session_id,
                        exit_code,
                    },
                );
            })
            .map_err(|e| format!("스레드 생성 실패: {}", e))?;

        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(&id) {
            if let Err(e) = session.writer.write_all(data.as_bytes()) {
                eprintln!("[pty-{}] write 오류: {}", id, e);
            }
            let _ = session.writer.flush();
        }
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) {
        let cols = cols.clamp(1, 1000);
        let rows = rows.clamp(1, 1000);
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(&id) {
            let _ = session.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    /// kill 신호만 보냄. 실제 session 제거와 pty:exit emit은 읽기 스레드가 처리.
    pub fn destroy(&self, id: u32) {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(&id) {
            let _ = session.killer.kill();
        }
    }

    /// 윈도우 종료 시 — 모든 session에 kill 신호. 읽기 스레드가 각각 wait로 정리.
    pub fn destroy_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, session) in sessions.iter_mut() {
            let _ = session.killer.kill();
        }
    }

    pub fn get_pid(&self, id: u32) -> Option<u32> {
        let sessions = self.sessions.lock();
        sessions.get(&id).and_then(|s| s.pid)
    }
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else if cfg!(target_os = "macos") {
        "/bin/zsh".to_string()
    } else {
        // Linux — /bin/bash가 더 일반적
        "/bin/bash".to_string()
    }
}

fn resolve_cwd(requested: &str) -> String {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());

    if requested.is_empty() {
        return home;
    }
    let path = std::path::Path::new(requested);
    if path.is_dir() {
        // canonicalize — 심링크 해석, ".."/"."  제거
        path.canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| requested.to_string())
    } else {
        home
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_boundary_empty() {
        assert_eq!(find_utf8_boundary(&[]), 0);
    }

    #[test]
    fn utf8_boundary_ascii() {
        let data = b"hello world";
        assert_eq!(find_utf8_boundary(data), data.len());
    }

    #[test]
    fn utf8_boundary_complete_korean() {
        let data = "안녕하세요".as_bytes();
        assert_eq!(find_utf8_boundary(data), data.len());
    }

    #[test]
    fn utf8_boundary_truncated_multibyte_end() {
        // "안" = 0xEC 0x95 0x88 (3바이트). 끝 2바이트 자름.
        let full = "안".as_bytes();
        let truncated = &full[..full.len() - 1];
        // valid_up_to는 완전 시퀀스만 인정 → 0
        assert_eq!(find_utf8_boundary(truncated), 0);

        // ASCII 뒤에 불완전 한글 1바이트 붙인 경우
        let mut mixed = b"hi ".to_vec();
        mixed.push(0xEC);
        // valid prefix = "hi " (3바이트)
        assert_eq!(find_utf8_boundary(&mixed), 3);
    }

    #[test]
    fn utf8_boundary_preserves_whole_characters() {
        // "한글" = 6바이트. 4바이트까지 = 첫 3바이트("한") + 불완전 1바이트
        let full = "한글".as_bytes();
        assert_eq!(full.len(), 6);
        // 앞 4바이트만 — "한"은 완성, 뒤 0xEA는 불완전 시작
        let b = find_utf8_boundary(&full[..4]);
        assert_eq!(b, 3); // "한"까지 유효
    }

    #[test]
    fn resolve_cwd_empty_returns_home() {
        let home = dirs::home_dir().unwrap().to_string_lossy().to_string();
        assert_eq!(resolve_cwd(""), home);
    }

    #[test]
    fn resolve_cwd_nonexistent_returns_home() {
        let home = dirs::home_dir().unwrap().to_string_lossy().to_string();
        assert_eq!(resolve_cwd("/nonexistent/path/xyzzy/123"), home);
    }

    #[test]
    fn resolve_cwd_existing_dir() {
        let tmp = std::env::temp_dir();
        let resolved = resolve_cwd(tmp.to_str().unwrap());
        // canonicalize가 심링크를 해석하므로 tmp와 다를 수 있지만 존재하는 디렉토리여야
        assert!(std::path::Path::new(&resolved).is_dir());
    }

    #[test]
    fn resolve_cwd_file_not_dir_returns_home() {
        // 파일 경로(디렉토리 아님)를 넘기면 home으로 fallback
        let home = dirs::home_dir().unwrap().to_string_lossy().to_string();
        // /etc/hosts는 macOS/Linux에 항상 존재하는 파일
        if std::path::Path::new("/etc/hosts").is_file() {
            assert_eq!(resolve_cwd("/etc/hosts"), home);
        }
    }

    #[test]
    fn default_shell_platform() {
        let sh = default_shell();
        assert!(!sh.is_empty());
        #[cfg(target_os = "macos")]
        assert_eq!(sh, "/bin/zsh");
        #[cfg(target_os = "linux")]
        assert_eq!(sh, "/bin/bash");
    }

    #[test]
    fn pty_manager_new_empty() {
        let mgr = PtyManager::new();
        assert!(mgr.get_pid(0).is_none());
        assert!(mgr.get_pid(9999).is_none());
    }

    #[test]
    fn pty_manager_destroy_nonexistent_is_noop() {
        // 없는 id를 destroy해도 패닉 없어야 함
        let mgr = PtyManager::new();
        mgr.destroy(42);
        mgr.destroy_all();
    }

    #[test]
    fn pty_manager_write_resize_nonexistent_is_noop() {
        let mgr = PtyManager::new();
        mgr.write(42, "hello");
        mgr.resize(42, 80, 24);
    }
}

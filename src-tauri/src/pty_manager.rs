use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};

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
    child: Box<dyn portable_pty::Child + Send>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<u32, PtySession>>,
    counter: AtomicU32,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
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

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");

        // cwd 설정
        let start_dir = if !cwd.is_empty() && std::path::Path::new(&cwd).is_dir() {
            cwd
        } else {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "/".to_string())
        };
        cmd.cwd(&start_dir);

        // 환경변수
        cmd.env("TERM", "xterm-256color");
        cmd.env("LANG", "ko_KR.UTF-8");
        cmd.env("LC_ALL", "ko_KR.UTF-8");

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let session = PtySession {
            writer,
            master: pair.master,
            child,
        };

        self.sessions.lock().insert(id, session);

        // PTY 출력 스레드
        let app_handle = app.clone();
        let session_id = id;
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(
                            "pty:data",
                            PtyDataPayload {
                                id: session_id,
                                data,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
            let _ = app_handle.emit(
                "pty:exit",
                PtyExitPayload {
                    id: session_id,
                    exit_code: 0,
                },
            );
        });

        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(&id) {
            let _ = session.writer.write_all(data.as_bytes());
            let _ = session.writer.flush();
        }
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) {
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

    pub fn destroy(&self, id: u32) {
        let mut sessions = self.sessions.lock();
        if let Some(mut session) = sessions.remove(&id) {
            let _ = session.child.kill();
        }
    }

    pub fn destroy_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
        }
    }

    pub fn get_pid(&self, id: u32) -> Option<u32> {
        let sessions = self.sessions.lock();
        sessions.get(&id).and_then(|s| s.child.process_id())
    }
}

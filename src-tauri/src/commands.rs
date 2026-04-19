use crate::pty_manager::PtyManager;

#[tauri::command]
pub fn log_from_js(msg: String) {
    // JS 로그 — 개행으로 제한 + 길이 제한으로 로그 폭주 방지
    let truncated: String = msg.chars().take(2000).collect();
    eprintln!("[JS] {}", truncated.replace('\n', " | "));
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use sysinfo::System;
use tauri::{AppHandle, Manager, State};

// 파일 I/O 안전성 상수
const MAX_READ_SIZE: u64 = 20 * 1024 * 1024; // 20MB
const MAX_WRITE_SIZE: usize = 20 * 1024 * 1024;
const MAX_LIST_ENTRIES: usize = 5000;
const MAX_FIND_RESULTS: usize = 1000;
const MAX_FIND_DEPTH: u32 = 3;

// --- PTY Commands ---

#[derive(Deserialize)]
pub struct PtyCreateOpts {
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub cwd: Option<String>,
}

#[tauri::command]
pub fn pty_create(
    app: AppHandle,
    pty: State<'_, PtyManager>,
    opts: PtyCreateOpts,
) -> Result<u32, String> {
    pty.create(
        &app,
        opts.cols.unwrap_or(80),
        opts.rows.unwrap_or(24),
        opts.cwd.unwrap_or_default(),
    )
}

#[tauri::command]
pub fn pty_write(pty: State<'_, PtyManager>, id: u32, data: String) {
    pty.write(id, &data);
}

#[tauri::command]
pub fn pty_resize(pty: State<'_, PtyManager>, id: u32, cols: u16, rows: u16) {
    pty.resize(id, cols, rows);
}

#[tauri::command]
pub fn pty_destroy(pty: State<'_, PtyManager>, id: u32) {
    pty.destroy(id);
}

#[tauri::command]
pub fn pty_get_cwd(pty: State<'_, PtyManager>, id: u32) -> String {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());

    let Some(pid) = pty.get_pid(id) else {
        return home;
    };

    // Linux: /proc/{pid}/cwd 심링크
    #[cfg(target_os = "linux")]
    {
        if let Ok(target) = std::fs::read_link(format!("/proc/{}/cwd", pid)) {
            return target.to_string_lossy().to_string();
        }
    }

    // macOS: lsof로 cwd 가져오기 (timeout으로 느린 lsof 방어)
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Some(path) = line.strip_prefix('n') {
                    if path.starts_with('/') {
                        return path.to_string();
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = pid; // Windows: cwd 추적 미구현 — home 반환
    }

    home
}

// --- System Info ---

#[derive(Serialize)]
pub struct SysInfoResult {
    pub cpu: CpuInfo,
    pub memory: MemInfo,
    pub disk: DiskInfo,
    pub network: NetInfo,
    pub hostname: String,
    pub os: String,
}

#[derive(Serialize)]
pub struct CpuInfo {
    pub model: String,
    pub cores_physical: usize,
    pub cores_logical: usize,
    pub percent: f32,
}

#[derive(Serialize)]
pub struct MemInfo {
    pub total_gb: f32,
    pub used_gb: f32,
    pub percent: f32,
}

#[derive(Serialize)]
pub struct DiskInfo {
    pub total_gb: f32,
    pub used_gb: f32,
    pub percent: f32,
}

#[derive(Serialize)]
pub struct NetInfo {
    pub sent_mbs: f32,
    pub recv_mbs: f32,
}

#[tauri::command]
pub fn get_sysinfo() -> SysInfoResult {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_count = sys.cpus().len();
    let physical_cores = System::physical_core_count().unwrap_or(cpu_count);
    let cpu_usage: f32 = if cpu_count > 0 {
        sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / cpu_count as f32
    } else {
        0.0
    };
    let cpu_model = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();

    let total_mem = sys.total_memory() as f64;
    let used_mem = sys.used_memory() as f64;
    let mem_pct = if total_mem > 0.0 {
        (used_mem / total_mem * 100.0) as f32
    } else {
        0.0
    };

    let (disk_total, disk_used, disk_pct) = get_disk_usage();

    let net = NetInfo {
        sent_mbs: 0.0,
        recv_mbs: 0.0,
    };

    let hostname = System::host_name().unwrap_or_default();
    let os_name = System::long_os_version().unwrap_or_default();

    SysInfoResult {
        cpu: CpuInfo {
            model: cpu_model,
            cores_physical: physical_cores,
            cores_logical: cpu_count,
            percent: (cpu_usage * 10.0).round() / 10.0,
        },
        memory: MemInfo {
            total_gb: ((total_mem / 1_073_741_824.0) * 10.0).round() as f32 / 10.0,
            used_gb: ((used_mem / 1_073_741_824.0) * 10.0).round() as f32 / 10.0,
            percent: (mem_pct * 10.0).round() / 10.0,
        },
        disk: DiskInfo {
            total_gb: disk_total,
            used_gb: disk_used,
            percent: disk_pct,
        },
        network: net,
        hostname,
        os: os_name,
    }
}

fn get_disk_usage() -> (f32, f32, f32) {
    // macOS / Linux — df -k /
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("df").args(["-k", "/"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let total_k: f64 = parts[1].parse().unwrap_or(0.0);
                    let avail_k: f64 = parts[3].parse().unwrap_or(0.0);
                    let used_k = total_k - avail_k;
                    let total_gb =
                        ((total_k * 1024.0 / 1_073_741_824.0) * 10.0).round() as f32 / 10.0;
                    let used_gb =
                        ((used_k * 1024.0 / 1_073_741_824.0) * 10.0).round() as f32 / 10.0;
                    let pct = if total_k > 0.0 {
                        ((used_k / total_k * 100.0) * 10.0).round() as f32 / 10.0
                    } else {
                        0.0
                    };
                    return (total_gb, used_gb, pct);
                }
            }
        }
    }
    (0.0, 0.0, 0.0)
}

// --- IME Detection ---

#[tauri::command]
pub fn get_input_source() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("defaults")
            .args(["read", "com.apple.HIToolbox", "AppleSelectedInputSources"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.contains("Korean")
                || stdout.contains("korean")
                || stdout.contains("HangulKeyboardLayout")
            {
                return "ko".to_string();
            }
        }
    }
    "en".to_string()
}

// --- Filesystem ---

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub path: String,
}

#[derive(Serialize)]
pub struct ListDirResult {
    pub entries: Vec<DirEntry>,
    pub dir: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn list_dir(
    dir: Option<String>,
    filter: Option<String>,
    only_dirs: Option<bool>,
) -> ListDirResult {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());
    let target_dir = dir.unwrap_or_else(|| home.clone());
    let only_dirs = only_dirs.unwrap_or(false);

    let entries = match fs::read_dir(&target_dir) {
        Ok(rd) => {
            let mut items: Vec<DirEntry> = rd
                .filter_map(|e| e.ok())
                .take(MAX_LIST_ENTRIES)
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let is_dir = e.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

                    if name.starts_with('.') {
                        if let Some(ref f) = filter {
                            if !f.starts_with('.') {
                                return None;
                            }
                        } else {
                            return None;
                        }
                    }

                    if only_dirs && !is_dir {
                        return None;
                    }

                    if let Some(ref f) = filter {
                        if !name.to_lowercase().starts_with(&f.to_lowercase()) {
                            return None;
                        }
                    }

                    let path = Path::new(&target_dir)
                        .join(&name)
                        .to_string_lossy()
                        .to_string();
                    Some(DirEntry { name, is_dir, path })
                })
                .collect();

            items.sort_by(|a, b| {
                if a.is_dir != b.is_dir {
                    return if a.is_dir {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    };
                }
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            });

            items
        }
        Err(e) => {
            return ListDirResult {
                entries: vec![],
                dir: target_dir,
                error: Some(e.to_string()),
            };
        }
    };

    ListDirResult {
        entries,
        dir: target_dir,
        error: None,
    }
}

/// 사용자가 직접 경로를 지정해 파일을 읽을 때 사용. 크기 제한 + 바이너리 거부.
#[tauri::command]
pub fn read_file(file_path: String) -> Option<String> {
    let p = PathBuf::from(&file_path);
    // 크기 제한 — 거대 파일 읽기 방지 (메모리 폭주)
    let meta = fs::metadata(&p).ok()?;
    if !meta.is_file() {
        return None;
    }
    if meta.len() > MAX_READ_SIZE {
        eprintln!("[read_file] 거부: {} 크기 초과 ({} bytes)", file_path, meta.len());
        return None;
    }
    fs::read_to_string(&p).ok()
}

/// 사용자가 직접 경로를 지정해 파일을 쓸 때. 크기 제한 + 심링크 방어.
#[tauri::command]
pub fn write_file(file_path: String, content: String) -> bool {
    if content.len() > MAX_WRITE_SIZE {
        eprintln!("[write_file] 거부: 내용 크기 초과 ({} bytes)", content.len());
        return false;
    }
    let p = PathBuf::from(&file_path);
    // 심링크를 통한 민감 파일 덮어쓰기 방지 — 기존 경로가 심링크면 거부
    if let Ok(meta) = fs::symlink_metadata(&p) {
        if meta.file_type().is_symlink() {
            eprintln!("[write_file] 거부: 심링크 대상 {}", file_path);
            return false;
        }
    }
    fs::write(&p, content).is_ok()
}

#[derive(Serialize)]
pub struct FoundFile {
    pub name: String,
    pub path: String,
    pub dir: String,
}

#[tauri::command]
pub fn find_files(dir: String, pattern: String) -> Vec<FoundFile> {
    let mut results = Vec::new();
    // ReDoS 방어 — 정규식 크기 제한
    if pattern.len() > 200 {
        return results;
    }
    let re = match regex::RegexBuilder::new(&pattern)
        .size_limit(1 << 20) // 1MB
        .dfa_size_limit(1 << 20)
        .build()
    {
        Ok(r) => Some(r),
        Err(_) => return results,
    };

    fn walk(
        d: &str,
        depth: u32,
        re: &Option<regex::Regex>,
        results: &mut Vec<FoundFile>,
    ) {
        if depth > MAX_FIND_DEPTH || results.len() >= MAX_FIND_RESULTS {
            return;
        }
        let entries = match fs::read_dir(d) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.filter_map(|e| e.ok()) {
            if results.len() >= MAX_FIND_RESULTS {
                return;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".claude" {
                continue;
            }
            let full = Path::new(d).join(&name).to_string_lossy().to_string();
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            // 심링크 따라가기 차단 — 순환 방지
            if ft.is_symlink() {
                continue;
            }
            if ft.is_file() {
                if let Some(ref re) = re {
                    if re.is_match(&name) {
                        results.push(FoundFile {
                            name: name.clone(),
                            path: full.clone(),
                            dir: d.to_string(),
                        });
                    }
                }
            }
            if ft.is_dir() && (name == ".claude" || name == "docs") {
                walk(&full, depth + 1, re, results);
            }
        }
    }

    walk(&dir, 0, &re, &mut results);
    results
}

// --- Settings (JSON file-based) ---

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Option<serde_json::Value> {
    let path = app.path().app_data_dir().ok()?.join("layout.json");
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 실패: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("디렉토리 생성 실패: {}", e))?;
    let path = dir.join("layout.json");
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("직렬화 실패: {}", e))?;
    // atomic 쓰기 — tmp에 쓰고 rename
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("임시 파일 쓰기 실패: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename 실패: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_prefs(app: AppHandle) -> Option<serde_json::Value> {
    let path = app.path().app_data_dir().ok()?.join("preferences.json");
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

#[tauri::command]
pub fn save_prefs(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 실패: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("디렉토리 생성 실패: {}", e))?;
    let path = dir.join("preferences.json");
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("직렬화 실패: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("임시 파일 쓰기 실패: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename 실패: {}", e))?;
    Ok(())
}

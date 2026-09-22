//! Rolling logs and on-disk crash reports. Panics write a file under logs/crashes.

use serde::{Deserialize, Serialize};
use std::{
    any::Any,
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};

const LOG_NAME: &str = "structurelab.log";
const CRASH_DIR_NAME: &str = "crashes";
const CRASH_KEEP: usize = 10;
const LOG_ROTATE_BYTES: u64 = 2 * 1024 * 1024;
const LOG_KEEP_BYTES: u64 = 400 * 1024;

static LOG_LOCK: Mutex<()> = Mutex::new(());
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub version: u32,
    pub kind: String,
    pub title: String,
    pub time: String,
    pub reason: String,
    pub details: String,
    pub log_dir: String,
    pub log_file: String,
    #[serde(default)]
    pub environment: String,
    #[serde(default)]
    pub exit_code: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashLogInfo {
    pub log_dir: String,
    pub log_file: String,
    pub report_file: String,
}

pub fn log_dir() -> PathBuf {
    LOG_DIR
        .get_or_init(|| {
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    let candidate = parent.join("logs");
                    if fs::create_dir_all(&candidate).is_ok() && dir_is_writable(&candidate) {
                        return candidate;
                    }
                }
            }
            let fallback = std::env::temp_dir().join("structurelab").join("logs");
            let _ = fs::create_dir_all(&fallback);
            fallback
        })
        .clone()
}

fn dir_is_writable(dir: &Path) -> bool {
    let probe = dir.join(".write-test");
    match fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

pub fn log_file_path() -> PathBuf {
    log_dir().join(LOG_NAME)
}

fn crash_dir() -> PathBuf {
    let dir = log_dir().join(CRASH_DIR_NAME);
    let _ = fs::create_dir_all(&dir);
    dir
}

fn crash_file_stem(stamp: &str) -> String {
    let safe: String = stamp
        .chars()
        .map(|ch| match ch {
            '0'..='9' | 'a'..='z' | 'A'..='Z' => ch,
            _ => '-',
        })
        .collect();
    let safe = safe.trim_matches('-');
    if safe.is_empty() {
        "crash".into()
    } else {
        format!("crash-{safe}")
    }
}

fn unique_crash_stem(stamp: &str) -> String {
    let dir = crash_dir();
    let base = crash_file_stem(stamp);
    let candidate = dir.join(format!("{base}.txt"));
    if !candidate.exists() {
        return base;
    }
    for n in 2..100 {
        let stem = format!("{base}-{n}");
        if !dir.join(format!("{stem}.txt")).exists() {
            return stem;
        }
    }
    format!("{base}-{}", std::process::id())
}

fn crash_txt_path(stem: &str) -> PathBuf {
    crash_dir().join(format!("{stem}.txt"))
}

fn crash_json_path(stem: &str) -> PathBuf {
    crash_dir().join(format!("{stem}.json"))
}

fn newest_crash_file(extension: &str) -> Option<PathBuf> {
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let Ok(entries) = fs::read_dir(crash_dir()) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with("crash-") || !name.ends_with(extension) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        files.push((modified, path));
    }
    files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    files.into_iter().next().map(|(_, path)| path)
}

fn prune_old_crashes() {
    let Ok(entries) = fs::read_dir(crash_dir()) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) => name,
            None => continue,
        };
        if !name.starts_with("crash-") || !name.ends_with(".txt") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        files.push((modified, path));
    }
    files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, txt) in files.into_iter().skip(CRASH_KEEP) {
        let json = txt.with_extension("json");
        let _ = fs::remove_file(&txt);
        let _ = fs::remove_file(json);
    }
}

fn latest_report_path() -> PathBuf {
    newest_crash_file(".json")
        .or_else(|| newest_crash_file(".txt"))
        .unwrap_or_else(|| crash_dir().join("crash-latest.txt"))
}

pub fn log_info() -> CrashLogInfo {
    CrashLogInfo {
        log_dir: log_dir().display().to_string(),
        log_file: log_file_path().display().to_string(),
        report_file: latest_report_path().display().to_string(),
    }
}

pub fn now_stamp() -> String {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct SystemTime {
            year: u16,
            month: u16,
            day_of_week: u16,
            day: u16,
            hour: u16,
            minute: u16,
            second: u16,
            millis: u16,
        }
        extern "system" {
            fn GetLocalTime(lp: *mut SystemTime);
        }
        let mut time = SystemTime {
            year: 0,
            month: 0,
            day_of_week: 0,
            day: 0,
            hour: 0,
            minute: 0,
            second: 0,
            millis: 0,
        };
        unsafe { GetLocalTime(&mut time) };
        return format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            time.year, time.month, time.day, time.hour, time.minute, time.second
        );
    }
    #[cfg(not(windows))]
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("unix:{secs}")
    }
}

fn format_bytes_gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

fn describe_exit_code(code: u32) -> String {
    let hint = match code {
        0 => "clean exit",
        1 => "generic error or Task Manager end task",
        0xC000_0005 => "access violation",
        0xC000_00FD => "stack overflow",
        0xC000_0374 => "heap corruption",
        0xC000_0409 => "fast fail",
        _ => "",
    };
    if hint.is_empty() {
        format!("{code} (0x{code:08X})")
    } else {
        format!("{code} (0x{code:08X}, {hint})")
    }
}

fn os_version_line() -> String {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct OsVersionInfo {
            size: u32,
            major: u32,
            minor: u32,
            build: u32,
            platform: u32,
            service_pack: [u16; 128],
        }
        #[link(name = "ntdll")]
        extern "system" {
            fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
        }
        let mut info = OsVersionInfo {
            size: std::mem::size_of::<OsVersionInfo>() as u32,
            major: 0,
            minor: 0,
            build: 0,
            platform: 0,
            service_pack: [0; 128],
        };
        let status = unsafe { RtlGetVersion(&mut info) };
        if status == 0 {
            return format!("windows {}.{}.{}", info.major, info.minor, info.build);
        }
        return "windows".into();
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("sw_vers").arg("-productVersion").output() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                return format!("macos {version}");
            }
        }
        return "macos".into();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(text) = fs::read_to_string("/etc/os-release") {
            for line in text.lines() {
                if let Some(value) = line.strip_prefix("PRETTY_NAME=") {
                    return value.trim_matches('"').to_string();
                }
            }
        }
        return "linux".into();
    }
    #[cfg(not(any(windows, unix)))]
    {
        std::env::consts::OS.to_string()
    }
}

fn memory_line() -> String {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct MemoryStatusEx {
            length: u32,
            memory_load: u32,
            total_phys: u64,
            avail_phys: u64,
            total_page: u64,
            avail_page: u64,
            total_virtual: u64,
            avail_virtual: u64,
            avail_extended: u64,
        }
        extern "system" {
            fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
        }
        let mut status = MemoryStatusEx {
            length: std::mem::size_of::<MemoryStatusEx>() as u32,
            memory_load: 0,
            total_phys: 0,
            avail_phys: 0,
            total_page: 0,
            avail_page: 0,
            total_virtual: 0,
            avail_virtual: 0,
            avail_extended: 0,
        };
        if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 && status.total_phys > 0 {
            return format!(
                "{} total, {} available",
                format_bytes_gb(status.total_phys),
                format_bytes_gb(status.avail_phys)
            );
        }
        return "unknown".into();
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Ok(bytes) = text.parse::<u64>() {
                return format!("{} total", format_bytes_gb(bytes));
            }
        }
        return "unknown".into();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(text) = fs::read_to_string("/proc/meminfo") {
            let mut total = None;
            let mut available = None;
            for line in text.lines() {
                if let Some(rest) = line.strip_prefix("MemTotal:") {
                    total = rest.split_whitespace().next().and_then(|n| n.parse::<u64>().ok());
                }
                if let Some(rest) = line.strip_prefix("MemAvailable:") {
                    available = rest.split_whitespace().next().and_then(|n| n.parse::<u64>().ok());
                }
            }
            if let Some(total_kb) = total {
                let total_s = format_bytes_gb(total_kb * 1024);
                if let Some(avail_kb) = available {
                    return format!(
                        "{total_s} total, {} available",
                        format_bytes_gb(avail_kb * 1024)
                    );
                }
                return format!("{total_s} total");
            }
        }
        return "unknown".into();
    }
    #[cfg(not(any(windows, unix)))]
    {
        "unknown".into()
    }
}

fn environment_summary(exit_code: Option<u32>) -> String {
    let build = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let cores = std::thread::available_parallelism()
        .map(|n| n.get().to_string())
        .unwrap_or_else(|_| "unknown".into());
    let mut lines = vec![
        format!("App: StructureLab {} ({build})", env!("CARGO_PKG_VERSION")),
        format!("OS: {}", os_version_line()),
        format!("Arch: {}", std::env::consts::ARCH),
        format!("CPU cores: {cores}"),
        format!("Memory: {}", memory_line()),
        format!("PID: {}", std::process::id()),
    ];
    if let Some(code) = exit_code {
        lines.push(format!("Exit code: {}", describe_exit_code(code)));
    }
    lines.join("\n")
}

pub fn append_log(line: &str) {
    let _guard = LOG_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let path = log_file_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    rotate_log_if_needed(&path);
    let stamp = now_stamp();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{stamp}] {line}");
        let _ = file.flush();
    }
}

fn rotate_log_if_needed(path: &Path) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() <= LOG_ROTATE_BYTES {
        return;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return;
    };
    let skip = meta.len().saturating_sub(LOG_KEEP_BYTES);
    if skip > 0 {
        let _ = file.seek(SeekFrom::Start(skip));
    }
    let mut buf = String::new();
    let _ = file.read_to_string(&mut buf);
    if let Some(cut) = buf.find('\n') {
        buf = buf[cut + 1..].to_string();
    }
    let _ = fs::write(path, buf);
}

pub fn log_tail(max_chars: usize) -> String {
    let path = log_file_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return String::new();
    };
    if text.len() <= max_chars {
        return text;
    }
    text[text.len() - max_chars..].to_string()
}

pub fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return (*text).to_string();
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }
    "unknown panic".into()
}

pub fn catch_convert<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)) {
        Ok(result) => result.map_err(|error| {
            append_log(&format!("[convert] {error}"));
            error
        }),
        Err(payload) => {
            let reason = panic_message(&*payload);
            append_log(&format!("[convert panic] {reason}"));
            Err(format!(
                "Convert crashed ({reason}). This is usually the process running out of memory. Try a smaller size, Hollow, or fewer parts. A log was written to {}.",
                log_file_path().display()
            ))
        }
    }
}

pub fn write_crash_report(kind: &str, title: &str, reason: &str, details: &str) -> CrashReport {
    let extra = log_tail(6000);
    let mut merged = details.trim().to_string();
    if !extra.is_empty() {
        if !merged.is_empty() {
            merged.push_str("\n\n--- recent log ---\n");
        }
        merged.push_str(&extra);
    }
    let environment = environment_summary(None);
    let report = CrashReport {
        version: 1,
        kind: kind.to_string(),
        title: title.to_string(),
        time: now_stamp(),
        reason: reason.to_string(),
        details: merged,
        log_dir: crash_dir().display().to_string(),
        log_file: log_file_path().display().to_string(),
        environment,
        exit_code: None,
    };
    let stem = unique_crash_stem(&report.time);
    let txt_path = crash_txt_path(&stem);
    if let Ok(json) = serde_json::to_string_pretty(&report) {
        let _ = fs::write(crash_json_path(&stem), json);
    }
    let _ = fs::write(
        &txt_path,
        format!(
            "StructureLab crash report\n\
Time: {}\n\
Kind: {}\n\
Title: {}\n\n\
What happened:\n{}\n\n\
Environment:\n{}\n\n\
Details:\n{}\n\n\
Crash folder: {}\n\
Log file: {}\n",
            report.time,
            report.kind,
            report.title,
            report.reason,
            report.environment,
            report.details,
            report.log_dir,
            report.log_file
        ),
    );
    prune_old_crashes();
    append_log(&format!("[crash:{kind}] {reason} ({})", txt_path.display()));
    report
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let reason = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "unknown panic".into()
        };
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown location".into());
        let backtrace = std::backtrace::Backtrace::force_capture();
        let details = format!("Location: {location}\n\n{backtrace}");
        write_crash_report("panic", "StructureLab crashed", &reason, &details);
        previous(info);
    }));
}

pub fn show_native_alert(title: &str, body: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        fn wide(text: &str) -> Vec<u16> {
            std::ffi::OsStr::new(text)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        }
        extern "system" {
            fn MessageBoxW(
                hwnd: *mut std::ffi::c_void,
                text: *const u16,
                caption: *const u16,
                ty: u32,
            ) -> i32;
        }
        const MB_OK: u32 = 0;
        const MB_ICONERROR: u32 = 0x0000_0010;
        let caption = wide(title);
        let text = wide(body);
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                caption.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let body = body.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"display alert "{title}" message "{body}" as critical buttons {{"OK"}} default button "OK""#
        );
        let _ = Command::new("osascript").args(["-e", &script]).status();
        return;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if Command::new("zenity")
            .args(["--error", "--title", title, "--text", body])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return;
        }
        let _ = Command::new("kdialog")
            .args(["--title", title, "--error", body])
            .status();
        return;
    }
    #[cfg(not(any(windows, unix)))]
    {
        eprintln!("{title}: {body}");
    }
}

fn reveal_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|error| format!("could not open folder: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|error| format!("could not open folder: {error}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|error| format!("could not open folder: {error}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
pub fn crash_log_info() -> CrashLogInfo {
    log_info()
}

#[tauri::command]
pub fn open_log_folder() -> Result<(), String> {
    reveal_dir(&log_dir())
}

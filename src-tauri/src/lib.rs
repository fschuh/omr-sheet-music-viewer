use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const PROTOCOL_VERSION: u8 = 1;

fn worker_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let log_directory = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&log_directory).map_err(|error| error.to_string())?;
    Ok(log_directory.join("worker.log"))
}

fn append_worker_log(path: &Path, line: &str) {
    if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(log, "{line}");
        let _ = log.flush();
    }
}

fn strip_ansi_codes(value: &str) -> String {
    let mut cleaned = String::with_capacity(value.len());
    let mut in_escape = false;
    for character in value.chars() {
        if character == '\u{1b}' {
            in_escape = true;
        } else if in_escape {
            if character.is_ascii_alphabetic() {
                in_escape = false;
            }
        } else {
            cleaned.push(character);
        }
    }
    cleaned
}

struct WorkerProcess {
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
}

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(Default)]
struct WorkerSupervisor {
    process: Mutex<Option<WorkerProcess>>,
}

impl WorkerSupervisor {
    fn ensure_started(&self, app: &AppHandle) -> Result<(), String> {
        let mut process = self
            .process
            .lock()
            .map_err(|_| "Worker lock was poisoned")?;
        if let Some(current) = process.as_mut() {
            let mut child = current
                .child
                .lock()
                .map_err(|_| "Worker process lock was poisoned")?;
            let is_running = child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none();
            drop(child);
            if is_running {
                return Ok(());
            }
        }
        *process = None;

        let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Could not locate the viewer repository")?
            .to_path_buf();
        let worker_directory = repository_root.join("worker");
        #[cfg(windows)]
        let python = repository_root
            .join(".venv")
            .join("Scripts")
            .join("python.exe");
        #[cfg(not(windows))]
        let python = repository_root.join(".venv").join("bin").join("python");

        if !python.is_file() {
            return Err(format!(
                "Viewer Python environment not found at {}",
                python.display()
            ));
        }
        if !worker_directory.is_dir() {
            return Err(format!(
                "Worker source not found at {}",
                worker_directory.display()
            ));
        }

        let mut command = Command::new(&python);
        command
            .arg("-X")
            .arg("faulthandler")
            .arg("-m")
            .arg("sheet_music_worker")
            .current_dir(&worker_directory)
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start the HOMR worker: {error}"))?;
        let worker_pid = child.id();
        let stdin = child.stdin.take().ok_or("Worker stdin was unavailable")?;
        let stdout = child.stdout.take().ok_or("Worker stdout was unavailable")?;
        let stderr = child.stderr.take().ok_or("Worker stderr was unavailable")?;
        let child = Arc::new(Mutex::new(child));
        let log_path = worker_log_path(app)?;
        let startup_line = format!("=== HOMR worker started (PID {worker_pid}) ===");
        append_worker_log(&log_path, &startup_line);
        let _ = app.emit(
            "worker-event",
            json!({"type":"worker_log", "line": startup_line}),
        );

        let event_app = app.clone();
        let stdout_log_path = log_path.clone();
        let stdout_child = child.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => match serde_json::from_str::<Value>(&line) {
                        Ok(event) => {
                            let _ = event_app.emit("worker-event", event);
                        }
                        Err(error) => {
                            let message = format!("Worker protocol error: {error}");
                            append_worker_log(&stdout_log_path, &message);
                            let _ = event_app.emit(
                                "worker-event",
                                json!({"type":"protocol_error", "message": message}),
                            );
                        }
                    },
                    Err(error) => {
                        let message = format!("Could not read worker output: {error}");
                        append_worker_log(&stdout_log_path, &message);
                        let _ = event_app.emit(
                            "worker-event",
                            json!({"type":"worker_stopped", "message": message}),
                        );
                        return;
                    }
                }
            }
            let exit_detail = match stdout_child.lock() {
                Ok(mut child) => child
                    .wait()
                    .map(|status| status.to_string())
                    .unwrap_or_else(|error| format!("unknown status: {error}")),
                Err(_) => "unknown status: worker process lock was poisoned".to_string(),
            };
            let message = format!(
                "The Python worker stopped unexpectedly ({exit_detail}). Reopen the PDF to restart it."
            );
            append_worker_log(&stdout_log_path, &message);
            let _ = event_app.emit(
                "worker-event",
                json!({"type":"worker_stopped", "message": message}),
            );
        });
        let log_app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                match line {
                    Ok(line) => {
                        let line = strip_ansi_codes(&line);
                        append_worker_log(&log_path, &line);
                        eprintln!("[homr-worker] {line}");
                        let _ = log_app
                            .emit("worker-event", json!({"type":"worker_log", "line": line}));
                    }
                    Err(error) => {
                        let message = format!("Could not read worker log output: {error}");
                        append_worker_log(&log_path, &message);
                        let _ = log_app.emit(
                            "worker-event",
                            json!({"type":"worker_log", "line": message}),
                        );
                        break;
                    }
                }
            }
        });

        *process = Some(WorkerProcess { child, stdin });
        Ok(())
    }

    fn send(&self, app: &AppHandle, message: Value) -> Result<(), String> {
        self.ensure_started(app)?;
        let mut process = self
            .process
            .lock()
            .map_err(|_| "Worker lock was poisoned")?;
        let worker = process.as_mut().ok_or("Worker was not running")?;
        serde_json::to_writer(&mut worker.stdin, &message).map_err(|error| error.to_string())?;
        worker
            .stdin
            .write_all(b"\n")
            .map_err(|error| error.to_string())?;
        worker.stdin.flush().map_err(|error| error.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageArtifactData {
    music_xml: String,
    visual_sidecar: Value,
}

#[tauri::command]
async fn choose_pdf() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("PDF document", &["pdf"])
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .unwrap_or(None)
}

#[tauri::command]
fn open_pdf(
    app: AppHandle,
    worker: State<'_, WorkerSupervisor>,
    path: String,
) -> Result<String, String> {
    let pdf = PathBuf::from(&path);
    if !pdf.is_file()
        || pdf
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_lowercase)
            .as_deref()
            != Some("pdf")
    {
        return Err("Choose an existing PDF document".into());
    }
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&cache_root).map_err(|error| error.to_string())?;
    let job_id = Uuid::new_v4().to_string();
    worker.send(
        &app,
        json!({
            "protocol": PROTOCOL_VERSION,
            "id": Uuid::new_v4().to_string(),
            "method": "process_pdf",
            "params": {
                "jobId": job_id,
                "pdfPath": pdf,
                "cacheRoot": cache_root,
            }
        }),
    )?;
    Ok(job_id)
}

#[tauri::command]
fn cancel_job(
    app: AppHandle,
    worker: State<'_, WorkerSupervisor>,
    job_id: String,
) -> Result<(), String> {
    worker.send(
        &app,
        json!({
            "protocol": PROTOCOL_VERSION,
            "id": Uuid::new_v4().to_string(),
            "method": "cancel_job",
            "params": {"jobId": job_id},
        }),
    )
}

#[tauri::command]
fn retry_page(
    app: AppHandle,
    worker: State<'_, WorkerSupervisor>,
    job_id: String,
    page_index: usize,
) -> Result<(), String> {
    worker.send(
        &app,
        json!({
            "protocol": PROTOCOL_VERSION,
            "id": Uuid::new_v4().to_string(),
            "method": "retry_page",
            "params": {"jobId": job_id, "pageIndex": page_index},
        }),
    )
}

fn checked_cache_path(app: &AppHandle, value: &str) -> Result<PathBuf, String> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let candidate = Path::new(value)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !candidate.starts_with(cache_root) {
        return Err("Worker artifact was outside the application cache".into());
    }
    Ok(candidate)
}

#[tauri::command]
fn load_page_artifacts(
    app: AppHandle,
    music_xml_path: String,
    visual_sidecar_path: String,
) -> Result<PageArtifactData, String> {
    let music_xml_path = checked_cache_path(&app, &music_xml_path)?;
    let visual_sidecar_path = checked_cache_path(&app, &visual_sidecar_path)?;
    let music_xml = fs::read_to_string(music_xml_path).map_err(|error| error.to_string())?;
    let visual_sidecar = serde_json::from_str(
        &fs::read_to_string(visual_sidecar_path).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(PageArtifactData {
        music_xml,
        visual_sidecar,
    })
}

#[tauri::command]
fn get_worker_log_path(app: AppHandle) -> Result<String, String> {
    Ok(worker_log_path(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_cache_directory(app: AppHandle, path: String) -> Result<(), String> {
    let directory = checked_cache_path(&app, &path)?;
    if !directory.is_dir() {
        return Err("The PDF cache directory does not exist".into());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg(PathBuf::from(path));
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(directory);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(directory);
        command
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("Opening cache directories is not supported on this platform".into());

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the PDF cache directory: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WorkerSupervisor::default())
        .setup(|app| {
            let cache_root = app.path().app_cache_dir()?;
            fs::create_dir_all(cache_root)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_pdf,
            open_pdf,
            cancel_job,
            retry_page,
            load_page_artifacts,
            get_worker_log_path,
            open_cache_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running the HOMR sheet-music viewer");
}

#[cfg(test)]
mod tests {
    use super::strip_ansi_codes;

    #[test]
    fn worker_logs_strip_terminal_colors() {
        assert_eq!(
            strip_ansi_codes("\u{1b}[32m[INFO]\u{1b}[0m ready"),
            "[INFO] ready"
        );
    }
}

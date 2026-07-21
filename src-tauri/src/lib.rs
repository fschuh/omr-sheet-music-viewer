#[cfg(target_os = "linux")]
use gtk::prelude::{DialogExtManual, GtkWindowExt, WidgetExt};
use midir::{Ignore, MidiInput, MidiInputConnection};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;
#[cfg(target_os = "linux")]
use webkit2gtk::{
    glib::object::Cast, PermissionRequestExt, UserMediaPermissionRequest,
    UserMediaPermissionRequestExt, WebViewExt,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPI_GETKEYBOARDDELAY, SPI_GETKEYBOARDSPEED,
    SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

const PROTOCOL_VERSION: u8 = 1;
const DEFAULT_KEYBOARD_REPEAT_DELAY_MS: u32 = 400;
const DEFAULT_KEYBOARD_REPEAT_INTERVAL_MS: u32 = 75;
const MIDI_INITIALIZATION_TIMEOUT: Duration = Duration::from_secs(4);
const MIDI_UNAVAILABLE_ERROR: &str = "MIDI initialization timed out because the system MIDI service did not respond. MIDI controls are disabled for this session; keyboard controls and the rest of the app remain available. Restart the MIDI service or your computer, then reopen the app to try again.";

#[cfg(target_os = "linux")]
fn install_linux_microphone_permission_handler<R: tauri::Runtime>(
    webview: &tauri::WebviewWindow<R>,
) -> tauri::Result<()> {
    webview.with_webview(|platform_webview| {
        platform_webview
            .inner()
            .connect_permission_request(|webview, request| {
                let Some(media_request) = request.downcast_ref::<UserMediaPermissionRequest>() else {
                    request.deny();
                    return true;
                };
                if !media_request.is_for_audio_device() || media_request.is_for_video_device() {
                    request.deny();
                    return true;
                }

                let parent = webview
                    .toplevel()
                    .and_then(|widget| widget.downcast::<gtk::Window>().ok());
                let mut builder = gtk::MessageDialog::builder()
                    .title("Microphone access")
                    .modal(true)
                    .message_type(gtk::MessageType::Question)
                    .buttons(gtk::ButtonsType::YesNo)
                    .text("Allow HOMR Sheet Music Viewer to use the microphone?")
                    .secondary_text(
                        "Listen mode analyzes microphone audio locally. Audio is not stored or transmitted.",
                    );
                if let Some(parent) = parent.as_ref() {
                    builder = builder.transient_for(parent);
                }
                let dialog = builder.build();
                let request = request.clone();
                gtk::glib::MainContext::default().spawn_local(async move {
                    let response = dialog.run_future().await;
                    dialog.close();
                    if response == gtk::ResponseType::Yes {
                        request.allow();
                    } else {
                        request.deny();
                    }
                });
                true
            });
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardRepeatTiming {
    delay_ms: u32,
    interval_ms: u32,
}

impl Default for KeyboardRepeatTiming {
    fn default() -> Self {
        Self {
            delay_ms: DEFAULT_KEYBOARD_REPEAT_DELAY_MS,
            interval_ms: DEFAULT_KEYBOARD_REPEAT_INTERVAL_MS,
        }
    }
}

#[cfg(any(target_os = "windows", test))]
fn repeat_timing_from_windows_settings(
    delay_setting: u32,
    speed_setting: u32,
) -> KeyboardRepeatTiming {
    let delay_ms = (delay_setting.min(3) + 1) * 250;
    let repeats_per_second = 2.5 + (speed_setting.min(31) as f64 / 31.0) * 27.5;
    let interval_ms = (1000.0 / repeats_per_second).round() as u32;
    KeyboardRepeatTiming {
        delay_ms,
        interval_ms,
    }
}

#[cfg(target_os = "windows")]
fn keyboard_repeat_timing() -> KeyboardRepeatTiming {
    let mut delay_setting = 0u32;
    let mut speed_setting = 0u32;
    let query_result = unsafe {
        SystemParametersInfoW(
            SPI_GETKEYBOARDDELAY,
            0,
            Some((&raw mut delay_setting).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .and_then(|_| {
            SystemParametersInfoW(
                SPI_GETKEYBOARDSPEED,
                0,
                Some((&raw mut speed_setting).cast()),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        })
    };
    query_result
        .map(|_| repeat_timing_from_windows_settings(delay_setting, speed_setting))
        .unwrap_or_default()
}

#[cfg(not(target_os = "windows"))]
fn keyboard_repeat_timing() -> KeyboardRepeatTiming {
    KeyboardRepeatTiming::default()
}

type MidiConnections = Vec<MidiInputConnection<()>>;
type MidiScanResult = Result<(Vec<String>, MidiConnections), String>;

#[derive(Clone, Default)]
struct MidiInputManager {
    connections: Arc<Mutex<MidiConnections>>,
    refresh_in_progress: Arc<AtomicBool>,
    unavailable: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiMessageEvent {
    port: String,
    timestamp: u64,
    bytes: Vec<u8>,
}

fn is_channel_voice_message(message: &[u8]) -> bool {
    message
        .first()
        .is_some_and(|status| (0x80..=0xef).contains(status))
}

fn discover_midi_inputs(app: &AppHandle) -> MidiScanResult {
    let probe =
        MidiInput::new("Sheet Music Viewer MIDI input").map_err(|error| error.to_string())?;
    let port_count = probe.port_count();
    drop(probe);

    let mut connected_names = Vec::new();
    let mut connections = Vec::new();
    let mut connection_errors = Vec::new();
    for port_index in 0..port_count {
        let mut midi_input = match MidiInput::new("Sheet Music Viewer MIDI input") {
            Ok(input) => input,
            Err(error) => {
                connection_errors.push(error.to_string());
                continue;
            }
        };
        // System-exclusive, timing, and active-sensing events are not useful page-turn controls.
        midi_input.ignore(Ignore::All);
        let ports = midi_input.ports();
        let Some(port) = ports.get(port_index).cloned() else {
            continue;
        };
        let port_name = midi_input
            .port_name(&port)
            .unwrap_or_else(|_| format!("MIDI input {}", port_index + 1));
        let event_port = port_name.clone();
        let event_app = app.clone();
        let connection_name = format!("Sheet Music Viewer page turner input {}", port_index + 1);
        match midi_input.connect(
            &port,
            &connection_name,
            move |timestamp, message, _| {
                if !is_channel_voice_message(message) {
                    return;
                }
                let _ = event_app.emit(
                    "midi-message",
                    MidiMessageEvent {
                        port: event_port.clone(),
                        timestamp,
                        bytes: message.to_vec(),
                    },
                );
            },
            (),
        ) {
            Ok(connection) => {
                connected_names.push(port_name);
                connections.push(connection);
            }
            Err(error) => connection_errors.push(format!("{port_name}: {error}")),
        }
    }

    if connections.is_empty() && !connection_errors.is_empty() {
        return Err(format!(
            "Could not connect to a MIDI input: {}",
            connection_errors.join("; ")
        ));
    }
    Ok((connected_names, connections))
}

fn run_with_timeout<T, F>(timeout: Duration, operation: F) -> Result<T, mpsc::RecvTimeoutError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(operation());
    });
    receiver.recv_timeout(timeout)
}

impl MidiInputManager {
    fn refresh(&self, app: AppHandle) -> Result<Vec<String>, String> {
        if self.unavailable.load(Ordering::Acquire) {
            return Err(MIDI_UNAVAILABLE_ERROR.into());
        }
        if self
            .refresh_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("A MIDI input scan is already in progress.".into());
        }

        let previous_connections = match self.connections.lock() {
            Ok(mut connections) => std::mem::take(&mut *connections),
            Err(_) => {
                self.refresh_in_progress.store(false, Ordering::Release);
                return Err("MIDI input lock was poisoned".into());
            }
        };
        let scan = run_with_timeout(MIDI_INITIALIZATION_TIMEOUT, move || {
            // WinMM devices are commonly exclusive, so release old handles before reconnecting.
            // This also keeps a stalled driver call away from the UI thread and manager lock.
            drop(previous_connections);
            discover_midi_inputs(&app)
        });
        self.refresh_in_progress.store(false, Ordering::Release);

        match scan {
            Ok(Ok((connected_names, connections))) => {
                *self
                    .connections
                    .lock()
                    .map_err(|_| "MIDI input lock was poisoned")? = connections;
                Ok(connected_names)
            }
            Ok(Err(error)) => Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.unavailable.store(true, Ordering::Release);
                Err(MIDI_UNAVAILABLE_ERROR.into())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.unavailable.store(true, Ordering::Release);
                Err("MIDI initialization stopped unexpectedly. MIDI controls are disabled for this session; keyboard controls and the rest of the app remain available. Reopen the app to try again.".into())
            }
        }
    }
}

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
fn read_music_xml(app: AppHandle, path: String) -> Result<String, String> {
    let music_xml = checked_cache_path(&app, &path)?;
    if !music_xml.is_file() || !has_music_xml_extension(&music_xml) {
        return Err("The merged MusicXML file does not exist".into());
    }
    fs::read_to_string(music_xml).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_music_xml(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    let music_xml = checked_cache_path(&app, &path)?;
    if !music_xml.is_file() || !has_music_xml_extension(&music_xml) {
        return Err("The merged MusicXML file does not exist".into());
    }
    fs::write(music_xml, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_worker_log_path(app: AppHandle) -> Result<String, String> {
    Ok(worker_log_path(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
async fn refresh_midi_inputs(
    app: AppHandle,
    midi_inputs: State<'_, MidiInputManager>,
) -> Result<Vec<String>, String> {
    let midi_inputs = midi_inputs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || midi_inputs.refresh(app))
        .await
        .map_err(|error| format!("MIDI initialization task failed: {error}"))?
}

#[tauri::command]
fn get_keyboard_repeat_timing() -> KeyboardRepeatTiming {
    keyboard_repeat_timing()
}

fn open_with_system(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg(path);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("Opening files is not supported on this platform".into());

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open {}: {error}", path.display()))
}

fn has_music_xml_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("musicxml"))
}

#[tauri::command]
fn open_music_xml(app: AppHandle, path: String) -> Result<(), String> {
    let music_xml = checked_cache_path(&app, &path)?;
    if !music_xml.is_file() || !has_music_xml_extension(&music_xml) {
        return Err("The merged MusicXML file does not exist".into());
    }
    open_with_system(&music_xml)
}

#[tauri::command]
fn open_cache_directory(app: AppHandle, path: String) -> Result<(), String> {
    let directory = checked_cache_path(&app, &path)?;
    if !directory.is_dir() {
        return Err("The PDF cache directory does not exist".into());
    }
    open_with_system(&directory)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WorkerSupervisor::default())
        .manage(MidiInputManager::default())
        .setup(|app| {
            let cache_root = app.path().app_cache_dir()?;
            fs::create_dir_all(cache_root)?;
            #[cfg(target_os = "linux")]
            if let Some(main_webview) = app.get_webview_window("main") {
                install_linux_microphone_permission_handler(&main_webview)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_pdf,
            open_pdf,
            cancel_job,
            retry_page,
            load_page_artifacts,
            read_music_xml,
            write_music_xml,
            get_worker_log_path,
            refresh_midi_inputs,
            get_keyboard_repeat_timing,
            open_music_xml,
            open_cache_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running the HOMR sheet-music viewer");
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::thread;
    use std::time::Duration;

    use super::{
        has_music_xml_extension, is_channel_voice_message, repeat_timing_from_windows_settings,
        run_with_timeout, strip_ansi_codes, KeyboardRepeatTiming,
    };

    #[test]
    fn worker_logs_strip_terminal_colors() {
        assert_eq!(
            strip_ansi_codes("\u{1b}[32m[INFO]\u{1b}[0m ready"),
            "[INFO] ready"
        );
    }

    #[test]
    fn system_open_only_accepts_musicxml_extensions() {
        assert!(has_music_xml_extension(Path::new("score.musicxml")));
        assert!(has_music_xml_extension(Path::new("score.MUSICXML")));
        assert!(!has_music_xml_extension(Path::new("score.xml")));
        assert!(!has_music_xml_extension(Path::new("score.musicxml.exe")));
    }

    #[test]
    fn midi_input_accepts_all_channel_voice_statuses_only() {
        assert!(is_channel_voice_message(&[0x80, 60, 0]));
        assert!(is_channel_voice_message(&[0x9f, 60, 127]));
        assert!(is_channel_voice_message(&[0xbe, 64, 127]));
        assert!(is_channel_voice_message(&[0xef, 0, 64]));
        assert!(!is_channel_voice_message(&[0xf8]));
        assert!(!is_channel_voice_message(&[0xfe]));
        assert!(!is_channel_voice_message(&[]));
    }

    #[test]
    fn background_operations_return_before_the_timeout() {
        assert_eq!(run_with_timeout(Duration::from_millis(100), || 42), Ok(42));
    }

    #[test]
    fn stalled_background_operations_time_out() {
        let result = run_with_timeout(Duration::from_millis(1), || {
            thread::sleep(Duration::from_millis(25));
            42
        });
        assert_eq!(result, Err(std::sync::mpsc::RecvTimeoutError::Timeout));
    }

    #[test]
    fn windows_keyboard_settings_convert_to_repeat_timings() {
        assert_eq!(
            repeat_timing_from_windows_settings(0, 0),
            KeyboardRepeatTiming {
                delay_ms: 250,
                interval_ms: 400,
            }
        );
        assert_eq!(
            repeat_timing_from_windows_settings(3, 31),
            KeyboardRepeatTiming {
                delay_ms: 1000,
                interval_ms: 33,
            }
        );
        assert_eq!(
            repeat_timing_from_windows_settings(99, 99),
            repeat_timing_from_windows_settings(3, 31),
        );
    }
}

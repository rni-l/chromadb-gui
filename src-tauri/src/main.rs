// Desktop shell: runs the existing Node server as a sidecar and points a system
// WebView at it. The page itself is plain HTTP and uses no Tauri APIs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::VecDeque;
use std::fs::File;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Fixed first choice so the page origin, and with it localStorage (theme, search
/// history), stays the same across launches. 4580 is left to the web version.
const PREFERRED_PORT: u16 = 4590;
const PORT_ATTEMPTS: u16 = 50;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const LOG_TAIL_LINES: usize = 40;

#[derive(Default)]
struct Sidecar {
    child: Mutex<Option<CommandChild>>,
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Sidecar::default())
        .setup(|app| {
            let window = create_window(app.handle())?;
            if cfg!(debug_assertions) {
                // `tauri dev` loads devUrl, served by `pnpm dev` (API + hot reload).
                return Ok(());
            }
            if let Err(e) = start_server(app.handle(), window.clone()) {
                show_error(&window, "启动失败", &e, "");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = app.state::<Sidecar>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let opener = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Chroma GUI")
        .inner_size(1400.0, 900.0)
        .min_inner_size(1000.0, 640.0)
        .center()
        .on_navigation(move |url| {
            if is_internal(url) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        // wry already saves to the Downloads folder with a de-duplicated name; there is
        // no browser download bar, so show the file once it is written.
        .on_download(move |webview, event| {
            if let DownloadEvent::Finished { path: Some(path), success: true, .. } = event {
                let _ = webview.opener().reveal_item_in_dir(path);
            }
            true
        })
        .build()
}

fn is_internal(url: &Url) -> bool {
    matches!(url.scheme(), "tauri" | "asset")
        || matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost"))
}

fn pick_port() -> Result<u16, String> {
    (PREFERRED_PORT..PREFERRED_PORT + PORT_ATTEMPTS)
        .find(|&p| TcpListener::bind((Ipv4Addr::LOCALHOST, p)).is_ok())
        .ok_or_else(|| format!("{PREFERRED_PORT}–{} 端口都被占用", PREFERRED_PORT + PORT_ATTEMPTS - 1))
}

/// Node cannot import an ESM entry from a Windows `\\?\` verbatim path.
fn plain_path(p: PathBuf) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p,
    }
}

fn start_server(app: &AppHandle, window: WebviewWindow) -> Result<(), String> {
    let port = pick_port()?;
    let resources = plain_path(app.path().resource_dir().map_err(|e| e.to_string())?);
    let log_path = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join("server.log");
    let _ = std::fs::create_dir_all(log_path.parent().unwrap());
    let mut log_file = File::create(&log_path).ok();

    let (mut rx, child) = app
        .shell()
        .sidecar("node")
        .map_err(|e| e.to_string())?
        .arg(resources.join("server").join("index.mjs"))
        .current_dir(&resources)
        .envs([
            ("NODE_ENV", "production".to_string()),
            ("HOST", "127.0.0.1".to_string()),
            ("PORT", port.to_string()),
            ("WEB_DIST", resources.join("web").to_string_lossy().into_owned()),
            // The server exits when our end of its stdin closes, even if we crash.
            ("CHROMADB_GUI_PARENT_STDIN", "1".to_string()),
        ])
        .spawn()
        .map_err(|e| format!("无法启动 Node：{e}"))?;
    *app.state::<Sidecar>().child.lock().unwrap() = Some(child);

    let exited = Arc::new(AtomicBool::new(false));
    let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));

    {
        let (exited, tail, window, log_path) = (exited.clone(), tail.clone(), window.clone(), log_path.clone());
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                let line = match event {
                    CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => String::from_utf8_lossy(&b).into_owned(),
                    CommandEvent::Error(e) => e,
                    CommandEvent::Terminated(p) => {
                        exited.store(true, Ordering::SeqCst);
                        let tail = tail.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("");
                        let code = p.code.map_or("被信号终止".into(), |c| format!("退出码 {c}"));
                        show_error(&window, "服务已退出", &format!("{code}，日志：{}", log_path.display()), &tail);
                        break;
                    }
                    _ => continue,
                };
                if let Some(f) = log_file.as_mut() {
                    let _ = f.write_all(line.as_bytes());
                }
                let mut t = tail.lock().unwrap();
                t.push_back(line);
                if t.len() > LOG_TAIL_LINES {
                    t.pop_front();
                }
            }
        });
    }

    std::thread::spawn(move || {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let started = Instant::now();
        while !exited.load(Ordering::SeqCst) {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
                let url = Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
                let _ = window.navigate(url);
                return;
            }
            if started.elapsed() > STARTUP_TIMEOUT {
                show_error(&window, "启动超时", &format!("服务在 {}s 内没有就绪，日志：{}", STARTUP_TIMEOUT.as_secs(), log_path.display()), "");
                return;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    });
    Ok(())
}

fn show_error(window: &WebviewWindow, title: &str, detail: &str, log: &str) {
    let args = [title, detail, log].map(|s| serde_json::to_string(s).unwrap());
    let _ = window.eval(format!("window.showError({}, {}, {})", args[0], args[1], args[2]));
}

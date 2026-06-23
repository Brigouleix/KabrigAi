use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent,
};
use tauri_plugin_global_shortcut::ShortcutState;

// Garde le handle du backend (uvicorn) lancé par l'app, pour le tuer à la sortie.
struct Backend(Mutex<Option<Child>>);

fn start_backend() -> Option<Child> {
    // exe = .../KabrigAI/frontend/src-tauri/target/<profil>/app.exe
    let exe = std::env::current_exe().ok()?;
    let root = exe.ancestors().nth(5)?.to_path_buf(); // .../KabrigAI
    let backend = root.join("backend");
    let python = backend.join(".venv").join("Scripts").join("python.exe");
    if !python.exists() {
        return None; // dev sans venv au bon endroit : on laisse le backend manuel
    }
    let mut cmd = Command::new(python);
    cmd.args(["-m", "uvicorn", "app.main:app", "--port", "8000"])
        .current_dir(&backend);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console
    }
    cmd.spawn().ok()
}

fn kill_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+space"])
                .expect("invalid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Démarre le backend Python et garde son handle pour le tuer à la sortie.
            app.manage(Backend(Mutex::new(start_backend())));

            let show = MenuItem::with_id(app, "show", "Afficher Kabrig", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Kabrig AI (Ctrl+Espace)")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // À la fermeture totale de l'app : on coupe le backend.
            if let RunEvent::Exit = event {
                kill_backend(app_handle);
            }
        });
}

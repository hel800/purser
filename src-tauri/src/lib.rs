use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_sql::{Migration, MigrationKind};

const QUICK_ADD_SHORTCUT: &str = "ctrl+alt+n";
const LIST_SHORTCUT: &str = "ctrl+alt+l";

const TRAY_DARK: tauri::image::Image<'static> = tauri::include_image!("./icons/tray-dark-32.png");

/// Whether the Windows taskbar (and tray area) is in light mode. The taskbar
/// follows the *system* theme (`SystemUsesLightTheme`), which can differ from
/// the app theme (`AppsUseLightTheme`) in Custom personalization mode, so the
/// registry is read directly. A missing value defaults to a dark taskbar.
#[cfg(windows)]
fn taskbar_is_light() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|key| key.get_value("SystemUsesLightTheme"))
        .map(|value: u32| value == 1)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn taskbar_is_light() -> bool {
    false
}

#[derive(Clone, Serialize, Deserialize)]
struct Settings {
    hour24: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { hour24: true }
    }
}

/// Label of the window that opened the keyboard-shortcut sheet, if it is
/// open. Kept so the caller stays visible underneath (modal behavior) and
/// regains focus when the sheet closes.
struct SheetOwner(Mutex<Option<String>>);

fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

/// Returns the stored settings and whether this is the first run.
fn load_settings(app: &AppHandle) -> (Settings, bool) {
    let Some(path) = settings_path(app) else {
        return (Settings::default(), false);
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => (serde_json::from_str(&raw).unwrap_or_default(), false),
        Err(_) => (Settings::default(), true),
    }
}

fn save_settings(app: &AppHandle, settings: &Settings) {
    let Some(path) = settings_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(raw) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(path, raw);
    }
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, Mutex<Settings>>) -> Settings {
    state.lock().unwrap().clone()
}

#[tauri::command]
fn open_about(app: AppHandle) {
    show_about(&app);
}

/// The keyboard-shortcut sheet is a small always-on-top window like About,
/// but it behaves like a modal: whichever window opened it (or the tray)
/// stays visible underneath, and the sheet hands focus back on close.
fn show_help(app: &AppHandle, owner: Option<String>) {
    if let Some(win) = app.get_webview_window("help") {
        // set the owner before taking focus, so the caller's focus-loss
        // handler sees the sheet as open and does not hide it
        *app.state::<SheetOwner>().0.lock().unwrap() = owner;
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn help_is_open(app: &AppHandle) -> bool {
    app.state::<SheetOwner>().0.lock().unwrap().is_some()
}

fn close_help_inner(app: &AppHandle) {
    let owner = {
        let state = app.state::<SheetOwner>();
        let mut guard = state.0.lock().unwrap();
        guard.take()
    };
    if let Some(win) = app.get_webview_window("help") {
        let _ = win.hide();
    }
    if let Some(label) = owner {
        if let Some(owner_win) = app.get_webview_window(&label) {
            if owner_win.is_visible().unwrap_or(false) {
                let _ = owner_win.set_focus();
            }
        }
    }
}

#[tauri::command]
fn open_help(window: WebviewWindow, app: AppHandle) {
    show_help(&app, Some(window.label().to_string()));
}

#[tauri::command]
fn close_help(app: AppHandle) {
    close_help_inner(&app);
}

fn toggle_quick_add(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("quickadd") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit("purser://focus", ());
        }
    }
}

/// Bottom-right of the primary monitor's work area — directly above the
/// clock, clear of the taskbar and never spilling onto another monitor.
/// (The tray with the clock lives on the primary monitor on Windows.)
fn position_popup(win: &WebviewWindow) {
    let monitor = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, win.outer_size()) else {
        return;
    };
    let wa = monitor.work_area();
    let margin = (12.0 * monitor.scale_factor()).round() as i32;
    let x = wa.position.x + wa.size.width as i32 - size.width as i32 - margin;
    let y = wa.position.y + wa.size.height as i32 - size.height as i32 - margin;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn toggle_popup(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            position_popup(&win);
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit("purser://refresh", ());
        }
    }
}

fn show_about(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("about") {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// CLI flags double as the hotkey fallback on Linux/Wayland, where
/// applications cannot grab global shortcuts: bind e.g.
/// `purser --quick-add` in the desktop environment's keyboard settings.
fn handle_cli_args(app: &AppHandle, args: &[String]) {
    if args.iter().any(|a| a == "--quick-add") {
        toggle_quick_add(app);
    } else if args.iter().any(|a| a == "--toggle-list") {
        toggle_popup(app);
    } else if args.iter().any(|a| a == "--autostart") {
        // started with Windows: stay in the tray, show nothing
    } else {
        toggle_popup(app);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create schema",
            sql: "CREATE TABLE IF NOT EXISTS categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    color TEXT NOT NULL,
                    created_at TEXT NOT NULL
                  );
                  CREATE TABLE IF NOT EXISTS todos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    text TEXT NOT NULL,
                    due_at TEXT,
                    created_at TEXT NOT NULL,
                    done_at TEXT,
                    category_id INTEGER
                  );",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_cli_args(app, &argv);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:purser.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_settings, open_about, open_help, close_help])
        .setup(|app| {
            let (settings, first_run) = load_settings(app.handle());
            if first_run {
                // opt in to autostart once; afterwards the tray setting rules
                #[cfg(not(debug_assertions))]
                let _ = app.autolaunch().enable();
                save_settings(app.handle(), &settings);
            }
            app.manage(Mutex::new(settings.clone()));
            app.manage(SheetOwner(Mutex::new(None)));

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

                let quick_add: Shortcut = QUICK_ADD_SHORTCUT.parse().unwrap();
                let list: Shortcut = LIST_SHORTCUT.parse().unwrap();

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts([quick_add, list])?
                        .with_handler(move |app, shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            if shortcut == &quick_add {
                                toggle_quick_add(app);
                            } else if shortcut == &list {
                                toggle_popup(app);
                            }
                        })
                        .build(),
                )?;

                let autostart_item = CheckMenuItem::with_id(
                    app,
                    "autostart",
                    "Start with Windows",
                    true,
                    app.autolaunch().is_enabled().unwrap_or(false),
                    None::<&str>,
                )?;
                let hour24_item = CheckMenuItem::with_id(
                    app,
                    "hour24",
                    "24-hour clock",
                    true,
                    settings.hour24,
                    None::<&str>,
                )?;
                let settings_menu =
                    Submenu::with_items(app, "Settings", true, &[&autostart_item, &hour24_item])?;

                let menu = Menu::with_items(
                    app,
                    &[
                        &MenuItem::with_id(app, "add", "Add todo\tCtrl+Alt+N", true, None::<&str>)?,
                        &MenuItem::with_id(app, "list", "Show todos\tCtrl+Alt+L", true, None::<&str>)?,
                        &settings_menu,
                        &PredefinedMenuItem::separator(app)?,
                        &MenuItem::with_id(app, "help", "Keyboard shortcuts", true, None::<&str>)?,
                        &MenuItem::with_id(app, "about", "About Purser", true, None::<&str>)?,
                        &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                    ],
                )?;

                let autostart_check = autostart_item.clone();
                let hour24_check = hour24_item.clone();

                TrayIconBuilder::with_id("main")
                    .icon(if taskbar_is_light() {
                        TRAY_DARK
                    } else {
                        app.default_window_icon().unwrap().clone()
                    })
                    .tooltip("Purser")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "add" => toggle_quick_add(app),
                        "list" => toggle_popup(app),
                        "autostart" => {
                            // the click already flipped the checkbox; apply it
                            let enable = autostart_check.is_checked().unwrap_or(false);
                            let result = if enable {
                                app.autolaunch().enable()
                            } else {
                                app.autolaunch().disable()
                            };
                            if result.is_err() {
                                let actual = app.autolaunch().is_enabled().unwrap_or(!enable);
                                let _ = autostart_check.set_checked(actual);
                            }
                        }
                        "hour24" => {
                            let hour24 = hour24_check.is_checked().unwrap_or(true);
                            let state = app.state::<Mutex<Settings>>();
                            let snapshot = {
                                let mut s = state.lock().unwrap();
                                s.hour24 = hour24;
                                s.clone()
                            };
                            save_settings(app, &snapshot);
                            let _ = app.emit("purser://settings-changed", snapshot);
                        }
                        "quit" => app.exit(0),
                        "help" => show_help(app, None),
                        "about" => show_about(app),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            toggle_popup(tray.app_handle());
                        }
                    })
                    .build(app)?;

                let args: Vec<String> = std::env::args().skip(1).collect();
                if !args.is_empty() {
                    handle_cli_args(app.handle(), &args);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // the app lives in the tray: closing or losing focus just hides
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) => {
                let app = window.app_handle();
                if window.label() == "help" {
                    // sheet lost focus (tray click, another popup…) — close
                    // it and hand focus back to the window that opened it
                    close_help_inner(app);
                } else if !help_is_open(app) {
                    let _ = window.hide();
                }
                // else: the keyboard-shortcut sheet is on top — keep the
                // caller open underneath so it reads like a modal
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

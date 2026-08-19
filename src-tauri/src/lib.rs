use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::Shortcut;
use tauri_plugin_sql::{Migration, MigrationKind};

const DEFAULT_QUICK_ADD_SHORTCUT: &str = "ctrl+alt+n";
const DEFAULT_LIST_SHORTCUT: &str = "ctrl+alt+l";

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
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default = "default_hour24")]
    hour24: bool,
    #[serde(default = "default_quick_add_shortcut")]
    quick_add_shortcut: String,
    #[serde(default = "default_list_shortcut")]
    list_shortcut: String,
}

fn default_hour24() -> bool {
    true
}

fn default_quick_add_shortcut() -> String {
    DEFAULT_QUICK_ADD_SHORTCUT.into()
}

fn default_list_shortcut() -> String {
    DEFAULT_LIST_SHORTCUT.into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hour24: default_hour24(),
            quick_add_shortcut: default_quick_add_shortcut(),
            list_shortcut: default_list_shortcut(),
        }
    }
}

/// Settings as sent to the webviews — includes display-ready shortcut
/// strings so combo formatting lives in one place (the tray uses it too).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsDto {
    hour24: bool,
    quick_add_shortcut: String,
    list_shortcut: String,
    quick_add_pretty: String,
    list_pretty: String,
}

impl From<&Settings> for SettingsDto {
    fn from(s: &Settings) -> Self {
        Self {
            hour24: s.hour24,
            quick_add_shortcut: s.quick_add_shortcut.clone(),
            list_shortcut: s.list_shortcut.clone(),
            quick_add_pretty: pretty_shortcut(&s.quick_add_shortcut),
            list_pretty: pretty_shortcut(&s.list_shortcut),
        }
    }
}

/// The tray's "Add todo"/"Show todos" items, so their accelerator text can
/// be refreshed when a shortcut changes.
struct TrayShortcutItems(Mutex<Option<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>)>>);

/// Label of the window that opened the keyboard-shortcut sheet, if it is
/// open. Kept so the caller stays visible underneath (modal behavior) and
/// regains focus when the sheet closes.
struct SheetOwner(Mutex<Option<String>>);

/// True while the help sheet is recording a combo. A combo owned by another
/// application triggers that app and steals focus — in that case the sheet
/// must stay open (the frontend stops the recording and explains) instead
/// of silently disappearing.
struct Capturing(AtomicBool);

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
fn get_settings(state: tauri::State<'_, Mutex<Settings>>) -> SettingsDto {
    SettingsDto::from(&*state.lock().unwrap())
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

/// While the help sheet records a combo, Purser's own global shortcuts are
/// unregistered so the keypress reaches the sheet's webview (where it is
/// captured by a plain keydown handler) instead of firing its action.
#[tauri::command]
fn begin_capture(app: AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    app.state::<Capturing>().0.store(true, Ordering::Relaxed);
    let _ = app.global_shortcut().unregister_all();
}

/// Recording ended without an assignment (cancelled, or the sheet lost
/// focus): restore the registration for whatever Settings holds.
#[tauri::command]
fn end_capture(app: AppHandle) {
    app.state::<Capturing>().0.store(false, Ordering::Relaxed);
    if let Err(e) = register_both(&app) {
        eprintln!("shortcut registration: {e}");
        let _ = app.emit("purser://shortcut-error", e);
    }
}

/// (Re-)registers both global shortcuts from the current Settings, replacing
/// whatever is registered. Invalid stored combos are skipped (startup resets
/// those to defaults); a registration failure is returned for the caller to
/// revert or surface.
fn register_both(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let (qa_raw, list_raw) = {
        let state = app.state::<Mutex<Settings>>();
        let s = state.lock().unwrap();
        (s.quick_add_shortcut.clone(), s.list_shortcut.clone())
    };
    let _ = app.global_shortcut().unregister_all();
    let mut problems = Vec::new();
    for raw in [&qa_raw, &list_raw] {
        if let Ok(combo) = raw.parse::<Shortcut>() {
            if let Err(e) = app.global_shortcut().register(combo) {
                problems.push(format!("{} ({e})", pretty_shortcut(raw)));
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Could not register {} — the combination may be in use by another application.",
            problems.join(" and ")
        ))
    }
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

/// Human-friendly form of a stored combo ("ctrl+alt+n" → "Ctrl+Alt+N") for
/// the tray menu accelerator text.
fn pretty_shortcut(combo: &str) -> String {
    combo
        .split('+')
        .map(|token| match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "Ctrl".to_string(),
            "alt" | "option" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "super" | "cmd" | "command" | "win" => "Win".to_string(),
            t if t.len() == 1 => t.to_uppercase(),
            t => {
                let mut chars = t.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn set_tray_shortcut_labels(app: &AppHandle, settings: &Settings) {
    let state = app.state::<TrayShortcutItems>();
    let items = state.0.lock().unwrap();
    let Some((add, list)) = items.as_ref() else {
        return;
    };
    let _ = add.set_text(format!(
        "Add todo\t{}",
        pretty_shortcut(&settings.quick_add_shortcut)
    ));
    let _ = list.set_text(format!(
        "Show todos\t{}",
        pretty_shortcut(&settings.list_shortcut)
    ));
}

/// Replaces one of the two global shortcuts: validates the combo, persists
/// it and re-registers both hotkeys (reverting the setting on failure).
#[tauri::command]
fn set_shortcut(app: AppHandle, id: String, shortcut: String) -> Result<(), String> {
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|_| format!("Unsupported key combination \"{shortcut}\"."))?;
    if parsed.mods.is_empty() {
        return Err("A shortcut needs at least one modifier (Ctrl, Alt, Shift or Win).".into());
    }

    let settings_state = app.state::<Mutex<Settings>>();
    let mut settings = settings_state.lock().unwrap();
    let (old_raw, other_raw) = match id.as_str() {
        "quick_add" => (settings.quick_add_shortcut.clone(), settings.list_shortcut.clone()),
        "list" => (settings.list_shortcut.clone(), settings.quick_add_shortcut.clone()),
        _ => return Err("Unknown shortcut id.".into()),
    };
    // compare parsed values, not strings, so "alt+ctrl+n" == "ctrl+alt+n"
    if other_raw.parse::<Shortcut>().ok() == Some(parsed) {
        return Err("That combination is already used by the other shortcut.".into());
    }
    if old_raw.parse::<Shortcut>().ok() == Some(parsed) {
        // keeping the current combo is a no-op, not an error; re-register
        // since capture mode unregistered everything
        drop(settings);
        app.state::<Capturing>().0.store(false, Ordering::Relaxed);
        return register_both(&app);
    }

    match id.as_str() {
        "quick_add" => settings.quick_add_shortcut = shortcut,
        "list" => settings.list_shortcut = shortcut,
        _ => unreachable!(),
    }
    let snapshot = settings.clone();
    drop(settings);

    if let Err(e) = register_both(&app) {
        // revert the setting and restore the previous registration
        {
            let mut settings = settings_state.lock().unwrap();
            match id.as_str() {
                "quick_add" => settings.quick_add_shortcut = old_raw.clone(),
                _ => settings.list_shortcut = old_raw.clone(),
            }
        }
        if let Err(revert_err) = register_both(&app) {
            let _ = app.emit(
                "purser://shortcut-error",
                format!("Restoring {} also failed: {revert_err}", pretty_shortcut(&old_raw)),
            );
        }
        return Err(e);
    }

    app.state::<Capturing>().0.store(false, Ordering::Relaxed);
    save_settings(&app, &snapshot);
    set_tray_shortcut_labels(&app, &snapshot);
    let _ = app.emit("purser://settings-changed", SettingsDto::from(&snapshot));
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_shortcut,
            begin_capture,
            end_capture,
            open_about,
            open_help,
            close_help
        ])
        .setup(|app| {
            let (settings, first_run) = load_settings(app.handle());
            if first_run {
                // opt in to autostart once; afterwards the tray setting rules
                #[cfg(not(debug_assertions))]
                let _ = app.autolaunch().enable();
                save_settings(app.handle(), &settings);
            }
            app.manage(Mutex::new(settings));
            app.manage(SheetOwner(Mutex::new(None)));
            app.manage(Capturing(AtomicBool::new(false)));
            app.manage(TrayShortcutItems(Mutex::new(None)));

            // an invalid stored combo would otherwise be un-fixable from the
            // UI: reset it to the default so display and registration agree
            {
                let state = app.state::<Mutex<Settings>>();
                let mut s = state.lock().unwrap();
                let mut fixed = false;
                if s.quick_add_shortcut.parse::<Shortcut>().is_err() {
                    s.quick_add_shortcut = DEFAULT_QUICK_ADD_SHORTCUT.into();
                    fixed = true;
                }
                if s.list_shortcut.parse::<Shortcut>().is_err() {
                    s.list_shortcut = DEFAULT_LIST_SHORTCUT.into();
                    fixed = true;
                }
                if fixed {
                    let snapshot = s.clone();
                    drop(s);
                    save_settings(app.handle(), &snapshot);
                }
            }
            let settings = app.state::<Mutex<Settings>>().lock().unwrap().clone();

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::ShortcutState;

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            // derived from Settings on each press (presses are
                            // rare) so there is no second copy to keep in sync
                            let (quick_add, list) = {
                                let state = app.state::<Mutex<Settings>>();
                                let s = state.lock().unwrap();
                                (
                                    s.quick_add_shortcut.parse::<Shortcut>().ok(),
                                    s.list_shortcut.parse::<Shortcut>().ok(),
                                )
                            };
                            if quick_add.as_ref() == Some(shortcut) {
                                toggle_quick_add(app);
                            } else if list.as_ref() == Some(shortcut) {
                                toggle_popup(app);
                            }
                        })
                        .build(),
                )?;

                // a failure (combo owned by another app) must not be silent:
                // log it and say so in the tray tooltip
                let registration_error = register_both(app.handle()).err();
                if let Some(e) = &registration_error {
                    eprintln!("shortcut registration: {e}");
                }
                let tooltip = match &registration_error {
                    Some(e) => format!("Purser — {e}"),
                    None => "Purser".into(),
                };

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

                let add_text = format!(
                    "Add todo\t{}",
                    pretty_shortcut(&settings.quick_add_shortcut)
                );
                let list_text = format!("Show todos\t{}", pretty_shortcut(&settings.list_shortcut));

                let menu = Menu::with_items(
                    app,
                    &[
                        &MenuItem::with_id(app, "add", add_text, true, None::<&str>)?,
                        &MenuItem::with_id(app, "list", list_text, true, None::<&str>)?,
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
                    .tooltip(&tooltip)
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
                            let _ = app.emit("purser://settings-changed", SettingsDto::from(&snapshot));
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

                // keep refs so the tray accelerator text can be refreshed
                *app.state::<TrayShortcutItems>().0.lock().unwrap() = Some((
                    menu.get("add").ok_or("missing tray item")?.as_menuitem_unchecked().clone(),
                    menu.get("list").ok_or("missing tray item")?.as_menuitem_unchecked().clone(),
                ));

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
                    if app.state::<Capturing>().0.load(Ordering::Relaxed) {
                        // recording lost focus — most likely the combo is
                        // owned by another app and just triggered it. Keep
                        // the sheet open; the frontend stops the recording
                        // (so nothing can be captured unfocused) and explains.
                    } else {
                        // sheet lost focus (tray click, another popup…) —
                        // close it and hand focus back to the opener
                        close_help_inner(app);
                    }
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

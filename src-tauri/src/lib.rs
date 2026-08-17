use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use device_query::{DeviceQuery, DeviceState, Keycode};
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

/// The currently registered global shortcuts, kept in sync with `Settings`
/// so the hotkey handler always fires for the latest combos.
struct Shortcuts(Mutex<(Shortcut, Shortcut)>);

/// The tray's "Add todo"/"Show todos" items, so their accelerator text can
/// be refreshed when a shortcut changes.
struct TrayShortcutItems(Mutex<Option<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>)>>);

/// Label of the window that opened the keyboard-shortcut sheet, if it is
/// open. Kept so the caller stays visible underneath (modal behavior) and
/// regains focus when the sheet closes.
struct SheetOwner(Mutex<Option<String>>);

/// Recording state for the keyboard-shortcut sheet. While `id` is `Some`, an
/// OS-level key listener runs and the global shortcut handler ignores presses,
/// so a re-assigned combo does not fire its action mid-recording.
struct Recording {
    /// Which shortcut is being recorded, if any.
    id: Mutex<Option<String>>,
    /// Set to stop the capture thread.
    stop: Arc<AtomicBool>,
}

/// Event payload sent to the sheet with the outcome of a recording attempt.
#[derive(Clone, Serialize)]
struct Captured {
    id: String,
    /// The recorded combo, or `None` if recording was cancelled or invalid.
    shortcut: Option<String>,
    /// True when the user pressed Escape to cancel.
    cancelled: bool,
    /// Human-readable problem for invalid captures (no modifier, unsupported key).
    reason: Option<String>,
}

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

/// Starts (id is `Some`) or stops (`None`) an OS-level key listener that runs
/// while the sheet records a combo. Keys are captured globally, so recording
/// works even when another app reacts to its own global shortcut.
#[tauri::command]
fn set_recording(app: AppHandle, id: Option<String>) {
    let rec = app.state::<Recording>();
    *rec.id.lock().unwrap() = id.clone();
    if let Some(id) = id {
        rec.stop.store(false, Ordering::Relaxed);
        let app = app.clone();
        let stop = rec.stop.clone();
        std::thread::spawn(move || capture_shortcut(app, id, stop));
    } else {
        rec.stop.store(true, Ordering::Relaxed);
    }
}

/// Polls the global keyboard state until a non-modifier key is pressed (or the
/// recording is stopped) and reports the outcome to the sheet.
fn capture_shortcut(app: AppHandle, id: String, stop: Arc<AtomicBool>) {
    let device = DeviceState::new();
    let mut prev: Vec<Keycode> = Vec::new();
    let mut first = true;
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let keys: Vec<Keycode> = device.get_keys();
        if first {
            // keys held before recording started are not "new presses"
            prev = keys;
            first = false;
            std::thread::sleep(Duration::from_millis(15));
            continue;
        }
        let fresh: Vec<Keycode> = keys.iter().copied().filter(|k| !prev.contains(k)).collect();
        prev = keys.clone();

        if fresh.iter().any(|k| *k == Keycode::Escape) {
            let _ = app.emit(
                "purser://shortcut-captured",
                Captured { id, shortcut: None, cancelled: true, reason: None },
            );
            return;
        }
        let Some(main) = fresh.iter().copied().find(|k| !is_modifier(*k)) else {
            std::thread::sleep(Duration::from_millis(15));
            continue;
        };
        let mods = modifiers_of(&keys);
        if mods.is_empty() {
            let _ = app.emit(
                "purser://shortcut-captured",
                Captured {
                    id,
                    shortcut: None,
                    cancelled: false,
                    reason: Some("Hold down a modifier (Ctrl, Alt, Shift or Win) with a key.".into()),
                },
            );
            return;
        }
        let Some(token) = key_token(main) else {
            let _ = app.emit(
                "purser://shortcut-captured",
                Captured {
                    id,
                    shortcut: None,
                    cancelled: false,
                    reason: Some("Unsupported key — try a letter, number or F-key.".into()),
                },
            );
            return;
        };
        let combo = format!("{}+{}", mods.join("+"), token);
        let _ = app.emit(
            "purser://shortcut-captured",
            Captured { id, shortcut: Some(combo), cancelled: false, reason: None },
        );
        return;
    }
}

fn is_modifier(key: Keycode) -> bool {
    matches!(
        key,
        Keycode::LControl
            | Keycode::RControl
            | Keycode::LShift
            | Keycode::RShift
            | Keycode::LAlt
            | Keycode::RAlt
            | Keycode::LOption
            | Keycode::ROption
            | Keycode::Command
            | Keycode::LMeta
            | Keycode::RMeta
    )
}

/// Pressed modifiers in the canonical ctrl+alt+shift+super order.
fn modifiers_of(keys: &[Keycode]) -> Vec<&'static str> {
    let mut mods = Vec::new();
    if keys.contains(&Keycode::LControl) || keys.contains(&Keycode::RControl) {
        mods.push("ctrl");
    }
    if keys.contains(&Keycode::LAlt)
        || keys.contains(&Keycode::RAlt)
        || keys.contains(&Keycode::LOption)
        || keys.contains(&Keycode::ROption)
    {
        mods.push("alt");
    }
    if keys.contains(&Keycode::LShift) || keys.contains(&Keycode::RShift) {
        mods.push("shift");
    }
    if keys.contains(&Keycode::Command)
        || keys.contains(&Keycode::LMeta)
        || keys.contains(&Keycode::RMeta)
    {
        mods.push("super");
    }
    mods
}

/// Combo token for a non-modifier key, or `None` for keys the shortcut
/// parser does not understand.
fn key_token(key: Keycode) -> Option<String> {
    use Keycode::*;
    match key {
        Space => Some("space".into()),
        Enter => Some("enter".into()),
        Tab => Some("tab".into()),
        Backspace => Some("backspace".into()),
        Delete => Some("delete".into()),
        Up => Some("up".into()),
        Down => Some("down".into()),
        Left => Some("left".into()),
        Right => Some("right".into()),
        _ => {
            let n = key as u8;
            if (A as u8..=Z as u8).contains(&n) {
                Some(char::from(b'a' + (n - A as u8)).to_string())
            } else if (Key0 as u8..=Key9 as u8).contains(&n) {
                Some(char::from(b'0' + (n - Key0 as u8)).to_string())
            } else if (F1 as u8..=F12 as u8).contains(&n) {
                Some(format!("f{}", n - F1 as u8 + 1))
            } else {
                None
            }
        }
    }
}

fn close_help_inner(app: &AppHandle) {
    stop_recording(app);
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

fn stop_recording(app: &AppHandle) {
    let rec = app.state::<Recording>();
    *rec.id.lock().unwrap() = None;
    rec.stop.store(true, Ordering::Relaxed);
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

/// Replaces one of the two global shortcuts: validates the combo, swaps the
/// OS registration (reverting on failure), then persists and broadcasts it.
#[tauri::command]
fn set_shortcut(app: AppHandle, id: String, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

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
    if shortcut.to_ascii_lowercase() == old_raw.to_ascii_lowercase() {
        return Err("That's already the assigned shortcut.".into());
    }
    if shortcut.to_ascii_lowercase() == other_raw.to_ascii_lowercase() {
        return Err("That combination is already used by the other shortcut.".into());
    }

    let old: Shortcut = old_raw
        .parse()
        .map_err(|_| format!("Stored shortcut \"{old_raw}\" is invalid."))?;

    // swap the OS registration first — only persist once it actually works
    let _ = app.global_shortcut().unregister(old);
    app.global_shortcut().register(parsed).map_err(|e| {
        let _ = app.global_shortcut().register(old);
        format!("Could not register the shortcut (already used elsewhere?): {e}")
    })?;

    match id.as_str() {
        "quick_add" => settings.quick_add_shortcut = shortcut,
        "list" => settings.list_shortcut = shortcut,
        _ => unreachable!(),
    }
    let snapshot = settings.clone();
    drop(settings);

    {
        let shortcuts = app.state::<Shortcuts>();
        let mut sc = shortcuts.0.lock().unwrap();
        let (qa, list) = *sc;
        *sc = match id.as_str() {
            "quick_add" => (parsed, list),
            _ => (qa, parsed),
        };
    }

    save_settings(&app, &snapshot);
    set_tray_shortcut_labels(&app, &snapshot);
    let _ = app.emit("purser://settings-changed", snapshot);
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
            set_recording,
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
            app.manage(Mutex::new(settings.clone()));
            app.manage(SheetOwner(Mutex::new(None)));
            app.manage(Recording { id: Mutex::new(None), stop: Arc::new(AtomicBool::new(false)) });
            app.manage(TrayShortcutItems(Mutex::new(None)));

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                use tauri_plugin_global_shortcut::ShortcutState;

                let quick_add: Shortcut = settings
                    .quick_add_shortcut
                    .parse()
                    .unwrap_or_else(|_| DEFAULT_QUICK_ADD_SHORTCUT.parse().unwrap());
                let list: Shortcut = settings
                    .list_shortcut
                    .parse()
                    .unwrap_or_else(|_| DEFAULT_LIST_SHORTCUT.parse().unwrap());
                app.manage(Shortcuts(Mutex::new((quick_add, list))));

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            // the sheet is capturing a combo: swallow presses
                            // so the re-assigned shortcut does not fire
                            if app.state::<Recording>().id.lock().unwrap().is_some() {
                                return;
                            }
                            let shortcuts = app.state::<Shortcuts>();
                            let sc = shortcuts.0.lock().unwrap();
                            if shortcut == &sc.0 {
                                drop(sc);
                                toggle_quick_add(app);
                            } else if shortcut == &sc.1 {
                                drop(sc);
                                toggle_popup(app);
                            }
                        })
                        .build(),
                )?;

                // register whatever is configured; failures are non-fatal
                let _ = app.global_shortcut().register(quick_add);
                let _ = app.global_shortcut().register(list);

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
                if window.label() == "help" {
                    // e.g. Alt+F4 mid-recording must not leave the global
                    // shortcuts suppressed
                    stop_recording(window.app_handle());
                }
                let _ = window.hide();
            }
            WindowEvent::Focused(false) => {
                let app = window.app_handle();
                if window.label() == "help" {
                    if app.state::<Recording>().id.lock().unwrap().is_some() {
                        // still capturing a combo — keep the sheet open so a
                        // stray focus steal does not abort the recording
                    } else {
                        // sheet lost focus (tray click, another popup…) — close
                        // it and hand focus back to the window that opened it
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

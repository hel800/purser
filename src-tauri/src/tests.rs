use super::*;
use std::path::{Path, PathBuf};

fn sample(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../samples/import")
        .join(name)
}

// decode_text

#[test]
fn decode_text_strips_the_utf8_bom() {
    assert_eq!(decode_text(b"\xEF\xBB\xBFa\xC3\xA4"), "aä");
}

#[test]
fn decode_text_keeps_valid_utf8() {
    assert_eq!(decode_text("Müller €".as_bytes()), "Müller €");
}

#[test]
fn decode_text_reads_bom_marked_utf16() {
    assert_eq!(decode_text(&[0xFF, 0xFE, b'a', 0, 0xE4, 0]), "aä");
    assert_eq!(decode_text(&[0xFE, 0xFF, 0, b'a', 0, 0xE4]), "aä");
    // a trailing odd byte is dropped
    assert_eq!(decode_text(&[0xFF, 0xFE, b'a', 0, b'b']), "a");
}

#[test]
fn decode_text_falls_back_to_windows_1252() {
    assert_eq!(
        decode_text(b"5 \x80 \x96 \x84final\x93 pr\xFCfen\x85"),
        "5 € – „final“ prüfen…"
    );
    assert_eq!(decode_text(b"\x81"), "\u{FFFD}");
}

// plural / pretty_shortcut

#[test]
fn plural_picks_the_form() {
    assert_eq!(plural(0, "todo", "todos"), "0 todos");
    assert_eq!(plural(1, "todo", "todos"), "1 todo");
    assert_eq!(plural(2, "todo", "todos"), "2 todos");
}

#[test]
fn pretty_shortcut_formats_modifiers_and_keys() {
    assert_eq!(pretty_shortcut("ctrl+alt+n"), "Ctrl+Alt+N");
    assert_eq!(pretty_shortcut("Control+Option+K"), "Ctrl+Alt+K");
    assert_eq!(pretty_shortcut("super+shift+f12"), "Win+Shift+F12");
    assert_eq!(pretty_shortcut("cmd+space"), "Win+Space");
    assert_eq!(pretty_shortcut(""), "");
}

// Settings

#[test]
fn settings_missing_fields_use_defaults() {
    let s: Settings = serde_json::from_str("{}").unwrap();
    assert!(s.hour24);
    assert!(s.auto_update_check);
    assert_eq!(s.quick_add_shortcut, DEFAULT_QUICK_ADD_SHORTCUT);
    assert_eq!(s.list_shortcut, DEFAULT_LIST_SHORTCUT);
    assert_eq!(s.update_endpoint, None);
}

#[test]
fn settings_use_camel_case_and_omit_an_unset_endpoint() {
    let json = serde_json::to_value(Settings::default()).unwrap();
    assert_eq!(json["hour24"], true);
    assert_eq!(json["quickAddShortcut"], "ctrl+alt+n");
    assert!(json.get("updateEndpoint").is_none());

    let s: Settings = serde_json::from_str(
        r#"{"hour24":false,"listShortcut":"ctrl+alt+x","updateEndpoint":"https://example.org/latest.json"}"#,
    )
    .unwrap();
    assert!(!s.hour24);
    assert_eq!(s.list_shortcut, "ctrl+alt+x");
    assert_eq!(
        s.update_endpoint.as_deref(),
        Some("https://example.org/latest.json")
    );
    assert_eq!(
        serde_json::to_value(&s).unwrap()["updateEndpoint"],
        "https://example.org/latest.json"
    );
}

#[test]
fn settings_dto_adds_display_shortcuts() {
    let dto = SettingsDto::from(&Settings {
        quick_add_shortcut: "ctrl+shift+space".into(),
        ..Settings::default()
    });
    assert_eq!(dto.quick_add_pretty, "Ctrl+Shift+Space");
    assert_eq!(dto.list_pretty, "Ctrl+Alt+L");
}

#[test]
fn tray_shortcut_labels_show_the_shortcuts_as_accelerator_text() {
    let (add, list) = tray_shortcut_labels(&Settings::default());
    assert_eq!(add, "Add todo\tCtrl+Alt+N");
    assert_eq!(list, "Show todos\tCtrl+Alt+L");
}

// settings file

#[test]
fn read_settings_file_missing_means_first_run() {
    let dir = tempfile::tempdir().unwrap();
    let (s, first_run) = read_settings_file(&dir.path().join("settings.json"));
    assert!(first_run);
    assert!(s.hour24);
}

#[test]
fn read_settings_file_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join("settings.json");
    write_settings_file(
        &path,
        &Settings {
            hour24: false,
            ..Settings::default()
        },
    );
    let (s, first_run) = read_settings_file(&path);
    assert!(!first_run);
    assert!(!s.hour24);
}

#[test]
fn read_settings_file_treats_an_unknown_date_language_as_auto() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, r#"{"dateLanguage":"fr"}"#).unwrap();
    let (s, _) = read_settings_file(&path);
    assert_eq!(s.date_language, "auto");
}

#[test]
fn read_settings_file_backs_up_a_broken_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "{not json").unwrap();
    let (s, first_run) = read_settings_file(&path);
    assert!(!first_run);
    assert!(s.hour24);
    assert!(!path.exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("settings.json.bak")).unwrap(),
        "{not json"
    );
}

// read_import_file

#[test]
fn read_import_file_rejects_other_extensions() {
    assert_eq!(
        read_import_file(&sample("README.md")).unwrap_err(),
        "only .txt and .csv files are supported."
    );
}

#[test]
fn read_import_file_rejects_the_invalid_samples() {
    assert_eq!(
        read_import_file(&sample("invalid/empty.txt")).unwrap_err(),
        "the file is empty."
    );
    assert_eq!(
        read_import_file(&sample("invalid/binary.csv")).unwrap_err(),
        "the file is not a text file."
    );
}

#[test]
fn read_import_file_rejects_files_over_the_limit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.txt");
    std::fs::write(&path, vec![b'a'; MAX_IMPORT_BYTES as usize + 1]).unwrap();
    assert_eq!(
        read_import_file(&path).unwrap_err(),
        "the file is larger than 200 KB."
    );
}

#[test]
fn read_import_file_reads_txt_and_decodes_the_ansi_csv() {
    let (csv, text) = read_import_file(&sample("new-todos.txt")).unwrap();
    assert!(!csv);
    assert_eq!(text.lines().filter(|l| !l.trim().is_empty()).count(), 3);

    let (csv, text) = read_import_file(&sample("todos-excel-ansi.csv")).unwrap();
    assert!(csv);
    assert_eq!(text.lines().next(), Some("text;due;category;notes"));
    assert!(text.contains("Budget 5 € – Q3 „final“ prüfen"));
    assert!(text.contains("Zahlen aus dem Controlling…"));
    assert!(text.contains("Café-Termin mit Müller ‚kurz‘"));
}

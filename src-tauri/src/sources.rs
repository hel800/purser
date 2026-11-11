//! External data sources: commands configured in `sources.json` whose JSON
//! output Purser mirrors as read-only todos.
//!
//! Rust only reads the configuration and runs the commands. Validating the
//! output and syncing it into the database happen in the webview
//! (`src/lib/sources.ts`), next to the rest of the persistence code.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// A source that hangs (waiting for a password prompt, a dead VPN) is
/// killed after this long; its last good items stay.
const RUN_TIMEOUT: Duration = Duration::from_secs(30);

/// Output beyond this is cut off, which then fails as invalid JSON. A few
/// hundred issues are well below 1 MB.
const MAX_OUTPUT_BYTES: u64 = 5 * 1024 * 1024;

pub const DEFAULT_REFRESH_MINUTES: u32 = 15;

/// Written by "Open sources file…" when there is no file yet. JSON has no
/// comments, so the pointer to the docs goes into an ignored field.
const TEMPLATE: &str = r#"{
  "_help": "Each source runs a command that prints JSON items; they show up as read-only todos. See the README section 'External data sources'.",
  "sources": []
}
"#;

#[derive(Deserialize)]
struct SourcesFile {
    #[serde(default)]
    sources: Vec<SourceConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceConfig {
    id: String,
    command: String,
    category: Option<String>,
    refresh_minutes: Option<u32>,
}

/// A configured source as the webview sees it, with the defaults filled in.
/// The command itself stays in Rust: the webview only runs a source by id.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDto {
    pub id: String,
    pub category: String,
    pub refresh_minutes: u32,
}

fn sources_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("sources.json"))
        .map_err(|e| e.to_string())
}

/// Folder of the source scripts shipped with Purser, referenced as
/// `{scripts}` in a command.
fn scripts_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| strip_verbatim_prefix(&dir).join("sources"))
}

/// Tauri canonicalizes the exe path, which on Windows yields a verbatim
/// `\\?\C:\…` path. Such paths take no `/` separators, so
/// `{scripts}/jira.ps1` would not be found; the plain `C:\…` form does.
pub fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        // `\\?\UNC\server\share` is a network path, which needs its `\\`
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// Parses `sources.json`. A broken file is reported, not replaced: the user
/// edits it by hand and fixes it from the error message.
pub fn parse_sources(raw: &str) -> Result<Vec<SourceDto>, String> {
    let file: SourcesFile =
        serde_json::from_str(raw).map_err(|e| format!("sources.json is invalid: {e}"))?;
    let mut sources: Vec<SourceDto> = Vec::new();
    for config in file.sources {
        let id = config.id.trim().to_string();
        if id.is_empty() {
            return Err("sources.json: every source needs an \"id\"".into());
        }
        if config.command.trim().is_empty() {
            return Err(format!("sources.json: source \"{id}\" has no \"command\""));
        }
        if sources.iter().any(|s| s.id.eq_ignore_ascii_case(&id)) {
            return Err(format!("sources.json: source id \"{id}\" is used twice"));
        }
        let category = config
            .category
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| id.clone());
        let refresh_minutes = config
            .refresh_minutes
            .unwrap_or(DEFAULT_REFRESH_MINUTES)
            .max(1);
        sources.push(SourceDto {
            id,
            category,
            refresh_minutes,
        });
    }
    Ok(sources)
}

/// The command of source `id`, read fresh so edits apply without a restart.
fn find_command(path: &Path, id: &str) -> Result<String, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("sources.json: {e}"))?;
    let file: SourcesFile =
        serde_json::from_str(&raw).map_err(|e| format!("sources.json is invalid: {e}"))?;
    file.sources
        .into_iter()
        .find(|s| s.id.trim() == id)
        .map(|s| s.command)
        .ok_or_else(|| format!("source \"{id}\" is no longer configured"))
}

/// Replaces `{scripts}` with the shipped scripts folder.
pub fn expand_command(command: &str, scripts: Option<&Path>) -> String {
    match scripts {
        Some(dir) => command.replace("{scripts}", &dir.to_string_lossy()),
        None => command.to_string(),
    }
}

/// Runs `command` through the shell, so users can write it exactly as they
/// would in a terminal, and returns its stdout.
fn run_command(command: &str) -> Result<String, String> {
    let mut child = shell(command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start: {e}"))?;

    // read both pipes on their own threads: a child filling one pipe while
    // we wait on the other would deadlock
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let out_reader = std::thread::spawn(move || read_limited(stdout));
    let err_reader = std::thread::spawn(move || read_limited(stderr));

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > RUN_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("timed out after {} s", RUN_TIMEOUT.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(50));
    };

    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    if !status.success() {
        let message = first_line(&err).unwrap_or_else(|| format!("exited with {status}"));
        return Err(message);
    }
    Ok(out)
}

fn read_limited(pipe: impl Read) -> String {
    let mut bytes = Vec::new();
    let _ = pipe.take(MAX_OUTPUT_BYTES).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

/// The first non-empty line of a script's error output, for a short message.
pub fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(windows)]
fn shell(command: &str) -> Command {
    use std::os::windows::process::CommandExt;
    // no console window flashing up on every refresh
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new("cmd");
    // raw: cmd.exe has its own quoting rules, which Rust's argument
    // escaping would break for commands like `powershell -File "C:\a b.ps1"`
    // With /S, cmd strips exactly the outer pair of quotes added here and
    // keeps the command's own, also when it starts with a quoted program path.
    cmd.raw_arg("/S /C")
        .raw_arg(format!("\"{command}\""))
        .creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn shell(command: &str) -> Command {
    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(command);
    cmd
}

/// The configured sources; none when there is no `sources.json`.
#[tauri::command]
pub fn list_sources(app: AppHandle) -> Result<Vec<SourceDto>, String> {
    let path = sources_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => parse_sources(&raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("sources.json: {e}")),
    }
}

/// Runs source `id` and returns its raw output for the webview to validate.
#[tauri::command]
pub async fn run_source(app: AppHandle, id: String) -> Result<String, String> {
    let path = sources_path(&app)?;
    let command = expand_command(&find_command(&path, &id)?, scripts_dir(&app).as_deref());
    tauri::async_runtime::spawn_blocking(move || run_command(&command))
        .await
        .map_err(|e| e.to_string())?
}

/// Tray entry "Open sources file…": creates the file on first use and opens
/// it in the default editor.
pub fn open_sources_file(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = sources_path(app)?;
    if !path.exists() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, TEMPLATE).map_err(|e| e.to_string())?;
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_defaults() {
        let sources =
            parse_sources(r#"{ "sources": [ { "id": "jira", "command": "x" } ] }"#).unwrap();
        assert_eq!(
            sources,
            vec![SourceDto {
                id: "jira".into(),
                category: "jira".into(),
                refresh_minutes: DEFAULT_REFRESH_MINUTES,
            }]
        );
    }

    #[test]
    fn keeps_explicit_values_and_clamps_refresh() {
        let sources = parse_sources(
            r#"{ "_help": "ignored", "sources": [
                 { "id": "gh", "command": "x", "category": "github", "refreshMinutes": 0 } ] }"#,
        )
        .unwrap();
        assert_eq!(sources[0].category, "github");
        assert_eq!(sources[0].refresh_minutes, 1);
    }

    #[test]
    fn template_has_no_sources() {
        assert_eq!(parse_sources(TEMPLATE).unwrap(), vec![]);
    }

    #[test]
    fn rejects_broken_configs() {
        assert!(parse_sources("{ nope").is_err());
        assert!(parse_sources(r#"{ "sources": [ { "id": " ", "command": "x" } ] }"#).is_err());
        assert!(parse_sources(r#"{ "sources": [ { "id": "a", "command": "" } ] }"#).is_err());
        assert!(parse_sources(
            r#"{ "sources": [ { "id": "a", "command": "x" }, { "id": "A", "command": "y" } ] }"#
        )
        .is_err());
    }

    #[test]
    fn expands_scripts_folder() {
        let dir = Path::new("C:/Purser/sources");
        assert_eq!(
            expand_command("powershell -File {scripts}/jira.ps1", Some(dir)),
            "powershell -File C:/Purser/sources/jira.ps1"
        );
        assert_eq!(expand_command("{scripts}/x", None), "{scripts}/x");
    }

    #[test]
    fn strips_verbatim_prefix_of_local_paths_only() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\C:\Program Files\Purser")),
            PathBuf::from(r"C:\Program Files\Purser")
        );
        let unc = Path::new(r"\\?\UNC\server\share");
        assert_eq!(strip_verbatim_prefix(unc), unc.to_path_buf());
        assert_eq!(strip_verbatim_prefix(Path::new("/opt/purser")), PathBuf::from("/opt/purser"));
    }

    #[test]
    fn first_line_skips_blank_lines() {
        assert_eq!(first_line("\n  \n 401 Unauthorized \nmore"), Some("401 Unauthorized".into()));
        assert_eq!(first_line("  "), None);
    }

    #[test]
    fn runs_a_command_and_reports_failures() {
        assert_eq!(run_command("echo hello").unwrap().trim(), "hello");
        let err = run_command("echo broken 1>&2 && exit 3").unwrap_err();
        assert_eq!(err, "broken");
    }

    #[cfg(windows)]
    #[test]
    fn keeps_quotes_in_windows_commands() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("a b.cmd");
        std::fs::write(&script, "@echo {\"items\": []}").unwrap();
        let expected = "{\"items\": []}";
        let quoted_program = format!("\"{}\"", script.display());
        assert_eq!(run_command(&quoted_program).unwrap().trim(), expected);
        let quoted_argument = format!("cmd /C \"{}\"", script.display());
        assert_eq!(run_command(&quoted_argument).unwrap().trim(), expected);
    }
}

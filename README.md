<img src="src/assets/purser-wordmark.svg" alt="Purser" width="260">

A keyboard-driven todo app that lives in the system tray. Built with Tauri 2, Svelte 5 and SQLite.

## Install

Download the latest `Purser_x.y.z_x64-setup.exe` from the
[Releases](https://github.com/hel800/purser/releases) page and run it
(Windows 10/11 x64; WebView2 is bootstrapped automatically if missing).

## Usage

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+N` | Quick-add popup (global) |
| `Ctrl+Alt+L` | Todo list popup above the tray/clock (global) |
| `Enter` | Quick-add: save · List: tick selected todo (moves it to Done) |
| `Tab` / `→` | Quick-add: accept the inline category suggestion |
| `Ctrl+⌫` | Quick-add: clear the input |
| `↑` / `↓` (or `j` / `k`) | Navigate the list |
| `E` or `F2` | Edit the text of the selected open todo |
| `D` | Edit due date of the selected open todo (natural language, empty removes it) |
| `Space` | Show/hide the notes of the selected todo |
| `N` | Edit the notes of the selected open todo (`Ctrl+Enter` saves, empty removes) |
| `T` | Cycle the category filter (all → each category → no category) |
| `F` | Cycle the due-date filter (all → today → this week → soon/overdue → overdue → no date) |
| `Tab` | Switch between Open and Done view |
| `Del` | Done view: delete permanently |
| `Esc` (or clicking elsewhere) | Dismiss popup |

Left-clicking the tray icon also opens the list; right-click shows a menu.

### Settings (tray menu → Settings)

- **Start with Windows** — toggles autostart (on by default after the first
  release-build launch; your choice sticks afterwards)
- **24-hour clock** — switches due-date display between 24 h and 12 h (AM/PM);
  stored in `settings.json` next to the database

### Quick-add syntax

One line, natural language — dates and categories are parsed as you type:

```
pay rent friday 5pm #finance
prepare demo tomorrow 9am #work // agenda: budget, https://example.com/prep
water plants
```

- Dates/times are parsed with [chrono-node](https://github.com/wanasit/chrono) (`friday 5pm`, `tomorrow`, `in 2 weeks`, `Aug 20`, …)
- `#word` assigns a category (created on the fly); existing category names
  autocomplete inline — `Tab` or `→` accepts the grayed-out suggestion
- Everything after a `//` (preceded by a space) becomes the todo's note —
  dates and `#tags` in the note are left untouched, and URLs like
  `https://…` in the title are never mistaken for the separator
- A half-typed todo survives closing the popup and is still there when it reopens

### Categories and due dates

- The list groups todos by color-coded category, ordered by due date within
  each group; todos without a category come last
- Hover a category header and click the pencil to rename it or change its
  color (names must stay `#tag`-compatible: letters, digits, `_`, `-`)
- Hover a todo row for pencils to edit its text and due date by mouse
- Due-date colors: **red** = overdue, **yellow** = due later today or on the
  next working day before 12:00

### Notes

- Every todo can carry longer notes — free text, links, instructions — hidden
  in the list by default. A `≡` marker shows next to todos that have one.
- `Space` (or clicking `≡`) expands the note below the row; URLs are
  clickable and open in the browser. `N` (or the pencil in the panel) edits;
  `Ctrl+Enter` saves, saving an empty note removes it. Done view shows notes
  read-only.

## Data

SQLite database in the app data directory
(`%APPDATA%\com.sschaefer.purser\purser.db` on Windows).

## Autostart

Release builds register themselves to start with Windows on first launch
(silently, via `--autostart`); afterwards the tray setting decides. Dev builds
never auto-enable it.

## Linux notes

Wayland compositors don't let applications grab global shortcuts, so on
GNOME/KDE Wayland the two hotkeys won't fire (X11 works). Instead, bind these
commands in your desktop environment's keyboard settings:

```
purser --quick-add     # open the quick-add popup
purser --toggle-list   # toggle the todo list
```

The app is single-instance: running these commands forwards the flag to the
running instance.

## Development

```
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # produce NSIS installer (Windows)
```

Requires Rust (MSVC toolchain on Windows) and Node.

## Notes
Developed with the support of AI (Anthropic Claude Code)

## License

[MIT](LICENSE)

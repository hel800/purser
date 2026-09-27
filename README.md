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

### Importing todos

Tray menu → **Import todos…** picks a `.txt` or `.csv`
file and adds its todos. Import only ever adds — existing todos and
categories are never changed. Examples live in [`samples/import`](samples/import).

- **`.txt`** — one todo per line in quick-add syntax
  (`title #category next monday //a note`); blank lines are ignored and a
  leading `•` bullet (pasted from Confluence, Word, …) is dropped. Markdown
  is not supported — `[ ]` or `[text](url)` stay plain text
- **Links become notes** — a URL in the title moves into the note, and a
  `#tag` at the very end of a note becomes the category when the title has
  none (`call Bob //https://… #work`). A line that is only a URL has no
  todo text and is skipped
- **`.csv`** (`,` `;` or tab separated, quoted fields supported):
  - with a header row: a `text` (or `todo`/`task`/`title`) column in
    quick-add syntax, plus optional `due`, `category` and `notes` columns
    that take precedence over what the text says. A row whose `due` cell
    can't be read as a date is skipped; a `category` cell that isn't a
    valid `#tag` name (e.g. contains spaces) is ignored
  - Jira exports, recognized by the English column names `Issue key` and
    `Summary`: the title is `KEY Summary` as-is, `Due Date` becomes the due
    date, a `Description` column (if exported) the note. Issues in status
    Done, Closed, Resolved, Cancelled, Rejected, Won't Do or Completed are
    skipped. An export with localized (e.g. German) column names is read as
    a plain CSV
  - without a header: each row is joined into one quick-add line
- Files may be UTF-8, UTF-16 with byte-order mark (Excel "Unicode text"), or
  Latin-1 (older Excel CSV exports) — umlauts come through in all three
- Exact copies of existing todos (same text, category, due date and note —
  open or done) are not imported again; the summary says how many. Relative
  dates with a time of day, like `in 2 weeks`, include the moment of import,
  so importing such a line again later adds a new todo
- More than 50 new todos need a confirmation; unreadable, empty, binary,
  malformed or larger than 200 KB files are rejected with an error and
  nothing is imported

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

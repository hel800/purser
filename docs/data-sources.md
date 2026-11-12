# External data sources

Purser can show items from other systems, such as Jira issues, next to your
own todos. A **data source** is a command that fetches items and prints them
to stdout as JSON. Purser runs it at regular intervals and shows the result as
read-only todos.

Purser never sees credentials. The command reads them itself (from
environment variables, a CLI login such as `gh`, …), and Purser only reads
what it prints.

## How it works

```
sources.json ──> Purser runs "command" ──> stdout: {"items":[...]} ──> read-only todos
                 (no console, 30 s max)    stderr + exit code: errors
```

1. Purser reads `sources.json` and runs each entry's `command`: at startup,
   every `refreshMinutes`, when the popup opens (if the last run is more than
   a minute old) and on `F5` in the popup.
2. The command prints a JSON document to stdout and exits with code 0.
3. Purser mirrors the items: new ids are added, known ids are updated, and
   ids that are missing from the output are removed. So the output must
   always be the **complete** current list, not changes since the last run.

## Use a shipped script

These scripts ship with Purser, in the folder that `{scripts}` stands for:

| Script | System | Credentials |
| --- | --- | --- |
| `jira-cloud.ps1` | Jira Cloud (`*.atlassian.net`) | Email + API token in `PURSER_JIRA_CLOUD_TOKEN` |
| `example.ps1` | none: prints two fixed items, to try it out | none |

1. Create an API token at
   <https://id.atlassian.com/manage-profile/security/api-tokens> and store it
   once, in a terminal: `setx PURSER_JIRA_CLOUD_TOKEN "<token>"`
2. Add an entry to `sources.json` (see below):

   ```json
   {
     "sources": [
       {
         "id": "jira",
         "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{scripts}/jira-cloud.ps1\" -Site https://example.atlassian.net -Email me@example.com"
       }
     ]
   }
   ```

3. Open the popup or press `F5`. The first successful run is confirmed with
   "Data source jira connected · 12 items added".

`jira-cloud.ps1` parameters: `-Site` and `-Email` (required), `-Jql`
(default: `assignee = currentUser() AND resolution = Unresolved ORDER BY
duedate ASC`), `-Max` (default 200) and `-NotesLength` (default 2000). It maps
Jira fields like this:

| Jira | Output field | Example |
| --- | --- | --- |
| `key` | `id` | `XY-123` |
| `key` + `summary` | `text` | `XY-123 Fix login` |
| `<site>/browse/<key>` | `url` | `https://example.atlassian.net/browse/XY-123` |
| `duedate` | `due` | `2026-11-10` |
| `description` | `notes` | flattened to plain text, shortened |

The shipped scripts are PowerShell because it comes with every Windows
installation and handles HTTPS and JSON on its own, so they need nothing
installed. Your own source can be written in any language.

## Configure sources.json

`sources.json` lives in the config folder
(`%APPDATA%\com.sschaefer.purser\sources.json` on Windows) and is created
empty on first start. Purser reads it again on every refresh, so changes
apply without a restart.

```json
{
  "sources": [
    {
      "id": "jira",
      "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:/scripts/my-source.ps1\" -Project XY",
      "category": "work",
      "refreshMinutes": 15
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Short name, unique (case is ignored). Shown on the items and in messages, and ties the stored items to the source. Renaming it replaces all its items |
| `command` | yes | What to run, as you would type it in a terminal. It runs through `cmd /S /C` on Windows and `sh -c` elsewhere, without a console window |
| `category` | no | Category new items get (default: the `id`). Must be a valid `#tag` name: letters, digits, `_` and `-` |
| `refreshMinutes` | no | How often the source runs (default 15, at least 1) |

The parts of a PowerShell `command`:

- `powershell -NoProfile -ExecutionPolicy Bypass -File` runs a script without
  your profile and without changing the execution policy.
- `"{scripts}/jira-cloud.ps1"` is the script. `{scripts}` is replaced with the
  folder of the shipped scripts; your own scripts use their full path. Keep
  the quotes, since paths may contain spaces. Forward slashes work and need
  no escaping in JSON.
- The rest are the script's parameters. A quote inside the JSON string is
  written `\"`, e.g. `-Jql \"project = XY AND assignee = currentUser()\"`.
  Quotes inside that argument must be single quotes, e.g.
  `-Jql \"status = 'In Progress'\"`: a second `\"` would end the
  argument early, and the rest would land in other parameters.

Other commands work the same way, e.g. `python C:/scripts/github.py` or
`node C:/scripts/tickets.js`.

## Output format

The command must print **one JSON document** to **stdout**, encoded as
**UTF-8** (a byte order mark is ignored), and exit with code **0**.

```json
{
  "items": [
    {
      "id": "XY-123",
      "text": "XY-123 Fix login",
      "url": "https://jira.example.com/browse/XY-123",
      "due": "2026-11-10",
      "notes": "Login fails after the password reset.\nSteps: ..."
    },
    {
      "id": "XY-124",
      "text": "XY-124 Update the release notes"
    }
  ]
}
```

The top level is an object with an `items` array. A bare array (`[ {...},
{...} ]`) is accepted too. An empty list (`{"items": []}`) is valid and
removes all items of the source, for example when nothing is assigned to you
any more.

### Item fields

| Field | Type | Required | Becomes | Rules |
| --- | --- | --- | --- | --- |
| `id` | string or number | yes | — | Unique within the source and stable across runs: the same issue must get the same id every time. Numbers become strings (`42` → `"42"`) |
| `text` | string | yes | todo text | Shown as it is. Quick-add syntax (`#tag`, dates, `//`) is **not** parsed |
| `url` | string | no | link | Must start with `http://` or `https://`. `O` or clicking the lock opens it |
| `due` | string | no | due date | `"2026-11-10"` (a day, shown and treated like a date typed without a time) or an ISO 8601 date-time with a zone, e.g. `"2026-11-10T15:00:00Z"` or `"2026-11-10T16:00:00+01:00"` |
| `notes` | string | no | notes | Plain text, `\n` for line breaks. `http(s)` links in it become clickable. Keep it short (a few thousand characters) |

Other fields are ignored. Leave out an optional field, or set it to `null`,
when there is no value. Whitespace around strings is trimmed, and an empty
string counts as missing.

### What Purser does with bad output

| Problem | Result |
| --- | --- |
| Item without `id` or `text`, or with an id already seen in this output | The item is skipped, the rest is used |
| `url` that isn't `http(s)`, `due` that can't be read, `notes` that isn't a string | Only that field is dropped |
| Output is not JSON, or has no `items` list | The run fails |
| Exit code other than 0 | The run fails; the first non-empty line on **stderr** is shown as the message |
| Runs longer than 30 seconds | The command is stopped and the run fails |
| More than 5 MB of output | Cut off, so it usually fails as invalid JSON |

When a run fails, the items from the last good run stay, and a red line in
the popup says "⚠ jira not synced · <message>" until a run succeeds. Purser
adds the source id itself, so the message doesn't need to name the source.

### What the user can do with the items

The items appear in their category with a gray lock and gray text. Hovering
the lock shows the source and the last sync time. Text, due date, notes and
the done state belong to the source: `Enter`, `E`, `D` and `N` only show
"Read-only · from jira". The category is the user's: `C` changes it, and the
change is kept on later runs. An item disappears when the source stops
returning it (closed, reassigned). Import and duplicate detection ignore
source items.

## Write your own source

A source only has to print the JSON above. Write errors to stderr and exit
with code 1, and don't print anything else to stdout.

PowerShell:

```powershell
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    $issues = Invoke-RestMethod "https://tracker.example.com/api/my-issues"
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
$items = foreach ($issue in $issues) {
    [ordered]@{ id = $issue.key; text = "$($issue.key) $($issue.title)"; url = $issue.link; due = $issue.dueDate }
}
# -InputObject keeps a single item an array
ConvertTo-Json -InputObject @{ items = @($items) } -Depth 4 -Compress
```

Python:

```python
import json, sys, urllib.request

try:
    with urllib.request.urlopen("https://tracker.example.com/api/my-issues", timeout=20) as r:
        issues = json.load(r)
except Exception as e:
    print(e, file=sys.stderr)
    sys.exit(1)

items = [{"id": i["key"], "text": f'{i["key"]} {i["title"]}', "url": i.get("link"), "due": i.get("dueDate")}
         for i in issues]
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps({"items": items}, ensure_ascii=False))
```

Test it in a terminal before adding it to `sources.json`: run the exact
`command`, check that stdout is valid JSON and that `echo %ERRORLEVEL%`
(cmd) or `$LASTEXITCODE` (PowerShell) prints `0`. The shipped
[example.ps1](../src-tauri/resources/sources/example.ps1) and
[jira-cloud.ps1](../src-tauri/resources/sources/jira-cloud.ps1) are complete
examples.

## Checklist for AI agents

When asked to build a source for Purser, produce a script and a
`sources.json` entry that meet all of these:

1. **Output:** stdout gets exactly one UTF-8 JSON document,
   `{"items": [...]}`, and nothing else (no logs, progress or prompts).
2. **Items:** every item has a non-empty `id` (string or number) and `text`
   (string). Optional: `url` (`http(s)` only), `due` (`YYYY-MM-DD` or ISO 8601
   with a zone), `notes` (plain text). Leave out fields without a value.
3. **Ids:** unique within the output and stable across runs. Use the
   system's own key (issue key, number), never a list position or a hash
   of changing fields.
4. **Full list:** return all currently relevant items every time. A missing
   id deletes the todo; an empty list deletes all of them. Never return an
   empty list because of an error: fail instead.
5. **Errors:** on any failure (network, auth, unexpected response) print one
   short, human-readable line to stderr, e.g. `401 Unauthorized - check
   the token`, without the source name (Purser adds the id), and exit with code 1. Never exit 0 with partial data.
6. **Speed:** finish within 30 seconds, including paging; cap the number of
   items (e.g. 200) and set request timeouts below 30 s.
7. **No interaction:** stdin is closed and no window is shown, so never
   prompt for input or open a browser.
8. **Credentials:** read secrets from environment variables or an existing
   CLI login, never from `sources.json` or the script. On Windows, also read
   the user-level variable, because `setx` doesn't reach processes that were
   already running: `[Environment]::GetEnvironmentVariable(name, "User")`.
9. **Text:** put the human-readable key in `text` (`XY-123 Fix login`), keep
   `notes` to a few thousand characters, and turn rich text (HTML, Markdown,
   Atlassian Document Format) into plain text.
10. **Config:** give the entry a short `id` and write the `command` as a JSON
    string: forward slashes in paths, `\"` around quoted arguments,
    `{scripts}` only for scripts shipped with Purser.

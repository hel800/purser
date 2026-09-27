# Import samples

Example files for tray menu → **Import todos…** (rules: see the
"Importing todos" section of the main [README](../../README.md)). All data is
fictional; links point to `example.org`.

| File | Shows |
| --- | --- |
| `new-todos.txt` | A `//` note ending in `#tag` (becomes the category), a URL in the title (moves to the note), a plain long line |
| `quick-add-syntax.txt` | Full quick-add syntax, dates (`next monday`, `friday 5pm`, `in 2 weeks`), a `#word` that stays in the note, `•` bullets, umlauts, a URL-only line (skipped), markdown kept as plain text |
| `todos-header.csv` | Comma-separated with a `text,due,category,notes` header: quoted fields with commas, a multi-line note, a `#` category, an unreadable due date (row skipped) |
| `todos-excel-de.csv` | Semicolon-separated without header, as Excel exports it in German locales |
| `jira-export.csv` | Jira CSV export layout (duplicate `Affects Version/s` column, `""` quoting, `2026-Dec-17 00:00` dates); Done/Closed issues are skipped, no notes |
| `jira-export-description.csv` | Jira export with a `Description` column (becomes the note) and the `02/Oct/26 3:00 PM` date format |
| `many-todos.txt` | 120 todos — triggers the confirmation for more than 50 |

## `invalid/` — each file must be rejected, nothing gets imported

| File | Error |
| --- | --- |
| `empty.txt` | the file is empty |
| `binary.csv` | not a text file (contains NUL bytes) |
| `broken-quote.csv` | invalid CSV — a quote is never closed |
| `only-urls.txt` | no todos found (every line is only a URL) |

Importing a valid file a second time (e.g. `new-todos.txt`) demonstrates
duplicate detection: the summary reports the todos that already exist
instead of adding them. Lines with a relative date and time of day
(`in 2 weeks`) are the exception — they get a new due time and are added
again.

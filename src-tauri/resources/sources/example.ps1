# Example data source for Purser: prints two fixed items as JSON.
# Try it with this entry in sources.json:
#   { "id": "example", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{scripts}/example.ps1\"" }
# A real source does the same with data from an API (Jira, GitHub, ...).

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$items = @(
    @{
        id    = "EX-1"
        text  = "EX-1 Review the Purser data source docs"
        url   = "https://github.com/hel800/purser/blob/main/docs/data-sources.md"
        notes = "Shown read-only. O opens the link."
    },
    @{
        id   = "EX-2"
        text = "EX-2 An item with a due date"
        due  = (Get-Date).Date.AddDays(1).AddHours(17).ToUniversalTime().ToString("o")
    }
)

@{ items = $items } | ConvertTo-Json -Depth 4 -Compress

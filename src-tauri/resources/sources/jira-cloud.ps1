# Purser data source: Jira Cloud (https://<your-site>.atlassian.net).
#
# Lists the issues of a JQL query as read-only todos. Authenticates with your
# Atlassian account email and an API token
# (https://id.atlassian.com/manage-profile/security/api-tokens) read from the
# environment variable PURSER_JIRA_CLOUD_TOKEN, so it never lands in sources.json.
#
#   setx PURSER_JIRA_CLOUD_TOKEN "<token>"
#
# sources.json entry:
#   { "id": "jira",
#     "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"{scripts}/jira-cloud.ps1\" -Site https://example.atlassian.net -Email me@example.com" }
#
# Optional: -Jql "project = XY AND assignee = currentUser()"  -Max 200
#
# Field mapping (Jira -> Purser):
#   key + summary  -> text    "XY-123 Fix login"
#   key            -> id      (matches the todo on the next refresh)
#   <Site>/browse/key -> url  (O opens it)
#   duedate        -> due     (plain date, shown like a typed "friday")
#   description    -> notes   (rich text flattened to plain text, shortened)

param(
    [Parameter(Mandatory = $true)][string]$Site,
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$Jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY duedate ASC",
    [int]$Max = 200,
    [int]$NotesLength = 2000
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Windows PowerShell 5.1 may default to TLS 1.0
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Fail([string]$message) {
    [Console]::Error.WriteLine($message)
    exit 1
}

# Jira Cloud returns descriptions in Atlassian Document Format (a JSON tree);
# collect its text, one line per paragraph, heading or list item.
function ConvertFrom-Adf($node) {
    if ($null -eq $node) { return "" }
    switch ($node.type) {
        "text" { return $node.text }
        "hardBreak" { return "`n" }
        "mention" { return $node.attrs.text }
        "inlineCard" { return $node.attrs.url }
        "emoji" { return $node.attrs.text }
    }
    $inner = ($node.content | ForEach-Object { ConvertFrom-Adf $_ }) -join ""
    if ($node.type -in @("paragraph", "heading", "listItem", "codeBlock", "blockquote", "rule")) {
        return $inner.TrimEnd() + "`n"
    }
    return $inner
}

$token = $env:PURSER_JIRA_CLOUD_TOKEN
# setx only reaches processes started afterwards; Purser (and the terminal it
# was started from) usually runs longer, so read the user variable directly
if (-not $token) { $token = [Environment]::GetEnvironmentVariable("PURSER_JIRA_CLOUD_TOKEN", "User") }
if (-not $token) { Fail "PURSER_JIRA_CLOUD_TOKEN is not set" }

$base = $Site.TrimEnd("/")
$basic = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("${Email}:$token"))
$headers = @{ Authorization = "Basic $basic"; Accept = "application/json" }
$items = New-Object System.Collections.Generic.List[object]
$nextPageToken = $null

while ($items.Count -lt $Max) {
    $request = @{
        jql        = $Jql
        maxResults = [Math]::Min(100, $Max - $items.Count)
        fields     = @("summary", "duedate", "description")
    }
    if ($nextPageToken) { $request.nextPageToken = $nextPageToken }
    $body = $request | ConvertTo-Json -Compress

    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        # /rest/api/3/search was retired on Cloud; search/jql pages by token
        $page = Invoke-RestMethod -Method Post -Uri "$base/rest/api/3/search/jql" -Headers $headers `
            -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 20
    } catch {
        # captured first: inside switch, $_ is the switch value
        $err = $_.Exception
        $status = $err.Response.StatusCode.value__
        switch ($status) {
            401 { Fail "401 Unauthorized - check -Email and PURSER_JIRA_CLOUD_TOKEN" }
            400 { Fail "400 Bad Request - check the JQL" }
            default { Fail $err.Message }
        }
    }

    foreach ($issue in $page.issues) {
        $item = [ordered]@{
            id   = $issue.key
            text = "$($issue.key) $($issue.fields.summary)"
            url  = "$base/browse/$($issue.key)"
        }
        if ($issue.fields.duedate) { $item.due = $issue.fields.duedate }
        $description = (ConvertFrom-Adf $issue.fields.description).Trim()
        if ($description) {
            if ($description.Length -gt $NotesLength) { $description = $description.Substring(0, $NotesLength) + "..." }
            $item.notes = $description
        }
        $items.Add([pscustomobject]$item)
    }

    $nextPageToken = $page.nextPageToken
    if ($page.isLast -or -not $nextPageToken -or $page.issues.Count -eq 0) { break }
}

# -InputObject keeps a single item a one-element array
ConvertTo-Json -InputObject @{ items = $items.ToArray() } -Depth 4 -Compress

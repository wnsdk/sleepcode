# AI Worker - single-run script (PowerShell)
# Used when running one cycle manually instead of run_forever.ps1.

param(
    [string]$provider = ''
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)

if (Test-Path .sleepcode/.env) {
    Get-Content .sleepcode/.env -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $eq = $line.IndexOf('=')
            if ($eq -gt 0) {
                $key = $line.Substring(0, $eq).Trim()
                $val = $line.Substring($eq + 1).Trim()
                [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
            }
        }
    }
}

function Build-CodexPrompt([string]$tasksText) {
    $sections = @()
    if (Test-Path .sleepcode/scripts/base_rules.md) {
        $sections += Get-Content .sleepcode/scripts/base_rules.md -Raw -Encoding UTF8
    }
    if (Test-Path .sleepcode/rules.md) {
        $sections += Get-Content .sleepcode/rules.md -Raw -Encoding UTF8
    }
    $sections += "# Task List`n`n$tasksText"
    return ($sections -join "`n`n---`n`n")
}

$providerArg = $provider
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq '--provider' -and ($i + 1) -lt $args.Count) {
        $providerArg = $args[$i + 1]
    }
}
if (-not $providerArg -and $env:SLEEPCODE_PROVIDER) {
    $providerArg = $env:SLEEPCODE_PROVIDER
}

$providerName = if ($providerArg) { $providerArg.ToString().Trim().ToLowerInvariant() } else { '' }
if (-not $providerName) { $providerName = 'claude' }
if ($providerName -eq 'auto') { $providerName = 'claude' }
if ($providerName -ne 'claude' -and $providerName -ne 'codex') { $providerName = 'claude' }
$env:SLEEPCODE_PROVIDER = $providerName

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "[$timestamp] AI single run start (provider: $providerName)"

# Keep CLAUDE.md synced for claude prompt-cache behavior.
$baseRules = if (Test-Path .sleepcode/scripts/base_rules.md) { Get-Content .sleepcode/scripts/base_rules.md -Raw -Encoding UTF8 } else { '' }
$rules = if (Test-Path .sleepcode/rules.md) { Get-Content .sleepcode/rules.md -Raw -Encoding UTF8 } else { '' }
if ($baseRules -or $rules) {
    $claudeMd = "$baseRules`n`n---`n`n$rules"
    [System.IO.File]::WriteAllText('CLAUDE.md', $claudeMd, [System.Text.Encoding]::UTF8)
}

$tasksPrompt = Get-Content .sleepcode/tasks.md -Raw -Encoding UTF8
$stdinPrompt = if ($providerName -eq 'codex') { Build-CodexPrompt $tasksPrompt } else { $tasksPrompt }

$tempFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tempFile, $stdinPrompt, [System.Text.Encoding]::UTF8)

if ($providerName -eq 'codex') {
    cmd /c "type `"$tempFile`" | codex exec --json --dangerously-bypass-approvals-and-sandbox - 2>&1 | python -u .sleepcode/scripts/log_filter.py"
} else {
    cmd /c "type `"$tempFile`" | claude -p --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 | python -u .sleepcode/scripts/log_filter.py"
}

Remove-Item $tempFile -ErrorAction SilentlyContinue

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "[$timestamp] AI single run end"

# AI Night Worker loop script (PowerShell)
# Usage:
#   powershell -File .\.sleepcode\scripts\run_forever.ps1
#   powershell -File .\.sleepcode\scripts\run_forever.ps1 --continue
#   powershell -File .\.sleepcode\scripts\run_forever.ps1 --provider codex

param(
    [switch]$continue,
    [string]$provider = ''
)

$encodingBootstrap = Join-Path $PSScriptRoot 'encoding_bootstrap.ps1'
if (Test-Path $encodingBootstrap) {
    . $encodingBootstrap
}
$ErrorActionPreference = 'Continue'
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

$logDir = '.sleepcode/logs'
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = "$logDir/worker_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

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

# Parse args
$useContinue = $continue
$providerArg = $provider
for ($i = 0; $i -lt $args.Count; $i++) {
    if (-not $useContinue -and $args[$i] -eq '--continue') {
        $useContinue = $true
        continue
    }
    if ($args[$i] -eq '--provider' -and ($i + 1) -lt $args.Count) {
        $providerArg = $args[$i + 1]
        continue
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

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

$notionPollInterval = if ($env:SLEEPCODE_NOTION_POLL_SEC) { [int]$env:SLEEPCODE_NOTION_POLL_SEC } else { 5 }
$notionPollJob = $null

function Start-NotionPoller() {
    if (-not $env:NOTION_API_KEY -or -not $env:NOTION_DB_ID) { return }
    if (-not (Test-Path .sleepcode/scripts/notion_sync.py)) { return }
    if ($notionPollJob) { return }
    $notionPollJob = Start-Job -ScriptBlock {
        param($pollInterval, $scriptPath, $logFile)
        while ($true) {
            try {
                $out = & python $scriptPath enqueue 2>$null
                if ($out) {
                    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $out"
                    Add-Content -Path $logFile -Value $line -Encoding UTF8
                }
            } catch {
            }
            Start-Sleep -Seconds $pollInterval
        }
    } -ArgumentList $notionPollInterval, '.sleepcode/scripts/notion_sync.py', $logFile
}

function Stop-NotionPoller() {
    if ($notionPollJob) {
        Stop-Job -Job $notionPollJob -Force | Out-Null
        Remove-Job -Job $notionPollJob -Force | Out-Null
        $notionPollJob = $null
    }
}

Log "=== AI Night Worker start ==="
if ($useContinue) {
    Log "continue mode enabled (--continue)"
}
Log "provider: $providerName"
Log "log file: $logFile"

$iteration = 0

while ($true) {
    $iteration++
    Log "--- iteration #$iteration start ---"

    $remaining = 0
    if (Test-Path .sleepcode/tasks.md) {
        $remaining = (Select-String -Pattern '[ ]' -Path .sleepcode/tasks.md -SimpleMatch).Count
    }
    Log "remaining tasks: ${remaining}"

    if ($remaining -eq 0) {
        Log '=== all tasks are complete. exiting. ==='
        exit 0
    }

    # Keep CLAUDE.md synced for claude prompt-cache behavior.
    $baseRules = if (Test-Path .sleepcode/scripts/base_rules.md) { Get-Content .sleepcode/scripts/base_rules.md -Raw -Encoding UTF8 } else { '' }
    $rules = if (Test-Path .sleepcode/rules.md) { Get-Content .sleepcode/rules.md -Raw -Encoding UTF8 } else { '' }
    if ($baseRules -or $rules) {
        $claudeMd = "$baseRules`n`n---`n`n$rules"
        [System.IO.File]::WriteAllText('CLAUDE.md', $claudeMd, [System.Text.Encoding]::UTF8)
    }

    $tasksPrompt = Get-Content .sleepcode/tasks.md -Raw -Encoding UTF8
    $tempFile = [System.IO.Path]::GetTempFileName()

    if ($providerName -eq 'codex') {
        Start-NotionPoller
        if ($useContinue -and $iteration -gt 1) {
            $stdinPrompt = 'Continue with the next tasks.'
            Log 'codex running... (resume)'
            [System.IO.File]::WriteAllText($tempFile, $stdinPrompt, [System.Text.Encoding]::UTF8)
            Get-Content -Raw -Encoding UTF8 $tempFile |
              codex exec resume --last --json --dangerously-bypass-approvals-and-sandbox - 2>&1 |
              python -u .sleepcode/scripts/log_filter.py 2>&1 |
              Tee-Object -Append $logFile
        } else {
            $stdinPrompt = Build-CodexPrompt $tasksPrompt
            Log 'codex running...'
            [System.IO.File]::WriteAllText($tempFile, $stdinPrompt, [System.Text.Encoding]::UTF8)
            Get-Content -Raw -Encoding UTF8 $tempFile |
              codex exec --json --dangerously-bypass-approvals-and-sandbox - 2>&1 |
              python -u .sleepcode/scripts/log_filter.py 2>&1 |
              Tee-Object -Append $logFile
        }
        Stop-NotionPoller
    } else {
        Start-NotionPoller
        if ($useContinue -and $iteration -gt 1) {
            $stdinPrompt = 'Continue with the next tasks.'
            Log 'claude running... (continue)'
            [System.IO.File]::WriteAllText($tempFile, $stdinPrompt, [System.Text.Encoding]::UTF8)
            Get-Content -Raw -Encoding UTF8 $tempFile |
              claude --continue -p --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 |
              python -u .sleepcode/scripts/log_filter.py 2>&1 |
              Tee-Object -Append $logFile
        } else {
            $stdinPrompt = $tasksPrompt
            Log 'claude running...'
            [System.IO.File]::WriteAllText($tempFile, $stdinPrompt, [System.Text.Encoding]::UTF8)
            Get-Content -Raw -Encoding UTF8 $tempFile |
              claude -p --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 |
              python -u .sleepcode/scripts/log_filter.py 2>&1 |
              Tee-Object -Append $logFile
        }
        Stop-NotionPoller
    }

    $exitCode = $LASTEXITCODE
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    Log "$providerName exit code: $exitCode"

    $porcelain = git status --porcelain
    if ($porcelain) {
        Log 'warning: uncommitted changes detected'
    }

    Log "--- iteration #$iteration end, sleep {{SLEEP_INTERVAL}}s ---"
    Start-Sleep -Seconds {{SLEEP_INTERVAL}}
}

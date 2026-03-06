# AI Night Worker - 감시자 스크립트 (Windows PowerShell)
# 사용법: powershell -File .\.sleepcode\scripts\run_forever.ps1
#         powershell -File .\.sleepcode\scripts\run_forever.ps1 --continue  (세션 연속 모드)

param(
    [switch]$continue
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)

$logDir = ".sleepcode/logs"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = "$logDir/worker_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# --continue 플래그 파싱 (문자열 인자 대응)
$useContinue = $continue
if (-not $useContinue) {
    $useContinue = $args -contains "--continue"
}

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

Log "=== AI Night Worker 시작 ==="
if ($useContinue) {
    Log "세션 연속 모드 활성화 (--continue)"
}
Log "로그 파일: $logFile"

$iteration = 0

while ($true) {
    $iteration++
    Log "--- 반복 #$iteration 시작 ---"

    # 미완료 태스크 확인
    $remaining = 0
    if (Test-Path .sleepcode/tasks.md) {
        $remaining = (Select-String -Pattern '[ ]' -Path .sleepcode/tasks.md -SimpleMatch).Count
    }
    Log "남은 태스크: ${remaining}개"

    if ($remaining -eq 0) {
        Log "=== 모든 태스크 완료. 종료합니다. ==="
        exit 0
    }

    # CLAUDE.md 동기화 (base_rules + rules → CLAUDE.md, 프롬프트 캐싱)
    $baseRules = if (Test-Path .sleepcode/scripts/base_rules.md) { Get-Content .sleepcode/scripts/base_rules.md -Raw -Encoding UTF8 } else { "" }
    $rules = if (Test-Path .sleepcode/rules.md) { Get-Content .sleepcode/rules.md -Raw -Encoding UTF8 } else { "" }
    if ($baseRules -or $rules) {
        $claudeMd = "$baseRules`n`n---`n`n$rules"
        [System.IO.File]::WriteAllText("CLAUDE.md", $claudeMd, [System.Text.Encoding]::UTF8)
    }

    # --continue 모드: 2회차부터 이전 세션 이어서 실행
    if ($useContinue -and $iteration -gt 1) {
        $prompt = "다음 태스크를 진행하세요."
        Log "claude 실행 중... (세션 연속)"
        $tempFile = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($tempFile, $prompt, [System.Text.Encoding]::UTF8)
        cmd /c "type `"$tempFile`" | claude --continue -p --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 | python -u .sleepcode/scripts/log_filter.py" 2>&1 |
          Tee-Object -Append $logFile
    } else {
        # 첫 실행 또는 일반 모드: tasks.md 전체 전달
        $prompt = Get-Content .sleepcode/tasks.md -Raw -Encoding UTF8
        Log "claude 실행 중..."
        $tempFile = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($tempFile, $prompt, [System.Text.Encoding]::UTF8)
        cmd /c "type `"$tempFile`" | claude -p --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 | python -u .sleepcode/scripts/log_filter.py" 2>&1 |
          Tee-Object -Append $logFile
    }
    $exitCode = $LASTEXITCODE
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    Log "claude 종료 (exit code: $exitCode)"

    # 미커밋 변경사항 체크
    $porcelain = git status --porcelain
    if ($porcelain) {
        Log "경고: 커밋되지 않은 변경사항 감지"
    }

    Log "--- 반복 #$iteration 종료, {{SLEEP_INTERVAL}}초 대기 ---"
    Start-Sleep -Seconds {{SLEEP_INTERVAL}}
}

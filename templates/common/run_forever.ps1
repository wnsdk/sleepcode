# AI Night Worker - 감시자 스크립트 (Windows PowerShell)
# 사용법: powershell -File .\.sleepcode\run_forever.ps1

$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)

$logDir = ".sleepcode/logs"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = "$logDir/worker_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

Log "=== AI Night Worker 시작 ==="
Log "로그 파일: $logFile"

$iteration = 0

while ($true) {
    $iteration++
    Log "--- 반복 #$iteration 시작 ---"

    # 미완료 태스크 확인
    $remaining = 0
    if (Test-Path .sleepcode/tasks.md) {
        $remaining = (Select-String -Pattern '\[ \]' -Path .sleepcode/tasks.md -SimpleMatch).Count
    }
    Log "남은 태스크: ${remaining}개"

    if ($remaining -eq 0) {
        Log "=== 모든 태스크 완료. 종료합니다. ==="
        exit 0
    }

    # rules.md + tasks.md 를 합쳐서 프롬프트 구성
    $rules = Get-Content .sleepcode/rules.md -Raw -Encoding UTF8
    $tasks = Get-Content .sleepcode/tasks.md -Raw -Encoding UTF8
    $prompt = "$rules`n`n---`n`n$tasks"

    Log "claude 실행 중..."
    # stream-json -> log_filter.py 로 핵심 메시지만 추출
    $prompt | claude -p --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 |
      python .sleepcode/log_filter.py |
      Tee-Object -Append $logFile
    $exitCode = $LASTEXITCODE
    Log "claude 종료 (exit code: $exitCode)"

    # 미커밋 변경사항 체크
    $porcelain = git status --porcelain
    if ($porcelain) {
        Log "경고: 커밋되지 않은 변경사항 감지"
    }

    Log "--- 반복 #$iteration 종료, {{SLEEP_INTERVAL}}초 대기 ---"
    Start-Sleep -Seconds {{SLEEP_INTERVAL}}
}

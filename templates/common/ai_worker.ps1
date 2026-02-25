# AI Worker - 1회 실행 스크립트 (Windows PowerShell)
# run_forever.ps1 (무한 루프) 대신 수동으로 1회만 돌릴 때 사용

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$timestamp] AI 단일 실행 시작"

$baseRules = Get-Content .sleepcode/scripts/base_rules.md -Raw -Encoding UTF8
$rules = Get-Content .sleepcode/rules.md -Raw -Encoding UTF8
$tasks = Get-Content .sleepcode/tasks.md -Raw -Encoding UTF8

$prompt = "$baseRules`n`n---`n`n$rules`n`n---`n`n$tasks"

# stream-json + verbose: 토큰 단위 실시간 출력
$prompt | claude -p --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 |
  python .sleepcode/scripts/log_filter.py

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$timestamp] AI 단일 실행 종료"

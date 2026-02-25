#!/bin/bash

# AI Worker - 1회 실행 스크립트
# run_forever.sh (무한 루프) 대신 수동으로 1회만 돌릴 때 사용

cd "$(dirname "$0")/.." || exit 1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI 단일 실행 시작"

RULES=$(cat .sleepcode/rules.md)
TASKS=$(cat .sleepcode/tasks.md)

PROMPT="${RULES}

---

${TASKS}"

# stream-json + verbose: 토큰 단위 실시간 출력
claude -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
  | python3 .sleepcode/log_filter.py

echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI 단일 실행 종료"

#!/bin/bash

# AI Worker - 1회 실행 스크립트
# run_forever.sh (무한 루프) 대신 수동으로 1회만 돌릴 때 사용

cd "$(dirname "$0")/../.." || exit 1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI 단일 실행 시작"

# .env 로드 (API 키 등)
if [ -f .sleepcode/.env ]; then
  set -a
  source .sleepcode/.env
  set +a
fi

# Notion 동기화: pull (Notion → tasks.md)
if [ -n "$NOTION_API_KEY" ] && [ -n "$NOTION_DB_ID" ]; then
  python3 .sleepcode/scripts/notion_sync.py pull
fi

BASE_RULES=$(cat .sleepcode/scripts/base_rules.md)
RULES=$(cat .sleepcode/rules.md)
TASKS=$(cat .sleepcode/tasks.md)

PROMPT="${BASE_RULES}

---

${RULES}

---

${TASKS}"

# stream-json + verbose: 토큰 단위 실시간 출력
claude -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
  | python3 .sleepcode/scripts/log_filter.py

# Notion 동기화: push (tasks.md → Notion)
if [ -n "$NOTION_API_KEY" ] && [ -n "$NOTION_DB_ID" ]; then
  python3 .sleepcode/scripts/notion_sync.py push
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI 단일 실행 종료"

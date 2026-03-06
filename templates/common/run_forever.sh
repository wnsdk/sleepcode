#!/bin/bash

# AI Night Worker - 감시자 스크립트
# 사용법: tmux new -s ai './.sleepcode/scripts/run_forever.sh'
#         ./.sleepcode/scripts/run_forever.sh --continue  (세션 연속 모드)

cd "$(dirname "$0")/../.." || exit 1

LOG_DIR=".sleepcode/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/worker_$(date +%Y%m%d_%H%M%S).log"

# --continue 플래그 파싱
USE_CONTINUE=false
for arg in "$@"; do
  if [ "$arg" = "--continue" ]; then
    USE_CONTINUE=true
  fi
done

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== AI Night Worker 시작 ==="
if [ "$USE_CONTINUE" = true ]; then
  log "세션 연속 모드 활성화 (--continue)"
fi
log "로그 파일: $LOG_FILE"

# .env 로드 (API 키 등)
if [ -f .sleepcode/.env ]; then
  set -a
  source .sleepcode/.env
  set +a
  log ".env 로드 완료"
fi

ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  log "--- 반복 #${ITERATION} 시작 ---"

  # Notion 동기화: pull (Notion → tasks.md)
  if [ -n "$NOTION_API_KEY" ] && [ -n "$NOTION_DB_ID" ]; then
    python3 .sleepcode/scripts/notion_sync.py pull
    log "Notion 동기화 완료 (pull)"
  fi

  # 미완료 태스크가 있는지 확인
  REMAINING=$(grep -c '\[ \]' .sleepcode/tasks.md 2>/dev/null || echo "0")
  log "남은 태스크: ${REMAINING}개"

  if [ "$REMAINING" -eq 0 ]; then
    log "=== 모든 태스크 완료. 종료합니다. ==="
    exit 0
  fi

  # CLAUDE.md 동기화 (base_rules + rules → CLAUDE.md, 프롬프트 캐싱)
  {
    BASE_RULES=$(cat .sleepcode/scripts/base_rules.md 2>/dev/null || true)
    RULES=$(cat .sleepcode/rules.md 2>/dev/null || true)
    if [ -n "$BASE_RULES" ] || [ -n "$RULES" ]; then
      printf '%s\n\n---\n\n%s' "$BASE_RULES" "$RULES" > CLAUDE.md
    fi
  }

  # --continue 모드: 2회차부터 이전 세션 이어서 실행
  if [ "$USE_CONTINUE" = true ] && [ "$ITERATION" -gt 1 ]; then
    PROMPT="다음 태스크를 진행하세요."
    log "claude 실행 중... (세션 연속)"
    claude --continue -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
      | python3 .sleepcode/scripts/log_filter.py \
      | tee -a "$LOG_FILE"
  else
    # 첫 실행 또는 일반 모드: tasks.md 전체 전달
    PROMPT=$(cat .sleepcode/tasks.md)
    log "claude 실행 중..."
    claude -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
      | python3 .sleepcode/scripts/log_filter.py \
      | tee -a "$LOG_FILE"
  fi
  EXIT_CODE=${PIPESTATUS[0]}
  log "claude 종료 (exit code: $EXIT_CODE)"

  # 미커밋 변경사항 체크
  if [[ -n $(git status --porcelain) ]]; then
    log "경고: 커밋되지 않은 변경사항 감지"
  fi

  # Notion 동기화: push (tasks.md → Notion)
  if [ -n "$NOTION_API_KEY" ] && [ -n "$NOTION_DB_ID" ]; then
    python3 .sleepcode/scripts/notion_sync.py push
    log "Notion 동기화 완료 (push)"
  fi

  log "--- 반복 #${ITERATION} 종료, {{SLEEP_INTERVAL}}초 대기 ---"
  sleep {{SLEEP_INTERVAL}}
done

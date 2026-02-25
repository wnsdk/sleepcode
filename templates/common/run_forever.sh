#!/bin/bash

# AI Night Worker - 감시자 스크립트
# 사용법: tmux new -s ai './.sleepcode/scripts/run_forever.sh'

cd "$(dirname "$0")/../.." || exit 1

LOG_DIR=".sleepcode/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/worker_$(date +%Y%m%d_%H%M%S).log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== AI Night Worker 시작 ==="
log "로그 파일: $LOG_FILE"

ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  log "--- 반복 #${ITERATION} 시작 ---"

  # 미완료 태스크가 있는지 확인
  REMAINING=$(grep -c '\[ \]' .sleepcode/tasks.md 2>/dev/null || echo "0")
  log "남은 태스크: ${REMAINING}개"

  if [ "$REMAINING" -eq 0 ]; then
    log "=== 모든 태스크 완료. 종료합니다. ==="
    exit 0
  fi

  # rules.md + tasks.md 를 합쳐서 프롬프트 구성
  RULES=$(cat .sleepcode/rules.md)
  TASKS=$(cat .sleepcode/tasks.md)

  PROMPT="${RULES}

---

${TASKS}"

  log "claude 실행 중..."
  # stream-json → log_filter.py 로 핵심 메시지만 추출
  claude -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
    | python3 .sleepcode/scripts/log_filter.py \
    | tee -a "$LOG_FILE"
  EXIT_CODE=${PIPESTATUS[0]}
  log "claude 종료 (exit code: $EXIT_CODE)"

  # 미커밋 변경사항 체크
  if [[ -n $(git status --porcelain) ]]; then
    log "경고: 커밋되지 않은 변경사항 감지"
  fi

  log "--- 반복 #${ITERATION} 종료, {{SLEEP_INTERVAL}}초 대기 ---"
  sleep {{SLEEP_INTERVAL}}
done

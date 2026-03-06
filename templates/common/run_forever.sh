#!/bin/bash

# AI Night Worker loop script
# Usage:
#   ./.sleepcode/scripts/run_forever.sh
#   ./.sleepcode/scripts/run_forever.sh --continue
#   ./.sleepcode/scripts/run_forever.sh --provider codex

cd "$(dirname "$0")/../.." || exit 1

LOG_DIR=".sleepcode/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/worker_$(date +%Y%m%d_%H%M%S).log"

USE_CONTINUE=false
PROVIDER_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --continue)
      USE_CONTINUE=true
      ;;
    --provider)
      shift
      [ $# -gt 0 ] && PROVIDER_ARG="$1"
      ;;
  esac
  shift
done

if [ -z "$PROVIDER_ARG" ] && [ -n "${SLEEPCODE_PROVIDER:-}" ]; then
  PROVIDER_ARG="$SLEEPCODE_PROVIDER"
fi

PROVIDER="$(printf '%s' "$PROVIDER_ARG" | tr '[:upper:]' '[:lower:]')"
[ -z "$PROVIDER" ] && PROVIDER="claude"
[ "$PROVIDER" = "auto" ] && PROVIDER="claude"
if [ "$PROVIDER" != "claude" ] && [ "$PROVIDER" != "codex" ]; then
  PROVIDER="claude"
fi
export SLEEPCODE_PROVIDER="$PROVIDER"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

build_codex_prompt_file() {
  local tasks_file="$1"
  local out_file="$2"
  local wrote=0

  : > "$out_file"
  if [ -f .sleepcode/scripts/base_rules.md ]; then
    cat .sleepcode/scripts/base_rules.md >> "$out_file"
    wrote=1
  fi
  if [ -f .sleepcode/rules.md ]; then
    if [ "$wrote" -eq 1 ]; then
      printf '\n\n---\n\n' >> "$out_file"
    fi
    cat .sleepcode/rules.md >> "$out_file"
    wrote=1
  fi
  if [ "$wrote" -eq 1 ]; then
    printf '\n\n---\n\n' >> "$out_file"
  fi
  printf '# Task List\n\n' >> "$out_file"
  cat "$tasks_file" >> "$out_file"
}

log "=== AI Night Worker start ==="
if [ "$USE_CONTINUE" = true ]; then
  log "continue mode enabled (--continue)"
fi
log "provider: $PROVIDER"
log "log file: $LOG_FILE"

if [ -f .sleepcode/.env ]; then
  set -a
  source .sleepcode/.env
  set +a
  log ".env loaded"
fi

ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  log "--- iteration #${ITERATION} start ---"

  if [ -n "$NOTION_API_KEY" ] && [ -n "$NOTION_DB_ID" ]; then
    SYNC_OUTPUT=$(python3 .sleepcode/scripts/notion_sync.py pull 2>&1)
    SYNC_EXIT=$?
    if [ $SYNC_EXIT -ne 0 ]; then
      log "Notion sync failed (pull): $SYNC_OUTPUT"
    else
      log "Notion sync complete (pull)"
    fi
  fi

  REMAINING=$(grep -c '\[ \]' .sleepcode/tasks.md 2>/dev/null || echo "0")
  log "remaining tasks: ${REMAINING}"

  if [ "$REMAINING" -eq 0 ]; then
    log "=== all tasks are complete. exiting. ==="
    exit 0
  fi

  # Keep CLAUDE.md synced for claude prompt-cache behavior.
  {
    BASE_RULES=$(cat .sleepcode/scripts/base_rules.md 2>/dev/null || true)
    RULES=$(cat .sleepcode/rules.md 2>/dev/null || true)
    if [ -n "$BASE_RULES" ] || [ -n "$RULES" ]; then
      printf '%s\n\n---\n\n%s' "$BASE_RULES" "$RULES" > CLAUDE.md
    fi
  }

  if [ "$PROVIDER" = "codex" ]; then
    if [ "$USE_CONTINUE" = true ] && [ "$ITERATION" -gt 1 ]; then
      TMP_PROMPT="$(mktemp)"
      printf '%s' 'Continue with the next tasks.' > "$TMP_PROMPT"
      log "codex running... (resume)"
      cat "$TMP_PROMPT" | codex exec resume --last --json --dangerously-bypass-approvals-and-sandbox - 2>&1 \
        | python3 .sleepcode/scripts/log_filter.py \
        | tee -a "$LOG_FILE"
      EXIT_CODE=${PIPESTATUS[0]}
      rm -f "$TMP_PROMPT"
    else
      TMP_PROMPT="$(mktemp)"
      build_codex_prompt_file ".sleepcode/tasks.md" "$TMP_PROMPT"
      log "codex running..."
      cat "$TMP_PROMPT" | codex exec --json --dangerously-bypass-approvals-and-sandbox - 2>&1 \
        | python3 .sleepcode/scripts/log_filter.py \
        | tee -a "$LOG_FILE"
      EXIT_CODE=${PIPESTATUS[0]}
      rm -f "$TMP_PROMPT"
    fi
  else
    if [ "$USE_CONTINUE" = true ] && [ "$ITERATION" -gt 1 ]; then
      PROMPT='Continue with the next tasks.'
      log "claude running... (continue)"
      claude --continue -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
        | python3 .sleepcode/scripts/log_filter.py \
        | tee -a "$LOG_FILE"
      EXIT_CODE=${PIPESTATUS[0]}
    else
      PROMPT=$(cat .sleepcode/tasks.md)
      log "claude running..."
      claude -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
        | python3 .sleepcode/scripts/log_filter.py \
        | tee -a "$LOG_FILE"
      EXIT_CODE=${PIPESTATUS[0]}
    fi
  fi

  log "$PROVIDER exit code: $EXIT_CODE"

  if [[ -n $(git status --porcelain) ]]; then
    log "warning: uncommitted changes detected"
  fi

  if [ -n "$NOTION_API_KEY" ] && [ -n "$NOTION_DB_ID" ]; then
    SYNC_OUTPUT=$(python3 .sleepcode/scripts/notion_sync.py push 2>&1)
    SYNC_EXIT=$?
    if [ $SYNC_EXIT -ne 0 ]; then
      log "Notion sync failed (push): $SYNC_OUTPUT"
    else
      log "Notion sync complete (push)"
    fi
  fi

  log "--- iteration #${ITERATION} end, sleep {{SLEEP_INTERVAL}}s ---"
  sleep {{SLEEP_INTERVAL}}
done

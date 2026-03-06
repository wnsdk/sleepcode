#!/bin/bash

# AI Worker - single-run script
# Used when running one cycle manually instead of run_forever.sh.

cd "$(dirname "$0")/../.." || exit 1

if [ -f .sleepcode/.env ]; then
  set -a
  source .sleepcode/.env
  set +a
fi

PROVIDER_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
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

echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI single run start (provider: $PROVIDER)"

# Keep CLAUDE.md synced for claude prompt-cache behavior.
{
  BASE_RULES=$(cat .sleepcode/scripts/base_rules.md 2>/dev/null || true)
  RULES=$(cat .sleepcode/rules.md 2>/dev/null || true)
  if [ -n "$BASE_RULES" ] || [ -n "$RULES" ]; then
    printf '%s\n\n---\n\n%s' "$BASE_RULES" "$RULES" > CLAUDE.md
  fi
}

if [ "$PROVIDER" = "codex" ]; then
  TMP_PROMPT="$(mktemp)"
  build_codex_prompt_file ".sleepcode/tasks.md" "$TMP_PROMPT"
  cat "$TMP_PROMPT" | codex exec --json --dangerously-bypass-approvals-and-sandbox - 2>&1 \
    | python3 .sleepcode/scripts/log_filter.py
  EXIT_CODE=${PIPESTATUS[0]}
  rm -f "$TMP_PROMPT"
else
  PROMPT=$(cat .sleepcode/tasks.md)
  claude -p "$PROMPT" --dangerously-skip-permissions --output-format stream-json --verbose 2>&1 \
    | python3 .sleepcode/scripts/log_filter.py
  EXIT_CODE=${PIPESTATUS[0]}
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] provider exit code: $EXIT_CODE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI single run end"
exit "$EXIT_CODE"

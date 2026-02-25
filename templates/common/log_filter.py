#!/usr/bin/env python3
"""
stream-json 출력에서 핵심 메시지만 추출하는 필터.
Usage: claude ... --output-format stream-json | python3 .sleepcode/log_filter.py
"""
import sys
import json

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue

    msg_type = obj.get("type")

    # assistant 메시지만 처리
    if msg_type == "assistant":
        message = obj.get("message", {})
        contents = message.get("content", [])
        for c in contents:
            ctype = c.get("type")
            if ctype == "text":
                text = c.get("text", "").strip()
                if text:
                    print(f"[TEXT] {text}", flush=True)
            elif ctype == "tool_use":
                name = c.get("name", "?")
                inp = c.get("input", {})
                # 도구별 핵심 파라미터만 요약
                if name in ("Read", "Write", "Edit"):
                    param = inp.get("file_path", "")
                    print(f"[TOOL] {name}: {param}", flush=True)
                elif name == "Bash":
                    cmd = inp.get("command", "")
                    if len(cmd) > 120:
                        cmd = cmd[:120] + "..."
                    print(f"[TOOL] Bash: {cmd}", flush=True)
                elif name == "Glob":
                    print(f"[TOOL] Glob: {inp.get('pattern', '')}", flush=True)
                elif name == "Grep":
                    print(f"[TOOL] Grep: {inp.get('pattern', '')}", flush=True)
                elif name == "TodoWrite":
                    todos = inp.get("todos", [])
                    active = [t for t in todos if t.get("status") == "in_progress"]
                    if active:
                        print(f"[TODO] {active[0].get('activeForm', '')}", flush=True)
                else:
                    print(f"[TOOL] {name}", flush=True)

    # 최종 결과
    elif msg_type == "result":
        message = obj.get("message", "")
        if isinstance(message, str) and message:
            short = message[:200] + "..." if len(message) > 200 else message
            print(f"[DONE] {short}", flush=True)
        cost = obj.get("cost_usd")
        duration = obj.get("duration_ms")
        if cost is not None:
            print(f"[COST] ${cost:.4f} | {(duration or 0) / 1000:.0f}s", flush=True)

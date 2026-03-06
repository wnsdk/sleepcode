#!/usr/bin/env python3
"""
Filters JSON stream output from Claude/Codex CLIs and prints concise logs.
Usage:
  claude ... --output-format stream-json | python3 .sleepcode/scripts/log_filter.py
  codex exec --json ... | python3 .sleepcode/scripts/log_filter.py
"""

import json
import sys


def trim(text, limit=120):
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


for raw in iter(sys.stdin.readline, ""):
    line = raw.strip()
    if not line:
        continue

    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue

    msg_type = obj.get("type")

    # Claude stream format
    if msg_type == "assistant":
        message = obj.get("message", {})
        contents = message.get("content", [])
        for content in contents:
            ctype = content.get("type")
            if ctype == "text":
                text = (content.get("text") or "").strip()
                if text:
                    print(f"[TEXT] {text}", flush=True)
            elif ctype == "tool_use":
                name = content.get("name", "?")
                inp = content.get("input", {})
                if name in ("Read", "Write", "Edit"):
                    print(f"[TOOL] {name}: {inp.get('file_path', '')}", flush=True)
                elif name == "Bash":
                    print(f"[TOOL] Bash: {trim(inp.get('command', ''), 120)}", flush=True)
                elif name in ("Glob", "Grep"):
                    print(f"[TOOL] {name}: {inp.get('pattern', '')}", flush=True)
                elif name == "TodoWrite":
                    todos = inp.get("todos", [])
                    active = [t for t in todos if t.get("status") == "in_progress"]
                    if active:
                        todo = active[0].get("activeForm") or active[0].get("content", "")
                        if todo:
                            print(f"[TODO] {todo}", flush=True)
                else:
                    print(f"[TOOL] {name}", flush=True)
        continue

    if msg_type == "result":
        message = obj.get("message", "")
        if isinstance(message, str) and message:
            print(f"[DONE] {trim(message, 200)}", flush=True)
        cost = obj.get("cost_usd")
        duration = obj.get("duration_ms")
        if isinstance(cost, (int, float)):
            seconds = (duration or 0) / 1000
            print(f"[COST] ${cost:.4f} | {seconds:.0f}s", flush=True)
        continue

    # Codex stream format
    if msg_type in ("item.started", "item.completed"):
        item = obj.get("item") or {}
        item_type = item.get("type")

        if item_type == "agent_message" and msg_type == "item.completed":
            text = (item.get("text") or "").strip()
            if text:
                print(f"[TEXT] {text}", flush=True)
            continue

        if item_type == "command_execution":
            command = trim(item.get("command", ""), 120)
            if msg_type == "item.started":
                print(f"[TOOL] Bash: {command}", flush=True)
            else:
                exit_code = item.get("exit_code")
                suffix = f" (exit {exit_code})" if isinstance(exit_code, int) else ""
                print(f"[TOOL] Bash done{suffix}: {command}", flush=True)
            continue

    if msg_type == "turn.completed":
        usage = obj.get("usage") or {}
        input_tokens = usage.get("input_tokens") or usage.get("prompt_tokens") or 0
        output_tokens = usage.get("output_tokens") or usage.get("completion_tokens") or 0
        total_tokens = usage.get("total_tokens") or (input_tokens + output_tokens)
        if total_tokens:
            print(f"[TOKENS] in:{input_tokens} out:{output_tokens} total:{total_tokens}", flush=True)

#!/usr/bin/env python3
"""
Notion DB ↔ task_queue.md 동기화 스크립트.
Usage:
  python3 .sleepcode/notion_sync.py pull   # Notion → task_queue.md
  python3 .sleepcode/notion_sync.py push   # task_queue.md → Notion
"""

import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error

# Windows 한글 깨짐 방지: stdin/stdout을 UTF-8로 강제 설정
if sys.platform == "win32":
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

TASKS_FILE = ".sleepcode/task_queue.md"
DONE_DIR = ".sleepcode/task_done"
STATE_FILE = ".sleepcode/.notion_state.json"
NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
LAST_API_ERROR_MESSAGE = ""

# ─── Notion API 헬퍼 ───


def api_request(method, endpoint, api_key, body=None):
    global LAST_API_ERROR_MESSAGE
    url = f"{NOTION_API}{endpoint}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Notion-Version", NOTION_VERSION)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            LAST_API_ERROR_MESSAGE = ""
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        LAST_API_ERROR_MESSAGE = f"API 오류 ({e.code}): {body_text}"
        print(f"[notion_sync] {LAST_API_ERROR_MESSAGE}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        LAST_API_ERROR_MESSAGE = f"네트워크 오류: {e.reason}"
        print(f"[notion_sync] {LAST_API_ERROR_MESSAGE}", file=sys.stderr)
        return None


# ─── DB 스키마 분석 ───


def get_db_schema(api_key, db_id):
    result = api_request("GET", f"/databases/{db_id}", api_key)
    if not result:
        return None, None, None
    props = result.get("properties", {})

    title_prop = None
    status_prop = None
    status_type = None

    for name, prop in props.items():
        ptype = prop.get("type")
        if ptype == "title":
            title_prop = name
        elif ptype == "checkbox" and not status_prop:
            status_prop = name
            status_type = "checkbox"
        elif ptype == "status":
            status_prop = name
            status_type = "status"
        elif ptype == "select" and not status_prop:
            status_prop = name
            status_type = "select"

    return title_prop, status_prop, status_type


# ─── 필터 파싱 ───


def parse_filter(filter_str, status_prop, status_type):
    """'컬럼명 = 값' 형태의 필터를 Notion API filter JSON으로 변환"""
    if not filter_str or "=" not in filter_str:
        return None
    col, val = [s.strip() for s in filter_str.split("=", 1)]
    if not col or not val:
        return None

    # 필터 대상 프로퍼티의 타입 추론 (status_prop과 같으면 해당 타입 사용)
    if col == status_prop:
        if status_type == "checkbox":
            return {"property": col, "checkbox": {"equals": val.lower() in ("true", "yes", "1")}}
        elif status_type == "status":
            return {"property": col, "status": {"equals": val}}
        elif status_type == "select":
            return {"property": col, "select": {"equals": val}}
    else:
        # 기본: rich_text로 시도, select, status 순
        return {"property": col, "rich_text": {"equals": val}}


# ─── 타이틀 추출 ───


def extract_title(page, title_prop):
    prop = page.get("properties", {}).get(title_prop, {})
    title_items = prop.get("title", [])
    return "".join(t.get("plain_text", "") for t in title_items).strip()


# ─── 완료 상태 추출 ───


def extract_done(page, status_prop, status_type):
    prop = page.get("properties", {}).get(status_prop, {})
    if status_type == "checkbox":
        return prop.get("checkbox", False)
    elif status_type == "status":
        status = prop.get("status")
        if status:
            name = status.get("name", "").lower()
            return name in ("done", "완료", "complete", "completed")
        return False
    elif status_type == "select":
        select = prop.get("select")
        if select:
            name = select.get("name", "").lower()
            return name in ("done", "완료", "complete", "completed")
        return False
    return False


def normalize_task_title(title):
    return re.sub(r"\s+", " ", str(title or "")).strip().lower()


def parse_task_body(task_body):
    body = str(task_body or "").strip()
    if not body:
        return None
    notion_match = re.search(r"\s*<!--\s*notion:([a-f0-9-]+)\s*-->\s*$", body, re.IGNORECASE)
    notion_id = notion_match.group(1).lower() if notion_match else None
    title = body[: notion_match.start()].strip() if notion_match else body
    if not title:
        return None
    return {"title": title, "notion_id": notion_id}


def build_task_key(title, notion_id=None):
    if notion_id:
        return f"notion:{str(notion_id).lower()}"
    return f"title:{normalize_task_title(title)}"


def read_done_keys():
    done_keys = set()
    if not os.path.isdir(DONE_DIR):
        return done_keys

    for name in sorted(os.listdir(DONE_DIR)):
        path = os.path.join(DONE_DIR, name)
        if not os.path.isfile(path) or not name.lower().endswith(".md"):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    m = re.match(r"^\s*-\s*\[x\]\s+(.+?)\s*$", line, re.IGNORECASE)
                    if not m:
                        continue
                    parsed = parse_task_body(m.group(1))
                    if not parsed:
                        continue
                    done_keys.add(build_task_key(parsed["title"], parsed["notion_id"]))
        except Exception:
            continue
    return done_keys


def parse_task_queue_entries(content):
    entries = []
    in_code_block = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        m = re.match(r"^\s*-\s*\[([ xX])\]\s+(.+?)\s*$", line)
        if not m:
            continue
        parsed = parse_task_body(m.group(2))
        if not parsed:
            continue
        entries.append(
            {
                "checked": m.group(1).lower() == "x",
                "title": parsed["title"],
                "notion_id": parsed["notion_id"],
                "key": build_task_key(parsed["title"], parsed["notion_id"]),
            }
        )
    return entries


# ─── Watch 모드: DB 스키마 확장 분석 ───


def get_watch_schema(api_key, db_id):
    """Watch 모드용 DB 스키마 — 제어판 컬럼 자동 감지"""
    result = api_request("GET", f"/databases/{db_id}", api_key)
    if not result:
        return None
    props = result.get("properties", {})
    schema = {
        "title_prop": None,
        "status_prop": None,
        "status_type": None,
        "worker_prop": None,
        "run_prop": None,
        "priority_prop": None,
        "difficulty_prop": None,
        "log_prop": None,
        "model_prop": None,
        "model_type": None,
        "cost_prop": None,
        "completed_at_prop": None,
        "commit_prop": None,
    }

    for name, prop in props.items():
        ptype = prop.get("type")
        lname = name.lower().strip()
        if ptype == "title":
            schema["title_prop"] = name
        elif ptype in ("status", "select") and lname in ("status", "상태") and not schema["status_prop"]:
            schema["status_prop"] = name
            schema["status_type"] = ptype
        elif ptype == "select" and lname in ("worker", "워커"):
            schema["worker_prop"] = name
        elif ptype == "checkbox" and lname in ("run", "실행", "start", "시작"):
            schema["run_prop"] = name
        elif ptype == "number" and lname in ("priority", "우선순위"):
            schema["priority_prop"] = name
        elif ptype in ("select", "number") and lname in ("difficulty", "난이도"):
            schema["difficulty_prop"] = name
        elif ptype == "rich_text" and lname in ("log", "로그"):
            schema["log_prop"] = name
        elif ptype in ("rich_text", "select") and lname in ("model", "모델") and not schema["model_prop"]:
            schema["model_prop"] = name
            schema["model_type"] = ptype
        elif ptype == "number" and lname in ("cost", "비용"):
            schema["cost_prop"] = name
        elif ptype == "date" and lname in ("completed at", "completed_at", "완료일", "완료 시각"):
            schema["completed_at_prop"] = name
        elif ptype == "rich_text" and lname in ("commit", "커밋", "commit id", "커밋 id"):
            schema["commit_prop"] = name

    # Fallback: status 미감지 시 첫 번째 status/select 프로퍼티 사용
    if not schema["status_prop"]:
        for name, prop in props.items():
            if prop.get("type") == "status":
                schema["status_prop"] = name
                schema["status_type"] = "status"
                break
        if not schema["status_prop"]:
            for name, prop in props.items():
                ptype = prop.get("type")
                lname = name.lower().strip()
                if ptype == "select" and lname not in ("worker", "워커"):
                    schema["status_prop"] = name
                    schema["status_type"] = "select"
                    break

    return schema


def extract_status_value(page, prop_name, prop_type):
    """Status/Select 프로퍼티 값 추출"""
    if prop_type == "status":
        s = page.get("properties", {}).get(prop_name, {}).get("status")
        return s.get("name", "") if s else ""
    elif prop_type == "select":
        s = page.get("properties", {}).get(prop_name, {}).get("select")
        return s.get("name", "") if s else ""
    return ""


def extract_difficulty(page, prop_name):
    """Difficulty 프로퍼티에서 1-5 값만 추출"""
    if not prop_name:
        return None

    prop = page.get("properties", {}).get(prop_name, {})
    ptype = prop.get("type")

    raw = None
    if ptype == "select":
        select = prop.get("select")
        raw = select.get("name", "") if select else ""
    elif ptype == "number":
        raw = prop.get("number")

    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None

    if 1 <= value <= 5:
        return value
    return None


# ─── POLL: Notion DB 폴링 (Watch 모드용) ───


def is_done_status(value):
    if not value:
        return False
    name = str(value).strip().lower()
    return name in ("done", "완료", "complete", "completed", "success")


def poll_tasks(api_key, db_id, notion_filter=None):
    """Notion DB 폴링 — 태스크 목록 + 스키마 반환"""
    schema = get_watch_schema(api_key, db_id)
    if not schema or not schema["title_prop"]:
        print(json.dumps({"error": "schema_failed"}), file=sys.stderr)
        return None

    query_body = {"sorts": [{"timestamp": "created_time", "direction": "ascending"}]}
    if notion_filter:
        api_filter = parse_filter(notion_filter, schema["status_prop"], schema["status_type"])
        if api_filter:
            query_body["filter"] = api_filter

    pages = []
    has_more = True
    start_cursor = None

    while has_more:
        if start_cursor:
            query_body["start_cursor"] = start_cursor
        resp = api_request("POST", f"/databases/{db_id}/query", api_key, query_body)
        if not resp:
            print(json.dumps({"error": "query_failed"}), file=sys.stderr)
            return None
        pages.extend(resp.get("results", []))
        has_more = resp.get("has_more", False)
        start_cursor = resp.get("next_cursor")

    tasks = []
    for page in pages:
        page_id = page["id"]
        title = extract_title(page, schema["title_prop"])
        if not title:
            continue
        task = {"id": page_id, "title": title}

        if schema["status_prop"]:
            task["status"] = extract_status_value(
                page, schema["status_prop"], schema["status_type"]
            )
        if schema["worker_prop"]:
            w = page.get("properties", {}).get(schema["worker_prop"], {}).get("select")
            task["worker"] = w.get("name", "") if w else ""
        if schema["run_prop"]:
            task["run"] = (
                page.get("properties", {})
                .get(schema["run_prop"], {})
                .get("checkbox", False)
            )
        if schema["priority_prop"]:
            task["priority"] = (
                page.get("properties", {})
                .get(schema["priority_prop"], {})
                .get("number", 0)
                or 0
            )
        if schema["difficulty_prop"]:
            difficulty = extract_difficulty(page, schema["difficulty_prop"])
            if difficulty is not None:
                task["difficulty"] = difficulty

        tasks.append(task)

    # Priority 내림차순 정렬
    tasks.sort(key=lambda t: -(t.get("priority", 0) or 0))

    return {"tasks": tasks, "schema": schema}


def poll(api_key, db_id, notion_filter=None):
    """Notion DB 폴링 — 태스크 목록 + 스키마 JSON 출력"""
    result = poll_tasks(api_key, db_id, notion_filter)
    if not result:
        return False
    print(json.dumps(result, ensure_ascii=False))


def enqueue(api_key, db_id, notion_filter=None):
    """Run 체크된 신규 태스크를 task_queue.md 실행 대기열에 추가"""
    result = poll_tasks(api_key, db_id, notion_filter)
    if not result:
        return False

    schema = result.get("schema") or {}
    if not schema.get("run_prop"):
        return True

    tasks = result.get("tasks") or []

    existing_ids = set()
    lines = []
    if os.path.exists(TASKS_FILE):
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
        for line in lines:
            m = re.search(r"<!--\s*notion:([a-f0-9-]+)\s*-->", line)
            if m:
                existing_ids.add(m.group(1).lower())
    else:
        lines = [
            "# 작업 목록",
            "",
            "아래 태스크를 순서대로 진행하세요. task_queue.md는 backlog(읽기 전용)로 유지하세요.",
            "",
            "---",
            "",
        ]

    added = 0
    for task in tasks:
        if not task.get("run"):
            continue
        task_id = (task.get("id") or "").lower()
        if not task_id or task_id in existing_ids:
            continue
        title = (task.get("title") or "").strip()
        if not title:
            continue
        done = is_done_status(task.get("status"))
        check = "[x]" if done else "[ ]"
        lines.append(f"- {check} {title} <!-- notion:{task_id} -->")
        existing_ids.add(task_id)
        added += 1

    if added <= 0:
        return True

    with open(TASKS_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    state = {}
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            state = {}
    for task in tasks:
        task_id = (task.get("id") or "").lower()
        if task_id and task_id in existing_ids and task_id not in state:
            state[task_id] = is_done_status(task.get("status"))

    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

    print(f"[notion_sync] enqueue: +{added} tasks")


# ─── UPDATE-PAGE: 페이지 프로퍼티 업데이트 ───


def update_page(api_key, page_id):
    """페이지 프로퍼티 업데이트 — stdin에서 Notion API 프로퍼티 JSON 읽기"""
    global LAST_API_ERROR_MESSAGE
    props_json = sys.stdin.read().strip()
    if not props_json:
        print(json.dumps({"ok": False, "error": "no input"}), file=sys.stderr)
        return
    try:
        props = json.loads(props_json)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
        return

    result = api_request("PATCH", f"/pages/{page_id}", api_key, {"properties": props})
    if result:
        print(json.dumps({"ok": True}))
    else:
        error_message = LAST_API_ERROR_MESSAGE or "update failed"
        print(json.dumps({"ok": False, "error": error_message}, ensure_ascii=False))


# ─── APPEND-CONTENT: 페이지 본문에 보고 텍스트 추가 ───


def parse_inline_rich_text(text):
    """인라인 마크다운(**bold**)을 Notion rich_text 배열로 변환"""
    rich_texts = []
    pattern = re.compile(r'\*\*(.+?)\*\*')
    last_end = 0
    for match in pattern.finditer(text):
        if match.start() > last_end:
            before = text[last_end:match.start()]
            rich_texts.append({"type": "text", "text": {"content": before}})
        rich_texts.append({
            "type": "text",
            "text": {"content": match.group(1)},
            "annotations": {"bold": True},
        })
        last_end = match.end()
    if last_end < len(text):
        rich_texts.append({"type": "text", "text": {"content": text[last_end:]}})
    if not rich_texts:
        rich_texts.append({"type": "text", "text": {"content": text}})
    return rich_texts


def md_line_to_block(line):
    """마크다운 한 줄을 Notion 블록으로 변환"""
    stripped = line.strip()

    if stripped == "---":
        return {"object": "block", "type": "divider", "divider": {}}

    if stripped.startswith("### "):
        content = stripped[4:].strip()
        return {
            "object": "block", "type": "heading_3",
            "heading_3": {"rich_text": [{"type": "text", "text": {"content": content}}]},
        }

    if stripped.startswith("## "):
        content = stripped[3:].strip()
        return {
            "object": "block", "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": content}}]},
        }

    if stripped.startswith("# "):
        content = stripped[2:].strip()
        return {
            "object": "block", "type": "heading_1",
            "heading_1": {"rich_text": [{"type": "text", "text": {"content": content}}]},
        }

    if re.match(r'^[-*+] ', stripped):
        content = stripped[2:].strip()
        return {
            "object": "block", "type": "bulleted_list_item",
            "bulleted_list_item": {"rich_text": parse_inline_rich_text(content)},
        }

    if re.match(r'^\d+\. ', stripped):
        content = re.sub(r'^\d+\. ', '', stripped)
        return {
            "object": "block", "type": "numbered_list_item",
            "numbered_list_item": {"rich_text": parse_inline_rich_text(content)},
        }

    # 빈 줄
    if not stripped:
        return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": []}}

    return {
        "object": "block", "type": "paragraph",
        "paragraph": {"rich_text": parse_inline_rich_text(line)},
    }


def split_rich_text_chunks(rich_texts, max_len=2000):
    """rich_text 배열의 총 텍스트가 2000자를 초과하면 분할"""
    total = sum(len(rt.get("text", {}).get("content", "")) for rt in rich_texts)
    if total <= max_len:
        return [rich_texts]
    full_text = "".join(rt.get("text", {}).get("content", "") for rt in rich_texts)
    return [
        [{"type": "text", "text": {"content": full_text[i:i + max_len]}}]
        for i in range(0, len(full_text), max_len)
    ]


def append_content(api_key, page_id):
    """페이지 본문에 보고 텍스트 추가 — stdin에서 텍스트 읽기"""
    text = sys.stdin.read().strip()
    if not text:
        return

    from datetime import datetime, timezone, timedelta

    kst = timezone(timedelta(hours=9))
    timestamp = datetime.now(kst).strftime("%Y-%m-%d %H:%M")

    blocks = []

    # 구분선
    blocks.append({"object": "block", "type": "divider", "divider": {}})

    # 헤더
    blocks.append({
        "object": "block",
        "type": "heading_2",
        "heading_2": {
            "rich_text": [{"type": "text", "text": {"content": f"AI Report ({timestamp})"}}]
        },
    })

    # 줄 단위로 Notion 블록 변환
    for line in text.split("\n"):
        block = md_line_to_block(line)
        btype = block.get("type")

        # rich_text 2000자 제한 처리
        if btype in ("paragraph", "bulleted_list_item", "numbered_list_item"):
            rich_texts = block.get(btype, {}).get("rich_text", [])
            chunks = split_rich_text_chunks(rich_texts)
            for i, chunk in enumerate(chunks):
                if i == 0:
                    block[btype]["rich_text"] = chunk
                    blocks.append(block)
                else:
                    blocks.append({
                        "object": "block", "type": btype,
                        btype: {"rich_text": chunk},
                    })
        else:
            blocks.append(block)

    if len(blocks) <= 2:  # 헤더+구분선만 있으면 스킵
        return

    # 100블록씩 나누어 전송 (API 제한)
    for i in range(0, len(blocks), 100):
        chunk = blocks[i : i + 100]
        result = api_request(
            "PATCH", f"/blocks/{page_id}/children", api_key, {"children": chunk}
        )
        if not result:
            print(f"[notion_sync] 페이지 콘텐츠 추가 실패: {page_id}", file=sys.stderr)
            return

    print(f"[notion_sync] 보고 내용 기록 완료: {page_id}")


# ─── Git commit 시각 조회 ───


def get_commit_time_for_task(page_id, cwd=None):
    """task_queue/task_done에서 특정 태스크가 완료 처리된 git commit 시각을 반환"""
    try:
        result = subprocess.run(
            [
                "git",
                "log",
                "--format=COMMIT %aI",
                "-p",
                "--",
                ".sleepcode/task_queue.md",
                ".sleepcode/task_done",
            ],
            capture_output=True,
            text=True,
            cwd=cwd or ".",
            timeout=30,
        )
        if result.returncode != 0:
            return None
        current_time = None
        for line in result.stdout.split("\n"):
            if line.startswith("COMMIT "):
                current_time = line[7:].strip()
            elif (
                line.startswith("+")
                and not line.startswith("+++")
                and re.search(r"\[[xX]\]", line)
                and f"notion:{page_id}" in line
            ):
                return current_time
        return None
    except Exception:
        return None


# ─── PULL: Notion → task_queue.md ───


def pull(api_key, db_id, notion_filter=None, status_prop_name=None, status_type_name=None):
    title_prop, status_prop, status_type = get_db_schema(api_key, db_id)
    if not title_prop:
        print("[notion_sync] DB 스키마 조회 실패", file=sys.stderr)
        return False

    # 스키마에서 감지 못하면 기본값
    if not status_prop:
        print("[notion_sync] 경고: 완료 상태 프로퍼티를 찾지 못했습니다. 모두 미완료로 처리합니다.", file=sys.stderr)

    # 필터 구성
    query_body = {"sorts": [{"timestamp": "created_time", "direction": "ascending"}]}
    api_filter = parse_filter(notion_filter, status_prop, status_type) if notion_filter else None
    if api_filter:
        query_body["filter"] = api_filter

    # 페이지네이션 처리
    pages = []
    has_more = True
    start_cursor = None

    while has_more:
        if start_cursor:
            query_body["start_cursor"] = start_cursor
        result = api_request("POST", f"/databases/{db_id}/query", api_key, query_body)
        if not result:
            print("[notion_sync] DB 쿼리 실패", file=sys.stderr)
            return False
        pages.extend(result.get("results", []))
        has_more = result.get("has_more", False)
        start_cursor = result.get("next_cursor")

    # task_queue.md 생성
    lines = [
        "# 작업 목록\n",
        "아래 태스크를 순서대로 진행하세요. task_queue.md는 backlog(읽기 전용)로 유지하세요.\n",
        "---\n",
    ]

    state = {}
    for page in pages:
        page_id = page["id"]
        title = extract_title(page, title_prop)
        if not title:
            continue
        done = extract_done(page, status_prop, status_type) if status_prop else False
        check = "[x]" if done else "[ ]"
        lines.append(f"- {check} {title} <!-- notion:{page_id} -->")
        state[page_id] = done

    with open(TASKS_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

    total = len(state)
    done_count = sum(1 for v in state.values() if v)
    print(f"[notion_sync] pull 완료: {total}개 태스크 ({done_count}개 완료)")


# ─── PUSH: task_queue.md → Notion ───


def push(api_key, db_id):
    # 전체 스키마 조회 (completed_at_prop 포함)
    watch_schema = get_watch_schema(api_key, db_id)
    if not watch_schema:
        print("[notion_sync] DB 스키마 조회 실패", file=sys.stderr)
        return False

    status_prop = watch_schema["status_prop"]
    status_type = watch_schema["status_type"]
    completed_at_prop = watch_schema["completed_at_prop"]

    if not status_prop:
        print("[notion_sync] 완료 상태 프로퍼티를 찾지 못해 push를 건너뜁니다.", file=sys.stderr)
        return False

    # 이전 상태 로드
    prev_state = {}
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            prev_state = json.load(f)

    # task_queue.md 파싱
    if not os.path.exists(TASKS_FILE):
        return

    with open(TASKS_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    task_entries = parse_task_queue_entries(content)
    done_keys = read_done_keys()
    current_state = {}
    for entry in task_entries:
        page_id = entry.get("notion_id")
        if not page_id:
            continue
        done = entry["checked"] or (entry["key"] in done_keys)
        current_state[page_id] = done

    # 변경된 항목만 업데이트
    updated = 0
    for page_id, done in current_state.items():
        prev_done = prev_state.get(page_id)
        if prev_done is not None and prev_done != done:
            # Notion API로 업데이트
            if status_type == "checkbox":
                props = {status_prop: {"checkbox": done}}
            elif status_type == "status":
                status_name = "Success" if done else "Idle"
                props = {status_prop: {"status": {"name": status_name}}}
            elif status_type == "select":
                select_name = "Success" if done else "Idle"
                props = {status_prop: {"select": {"name": select_name}}}
            else:
                continue

            # 완료 시 "Completed At"에 git commit 시각 설정
            if done and completed_at_prop:
                commit_time = get_commit_time_for_task(page_id)
                if commit_time:
                    props[completed_at_prop] = {"date": {"start": commit_time}}

            result = api_request("PATCH", f"/pages/{page_id}", api_key, {"properties": props})
            if result:
                updated += 1

    # 상태 저장
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(current_state, f, indent=2)

    if updated > 0:
        print(f"[notion_sync] push 완료: {updated}개 태스크 상태 업데이트")


# ─── 메인 ───


def main():
    api_key = os.environ.get("NOTION_API_KEY", "")
    db_id = os.environ.get("NOTION_DB_ID", "")
    notion_filter = os.environ.get("NOTION_FILTER", "")

    if not api_key or not db_id:
        return

    if len(sys.argv) < 2:
        print("Usage: notion_sync.py [pull|push]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "pull":
        result = pull(api_key, db_id, notion_filter)
        if result is False:
            sys.exit(1)
    elif cmd == "push":
        result = push(api_key, db_id)
        if result is False:
            sys.exit(1)
    elif cmd == "poll":
        result = poll(api_key, db_id, notion_filter)
        if result is False:
            sys.exit(1)
    elif cmd == "enqueue":
        result = enqueue(api_key, db_id, notion_filter)
        if result is False:
            sys.exit(1)
    elif cmd == "update-page":
        if len(sys.argv) < 3:
            print("Usage: notion_sync.py update-page <page_id>", file=sys.stderr)
            sys.exit(1)
        update_page(api_key, sys.argv[2])
    elif cmd == "append-content":
        if len(sys.argv) < 3:
            print(
                "Usage: notion_sync.py append-content <page_id>", file=sys.stderr
            )
            sys.exit(1)
        append_content(api_key, sys.argv[2])
    else:
        print(f"알 수 없는 명령: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

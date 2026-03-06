# Notion 실시간 동기화 강화 — 구현 계획

> proposal-runtime-task-addition.md 제안 7번의 구체적 구현 시스템 설계

---

## 1. 현재 시스템 분석

### 현재 Notion 동기화 흐름

```
[run 모드]
  1. .env 로드 → NOTION_API_KEY, NOTION_DB_ID 확인
  2. notion_sync.py pull (Notion → tasks.md)       ← 실행 전 1회
  3. Claude 프로세스 실행 (tasks.md를 stdin으로 전달)
  4. Claude 완료
  5. notion_sync.py push (tasks.md → Notion)       ← 실행 후 1회

[loop 모드 — run_forever.sh]
  while true:
    1. notion_sync.py pull
    2. 남은 태스크 확인 → 0이면 종료
    3. Claude 실행
    4. notion_sync.py push
    5. sleep 5초

[parallel 모드]
  - Notion 동기화 없음 (worktree별 독립 tasks.md)
```

### 핵심 제약

| 항목 | 설명 |
|------|------|
| **stdin 주입 불가** | Claude 프로세스에 `stdin.write()` → `stdin.end()` 후 새 태스크 전달 불가 |
| **pull 타이밍** | Claude 실행 전 1회만 수행 → 실행 중 Notion 변경사항 반영 안 됨 |
| **tasks.md 충돌** | Claude가 tasks.md를 수정 중이므로 외부에서 직접 쓰면 충돌 |

---

## 2. 구현 시스템 설계

### 2.1 아키텍처 개요

Proposal 1(inbox 파일)을 기반 인프라로 두고, Proposal 7(Notion 백그라운드 폴링)을 그 위에 구축한다.

```
┌─────────────────────────────────────────────────────────────┐
│  Notion DB                                                  │
│  (유저가 모바일/웹에서 태스크 추가)                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │  30초 간격 백그라운드 polling
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  notionBackgroundSync (Node.js setInterval)                  │
│                                                              │
│  - Notion DB 쿼리 → 새 태스크 감지                           │
│  - 새 태스크를 inbox.md에 기록                               │
│  - 완료된 태스크를 .notion_state.json에 반영                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  .sleepcode/inbox.md                                         │
│                                                              │
│  - [ ] 새로운 태스크 A  <!-- notion:page-id-1 -->            │
│  - [ ] 새로운 태스크 B  <!-- notion:page-id-2 -->            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │  mergeInbox() — Claude 실행 전 호출
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  .sleepcode/tasks.md                                         │
│                                                              │
│  (Claude가 읽고 수정하는 메인 태스크 파일)                    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 파일 구조

```
.sleepcode/
├── tasks.md               # 메인 태스크 (Claude가 관리)
├── inbox.md               # 새 태스크 대기열 (외부에서 안전하게 추가)
├── .notion_state.json     # Notion 동기화 상태 (기존)
├── .notion_bg_state.json  # 백그라운드 폴링 상태 (신규)
├── scripts/
│   └── notion_sync.py     # 기존 pull/push 스크립트 (수정)
└── config.json            # notion_bg_poll_interval 설정 추가
```

---

## 3. 구현 상세

### 3.1 Phase A: inbox.md 병합 시스템 (Proposal 1 기반)

> Claude 실행 전 inbox.md → tasks.md 병합

#### `mergeInbox(targetDir)` — bin/index.js에 추가

```javascript
function mergeInbox(targetDir) {
  const scDir = path.join(targetDir, '.sleepcode');
  const inboxPath = path.join(scDir, 'inbox.md');
  const tasksPath = path.join(scDir, 'tasks.md');

  if (!fs.existsSync(inboxPath)) return 0;
  const inbox = fs.readFileSync(inboxPath, 'utf-8').trim();
  if (!inbox) return 0;

  // inbox에서 태스크 라인만 추출 (- [ ] 로 시작하는 줄)
  const newTasks = inbox.split('\n')
    .filter(line => /^- \[ \]/.test(line.trim()));

  if (newTasks.length === 0) {
    fs.writeFileSync(inboxPath, '');
    return 0;
  }

  // tasks.md에서 현재 워커 섹션 끝에 추가
  const tasks = fs.readFileSync(tasksPath, 'utf-8');
  const appended = tasks.trimEnd() + '\n' + newTasks.join('\n') + '\n';
  fs.writeFileSync(tasksPath, appended);

  // inbox 초기화
  fs.writeFileSync(inboxPath, '');

  return newTasks.length;
}
```

#### 호출 위치

| 함수 | 위치 | 타이밍 |
|------|------|--------|
| `runSingleWithDashboard()` | 1810행 부근 | Notion pull 직후, Claude 실행 전 |
| `spawnWorker()` | 1543행 부근 | CLAUDE.md 동기화 직후 |
| `run_forever.sh` | while 루프 내 | Notion pull 직후 |

---

### 3.2 Phase B: Notion 백그라운드 폴링 시스템

> Claude 실행 중 Notion 변경 감지 → inbox.md에 기록

#### 전체 흐름

```
Claude 실행 시작
     │
     ├── startNotionBgSync(targetDir, interval) 호출
     │       │
     │       └── setInterval(interval) 루프:
     │              1. Notion DB 쿼리 (전체 페이지 목록)
     │              2. .notion_bg_state.json 로드 (이전 페이지 ID 목록)
     │              3. 새로 추가된 페이지 감지 (ID diff)
     │              4. 새 태스크를 inbox.md에 append
     │              5. .notion_bg_state.json 업데이트
     │              6. 대시보드 로그에 알림
     │
Claude 실행 종료
     │
     ├── stopNotionBgSync() 호출
     └── 기존 notion_sync.py push 실행 (변경 없음)
```

#### `startNotionBgSync()` — bin/index.js에 추가

```javascript
function startNotionBgSync(targetDir, pushLog) {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DB_ID;
  const filter = process.env.NOTION_FILTER || '';

  if (!apiKey || !dbId) return null;

  const scDir = path.join(targetDir, '.sleepcode');
  const bgStatePath = path.join(scDir, '.notion_bg_state.json');
  const inboxPath = path.join(scDir, 'inbox.md');

  // 폴링 간격 (config.json에서 읽거나 기본 30초)
  const configPath = path.join(scDir, 'config.json');
  let interval = 30000;
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.notion_bg_poll_interval) {
        interval = config.notion_bg_poll_interval * 1000;
      }
    } catch {}
  }

  const py = detectPython();
  const syncScript = path.join(scDir, 'scripts', 'notion_sync.py');
  if (!py || !fs.existsSync(syncScript)) return null;

  // notion_sync.py에 diff 명령 추가하여 새 태스크만 추출
  const timer = setInterval(() => {
    try {
      // pull-diff: 현재 Notion 상태와 bg_state 비교 → 새 태스크만 stdout으로 출력
      const result = execSync(
        `${py.cmd} "${syncScript}" pull-diff`,
        { cwd: targetDir, stdio: 'pipe', timeout: 15000, env: process.env }
      ).toString().trim();

      if (result) {
        // 새 태스크를 inbox.md에 추가
        const existing = fs.existsSync(inboxPath)
          ? fs.readFileSync(inboxPath, 'utf-8')
          : '';
        fs.writeFileSync(inboxPath, existing + result + '\n');

        const count = result.split('\n').filter(l => l.trim()).length;
        if (pushLog) {
          pushLog('system', `[Notion] ${count}개 새 태스크 감지 → 다음 사이클에 반영`);
        }
      }
    } catch {
      // 네트워크 오류 등은 무시 (다음 폴링에서 재시도)
    }
  }, interval);

  if (pushLog) {
    pushLog('system', `[Notion] 백그라운드 동기화 시작 (${interval / 1000}초 간격)`);
  }

  return timer;
}

function stopNotionBgSync(timer) {
  if (timer) clearInterval(timer);
}
```

---

### 3.3 Phase C: notion_sync.py 확장

> `pull-diff` 명령 추가 — 새로 추가된 태스크만 감지

#### notion_sync.py 수정 내용

```python
# 새 명령: pull-diff
# - Notion DB를 쿼리하여 현재 전체 페이지 목록을 가져옴
# - .notion_bg_state.json에 저장된 이전 페이지 ID 목록과 비교
# - 새로 추가된 페이지(= ID가 이전에 없던 것)만 stdout으로 출력
# - .notion_bg_state.json 업데이트

BG_STATE_FILE = ".sleepcode/.notion_bg_state.json"

def pull_diff(api_key, db_id, notion_filter=None):
    """Notion에서 새로 추가된 태스크만 감지하여 inbox 형식으로 출력"""
    title_prop, status_prop, status_type = get_db_schema(api_key, db_id)
    if not title_prop:
        return

    # 이전 상태 로드
    prev_ids = set()
    if os.path.exists(BG_STATE_FILE):
        with open(BG_STATE_FILE, "r", encoding="utf-8") as f:
            prev_ids = set(json.load(f).get("page_ids", []))

    # Notion 쿼리 (전체)
    query_body = {"sorts": [{"timestamp": "created_time", "direction": "ascending"}]}
    api_filter = parse_filter(notion_filter, status_prop, status_type) if notion_filter else None
    if api_filter:
        query_body["filter"] = api_filter

    pages = []
    has_more = True
    start_cursor = None
    while has_more:
        if start_cursor:
            query_body["start_cursor"] = start_cursor
        result = api_request("POST", f"/databases/{db_id}/query", api_key, query_body)
        if not result:
            return
        pages.extend(result.get("results", []))
        has_more = result.get("has_more", False)
        start_cursor = result.get("next_cursor")

    # 현재 ID 목록
    current_ids = set()
    new_tasks = []
    for page in pages:
        page_id = page["id"]
        current_ids.add(page_id)
        if page_id not in prev_ids:
            title = extract_title(page, title_prop)
            done = extract_done(page, status_prop, status_type) if status_prop else False
            if title and not done:
                new_tasks.append(f"- [ ] {title} <!-- notion:{page_id} -->")

    # 상태 저장
    with open(BG_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump({"page_ids": list(current_ids)}, f)

    # 새 태스크 출력 (stdout → Node.js가 캡처)
    if new_tasks:
        print("\n".join(new_tasks))
```

#### notion_sync.py main() 수정

```python
def main():
    # ... 기존 코드 ...
    cmd = sys.argv[1]
    if cmd == "pull":
        pull(api_key, db_id, notion_filter)
    elif cmd == "push":
        push(api_key, db_id)
    elif cmd == "pull-diff":
        pull_diff(api_key, db_id, notion_filter)
    # ...
```

---

### 3.4 Phase D: 각 실행 모드 통합

#### run 모드 (`runSingleWithDashboard`)

```
수정 위치: bin/index.js runSingleWithDashboard()

실행 전:
  1. .env 로드
  2. notion_sync.py pull          ← 기존
  3. mergeInbox(targetDir)        ← 추가
  4. CLAUDE.md 동기화
  5. Claude 실행

실행 중:
  6. startNotionBgSync()          ← 추가 (30초 간격 백그라운드 폴링)
     - Notion에서 새 태스크 감지 → inbox.md에 기록
     - 대시보드 로그에 알림 표시
  (※ 현재 실행 중인 Claude에는 반영 불가, 다음 run 시 반영)

실행 후:
  7. stopNotionBgSync()           ← 추가
  8. notion_sync.py push          ← 기존
```

#### loop 모드 (`run_forever.sh`)

```
수정 위치: templates/common/run_forever.sh

while true:
  1. notion_sync.py pull          ← 기존
  2. mergeInbox                   ← 추가 (Python 또는 bash로 구현)
  3. 남은 태스크 확인
  4. CLAUDE.md 동기화
  5. Claude 실행
  6. notion_sync.py push          ← 기존
  7. sleep

※ loop 모드에서 백그라운드 폴링:
  - 방법 A: run_forever.sh에서 sleep 구간에 pull-diff 실행 (단순)
  - 방법 B: Node.js로 loop 모드 전체를 리팩토링하여 setInterval 사용
  - 추천: 방법 A (기존 쉘 스크립트 구조 유지)

수정된 sleep 구간:
  sleep {{SLEEP_INTERVAL}}
  → 이 시점에 pull-diff 한 번 더 실행하여 inbox.md에 기록
```

#### parallel 모드

```
수정 위치: bin/index.js runParallelWorkers()

워커 시작 전:
  1. mergeInbox(targetDir)        ← 추가 (메인 프로젝트 기준)

실행 중:
  2. 백그라운드 폴링은 메인 프로젝트의 inbox.md에 기록
  3. 각 워커가 완료 → 다음 워커 시작 시 inbox 병합

※ parallel 모드 특이사항:
  - 메인 프로젝트의 inbox.md에 기록
  - @worker 태그가 있으면 해당 워커의 tasks.md에 추가
  - @worker 태그가 없으면 기본 섹션에 추가
  - 워커가 이미 실행 중이면 다음 실행 사이클에서 반영
```

---

## 4. 설정

### config.json 확장

```json
{
  "budget": 50,
  "notion_bg_poll_interval": 30,
  "notion_bg_sync_enabled": true
}
```

| 설정 키 | 기본값 | 설명 |
|---------|--------|------|
| `notion_bg_poll_interval` | `30` | 백그라운드 폴링 간격 (초) |
| `notion_bg_sync_enabled` | `true` | 백그라운드 동기화 on/off |

---

## 5. 대시보드 알림

백그라운드 폴링 시 대시보드 로그에 실시간 알림을 표시한다.

```
 ─── logs ─────────────────────────────────────────────────
  [14:32:15] tool: Write → .sleepcode/tasks.md
  [14:32:18] task: API 에러 핸들링 구현
  [14:33:00] [Notion] 2개 새 태스크 감지 → 다음 사이클에 반영
  [14:33:45] tool: Bash → npm test
```

---

## 6. 안전장치

| 항목 | 대응 |
|------|------|
| **Notion API 장애** | 폴링 실패 시 무시 → 다음 폴링에서 재시도 |
| **Rate Limit** | 30초 간격이면 분당 2회 → Notion API 제한(3 req/sec)에 안전 |
| **동시 쓰기** | inbox.md는 append-only → 충돌 위험 매우 낮음 |
| **중복 감지** | page_id 기반 비교 → 동일 태스크 중복 추가 방지 |
| **네트워크 끊김** | try-catch로 감싸고 로그만 남김 → Claude 실행에 영향 없음 |
| **bg_state 초기화** | 최초 실행 시 pull로 생성된 state를 bg_state에도 복사 |

---

## 7. 구현 순서

```
Step 1: mergeInbox() 함수 구현
        └── bin/index.js에 함수 추가
        └── runSingleWithDashboard()에서 호출
        └── spawnWorker()에서 호출

Step 2: notion_sync.py에 pull-diff 명령 추가
        └── 새 태스크 감지 로직
        └── .notion_bg_state.json 관리

Step 3: startNotionBgSync() / stopNotionBgSync() 구현
        └── bin/index.js에 추가
        └── runSingleWithDashboard()에서 호출

Step 4: run_forever.sh 수정
        └── mergeInbox 호출 추가
        └── sleep 구간에 pull-diff 호출 추가

Step 5: parallel 모드 통합
        └── runParallelWorkers()에서 mergeInbox 호출
        └── 백그라운드 폴링 연결

Step 6: config.json 설정 지원
        └── 폴링 간격, on/off 설정
```

---

## 8. 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `bin/index.js` | `mergeInbox()`, `startNotionBgSync()`, `stopNotionBgSync()` 추가. `runSingleWithDashboard()`, `spawnWorker()`, `runParallelWorkers()` 수정 |
| `templates/common/notion_sync.py` | `pull_diff()` 함수 및 `pull-diff` 명령 추가 |
| `templates/common/run_forever.sh` | `mergeInbox` 호출 및 sleep 구간 pull-diff 추가 |
| `templates/common/run_forever.ps1` | Windows 대응 동일 수정 |

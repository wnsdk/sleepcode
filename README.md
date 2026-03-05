# SleepCode

**AI codes while you sleep** — Claude AI 야간 자동화 세팅 CLI

잠자는 동안 AI가 코드를 작성하고, 빌드하고, 테스트하고, 커밋합니다.

---

## 설치

```bash
npm install -g sleepcode
```

또는 npx로 바로 실행:

```bash
npx sleepcode
```

---

## 빠른 시작

### 1. 프로젝트 루트에서 실행

```bash
cd my-project
npx sleepcode
```

인터랙티브 모드로 프로젝트 타입, 이름, AI 역할 등을 설정합니다.

### 2. 참고 자료 추가

`.sleepcode/docs/`에 기획서, 피그마 스크린샷 등 참고 자료를 넣습니다.

### 3. 태스크 작성

**방법 A: 자동 생성 (추천)**

```bash
npx sleepcode generate
```

참고 자료(docs/, Figma, Notion)와 프로젝트 구조를 분석해서 `tasks.md`를 자동 생성합니다.
이미 구현된 기능은 제외됩니다.

**방법 B: 직접 작성**

`.sleepcode/tasks.md` 에 AI가 수행할 작업을 작성합니다:

```markdown
# 작업 목록

- [ ] 로그인 화면 구현
- [ ] 회원가입 API 연동
- [ ] 홈 화면 UI 개선
```

### 4. 실행

```bash
# 1회 실행
npx sleepcode run

# 무한 루프 (잠자기 전)
npx sleepcode run --loop

# 병렬 실행 (여러 기능 동시 개발)
npx sleepcode parallel
```

### 5. 아침에 확인

```bash
git log --oneline --since="12 hours ago"
```

---

## 병렬 실행 (Parallel Mode)

여러 기능을 동시에 개발할 수 있는 **병렬 실행 모드**입니다. 각 워커가 독립된 git worktree에서 작업하므로 충돌 없이 동시에 진행됩니다.

### 사용법

`tasks.md`에 `@worker`로 워커별 태스크를 나눕니다:

```markdown
## @worker feature-auth
- [ ] 로그인 화면 구현
- [ ] JWT 토큰 관리

## @worker feature-home
- [ ] 홈 화면 레이아웃
- [ ] 상품 목록 API 연동

## @worker bugfix
- [ ] 장바구니 수량 버그 수정
```

```bash
# 병렬 실행
npx sleepcode parallel

# worktree만 생성 (실행 전 확인용)
npx sleepcode parallel --setup

# 완료된 브랜치 자동 머지
npx sleepcode parallel --merge

# worktree 정리
npx sleepcode parallel --clean
```

### 실시간 대시보드

병렬 실행 중 터미널에 실시간 대시보드가 표시됩니다:

```
┌─ sleepcode parallel — 3/3 workers active ──────────────────┐
│  ⟳ feature-auth       ████████░░░░░░░░ 2/4  JWT 토큰 관리 │
│  ⟳ feature-home       ██████░░░░░░░░░░ 1/3  상품 목록 API  │
│  ✓ bugfix             ████████████████ 1/1  완료           │
│──────────────────────────────────────────────────────────── │
│  💰 $0.45   ⏱ 12m 34s   📋 4/8 done                       │
│  주간: $12.34/$50 (24%) ██████░░░░░░░░░░                   │
└────────────────────────────────────────────────────────────┘
 [feature-auth] JWT 토큰 저장 로직을 구현하겠습니다...
 [feature-home] Edit: src/screens/HomeScreen.tsx
 [bugfix] Bash: git commit -m "fix: 장바구니 수량 버그 수정"
```

각 워커의 진행률, 비용, 경과 시간, 실시간 로그를 한눈에 확인할 수 있습니다.

---

## 주간 예산 관리

API 비용을 추적하고 주간 한도를 설정할 수 있습니다.

### 설정

초기화 시 인터랙티브로 설정하거나 CLI 옵션으로 지정:

```bash
# 인터랙티브 (초기화 중 질문)
npx sleepcode

# CLI 옵션
npx sleepcode --budget 50 --threshold 90
```

### 동작 방식

- 매주 월요일 기준으로 사용량 리셋
- 병렬 실행 시 30초마다 예산 체크
- 임계값(기본 90%) 도달 시 **진행 중인 태스크까지만 완료 후 종료**
- 워커는 SIGTERM으로 안전하게 중지됨

### 사용량 확인

```bash
npx sleepcode usage
```

```
📊 주간 사용량 리포트
────────────────────
  주간 시작: 2026-03-02 (월)
  세션 수:   8
  총 비용:   $12.34
  주간 예산: $50.00 (임계값: 90%)
  사용률:    24.7%
  ██████░░░░░░░░░░░░░░ 24.7%
  ✅ 예산 범위 내 ($32.66 남음)

📋 최근 세션
  2026-03-05 14:30  parallel  feature-auth  $3.45
  2026-03-05 14:30  parallel  feature-home  $2.10
  2026-03-04 22:00  run       —             $1.80
```

---

## 지원 프로젝트 타입

| 타입 | 설명 |
|------|------|
| `spring-boot` | Spring Boot (Kotlin/Java) — Gradle 빌드/테스트 |
| `react-native` | React Native (TypeScript) — tsc 타입체크 |
| `nextjs` | Next.js (TypeScript) — npm build/test/lint |
| `custom` | 직접 설정 — 빌드/테스트/린트 명령어 수동 입력 |

---

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `npx sleepcode` | 인터랙티브 초기화 |
| `npx sleepcode run` | 1회 실행 |
| `npx sleepcode run --loop` | 무한 루프 실행 |
| `npx sleepcode generate` | 참고자료 기반 tasks.md 자동 생성 |
| `npx sleepcode parallel` | 병렬 실행 (워커별 동시 개발) |
| `npx sleepcode parallel --setup` | worktree만 생성 (실행 전 확인) |
| `npx sleepcode parallel --merge` | 완료된 브랜치 자동 머지 |
| `npx sleepcode parallel --clean` | worktree 정리 |
| `npx sleepcode parallel --status` | 워커 상태 확인 |
| `npx sleepcode usage` | 주간 사용량 확인 |

## CLI 옵션

인터랙티브 모드 외에 CLI 인자로도 사용 가능합니다:

```bash
npx sleepcode --type react-native --name my-app --role "쇼핑몰 앱 개발"
```

| 옵션 | 설명 |
|------|------|
| `--type <type>` | 프로젝트 타입 (`spring-boot`, `react-native`, `nextjs`, `custom`) |
| `--name <name>` | 프로젝트 이름 |
| `--role <desc>` | AI 역할 설명 |
| `--figma-key <key>` | Figma API Key (선택) |
| `--figma-file <name>` | Figma 참고 파일명 (선택) |
| `--notion-key <key>` | Notion API Key (선택) |
| `--notion-page <name>` | Notion 참고 페이지명 (선택) |
| `--notion-db <id\|url>` | Notion DB ID 또는 URL (태스크 동기화용) |
| `--notion-filter <f>` | Notion 필터 (예: `"Status = To Do"`) |
| `--interval <sec>` | 반복 간격 초 (기본: 30) |
| `--budget <usd>` | 주간 예산 USD (예: `--budget 50`) |
| `--threshold <pct>` | 예산 임계값 % (기본: 90) |
| `-f, --force` | 기존 `.sleepcode/` 폴더 덮어쓰기 |
| `-h, --help` | 도움말 |

---

## 생성되는 파일

```
.sleepcode/
  rules.md               # ✏️ AI 역할 + 작업 규칙 (수정하세요)
  tasks.md               # ✏️ 작업 목록 (수정하세요)
  docs/                  # ✏️ 참고 자료 (피그마 스크린샷, 기획서 등)
  config.json            # ⚙️ 주간 예산 설정 (budget 설정 시)
  usage.json             # ⚙️ 사용량 추적 (자동 생성, gitignored)
  scripts/               # ⚙️ 시스템 (수정하지 마세요)
    base_rules.md        #    공통 작업 규칙
    ai_worker.sh/.ps1    #    1회 실행 스크립트 (OS별)
    run_forever.sh/.ps1  #    무한 루프 스크립트 (OS별)
    log_filter.py        #    실시간 로그 필터
    notion_sync.py       #    Notion 동기화 (Notion DB 모드만)
  logs/                  # 실행 로그 (자동 생성)
  README.md              # 사용 가이드

.claude/
  settings.local.json    # Claude 권한 설정
```

---

## 작동 원리

### 기본 모드

```
rules.md + tasks.md → 프롬프트 조합 → claude -p (비대화형) → 코드 작성 → git commit → 반복
```

1. `rules.md`(AI 역할/규칙)와 `tasks.md`(작업 목록)를 합쳐서 프롬프트로 전달
2. Claude가 태스크를 하나씩 수행 (코드 작성 → 빌드/테스트 → 오류 수정)
3. 태스크 완료 시 `[x]` 체크 + `git commit`
4. 모든 태스크 완료되면 자동 종료 (또는 대기 후 반복)

### 병렬 모드

```
tasks.md → @worker별 분리 → git worktree 생성 → 동시 실행 → 완료 후 머지
```

1. `@worker` 섹션별로 독립된 git worktree 생성
2. 각 worktree에서 Claude 워커가 동시에 실행
3. 실시간 대시보드로 진행 상황 모니터링
4. 완료 후 `--merge`로 main 브랜치에 통합

### Notion DB 동기화

Notion DB를 태스크 소스로 사용하면 양방향 동기화가 자동으로 진행됩니다:

```
[Notion DB] ──pull──→ [tasks.md] ──prompt──→ [Claude] ──완료──→ [tasks.md] ──push──→ [Notion DB]
```

- **pull**: 실행 전 Notion DB에서 태스크를 가져와 `tasks.md` 생성
- **push**: 실행 후 완료된 태스크 상태를 Notion DB에 반영
- DB 스키마 자동 감지 (checkbox, status, select 프로퍼티)
- 필터 조건으로 특정 태스크만 실행 가능 (예: `Status = To Do`)

### 실시간 로그

`stream-json` 출력을 `log_filter.py`가 파싱하여 핵심 메시지만 표시합니다:

```
[TEXT] 로그인 화면을 구현하겠습니다...
[TOOL] Edit: src/screens/LoginScreen.tsx
[TOOL] Bash: npx tsc --noEmit
[TEXT] 타입 체크 통과, 커밋합니다.
[TOOL] Bash: git commit -m "feat: 로그인 화면 구현"
[DONE] 완료
[COST] input: 50,000 / output: 12,000
```

---

## tmux 관리

| 동작 | 명령어 |
|------|--------|
| 세션 생성 + 실행 | `tmux new -s ai 'npx sleepcode run --loop'` |
| 백그라운드 전환 | `Ctrl+B` → `D` |
| 세션 재접속 | `tmux attach -t ai` |
| 실시간 로그 | `tail -f .sleepcode/logs/worker_*.log` |
| 종료 | `tmux attach -t ai` → `Ctrl+C` |
| 세션 삭제 | `tmux kill-session -t ai` |

---

## 사전 준비 (Prerequisites)

`npx sleepcode` 실행 시 **자동으로 필수 도구를 체크**합니다. 누락된 도구가 있으면 설치 방법을 안내하며, Claude CLI는 자동 설치를 제안합니다.

### 필수

| 도구 | 용도 | 자동 설치 |
|------|------|-----------|
| **Node.js** 18+ | CLI 실행 (`npx sleepcode`) | — |
| **Claude CLI** | AI 워커가 `claude -p` 명령으로 코드 작성 | npm으로 자동 설치 제안 |
| **Python 3** | 실시간 로그 필터 (`log_filter.py`) | 안내만 |
| **Git** | 코드 커밋 및 변경사항 관리 | 안내만 |

### 선택 (macOS/Linux만)

| 도구 | 용도 |
|------|------|
| **tmux** | 워커를 백그라운드 세션에서 실행 |

### 자동 체크 예시

```
사전 준비 확인 중...
  ✓ git (2.43.0)
  ✓ python3 (3.12.0)
  ✗ claude — 설치 필요
  - tmux — 미설치 (선택사항)

? claude CLI를 설치할까요? (npm install -g @anthropic-ai/claude-code) [Y/n]: y
  ✓ claude CLI 설치 완료
```

### Claude CLI 권한 설정

AI 워커는 비대화형(`-p`) 모드에서 `--dangerously-skip-permissions` 플래그를 사용합니다.
최초 1회 동의가 필요합니다:

```bash
claude --dangerously-skip-permissions
# 동의 프롬프트 수락 후 Ctrl+C
```

### Windows 지원

Windows에서는 `.sh` 대신 **PowerShell 스크립트(`.ps1`)가 자동 생성**됩니다. WSL 없이 바로 사용 가능합니다.

---

## 커스터마이징

- **AI 역할/규칙 변경**: `.sleepcode/rules.md` 수정
- **작업 목록 변경**: `.sleepcode/tasks.md` 수정 (또는 Notion DB에서 관리)
- **참고 자료 추가**: `.sleepcode/docs/`에 파일 추가 (스크린샷, 기획서 등)
- **반복 간격 변경**: `.sleepcode/scripts/run_forever.sh` (또는 `.ps1`)의 sleep 값 수정
- **주간 예산 변경**: `.sleepcode/config.json`의 `weeklyBudget`, `budgetThreshold` 수정
- **Claude 권한 변경**: `.claude/settings.local.json` 수정

---

## License

MIT

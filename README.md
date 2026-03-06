# SleepCode

**AI codes while you sleep** — Claude AI 야간 자동화 세팅 CLI

잠자는 동안 AI가 코드를 작성하고, 빌드하고, 테스트하고, 커밋합니다.

---

## 사용법

```bash
# 1회 실행
npx sleepcode run

# 무한 루프 (잠자기 전)
npx sleepcode run --loop

# 병렬 실행 (여러 기능 동시 개발)
npx sleepcode parallel

# Notion 제어판 모드 (원격으로 태스크 관리)
npx sleepcode watch
```

### 기본 흐름

```bash
cd my-project
npx sleepcode          # 초기화 (최초 1회)
npx sleepcode run      # 실행
```

1. 프로젝트 루트에서 `npx sleepcode` → 인터랙티브 초기화
2. `.sleepcode/tasks.md`에 작업 목록 작성 (또는 `generate`로 자동 생성)
3. `npx sleepcode run` → AI가 태스크를 순서대로 수행

### tasks.md 작성

**자동 생성 (추천)**

```bash
npx sleepcode generate
```

참고 자료(docs/, Figma, Notion)와 프로젝트 구조를 분석해서 `tasks.md`를 자동 생성합니다.

**직접 작성**

`.sleepcode/tasks.md`:

```markdown
# 작업 목록

- [ ] 로그인 화면 구현
- [ ] 회원가입 API 연동
- [ ] 홈 화면 UI 개선
```

---

## 병렬 실행

여러 기능을 동시에 개발합니다. 각 워커가 독립된 git worktree에서 작업하므로 충돌 없이 동시 진행됩니다.

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
npx sleepcode parallel              # 병렬 실행
npx sleepcode parallel --setup      # worktree만 생성 (실행 전 확인)
npx sleepcode parallel --merge      # 완료된 브랜치 자동 머지
npx sleepcode parallel --clean      # worktree 정리
npx sleepcode parallel --status     # 워커 상태 확인
```

### 실시간 대시보드

```
╭────────────────────────────────────────────────────╮
│ ▐ sleepcode ▌ parallel  3/3 workers                │
├────────────────────────────────────────────────────┤
│ ⟳ feature-auth    ━━━━━━━━──────── 2/4            │
│   > JWT 토큰 관리                                  │
│ ⟳ feature-home    ━━━━━━────────── 1/3            │
│   > 상품 목록 API 연동                              │
│ ✓ bugfix           ━━━━━━━━━━━━━━━ 1/1            │
├────────────────────────────────────────────────────┤
│ 비용: $0.45 · 경과: 12m 34s · 진행: 4/8           │
│ 주간: $12.34/$50 (24%) ━━━━━━──────                │
╰────────────────────────────────────────────────────╯
 ─── logs ───────────────────────────────────────────
 [feature-auth] JWT 토큰 저장 로직을 구현하겠습니다...
 [feature-home] Edit: src/screens/HomeScreen.tsx
```

---

## Notion 제어판 (Watch 모드)

Notion DB를 제어판으로 사용하여 원격으로 태스크를 관리합니다.

```bash
npx sleepcode watch
```

### Notion DB 스키마

| 컬럼 | 타입 | 설명 |
|------|------|------|
| Task | Title | 태스크 내용 |
| Status | Status/Select | 상태 (Start → Running → Done/Failed) |
| Worker | Select | 워커 이름 (병렬 실행 시 그룹핑) |
| Run | Checkbox | ✅ 체크하면 즉시 실행 |
| Priority | Number | 우선순위 (높을수록 먼저 실행) |
| Log | Rich Text | 실행 로그 (자동 기록) |
| Cost | Number | API 비용 (자동 기록) |

### 동작 방식

1. 30초마다 Notion DB 폴링
2. **Run** 체크 또는 **Status = Start** 인 태스크 감지
3. Worker별 그룹핑 → 자동 실행 (단일/병렬)
4. 완료 시 Status, Log, Cost 자동 업데이트

---

## 주간 예산 관리

API 비용을 추적하고 주간 한도를 설정합니다.

```bash
# 예산 설정
npx sleepcode --budget 50 --threshold 90

# 사용량 확인
npx sleepcode usage
```

```
📊 주간 사용량 리포트
────────────────────
  주간 시작: 2026-03-02 (월)
  총 비용:   $12.34
  주간 예산: $50.00 (임계값: 90%)
  사용률:    24.7%
  ━━━━━━────────────────── 24.7%
  ✅ 예산 범위 내 ($32.66 남음)
```

- 매주 월요일 기준으로 사용량 리셋
- 임계값 도달 시 진행 중인 태스크까지만 완료 후 종료

---

## 설치

```bash
npm install -g sleepcode
```

또는 npx로 바로 실행:

```bash
npx sleepcode
```

### 사전 준비

`npx sleepcode` 실행 시 자동으로 필수 도구를 체크합니다.

| 도구 | 용도 | 필수 |
|------|------|------|
| **Node.js** 18+ | CLI 실행 | ✅ |
| **Claude CLI** | AI 코드 작성 | ✅ (자동 설치 제안) |
| **Python 3** | 로그 필터 | ✅ |
| **Git** | 코드 커밋 | ✅ |
| **tmux** | 백그라운드 세션 | 선택 |

```bash
# Claude CLI 권한 설정 (최초 1회)
claude --dangerously-skip-permissions
# 동의 프롬프트 수락 후 Ctrl+C
```

---

## 지원 프로젝트 타입

| 타입 | 설명 |
|------|------|
| `spring-boot` | Spring Boot (Kotlin/Java) — Gradle 빌드/테스트 |
| `react-native` | React Native (TypeScript) — tsc 타입체크 |
| `nextjs` | Next.js (TypeScript) — npm build/test/lint |
| `godot` | Godot 4 (GDScript) — 게임 개발 |
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
| `npx sleepcode watch` | Notion 제어판 모드 (원격 태스크 관리) |
| `npx sleepcode usage` | 주간 사용량 확인 |

## CLI 옵션

```bash
npx sleepcode --type react-native --name my-app --role "쇼핑몰 앱 개발"
```

| 옵션 | 설명 |
|------|------|
| `--type <type>` | 프로젝트 타입 |
| `--name <name>` | 프로젝트 이름 |
| `--role <desc>` | AI 역할 설명 |
| `--figma-key <key>` | Figma API Key (선택) |
| `--figma-file <name>` | Figma 참고 파일명 (선택) |
| `--notion-key <key>` | Notion API Key (선택) |
| `--notion-page <name>` | Notion 참고 페이지명 (선택) |
| `--notion-db <id\|url>` | Notion DB ID 또는 URL (태스크 동기화용) |
| `--notion-filter <f>` | Notion 필터 (예: `"Status = To Do"`) |
| `--interval <sec>` | 반복 간격 초 (기본: 30) |
| `--budget <usd>` | 주간 예산 USD |
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
rules.md + tasks.md → 프롬프트 조합 → claude -p → 코드 작성 → git commit → 반복
```

### 병렬 모드

```
tasks.md → @worker별 분리 → git worktree 생성 → 동시 실행 → 완료 후 머지
```

### Notion 동기화

```
[Notion DB] ──pull──→ [tasks.md] ──prompt──→ [Claude] ──완료──→ [tasks.md] ──push──→ [Notion DB]
```

### 실시간 로그

```
[TEXT] 로그인 화면을 구현하겠습니다...
[TOOL] Edit: src/screens/LoginScreen.tsx
[TOOL] Bash: npx tsc --noEmit
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

---

## 커스터마이징

- **AI 역할/규칙 변경**: `.sleepcode/rules.md` 수정
- **작업 목록 변경**: `.sleepcode/tasks.md` 수정 (또는 Notion DB에서 관리)
- **참고 자료 추가**: `.sleepcode/docs/`에 파일 추가
- **주간 예산 변경**: `.sleepcode/config.json` 수정

---

## License

MIT

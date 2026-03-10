# SleepCode

Local-first multi-agent coding orchestration for git repos.

SleepCode는 `task_queue.md` 또는 Notion DB를 backlog로 사용해 여러 AI 코딩 워커를 git worktree에서 병렬 실행하고,
완료 로그, 커밋, 자동 머지, 비용 추적까지 관리하는 로컬 오케스트레이션 레이어입니다.

이 문서는 `npx sleepcode init` 완료 후 생성되는 프로젝트를 기준으로 설명합니다.

---

## 사용법

### 1. (최초 1회) Claude CLI 권한 설정

```bash
claude --dangerously-skip-permissions
```

동의 프롬프트가 뜨면 수락 후 `Ctrl + C`로 나옵니다.

### 2. 작업 목록 작성

`.sleepcode/task_queue.md`:

```markdown
# 작업 목록

- [ ] 로그인 화면 구현
- [ ] 회원가입 API 연동
- [ ] 홈 화면 UI 개선
```

`task_queue.md`는 backlog(읽기 전용)로 유지하고, 완료 기록은 `.sleepcode/task_done/<branch>.md`에 `- [x] ...` 형태로 append-only로 남기세요.
sleepcode는 `.gitattributes`에 `task_queue/task_done`용 `merge=union` 규칙을 자동 추가합니다.
태스크 완료 후 생성되는 자동 커밋 제목은 `prefix: message` 형식을 사용합니다.

### 3. 실행

```bash
# 실행
npx sleepcode run
```

### 4. 병렬 실행 (여러 기능 동시 개발)

`task_queue.md`에 `@worker`로 워커별 태스크를 나누면 여러 기능을 동시에 개발할 수 있습니다.
각 워커가 독립된 git worktree에서 작업하므로 충돌 없이 동시에 진행됩니다.

**task_queue.md 작성:**

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

`@worker main`은 별도 `sleepcode/main` 브랜치를 만들지 않고 현재 체크아웃된 브랜치에서 실행됩니다.

**실행:**

```bash
npx sleepcode run                   # 병렬 실행 (실시간 대시보드 표시, 모든 워커 종료 후 일괄 머지)
npx sleepcode run --setup           # worktree만 먼저 생성 (실행 전 확인용)
npx sleepcode run --status          # 워커 상태 확인
npx sleepcode run --merge           # 완료된 브랜치 자동 머지
npx sleepcode run --clean           # worktree 정리
npx sleepcode run --stop-worker bugfix  # 특정 워커 즉시 종료
```

### 5. Notion 제어판 모드 (원격 태스크 관리)

Notion DB를 제어판으로 사용하여 원격으로 태스크를 관리합니다.

```bash
npx sleepcode run         # 한 번 실행
```

### 5-1. Notion DB 컬럼 업데이트

기존 Notion DB 컬럼 구성이 오래된 경우 아래 명령으로 최신 스키마로 맞춥니다.

```bash
npx sleepcode notion-update --notion-key <KEY> --notion-db <ID|URL>
```

### 6. tmux 분리 (백그라운드 전환, macOS/Linux)

```bash
# tmux 세션에서 실행
tmux new -s ai 'npx sleepcode run'

# 백그라운드 전환
Ctrl + B → D

# 세션 재접속
tmux attach -t ai
```

---

## 아침 확인

```bash
# 밤 동안의 커밋 확인
git log --oneline --since="12 hours ago"

# 로그 확인
tail -100 .sleepcode/runtime/logs/worker_*.log

# 주간 사용량 확인
npx sleepcode usage
```

---

## 주간 예산 관리

API 비용을 추적하고 주간 한도를 설정합니다. 초기화 시 `npx sleepcode init --budget 50 --threshold 90`로 지정하거나, 이후 `.sleepcode/config.json`에서 직접 수정할 수 있습니다.

```bash
npx sleepcode usage
```

- 매주 월요일 기준으로 사용량 리셋
- 임계값 도달 시 진행 중인 태스크까지만 완료 후 종료

---

## 폴더 구조

```
.sleepcode/
  rules.md           # AI 역할 + 작업 규칙 (수정하세요)
  task_queue.md      # 오늘 진행할 작업 backlog (읽기 전용)
  task_done/         # 완료 로그 (append-only, 브랜치별 파일)
    main.md
  docs/              # 개발 참고 자료 (피그마 스크린샷, 기획서 등)
  config.json        # 주간 예산 설정 (budget 설정 시)
  scripts/           # 시스템 (수정하지 마세요)
    base_rules.md    #   공통 작업 규칙
    ai_worker.*      #   1회 실행 스크립트
    log_filter.py    #   로그 필터 (핵심 메시지만 추출)
  runtime/           # 실행 산출물 (자동 생성)
    logs/            #   실행 로그
    worktrees/       #   병렬 실행용 worktree
```

---

## 작동 원리

```
rules.md + task_queue.md(+ task_done/*.md) → 프롬프트 조합 → claude/codex 실행 → 코드 작성 → git commit → 반복
```

---

## 커스터마이징

- **역할/규칙 변경**: `.sleepcode/rules.md` 수정
- **태스크 backlog 변경**: `.sleepcode/task_queue.md` 수정
- **완료 기록 확인**: `.sleepcode/task_done/*.md` 확인
- **참고 자료 추가**: `.sleepcode/docs/` 에 파일 추가
- **주간 예산 변경**: `.sleepcode/config.json` 수정

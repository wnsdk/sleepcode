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

### 2. 태스크 작성

`.sleepcode/tasks.md` 에 AI가 수행할 작업을 작성합니다:

```markdown
# 작업 목록

- [ ] 로그인 화면 구현
- [ ] 회원가입 API 연동
- [ ] 홈 화면 UI 개선
```

### 3. 실행

**macOS / Linux:**
```bash
# 1회 실행
./.sleepcode/ai_worker.sh

# 무한 루프 (tmux 권장)
tmux new -s ai './.sleepcode/run_forever.sh'
```

**Windows (PowerShell):**
```powershell
# 1회 실행
powershell -File .\.sleepcode\ai_worker.ps1

# 무한 루프
powershell -File .\.sleepcode\run_forever.ps1
```

### 4. 아침에 확인

```bash
git log --oneline --since="12 hours ago"
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
| `--interval <sec>` | 반복 간격 초 (기본: 30) |
| `-f, --force` | 기존 `.sleepcode/` 폴더 덮어쓰기 |
| `-h, --help` | 도움말 |

---

## 생성되는 파일

```
.sleepcode/
  rules.md             # AI 역할 + 작업 규칙 (프롬프트)
  tasks.md             # 작업 목록 (체크리스트)
  docs/                # 참고 자료 (피그마 스크린샷, 기획서 등)
  ai_worker.sh/.ps1    # 1회 실행 스크립트 (OS별)
  run_forever.sh/.ps1  # 무한 루프 스크립트 (OS별)
  log_filter.py        # 실시간 로그 필터
  logs/                # 실행 로그 (자동 생성)
  README.md            # 사용 가이드

.claude/
  settings.local.json  # Claude 권한 설정
```

---

## 작동 원리

```
rules.md + tasks.md → 프롬프트 조합 → claude -p (비대화형) → 코드 작성 → git commit → 반복
```

1. `rules.md`(AI 역할/규칙)와 `tasks.md`(작업 목록)를 합쳐서 프롬프트로 전달
2. Claude가 태스크를 하나씩 수행 (코드 작성 → 빌드/테스트 → 오류 수정)
3. 태스크 완료 시 `[x]` 체크 + `git commit`
4. 모든 태스크 완료되면 자동 종료 (또는 대기 후 반복)

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
| 세션 생성 + 실행 | `tmux new -s ai './.sleepcode/run_forever.sh'` |
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
- **작업 목록 변경**: `.sleepcode/tasks.md` 수정
- **참고 자료 추가**: `.sleepcode/docs/`에 파일 추가 (스크린샷, 기획서 등)
- **반복 간격 변경**: `.sleepcode/run_forever.sh` (또는 `.ps1`)의 sleep 값 수정
- **Claude 권한 변경**: `.claude/settings.local.json` 수정

---

## License

MIT

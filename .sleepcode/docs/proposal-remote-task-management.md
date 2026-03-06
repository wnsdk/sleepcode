# sleepcode 원격 태스크 관리 및 실행 제안서

## 현재 상황

sleepcode를 사용하려면 반드시 **작업 대상 컴퓨터 앞에서** 다음 과정을 거쳐야 한다:

1. `.sleepcode/tasks.md` 직접 편집 (에디터 필요)
2. 터미널에서 `npx sleepcode run` 실행
3. 대시보드로 진행 상황 확인

**문제:** 외출 중이거나 다른 컴퓨터에서는 태스크 설정/시작/모니터링이 불가능하다.

---

## 제안 1: HTTP 원격 제어 서버 (추천)

### 개념

sleepcode에 내장 HTTP 서버를 추가한다. `sleepcode serve`로 서버를 띄우면, 다른 기기의 브라우저나 API 호출로 태스크 관리 + 실행 제어가 가능하다.

### 사용법

```bash
# 서버 컴퓨터에서 (1회 실행)
npx sleepcode serve --port 4000 --token mysecrettoken

# 원격 컴퓨터에서 (브라우저)
https://192.168.0.10:4000   # 웹 UI 접속

# 원격 컴퓨터에서 (API)
curl -H "Authorization: Bearer mysecrettoken" \
  http://192.168.0.10:4000/api/tasks -d '{"task":"로그인 버그 수정"}'

curl -H "Authorization: Bearer mysecrettoken" \
  http://192.168.0.10:4000/api/start
```

### 제공 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/status` | 현재 상태 (실행 중/대기/에러) |
| GET | `/api/tasks` | 태스크 목록 조회 |
| POST | `/api/tasks` | 태스크 추가 |
| PUT | `/api/tasks/:id` | 태스크 수정 |
| DELETE | `/api/tasks/:id` | 태스크 삭제 |
| POST | `/api/start` | sleepcode 실행 시작 |
| POST | `/api/stop` | 실행 중지 (graceful_stop) |
| GET | `/api/logs` | 실시간 로그 (SSE 스트림) |
| GET | `/api/cost` | 비용 현황 |
| GET | `/` | 웹 대시보드 UI |

### 웹 대시보드 (내장)

별도 프론트엔드 빌드 없이, HTML을 JS 문자열로 내장한다:

```
┌──────────────────────────────────────────────────┐
│  sleepcode remote                    ● Connected │
├──────────────────────────────────────────────────┤
│                                                  │
│  Status: ▶ Running        Cost: $0.42            │
│  Progress: ████████░░░░   6/10 tasks             │
│  Elapsed: 23m 15s                                │
│                                                  │
├──────────────────────────────────────────────────┤
│  Tasks                                           │
│  ✅ 로그인 페이지 UI 구현                          │
│  ✅ 회원가입 API 연동                              │
│  🔄 비밀번호 재설정 기능 (진행 중...)               │
│  ⬜ 마이페이지 프로필 편집                          │
│  ⬜ 다크모드 구현                                  │
│                                                  │
│  [+ 태스크 추가]                                  │
│                                                  │
├──────────────────────────────────────────────────┤
│  Logs (실시간)                                    │
│  14:23:05 ✏️ 파일 수정: src/pages/ResetPw.tsx     │
│  14:23:12 🔧 빌드 실행 중...                      │
│  14:23:18 ✅ 빌드 성공                            │
│                                                  │
├──────────────────────────────────────────────────┤
│  [▶ Start]  [⏹ Stop]  [🔄 Refresh]              │
└──────────────────────────────────────────────────┘
```

### 아키텍처

```
[원격 브라우저/curl]
       │
       ▼
┌─────────────────────────┐
│  HTTP Server (Node.js)  │  ← sleepcode serve
│  - Express-free (http)  │
│  - Token auth           │
│  - SSE for logs         │
│  - Static HTML embed    │
├─────────────────────────┤
│  Process Manager        │
│  - spawn claude         │
│  - stdin/stdout pipe    │
│  - graceful stop        │
├─────────────────────────┤
│  File Manager           │
│  - tasks.md CRUD        │
│  - inbox.md merge       │
│  - log streaming        │
└─────────────────────────┘
```

### 보안

- `--token` 필수: Bearer token 인증
- LAN 전용 기본 바인딩 (`0.0.0.0`)
- 인터넷 노출 시 `--tunnel` 옵션으로 Cloudflare Tunnel/ngrok 자동 연결 (제안 5 참고)
- Rate limiting (1초에 10 요청 제한)

### 구현 범위

```javascript
// bin/index.js에 serve 커맨드 추가
function cmdServe(opts) {
  const server = http.createServer(handleRequest);
  server.listen(opts.port, '0.0.0.0');

  // SSE 엔드포인트 (실시간 로그)
  // claude 프로세스 spawn/kill 관리
  // tasks.md 파일 CRUD
  // 내장 HTML 대시보드 응답
}
```

### 장점

- **의존성 제로**: Node.js 내장 `http` 모듈만 사용
- **원스톱**: 태스크 관리 + 실행 제어 + 모니터링을 하나의 인터페이스로
- **범용성**: 브라우저, curl, 모바일 앱, 자동화 스크립트 모두 접근 가능
- **모바일 친화**: 반응형 웹 UI로 폰에서도 사용 가능

### 단점

- 구현량이 가장 많음 (HTTP 서버 + 웹 UI + 프로세스 관리)
- 보안 설정을 유저가 신경 써야 함
- 방화벽/네트워크 설정 필요할 수 있음

---

## 제안 2: Notion을 원격 제어판으로 활용

### 개념

기존 Notion 연동을 확장하여, Notion DB가 "태스크 설정 + 실행 트리거" 역할을 한다. Notion 앱(모바일/웹)에서 태스크를 추가하고, 특정 상태 변경으로 실행을 트리거한다.

### 동작 흐름

```
[유저: Notion 앱 (모바일/웹/데스크톱)]
  │
  ├── 태스크 추가: DB에 새 행 추가
  ├── 실행 트리거: "Run" 체크박스 ✅ 또는 상태를 "Start" 로 변경
  │
  ▼
┌─────────────────────────────┐
│  sleepcode daemon           │  ← npx sleepcode watch
│  - Notion polling (30초)    │
│  - 태스크 pull → tasks.md   │
│  - "Start" 감지 → run 시작  │
│  - 결과 push → Notion DB   │
│  - 로그 요약 push           │
└─────────────────────────────┘
```

### Notion DB 스키마

| 컬럼 | 타입 | 용도 |
|------|------|------|
| Task | Title | 태스크 내용 |
| Status | Select | `To Do` / `In Progress` / `Done` / `Failed` |
| Worker | Select | `@worker feature-1` 등 |
| Priority | Number | 우선순위 |
| Run | Checkbox | ✅ 체크하면 실행 시작 |
| Log | Rich Text | 실행 결과/로그 요약 |
| Cost | Number | 소모 비용 ($) |
| Created | Date | 생성일 |

### 사용법

```bash
# 서버 컴퓨터에서 (1회, 백그라운드 데몬)
npx sleepcode watch --notion-db <DB_ID> --notion-key <KEY>
```

그 이후에는 Notion 앱만으로 모든 것을 제어:

1. Notion에서 새 행 추가 → 태스크 자동 추가
2. "Run" 체크박스 ✅ → sleepcode 자동 시작
3. 진행 상황이 Notion에 실시간 반영
4. 완료되면 Status가 "Done"으로 변경, Log에 요약 기록

### 장점

- **UI 개발 불필요**: Notion이 이미 훌륭한 UI
- **모바일 완벽 지원**: Notion 앱 설치만 하면 됨
- **팀 협업**: 여러 명이 동시에 태스크 관리
- **이력 관리**: Notion의 변경 이력, 댓글 기능 활용
- **기존 인프라 활용**: notion_sync.py 확장

### 단점

- Notion API Key + DB 설정 필수 (진입 장벽)
- Notion API rate limit (초당 3 요청)
- 네트워크 의존 (오프라인 불가)
- polling 방식이라 최대 30초 딜레이

---

## 제안 3: Telegram Bot

### 개념

Telegram Bot을 통해 채팅으로 태스크 관리 + 실행 제어. 스마트폰에서 가장 빠르게 접근 가능.

### 사용법 (유저 시점)

```
유저: /add 로그인 페이지 비밀번호 재설정 구현
봇:   ✅ 태스크 추가됨 (총 5개 대기 중)

유저: /start
봇:   ▶️ sleepcode 실행 시작!
      현재 태스크: 5개 (예상 비용: ~$0.50)

봇:   📊 진행 상황 업데이트
      ████░░░░░░ 2/5 완료
      현재: 회원가입 API 연동 중...
      비용: $0.18

유저: /status
봇:   🔄 실행 중 (3/5 완료)
      ⏱ 경과: 15분 32초
      💰 비용: $0.31

봇:   ✅ 모든 태스크 완료!
      5/5 tasks done
      총 비용: $0.52
      총 시간: 28분 15초

유저: /tasks
봇:   📋 현재 태스크:
      ✅ 로그인 페이지 UI
      ✅ 회원가입 API
      ✅ 비밀번호 재설정
      ✅ 마이페이지
      ✅ 다크모드
```

### 지원 명령어

| 명령어 | 설명 |
|--------|------|
| `/add <task>` | 태스크 추가 |
| `/tasks` | 태스크 목록 |
| `/start` | 실행 시작 |
| `/stop` | 실행 중지 |
| `/status` | 현재 상태 |
| `/logs` | 최근 로그 |
| `/cost` | 비용 현황 |

### 설정

```bash
# 1. BotFather에서 봇 생성 → 토큰 획득
# 2. sleepcode에 등록
npx sleepcode serve --telegram-token <BOT_TOKEN>
```

### 아키텍처

```
[Telegram App (모바일/데스크톱)]
       │
       ▼
[Telegram Bot API (polling)]
       │
       ▼
┌────────────────────────┐
│  sleepcode daemon      │
│  - Bot message handler │
│  - Process manager     │
│  - Status reporter     │
└────────────────────────┘
```

### 장점

- **최고의 모바일 UX**: 알림 자동 수신, 어디서나 제어
- **실시간 알림**: 태스크 완료/에러 시 즉시 push 알림
- **설정 간편**: Bot 토큰 하나만 설정
- **무료**: Telegram Bot API 무료
- **보안**: Bot-유저 1:1 채팅이라 접근 제한 자연스러움

### 단점

- Telegram 계정 필요
- `node-telegram-bot-api` 등 외부 패키지 의존
- Telegram 서버 경유 (레이턴시)
- 복잡한 태스크 편집은 채팅 UI로 어려움

---

## 제안 4: GitHub Issues → 자동 실행

### 개념

GitHub Issue를 생성하면 sleepcode가 감지하여 태스크로 변환하고 자동 실행. 개발자에게 가장 자연스러운 워크플로우.

### 동작

```
[유저: GitHub 웹/앱에서 Issue 생성]
  │
  ├── Title: "로그인 페이지 비밀번호 재설정 구현"
  ├── Label: "sleepcode" (자동 실행 트리거)
  │
  ▼
┌──────────────────────────────┐
│  sleepcode daemon            │
│  - gh api polling (1분)      │
│  - "sleepcode" 라벨 감지     │
│  - Issue → tasks.md 변환     │
│  - claude 실행               │
│  - 완료 시 Issue에 코멘트    │
│  - 자동 PR 생성 (선택)       │
└──────────────────────────────┘
```

### 사용법

```bash
# 서버 컴퓨터에서
npx sleepcode watch --github

# 원격에서 (GitHub 웹/앱/CLI)
gh issue create --title "로그인 버그 수정" --label "sleepcode"
```

### 완료 시 자동 응답

Issue에 자동 코멘트:

```markdown
## sleepcode 실행 완료 ✅

- 소요 시간: 12분 30초
- 비용: $0.23
- 커밋: abc1234 "feat: 비밀번호 재설정 기능 구현"

### 변경된 파일
- `src/pages/ResetPassword.tsx` (신규)
- `src/api/auth.ts` (수정)
- `src/routes/index.tsx` (수정)
```

### 장점

- **개발자 워크플로우**: Issue → Code → PR의 자연스러운 흐름
- **이력 관리**: 모든 작업이 GitHub에 기록
- **팀 활용**: 팀원 누구나 Issue 생성 가능
- **모바일**: GitHub 앱에서 Issue 생성/확인
- **추가 인증 불필요**: `gh auth` 이미 되어 있으면 됨

### 단점

- GitHub 의존
- polling 딜레이 (1분)
- 복잡한 태스크 설명에는 Issue 본문 파싱 필요
- 오픈소스 프로젝트에서는 아무나 실행 트리거 가능 (보안 주의)

---

## 제안 5: Tunnel 기반 인터넷 노출

### 개념

제안 1(HTTP 서버)에 **터널 서비스**를 결합하여, LAN이 아닌 인터넷 어디서든 접근 가능하게 한다.

### 사용법

```bash
# cloudflare tunnel (무료, 가장 안정적)
npx sleepcode serve --tunnel cloudflare
# → https://random-name.trycloudflare.com 자동 생성

# ngrok
npx sleepcode serve --tunnel ngrok --ngrok-token <TOKEN>
# → https://xxxx.ngrok.io 자동 생성

# tailscale (VPN 기반, 가장 안전)
npx sleepcode serve --tunnel tailscale
# → http://mypc:4000 (Tailscale 네트워크 내에서 접근)
```

### 아키텍처

```
[원격 브라우저 (세계 어디서나)]
       │
       ▼
[Cloudflare Tunnel / ngrok]
       │ (암호화된 터널)
       ▼
┌─────────────────────────┐
│  sleepcode HTTP Server  │  (localhost:4000)
└─────────────────────────┘
```

### 터널 옵션 비교

| 서비스 | 비용 | 설정 난이도 | 안정성 | 보안 |
|--------|------|-------------|--------|------|
| Cloudflare Tunnel | 무료 | 낮음 | 높음 | 높음 |
| ngrok | 무료/유료 | 낮음 | 중간 | 중간 |
| Tailscale | 무료 | 중간 | 높음 | 최고 |
| localtunnel | 무료 | 낮음 | 낮음 | 낮음 |

### 장점

- LAN 밖에서도 접근 가능 (카페, 이동 중 등)
- 방화벽/포트포워딩 설정 불필요
- HTTPS 자동 적용 (cloudflare, ngrok)

### 단점

- 외부 서비스 의존
- 터널 도구 별도 설치 필요
- 무료 tier는 URL이 매번 변경될 수 있음
- 보안 표면 증가

---

## 제안 6: SSH + 래퍼 스크립트

### 개념

가장 심플한 접근법. SSH로 원격 컴퓨터에 접속하여 sleepcode CLI를 직접 실행. 편의를 위한 래퍼 스크립트 제공.

### 사용법

```bash
# 로컬 머신에서 원격 제어 (래퍼 스크립트)
sleepcode-remote add "로그인 버그 수정"
sleepcode-remote start
sleepcode-remote status
sleepcode-remote logs
```

### 래퍼 스크립트 (`sleepcode-remote`)

```bash
#!/bin/bash
# ~/.local/bin/sleepcode-remote

REMOTE_HOST="user@myserver.local"
PROJECT_DIR="/home/user/myproject"

case "$1" in
  add)
    ssh $REMOTE_HOST "cd $PROJECT_DIR && npx sleepcode add '${@:2}'"
    ;;
  start)
    ssh $REMOTE_HOST "cd $PROJECT_DIR && nohup npx sleepcode run --loop > /dev/null 2>&1 &"
    ;;
  stop)
    ssh $REMOTE_HOST "cd $PROJECT_DIR && touch .sleepcode/graceful_stop"
    ;;
  status)
    ssh $REMOTE_HOST "cd $PROJECT_DIR && cat .sleepcode/tasks.md"
    ;;
  logs)
    ssh $REMOTE_HOST "cd $PROJECT_DIR && tail -f .sleepcode/logs/*.log"
    ;;
esac
```

### `sleepcode remote` 내장 커맨드

```bash
# 원격 호스트 등록
npx sleepcode remote set myserver user@192.168.0.10:/home/user/project

# 원격 제어
npx sleepcode remote myserver add "태스크 내용"
npx sleepcode remote myserver start
npx sleepcode remote myserver status
```

### 장점

- **추가 구현 최소**: SSH 기반이라 서버 코드 불필요
- **보안 최고**: SSH 키 인증, 암호화 기본 제공
- **안정성**: SSH는 검증된 프로토콜
- **방화벽 통과**: SSH (22번 포트) 는 대부분 열려 있음

### 단점

- SSH 설정 필요 (키 생성, authorized_keys 등)
- 모바일에서 불편 (SSH 앱 필요)
- 웹 UI 없음
- 실시간 대시보드 보려면 SSH 터미널 직접 접속 필요

---

## 종합 비교

| 제안 | 구현 난이도 | 모바일 UX | 실시간성 | 보안 | 의존성 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 1. HTTP 서버 + 웹 UI | **높음** | 좋음 | 실시간(SSE) | 토큰 | 없음 |
| 2. Notion 제어판 | 중간 | **최고** | 30초 | Notion | Notion API |
| 3. Telegram Bot | 중간 | **최고** | 실시간 | Bot 1:1 | telegram-bot-api |
| 4. GitHub Issues | 중간 | 좋음 | 1분 | GitHub | gh CLI |
| 5. Tunnel | 낮음 (1과 결합) | 좋음 | 실시간 | HTTPS | tunnel 도구 |
| 6. SSH 래퍼 | **낮음** | 나쁨 | 즉시 | **최고** | SSH |

---

## 추천 구현 순서

### Phase 1: 즉시 실용 (제안 6 - SSH 래퍼)

구현량이 가장 적으면서 즉시 사용 가능. `sleepcode remote` 커맨드 추가.

```bash
npx sleepcode remote set mypc user@192.168.0.10:~/project
npx sleepcode remote mypc start
```

**예상 구현량:** ~100줄 (CLI 인자 파싱 + SSH exec)

### Phase 2: 웹 원격 제어 (제안 1 - HTTP 서버)

`sleepcode serve`로 웹 대시보드 + REST API 제공. 이것이 핵심 원격 제어 인프라가 된다.

**예상 구현량:** ~500줄 (HTTP 서버 + 내장 HTML + API 핸들러)

### Phase 3: 인터넷 접근 (제안 5 - Tunnel)

Phase 2에 `--tunnel` 옵션 추가. LAN 밖에서도 접근 가능.

**예상 구현량:** ~50줄 (child_process로 tunnel 도구 실행)

### Phase 4: 모바일 최적화 (제안 3 - Telegram Bot)

가장 모바일 친화적인 인터페이스 추가. Phase 2의 API를 내부적으로 호출.

**예상 구현량:** ~200줄 (Bot 메시지 핸들링)

---

## 핵심 질문: "시작시키기"의 구현

모든 제안의 공통 과제는 **원격에서 claude 프로세스를 시작하는 것**이다.

### 방법 A: Daemon 모드 (추천)

```bash
npx sleepcode serve   # 항상 대기 상태, API 요청 시 실행
```

sleepcode가 데몬으로 상시 실행되면서, "시작" 요청이 오면 claude 프로세스를 spawn한다.

### 방법 B: Watch 모드

```bash
npx sleepcode watch   # 파일/Notion 변경 감지 시 자동 실행
```

tasks.md나 Notion DB에 변경이 감지되면 자동으로 실행을 시작한다.

### 방법 C: Cron + 트리거 파일

```bash
# crontab에 등록 (1분마다 체크)
* * * * * cd /project && [ -f .sleepcode/trigger ] && npx sleepcode run && rm .sleepcode/trigger
```

원격에서 `trigger` 파일만 생성하면 cron이 실행을 시작한다. 가장 단순하지만 유연성 부족.

---

## 결론

**가장 실용적인 조합:** `Phase 1 (SSH)` → `Phase 2 (HTTP 서버)` → `Phase 3 (Tunnel)`

이 조합이면:
- 즉시 사용 가능 (SSH)
- LAN 내 모바일 제어 (웹 UI)
- 외부 접근 (Tunnel)

을 단계적으로 확보할 수 있다.

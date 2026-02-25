# SleepCode

AI codes while you sleep — 밤새 개발 작업을 자동화하는 시스템입니다.

---

## 폴더 구조

```
.sleepcode/
  rules.md           # ✏️ AI 역할 + 작업 규칙 (수정하세요)
  tasks.md           # ✏️ 오늘 진행할 작업 목록 (수정하세요)
  docs/              # ✏️ 개발 참고 자료 (피그마 스크린샷, 기획서 등)
  scripts/           # ⚙️ 시스템 (수정하지 마세요)
    base_rules.md    #    공통 작업 규칙
    ai_worker.*      #    1회 실행 스크립트
    run_forever.*    #    무한 루프 감시자 스크립트
    log_filter.py    #    로그 필터 (핵심 메시지만 추출)
  logs/              # 실행 로그 (자동 생성)
```

---

## 작동 원리

1. `claude -p` 로 비대화형 모드 실행
2. `rules.md` + `tasks.md` 를 합쳐서 프롬프트로 전달
3. AI가 코드 작성 → 빌드/테스트 → 오류 수정 → git commit
4. 대기 후 다시 반복

---

## 실행 방법

### 1. (최초 1회) --dangerously-skip-permissions 수락

```bash
claude --dangerously-skip-permissions
```

동의 프롬프트가 뜨면 수락 후 `Ctrl + C`로 나옵니다.

### 2. 실행

```bash
# 1회 실행
npx sleepcode run

# 무한 루프 (잠자기 전)
npx sleepcode run --loop
```

OS에 맞는 스크립트를 자동으로 선택합니다.

### 3. tmux 분리 (백그라운드 전환, macOS/Linux)

```
Ctrl + B → D
```

---

## 관리 명령어

| 동작 | 명령어 |
|------|--------|
| 세션 재접속 | `tmux attach -t ai` |
| 실시간 로그 | `tail -f .sleepcode/logs/worker_*.log` |
| 종료 | `tmux attach -t ai` → `Ctrl + C` |
| 세션 삭제 | `tmux kill-session -t ai` |

---

## 아침 확인

```bash
# 밤 동안의 커밋 확인
git log --oneline --since="12 hours ago"

# 로그 확인
tail -100 .sleepcode/logs/worker_*.log
```

---

## 커스터마이징

- **역할/규칙 변경**: `.sleepcode/rules.md` 수정
- **태스크 변경**: `.sleepcode/tasks.md` 수정
- **참고 자료 추가**: `.sleepcode/docs/` 에 파일 추가

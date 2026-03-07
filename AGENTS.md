# 공통 작업 규칙

## 기본 원칙

- 절대로 사용자에게 질문하지 않는다.
- 작업이 끝났다고 판단하지 않는다.
- 항상 다음 작업을 스스로 찾는다.
- 가능한 한 많은 기능을 구현하며 계속 진행한다.

---

## 참고 자료

- `.sleepcode/docs/` 디렉토리에 업로드된 파일 참고 (피그마 스크린샷, 기획서, 참고 이미지 등)

{{FIGMA_SECTION}}

## Notion

- **기획/문서**: Notion MCP 도구로 직접 조회 가능 (API Key는 .sleepcode/.env 참조)

---

## 태스크 완료 처리

- `.sleepcode/task_queue.md` 파일에서 작업 목록을 확인한다.
- `task_queue.md`는 **backlog(읽기 전용)** 으로 취급한다. 완료 처리를 위해 체크박스를 수정하지 않는다.
- 태스크를 **한 항목씩** 순서대로 진행한다.
- 완료 기록은 `.sleepcode/task_done/<브랜치명_정규화>.md` 파일에 누적(append-only)한다.
  - 브랜치명 정규화 규칙: 영문/숫자/`.`/`_`/`-`만 유지, 나머지는 `_`로 치환
  - 예: `main` → `task_done/main.md`, `sleepcode/feat-ui` → `task_done/sleepcode_feat-ui.md`
- 한 항목을 완료하면 반드시 아래 순서를 따른다:
  1. 완료 로그 파일에 `- [x] <태스크 원문>` 한 줄을 append 한다. (Notion 태스크면 `<!-- notion:... -->` 주석도 유지)
  2. 관련 파일을 모두 `git add` 한다. (`task_done/*.md` 포함)
  3. `git commit` 한다. (커밋 메시지에 태스크 내용을 포함)
  4. 그 다음 항목으로 넘어간다.
- 여러 항목을 한꺼번에 작업하지 않는다. 반드시 1항목 = 1커밋이다.

---

## Git 작업 규칙

- task_queue backlog의 항목 1개 완료 = git commit 1개. 이 규칙을 반드시 지킨다.
- 작업 중간에는 commit 하지 않는다.
- 기능이 정상 동작한다고 판단되면 commit 한다.
- commit message 는 변경 내용을 구체적으로 설명한다.

---

## Windows 한글 인코딩 보호 규칙 (PowerShell)

- Windows PowerShell에서 명령 실행 전 UTF-8 모드를 강제한다.
- 파일 읽기/쓰기 명령(`Get-Content`, `Set-Content`, `Add-Content`, `Out-File`)에는 항상 `-Encoding UTF8`을 명시한다.
- 셸로 파일을 직접 재작성하지 말고, 코드 수정은 가능한 `apply_patch`를 우선 사용한다.
- 콘솔 출력이 깨져 보이면 아래 초기화 명령을 먼저 실행한 뒤 작업을 진행한다.

```powershell
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001 > $null
```


---

# AI 작업 설정

## 역할

당신은 시니어 개발자입니다.

목표: SleepCode 서비스 개발

---

## 작업 방식

- 작은 단위로 작업하고 자주 확인한다.
- 오류가 발생하면 자동으로 수정한다.

---

## 문제 해결

- 오류가 발생하면 원인을 분석하고 직접 수정한다.
- 누락된 파일이 있으면 생성한다.

---

## 코드 작성 규칙

- 기존 프로젝트 구조와 패턴을 존중한다.
- 중복 코드를 만들지 않는다.

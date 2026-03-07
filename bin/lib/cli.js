const path = require('path');
const { C, SLEEPCODE_BADGE } = require('./constants');

// ─── 도움말 / 버전 ───
function showHelp() {
  const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
  console.log(`
${SLEEPCODE_BADGE}  v${pkg.version}

사용법: sleepcode [옵션]
       sleepcode watch [--notion-db <id|url>] [--notion-key <key>]
       sleepcode generate
       sleepcode sources
       sleepcode parallel [--setup|--clean|--merge|--status]
       sleepcode usage

옵션 없이 실행하면 인터랙티브 모드로 동작합니다.

명령어:
  help             도움말 보기
  version          버전 정보 보기
  watch            Notion DB 감시 (제어판 모드, 자동 실행)
  run              watch의 별칭 (sleepcode watch와 동일)
  generate         참고자료 기반으로 태스크 자동 생성
  sources          참고자료 URL 관리 (sources.json)
  parallel         @worker 섹션 기반 병렬 실행
  usage            주간 사용량 확인
  parallel --setup worktree 생성만 (실행하지 않음)
  parallel --status 워커 상태 확인
  parallel --merge 완료된 브랜치 자동 머지
  parallel --clean worktree 정리

옵션:
  --type <type>        프로젝트 타입 (spring-boot, react-native, nextjs, custom)
  --name <name>        프로젝트 이름
  --role <desc>        AI 역할 설명
  --figma-key <key>    Figma API Key
  --figma-file <name>  Figma 참고 파일명
  --notion-key <key>   Notion API Key
  --notion-page <name> Notion 참고 페이지명
  --notion-db <id|url|create> Notion DB (ID/URL 또는 'create'로 새로 생성)
  --notion-parent <id|url>   새 DB 생성 시 상위 Notion 페이지
  --notion-db-name <name>    새 DB 이름 (기본: <프로젝트명> - sleepcode tasks)
  --notion-filter <f>  Notion 필터 (예: "Status = To Do")
  --interval <sec>     반복 간격 (초, 기본 30)
  --budget <usd>       주간 예산 ($, 예: 50)
  --threshold <pct>    사용량 임계값 (%, 기본 90)
  --provider <name>    AI provider (claude, codex, auto)
  -c, --continue       이전 세션 이어서 실행 (토큰 절약)
  -f, --force          기존 .sleepcode/ 덮어쓰기
  -v, --version        버전 정보
  -h, --help           도움말
`);
}

function showVersion() {
  const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
  console.log(`sleepcode v${pkg.version}`);
}

// ─── CLI 인자 파싱 ───
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) parsed.type = args[++i];
    else if (args[i] === '--name' && args[i + 1]) parsed.name = args[++i];
    else if (args[i] === '--role' && args[i + 1]) parsed.role = args[++i];
    else if (args[i] === '--figma-key' && args[i + 1]) parsed.figmaKey = args[++i];
    else if (args[i] === '--figma-file' && args[i + 1]) parsed.figmaFileNames = args[++i];
    else if (args[i] === '--notion-key' && args[i + 1]) parsed.notionKey = args[++i];
    else if (args[i] === '--notion-page' && args[i + 1]) parsed.notionPages = args[++i];
    else if (args[i] === '--notion-db' && args[i + 1]) parsed.notionDb = args[++i];
    else if (args[i] === '--notion-parent' && args[i + 1]) parsed.notionParent = args[++i];
    else if (args[i] === '--notion-db-name' && args[i + 1]) parsed.notionDbName = args[++i];
    else if (args[i] === '--notion-filter' && args[i + 1]) parsed.notionFilter = args[++i];
    else if (args[i] === '--interval' && args[i + 1]) parsed.interval = args[++i];
    else if (args[i] === '--budget' && args[i + 1]) parsed.budget = args[++i];
    else if (args[i] === '--threshold' && args[i + 1]) parsed.threshold = args[++i];
    else if (args[i] === '--provider' && args[i + 1]) parsed.provider = args[++i];
    else if (args[i] === '--continue' || args[i] === '-c') parsed.continue = true;
    else if (args[i] === '--force' || args[i] === '-f') parsed.force = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      showHelp();
      process.exit(0);
    }
    else if (args[i] === '--version' || args[i] === '-v') {
      showVersion();
      process.exit(0);
    }
  }
  return parsed;
}

module.exports = {
  showHelp,
  showVersion,
  parseArgs,
};

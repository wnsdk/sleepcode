#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ─── 색상 ───
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  bgMagenta: '\x1b[45m',
  brightWhite: '\x1b[97m',
};

// sleepcode 뱃지 (pill 형태: 반블록 + 마젠타 배경 + 흰색 볼드)
const SLEEPCODE_BADGE = `${C.magenta}▐${C.bgMagenta}${C.brightWhite}${C.bold} sleepcode ${C.reset}${C.magenta}▌${C.reset}`;

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const IS_WIN = process.platform === 'win32';

// Windows에서 Python 서브프로세스 한글 깨짐 방지
if (IS_WIN) {
  process.env.PYTHONUTF8 = '1';
  process.env.PYTHONIOENCODING = 'utf-8';
}

// ─── 사전 준비 체크 ───
function checkCommand(cmd) {
  try {
    const out = execSync(cmd, { stdio: 'pipe', timeout: 10000 }).toString().trim();
    // 버전 문자열에서 숫자 부분만 추출
    const ver = out.match(/(\d+\.\d+[\.\d]*)/);
    return ver ? ver[1] : 'OK';
  } catch {
    return null;
  }
}

function detectPython() {
  const v3 = checkCommand('python3 --version');
  if (v3) return { cmd: 'python3', version: v3 };
  const v = checkCommand('python --version');
  if (v && v.startsWith('3')) return { cmd: 'python', version: v };
  return null;
}

function getInstallHint(tool) {
  const isMac = process.platform === 'darwin';
  const hints = {
    python: isMac
      ? 'brew install python3'
      : IS_WIN
        ? 'https://www.python.org/downloads/ 에서 설치 (Add to PATH 체크)'
        : 'sudo apt install python3',
    git: isMac
      ? 'brew install git'
      : IS_WIN
        ? 'https://git-scm.com/downloads 에서 설치'
        : 'sudo apt install git',
    tmux: isMac
      ? 'brew install tmux'
      : 'sudo apt install tmux',
  };
  return hints[tool] || '';
}

async function checkPrerequisites(rl) {
  console.log(`${C.bold}사전 준비 확인 중...${C.reset}\n`);

  const results = {};
  let hasMissing = false;

  // git
  const gitVer = checkCommand('git --version');
  if (gitVer) {
    console.log(`  ${C.green}✓${C.reset} git (${gitVer})`);
    results.git = true;
  } else {
    console.log(`  ${C.red}✗${C.reset} git — 설치 필요`);
    results.git = false;
    hasMissing = true;
  }

  // python
  const py = detectPython();
  if (py) {
    console.log(`  ${C.green}✓${C.reset} ${py.cmd} (${py.version})`);
    results.python = py;
  } else {
    console.log(`  ${C.red}✗${C.reset} python3 — 설치 필요`);
    results.python = null;
    hasMissing = true;
  }

  // claude
  const claudeVer = checkCommand('claude --version');
  if (claudeVer) {
    console.log(`  ${C.green}✓${C.reset} claude (${claudeVer})`);
    results.claude = true;
  } else {
    console.log(`  ${C.red}✗${C.reset} claude — 설치 필요`);
    results.claude = false;
    hasMissing = true;
  }

  // tmux (선택, Windows 제외)
  if (!IS_WIN) {
    const tmuxVer = checkCommand('tmux -V');
    if (tmuxVer) {
      console.log(`  ${C.green}✓${C.reset} tmux (${tmuxVer})`);
    } else {
      console.log(`  ${C.dim}-${C.reset} tmux — 미설치 (선택사항)`);
    }
  }

  console.log('');

  if (!hasMissing) return results;

  // ─── 자동 설치 제안 ───

  // Claude CLI 자동 설치
  if (!results.claude && rl) {
    const answer = await ask(rl, 'claude CLI를 설치할까요? (npm install -g @anthropic-ai/claude-code) [Y/n]', 'Y');
    if (answer.toLowerCase() !== 'n') {
      console.log(`\n  ${C.dim}설치 중...${C.reset}`);
      try {
        execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit', timeout: 120000 });
        console.log(`  ${C.green}✓${C.reset} claude CLI 설치 완료\n`);
        results.claude = true;

        // 설치 후 권한 동의 안내
        console.log(`  ${C.yellow}!${C.reset} 최초 1회 권한 동의가 필요합니다:`);
        console.log(`    ${C.dim}claude --dangerously-skip-permissions${C.reset}`);
        console.log(`    ${C.dim}(동의 프롬프트 수락 후 Ctrl+C)${C.reset}\n`);
      } catch {
        console.log(`  ${C.red}✗${C.reset} claude CLI 설치 실패\n`);
      }
    }
  }

  // 나머지 누락 도구 안내
  const missing = [];
  if (!results.git) missing.push({ name: 'git', hint: getInstallHint('git') });
  if (!results.python) missing.push({ name: 'python3', hint: getInstallHint('python') });
  if (!results.claude) missing.push({ name: 'claude', hint: 'npm install -g @anthropic-ai/claude-code' });

  if (missing.length > 0) {
    console.log(`${C.red}${C.bold}아래 도구를 설치한 뒤 다시 실행해주세요:${C.reset}\n`);
    for (const m of missing) {
      console.log(`  ${C.bold}${m.name}${C.reset}: ${C.cyan}${m.hint}${C.reset}`);
    }
    console.log('');
    process.exit(1);
  }

  return results;
}

// ─── 프로젝트 타입 정의 ───
const PROJECT_TYPES = {
  'spring-boot': {
    label: 'Spring Boot (Kotlin/Java)',
    buildCmd: './gradlew build -x test --no-daemon',
    testCmd: './gradlew test --no-daemon',
    lintCmd: '',
  },
  'react-native': {
    label: 'React Native (TypeScript)',
    buildCmd: '',
    testCmd: '',
    lintCmd: 'npx tsc --noEmit',
  },
  nextjs: {
    label: 'Next.js (TypeScript)',
    buildCmd: 'npm run build',
    testCmd: 'npm test',
    lintCmd: 'npx next lint',
  },
  godot: {
    label: 'Godot 4 (GDScript)',
    buildCmd: 'godot --headless --check-only --script res://project.godot 2>&1 || true',
    testCmd: '',
    lintCmd: '',
  },
  custom: {
    label: 'Custom (직접 설정)',
    buildCmd: '',
    testCmd: '',
    lintCmd: '',
  },
};

// ─── 도움말 / 버전 ───
function showHelp() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  console.log(`
${SLEEPCODE_BADGE}  v${pkg.version}

사용법: sleepcode [옵션]
       sleepcode run [--loop] [--continue]
       sleepcode watch [--notion-db <id|url>] [--notion-key <key>]
       sleepcode generate
       sleepcode sources
       sleepcode parallel [--setup|--clean|--merge|--status]
       sleepcode usage

옵션 없이 실행하면 인터랙티브 모드로 동작합니다.

명령어:
  help             도움말 보기
  version          버전 정보 보기
  run              1회 실행 (대시보드 + 실시간 로그)
  run --continue   이전 세션 이어서 실행 (컨텍스트 유지)
  run --loop       무한 루프 실행 (run_forever 스크립트)
  run --loop --continue  루프 실행 시 세션 연속 (2회차부터 --continue)
  watch            Notion DB 감시 (제어판 모드, 자동 실행)
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
  -c, --continue       이전 Claude 세션 이어서 실행 (토큰 절약)
  -f, --force          기존 .sleepcode/ 덮어쓰기
  -v, --version        버전 정보
  -h, --help           도움말
`);
}

function showVersion() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
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

// ─── 유틸 ───
function ask(rl, question, defaultVal) {
  const suffix = defaultVal ? ` ${C.dim}(${defaultVal})${C.reset}` : '';
  return new Promise((resolve) => {
    rl.question(`${C.cyan}?${C.reset} ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function select(rl, question, options) {
  return new Promise((resolve) => {
    console.log(`\n${C.cyan}?${C.reset} ${question}`);
    options.forEach((opt, i) => {
      console.log(`  ${C.bold}${i + 1})${C.reset} ${opt.label}`);
    });
    rl.question(`${C.cyan}>${C.reset} 번호 선택: `, (answer) => {
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]);
      } else {
        resolve(options[0]);
      }
    });
  });
}

function parseNotionDbId(input) {
  if (!input) return '';
  // URL: https://www.notion.so/workspace/abc123...?v=xyz → 32자리 hex 추출
  const urlMatch = input.match(/([a-f0-9]{32})/);
  if (urlMatch) return urlMatch[1];
  // 대시 포함 UUID: abc-def-... → 대시 제거
  const dashless = input.replace(/-/g, '');
  if (/^[a-f0-9]{32}$/.test(dashless)) return dashless;
  return input;
}

/**
 * 입력된 Notion ID가 실제 DB인지 검증.
 * 페이지 URL이면 해당 페이지 안의 DB를 자동 탐색.
 * @returns {Promise<string>} 유효한 DB ID
 */
async function validateNotionDbId(apiKey, rawId) {
  if (!rawId) return '';

  // 32자리 hex → 대시 포함 UUID 형식으로 변환 (Notion API 호환성)
  let formattedId = rawId;
  if (/^[a-f0-9]{32}$/.test(rawId)) {
    formattedId = `${rawId.slice(0,8)}-${rawId.slice(8,12)}-${rawId.slice(12,16)}-${rawId.slice(16,20)}-${rawId.slice(20)}`;
  }

  let dbError = null;

  // 1. DB로 직접 조회 시도
  try {
    await notionApiRequest('GET', `/databases/${formattedId}`, apiKey);
    return rawId; // DB ID가 맞음
  } catch (e) {
    dbError = e;
  }

  // 2. 페이지로 조회 시도
  try {
    const page = await notionApiRequest('GET', `/pages/${formattedId}`, apiKey);
    if (page && page.object === 'page') {
      // 페이지 내 자식 DB 검색
      try {
        const blocks = await notionApiRequest('GET', `/blocks/${formattedId}/children?page_size=100`, apiKey);
        if (blocks && blocks.results) {
          const childDb = blocks.results.find(b => b.type === 'child_database');
          if (childDb) {
            return childDb.id.replace(/-/g, '');
          }
        }
      } catch {}

      // 자식 DB가 없으면 에러
      throw new Error(
        `입력한 URL은 Notion 페이지입니다 (DB가 아닙니다).\n` +
        `  해당 페이지 안에 데이터베이스가 없습니다.\n` +
        `  Notion 데이터베이스의 URL 또는 ID를 입력해주세요.\n` +
        `  ${C.dim}(DB URL 예: https://www.notion.so/workspace/abc123...?v=...)${C.reset}`
      );
    }
  } catch (e) {
    if (e.message.includes('Notion 페이지입니다')) throw e;
  }

  // 실제 API 오류 메시지를 포함하여 원인 파악이 가능하도록 함
  const apiMsg = dbError ? dbError.message : '';
  if (apiMsg.includes('401') || apiMsg.includes('Unauthorized') || apiMsg.includes('unauthorized')) {
    throw new Error(
      `Notion API Key가 유효하지 않습니다.\n` +
      `  API Key를 다시 확인해주세요.\n` +
      `  ${C.dim}(발급: https://www.notion.so/my-integrations)${C.reset}`
    );
  }

  throw new Error(
    `Notion 데이터베이스에 접근할 수 없습니다.\n` +
    `  다음 사항을 확인해주세요:\n` +
    `  1. Notion 데이터베이스 페이지에서 ··· → 연결 → 통합(Integration)을 추가했는지 확인\n` +
    `  2. 데이터베이스 URL 또는 ID가 올바른지 확인\n` +
    `  ${C.dim}(입력한 ID: ${rawId})${C.reset}`
  );
}

// ─── Notion DB 생성 ───

function notionApiRequest(method, endpoint, apiKey, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(`Notion API 오류 (${res.statusCode}): ${json.message || body}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Notion API 응답 파싱 오류: ${body}`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`네트워크 오류: ${e.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

async function createNotionDb(apiKey, parentPageId, dbTitle) {
  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: dbTitle } }],
    properties: {
      'Task': { title: {} },
      'Status': {
        select: {
          options: [
            { name: 'Not started', color: 'default' },
            { name: 'In Progress', color: 'blue' },
            { name: 'Done', color: 'green' },
            { name: 'Failed', color: 'red' },
          ],
        },
      },
      'Run': { checkbox: {} },
      'Worker': { select: { options: [] } },
      'Priority': { number: { format: 'number' } },
      'Log': { rich_text: {} },
      'Cost': { number: { format: 'number' } },
      'Completed At': { date: {} },
    },
  };

  const result = await notionApiRequest('POST', '/databases', apiKey, body);
  return result.id.replace(/-/g, '');
}

async function searchNotionPages(apiKey, query) {
  const body = {
    query: query || '',
    filter: { value: 'page', property: 'object' },
    page_size: 10,
  };
  const result = await notionApiRequest('POST', '/search', apiKey, body);
  return (result.results || []).map((p) => ({
    id: p.id,
    title: (p.properties?.title?.title || p.properties?.Name?.title || [])
      .map((t) => t.plain_text).join('') || '(제목 없음)',
  }));
}

// ─── sources.json 관리 ───
function loadSources(targetDir) {
  const sourcesPath = path.join(targetDir, '.sleepcode', 'sources.json');
  if (!fs.existsSync(sourcesPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
  } catch {
    return null;
  }
}

function createDefaultSources(targetDir) {
  const sourcesPath = path.join(targetDir, '.sleepcode', 'sources.json');
  const defaultSources = {
    "$schema": "참고자료 URL 관리 파일 — generate 명령에서 자동으로 읽어 tasks.md 생성에 활용됩니다.",
    notion: [],
    figma: [],
    urls: [],
  };
  fs.mkdirSync(path.dirname(sourcesPath), { recursive: true });
  fs.writeFileSync(sourcesPath, JSON.stringify(defaultSources, null, 2) + '\n');
  return defaultSources;
}

function fetchSourceContents(targetDir) {
  const sources = loadSources(targetDir);
  if (!sources) return '';

  const parts = [];

  // Notion 페이지 내용 가져오기 (claude CLI로 MCP 호출)
  if (sources.notion && sources.notion.length > 0) {
    parts.push('--- 참고 Notion 페이지 ---');
    for (const entry of sources.notion) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const label = (typeof entry === 'object' && entry.label) ? entry.label : url;
      if (!url) continue;
      parts.push(`\n[Notion: ${label}]\nURL: ${url}\n(AI가 Notion MCP 도구로 이 페이지를 직접 조회하여 참고하세요)`);
    }
  }

  // Figma 파일 참고
  if (sources.figma && sources.figma.length > 0) {
    parts.push('\n--- 참고 Figma 디자인 ---');
    for (const entry of sources.figma) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const label = (typeof entry === 'object' && entry.label) ? entry.label : url;
      if (!url) continue;
      parts.push(`\n[Figma: ${label}]\nURL: ${url}\n(AI가 Figma MCP 도구로 이 디자인을 직접 조회하여 참고하세요)`);
    }
  }

  // 일반 URL 참고
  if (sources.urls && sources.urls.length > 0) {
    parts.push('\n--- 참고 URL ---');
    for (const entry of sources.urls) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const label = (typeof entry === 'object' && entry.label) ? entry.label : url;
      if (!url) continue;
      parts.push(`\n[참고: ${label}]\nURL: ${url}`);
    }
  }

  return parts.join('\n');
}

function showSources() {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  const sourcesPath = path.join(scDir, 'sources.json');
  let sources = loadSources(targetDir);

  if (!sources) {
    sources = createDefaultSources(targetDir);
    console.log(`${C.green}✓${C.reset} .sleepcode/sources.json 생성됨\n`);
  }

  const notionCount = (sources.notion || []).length;
  const figmaCount = (sources.figma || []).length;
  const urlCount = (sources.urls || []).length;
  const total = notionCount + figmaCount + urlCount;

  console.log(`\n${C.bold}참고자료 현황${C.reset} — ${sourcesPath}\n`);

  if (total === 0) {
    console.log(`  ${C.dim}(등록된 참고자료가 없습니다)${C.reset}\n`);
  } else {
    if (notionCount > 0) {
      console.log(`  ${C.cyan}Notion${C.reset} (${notionCount}개):`);
      for (const entry of sources.notion) {
        const url = typeof entry === 'string' ? entry : entry.url;
        const label = (typeof entry === 'object' && entry.label) ? entry.label : '';
        console.log(`    ${label ? `${label}: ` : ''}${C.dim}${url}${C.reset}`);
      }
    }
    if (figmaCount > 0) {
      console.log(`  ${C.magenta}Figma${C.reset} (${figmaCount}개):`);
      for (const entry of sources.figma) {
        const url = typeof entry === 'string' ? entry : entry.url;
        const label = (typeof entry === 'object' && entry.label) ? entry.label : '';
        console.log(`    ${label ? `${label}: ` : ''}${C.dim}${url}${C.reset}`);
      }
    }
    if (urlCount > 0) {
      console.log(`  ${C.green}URL${C.reset} (${urlCount}개):`);
      for (const entry of sources.urls) {
        const url = typeof entry === 'string' ? entry : entry.url;
        const label = (typeof entry === 'object' && entry.label) ? entry.label : '';
        console.log(`    ${label ? `${label}: ` : ''}${C.dim}${url}${C.reset}`);
      }
    }
  }

  console.log(`
${C.bold}사용법:${C.reset}

  ${C.dim}sources.json을 직접 편집하여 참고자료를 추가하세요:${C.reset}

  ${C.cyan}${sourcesPath}${C.reset}

  ${C.dim}예시:${C.reset}
  {
    "notion": [
      { "url": "https://www.notion.so/...", "label": "기획서" },
      { "url": "https://www.notion.so/...", "label": "API 명세" }
    ],
    "figma": [
      { "url": "https://www.figma.com/file/...", "label": "홈 화면" }
    ],
    "urls": [
      { "url": "https://api-docs.example.com", "label": "외부 API 문서" }
    ]
  }

  ${C.dim}등록 후:${C.reset}
  ${C.cyan}npx sleepcode generate${C.reset}   ${C.dim}# sources.json + docs/ 기반으로 tasks.md 자동 생성${C.reset}
`);
}

function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
}

/**
 * CLAUDE.md 동기화: base_rules.md + rules.md → 프로젝트 루트 CLAUDE.md
 * Claude CLI가 CLAUDE.md를 시스템 프롬프트로 자동 로드하며, 프롬프트 캐싱 적용됨.
 * -p 프롬프트에는 tasks.md만 전달하여 토큰 절약.
 */
function syncClaudeMd(targetDir) {
  const scDir = path.join(targetDir, '.sleepcode');
  const baseRulesPath = path.join(scDir, 'scripts', 'base_rules.md');
  const rulesPath = path.join(scDir, 'rules.md');
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');

  const parts = [];
  if (fs.existsSync(baseRulesPath)) parts.push(fs.readFileSync(baseRulesPath, 'utf-8'));
  if (fs.existsSync(rulesPath)) parts.push(fs.readFileSync(rulesPath, 'utf-8'));

  if (parts.length > 0) {
    let content = parts.join('\n\n---\n\n');
    // API 키가 CLAUDE.md에 노출되지 않도록 마스킹
    content = content.replace(/API Key: `[^`]+`/g, 'API Key는 .sleepcode/.env 참조');
    content = content.replace(/\(API Key: [^)]+\)/g, '(API Key는 .sleepcode/.env 참조)');
    fs.writeFileSync(claudeMdPath, content);
  }
}

function generateFiles(targetDir, { typeKey, projectName, role, buildCmd, testCmd, lintCmd, figmaKey, figmaFileNames, notionKey, notionPages, notionDbId, notionFilter, sleepInterval }) {
  const scDir = path.join(targetDir, '.sleepcode');
  const claudeDir = path.join(targetDir, '.claude');
  fs.mkdirSync(path.join(scDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(scDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(scDir, 'logs'), { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });

  // 스크립트 파일 → scripts/ 하위로 복사 (OS별 분기)
  const scriptFiles = IS_WIN
    ? ['ai_worker.ps1', 'run_forever.ps1']
    : ['ai_worker.sh', 'run_forever.sh'];
  const allScriptFiles = [...scriptFiles, 'log_filter.py'];
  if (notionDbId) allScriptFiles.push('notion_sync.py');

  for (const file of allScriptFiles) {
    const src = path.join(TEMPLATES_DIR, 'common', file);
    const dest = path.join(scDir, 'scripts', file);
    if (fs.existsSync(src)) {
      let content = fs.readFileSync(src, 'utf-8');
      content = content.replace(/\{\{SLEEP_INTERVAL\}\}/g, sleepInterval);
      // Shell/Python 스크립트는 반드시 LF 줄바꿈 (Windows에서도)
      if (file.endsWith('.sh') || file.endsWith('.py')) {
        content = content.replace(/\r\n/g, '\n');
      }
      // PowerShell은 UTF-8 BOM 필요 (한글 깨짐 방지)
      if (file.endsWith('.ps1')) content = '\uFEFF' + content;
      fs.writeFileSync(dest, content);
    }
  }

  // base_rules.md → scripts/ 하위로 복사 (Figma/Notion 섹션 조건부 처리)
  const baseRulesSrc = path.join(TEMPLATES_DIR, 'common', 'base_rules.md');
  if (fs.existsSync(baseRulesSrc)) {
    let baseRules = fs.readFileSync(baseRulesSrc, 'utf-8');

    // Figma 섹션
    if (figmaKey) {
      let figmaSection = `## Figma\n\n- **프론트엔드 디자인**: Figma MCP 도구로 직접 조회 가능 (API Key: \`${figmaKey}\`)`;
      if (figmaFileNames) {
        figmaSection += `\n- **참고 파일**: ${figmaFileNames}`;
      }
      baseRules = baseRules.replace('{{FIGMA_SECTION}}', figmaSection);
    } else {
      baseRules = baseRules.replace('\n{{FIGMA_SECTION}}\n', '');
    }

    // Notion 섹션 (API 키는 .env에서 관리, CLAUDE.md에 노출하지 않음)
    if (notionKey) {
      let notionSection = `\n## Notion\n\n- **기획/문서**: Notion MCP 도구로 직접 조회 가능 (API Key는 .sleepcode/.env 참조)`;
      if (notionPages) {
        notionSection += `\n- **참고 페이지**: ${notionPages}`;
      }
      baseRules = baseRules.replace('{{NOTION_SECTION}}', notionSection);
    } else {
      baseRules = baseRules.replace('\n{{NOTION_SECTION}}\n', '');
    }

    fs.writeFileSync(path.join(scDir, 'scripts', 'base_rules.md'), baseRules);
  }

  // README.md → .sleepcode/ 루트에 복사
  const readmeSrc = path.join(TEMPLATES_DIR, 'common', 'README.md');
  if (fs.existsSync(readmeSrc)) {
    fs.writeFileSync(path.join(scDir, 'README.md'), fs.readFileSync(readmeSrc, 'utf-8'));
  }

  // 실행 권한 (Unix만)
  if (!IS_WIN) {
    fs.chmodSync(path.join(scDir, 'scripts', 'ai_worker.sh'), 0o755);
    fs.chmodSync(path.join(scDir, 'scripts', 'run_forever.sh'), 0o755);
    fs.chmodSync(path.join(scDir, 'scripts', 'log_filter.py'), 0o755);
    if (notionDbId) fs.chmodSync(path.join(scDir, 'scripts', 'notion_sync.py'), 0o755);
  }

  // docs/.gitkeep
  writeFile(path.join(scDir, 'docs', '.gitkeep'), '');

  // sources.json (참고자료 URL 관리)
  const sourcesPath = path.join(scDir, 'sources.json');
  if (!fs.existsSync(sourcesPath)) {
    const sourcesData = { "$schema": "참고자료 URL 관리 파일 — generate 명령에서 자동으로 읽어 tasks.md 생성에 활용됩니다.", notion: [], figma: [], urls: [] };
    if (notionPages) {
      for (const page of notionPages.split(',').map(s => s.trim()).filter(Boolean)) {
        sourcesData.notion.push({ url: '', label: page });
      }
    }
    if (figmaFileNames) {
      for (const file of figmaFileNames.split(',').map(s => s.trim()).filter(Boolean)) {
        sourcesData.figma.push({ url: '', label: file });
      }
    }
    writeFile(sourcesPath, JSON.stringify(sourcesData, null, 2) + '\n');
  }

  // tasks.md는 Notion에서 동적으로 생성됨 (로컬 기본 템플릿 폐기)

  // rules.md
  const rulesTemplate = path.join(TEMPLATES_DIR, 'rules', `${typeKey}.md`);
  if (fs.existsSync(rulesTemplate)) {
    let rules = fs.readFileSync(rulesTemplate, 'utf-8');
    rules = rules.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
    rules = rules.replace(/\{\{ROLE\}\}/g, role);
    rules = rules.replace(/\{\{BUILD_CMD\}\}/g, buildCmd);
    rules = rules.replace(/\{\{TEST_CMD\}\}/g, testCmd);
    rules = rules.replace(/\{\{LINT_CMD\}\}/g, lintCmd);
    writeFile(path.join(scDir, 'rules.md'), rules);
  }

  // settings.local.json
  const settingsTemplate = path.join(TEMPLATES_DIR, 'settings', `${typeKey}.json`);
  if (fs.existsSync(settingsTemplate)) {
    const content = fs.readFileSync(settingsTemplate, 'utf-8');
    fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), content);
  }

  // .sleepcode/.env (API 키 등 민감 정보)
  const envLines = [];
  if (figmaKey) envLines.push(`FIGMA_API_KEY=${figmaKey}`);
  if (notionKey) envLines.push(`NOTION_API_KEY=${notionKey}`);
  if (notionDbId) envLines.push(`NOTION_DB_ID=${notionDbId}`);
  if (notionFilter) envLines.push(`NOTION_FILTER=${notionFilter}`);
  if (envLines.length > 0) {
    writeFile(path.join(scDir, '.env'), envLines.join('\n') + '\n');
  }

  // .gitignore — .sleepcode/ 전체를 무시
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    let gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('.sleepcode/')) {
      fs.appendFileSync(gitignorePath, '\n# sleepcode workspace\n.sleepcode/\n');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# sleepcode workspace\n.sleepcode/\n');
  }

  // CLAUDE.md 생성 (base_rules + rules → 프로젝트 루트 CLAUDE.md)
  syncClaudeMd(targetDir);
}

function printResult(notionDbId) {
  const workerScript = IS_WIN ? 'ai_worker.ps1' : 'ai_worker.sh';
  const foreverScript = IS_WIN ? 'run_forever.ps1' : 'run_forever.sh';

  console.log(`\n${C.bold}파일 생성 완료:${C.reset}\n`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/rules.md          ${C.dim}← 수정하세요${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/notion_sync.py`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/sources.json      ${C.dim}← 참고자료 URL 추가${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/docs/             ${C.dim}← 참고자료 파일 추가${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/base_rules.md`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/${workerScript}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/${foreverScript}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/log_filter.py`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/README.md`);
  console.log(`  ${C.green}✓${C.reset} .claude/settings.local.json`);
  console.log(`  ${C.green}✓${C.reset} CLAUDE.md                    ${C.dim}← 프롬프트 캐싱 (자동 생성)${C.reset}`);

  const taskStep = `${C.bold}3.${C.reset} Notion DB에 할 일을 작성해두세요 (실행 시 자동 동기화)`;

  console.log(`
${C.bold}${C.green}완료!${C.reset} 다음 단계:

  ${C.bold}1.${C.reset} .sleepcode/rules.md 를 프로젝트에 맞게 수정
  ${C.bold}2.${C.reset} 참고 자료 추가:
     ${C.dim}• .sleepcode/sources.json 에 Notion/Figma URL 등록${C.reset}
     ${C.dim}• .sleepcode/docs/ 에 기획서, 스크린샷 등 파일 추가${C.reset}
     ${C.cyan}npx sleepcode sources${C.reset}         ${C.dim}# 참고자료 현황 확인${C.reset}
  ${taskStep}
  ${C.bold}4.${C.reset} 실행:
     ${C.cyan}npx sleepcode run${C.reset}          ${C.dim}# 1회 실행${C.reset}
     ${C.cyan}npx sleepcode run --loop${C.reset}   ${C.dim}# 무한 루프${C.reset}
`);
}

// ─── 병렬 실행 (worktree) ───
function parseParallelTasks(tasksPath) {
  if (!fs.existsSync(tasksPath)) return null;
  const content = fs.readFileSync(tasksPath, 'utf-8');
  const lines = content.split('\n');

  const workers = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## @worker\s+(\S+)/);
    if (match) {
      current = { name: match[1], lines: [line] };
      workers.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (workers.length === 0) return null;

  // 각 워커의 tasks.md 콘텐츠 구성
  return workers.map(w => ({
    name: w.name,
    tasks: `# 작업 목록\n\n${w.lines.join('\n')}`,
    remaining: countTasks(w.lines.join('\n')).total - countTasks(w.lines.join('\n')).done,
  }));
}

/**
 * .sleepcode/ 디렉토리를 worktree로 복사 (worktrees/, logs/ 제외)
 */
function copySleepcodeDirToWorktree(srcDir, wtPath) {
  const sleepcodeDir = path.join(srcDir, '.sleepcode');
  const wtSleepcodeDir = path.join(wtPath, '.sleepcode');

  if (!fs.existsSync(sleepcodeDir)) return;

  // 복사에서 제외할 디렉토리 (재귀 방지 + 불필요한 파일)
  const EXCLUDE_DIRS = new Set(['worktrees', 'logs']);

  function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        // 최상위 .sleepcode/ 직속 하위인 경우만 제외 체크
        if (src === sleepcodeDir && EXCLUDE_DIRS.has(entry.name)) continue;
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDirRecursive(sleepcodeDir, wtSleepcodeDir);
}

function createWorktrees(targetDir, workers) {
  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');
  fs.mkdirSync(wtBase, { recursive: true });

  const created = [];
  for (const worker of workers) {
    const wtPath = path.join(wtBase, worker.name);
    const branch = `sleepcode/${worker.name}`;

    if (fs.existsSync(wtPath)) {
      console.log(`  ${C.dim}-${C.reset} ${worker.name} ${C.dim}(이미 존재)${C.reset}`);
      // .sleepcode 디렉토리가 없으면 복사
      const wtSleepcodeDir = path.join(wtPath, '.sleepcode');
      if (!fs.existsSync(wtSleepcodeDir)) {
        copySleepcodeDirToWorktree(targetDir, wtPath);
      }
      // 태스크 파일 갱신
      const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
      fs.mkdirSync(path.dirname(wtTasksPath), { recursive: true });
      fs.writeFileSync(wtTasksPath, worker.tasks);
      created.push({ name: worker.name, path: wtPath, branch });
      continue;
    }

    try {
      execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
        cwd: targetDir,
        stdio: 'pipe',
      });
    } catch (e) {
      // 브랜치가 이미 있으면 -b 없이 재시도
      try {
        execSync(`git worktree add "${wtPath}" "${branch}"`, {
          cwd: targetDir,
          stdio: 'pipe',
        });
      } catch (e2) {
        console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e2.message}`);
        continue;
      }
    }

    // .sleepcode 디렉토리를 worktree로 복사 (scripts, rules, docs 등)
    copySleepcodeDirToWorktree(targetDir, wtPath);

    // worktree 안의 tasks.md를 해당 워커 태스크만으로 덮어쓰기
    const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
    fs.mkdirSync(path.dirname(wtTasksPath), { recursive: true });
    fs.writeFileSync(wtTasksPath, worker.tasks);

    console.log(`  ${C.green}✓${C.reset} ${worker.name} ${C.dim}(${branch})${C.reset} — ${worker.remaining}개 태스크`);
    created.push({ name: worker.name, path: wtPath, branch });
  }

  return created;
}

function cleanupWorktrees(targetDir, workers) {
  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');

  if (workers) {
    // 특정 워커들만 정리
    for (const worker of workers) {
      const wtPath = path.join(wtBase, worker.name);
      if (!fs.existsSync(wtPath)) continue;
      try {
        execSync(`git worktree remove "${wtPath}" --force`, { cwd: targetDir, stdio: 'pipe' });
        console.log(`  ${C.green}✓${C.reset} ${worker.name} worktree 제거`);
      } catch (e) {
        console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e.message}`);
      }
    }
  } else {
    // 전체 정리: .sleepcode/worktrees/ 아래 모든 디렉토리
    if (!fs.existsSync(wtBase)) {
      console.log(`${C.dim}정리할 worktree가 없습니다.${C.reset}`);
      return;
    }
    const dirs = fs.readdirSync(wtBase).filter(d =>
      fs.statSync(path.join(wtBase, d)).isDirectory()
    );
    for (const dir of dirs) {
      const wtPath = path.join(wtBase, dir);
      try {
        execSync(`git worktree remove "${wtPath}" --force`, { cwd: targetDir, stdio: 'pipe' });
        console.log(`  ${C.green}✓${C.reset} ${dir} worktree 제거`);
      } catch (e) {
        console.error(`  ${C.red}✗${C.reset} ${dir}: ${e.message}`);
      }
    }
  }

  // worktrees 디렉토리가 비었으면 삭제
  if (fs.existsSync(wtBase)) {
    const remaining = fs.readdirSync(wtBase);
    if (remaining.length === 0) {
      fs.rmdirSync(wtBase);
    }
  }
}

function showParallelStatus(targetDir) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'tasks.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.log(`${C.yellow}tasks.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`${C.dim}병렬 실행을 위해 tasks.md에 ## @worker <name> 섹션을 추가하세요.${C.reset}`);
    return;
  }

  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');

  console.log(`\n${C.bold}워커 상태:${C.reset}\n`);
  for (const worker of workers) {
    const wtPath = path.join(wtBase, worker.name);
    const exists = fs.existsSync(wtPath);

    // worktree가 있으면 그 안의 tasks.md에서 진행률 확인
    let done = 0;
    let total = 0;
    if (exists) {
      const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
      if (fs.existsSync(wtTasksPath)) {
        const wtContent = fs.readFileSync(wtTasksPath, 'utf-8');
        const tc = countTasks(wtContent);
        done = tc.done;
        total = tc.total;
      }
    } else {
      total = worker.remaining;
    }

    const bar = total > 0 ? progressBar(done, total, 20) : C.dim + '(태스크 없음)' + C.reset;
    const status = exists
      ? `${C.green}준비됨${C.reset}`
      : `${C.dim}미생성${C.reset}`;

    console.log(`  ${C.bold}${worker.name}${C.reset}  ${bar}  ${done}/${total}  ${status}`);
  }
  console.log('');
}

/** tasks.md에서 코드 블록 내부를 제외한 실제 태스크만 카운트 */
function countTasks(content) {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let done = 0;
  let pending = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (/^- \[x\]/i.test(line.trimStart())) done++;
    else if (/^- \[ \]/.test(line.trimStart())) pending++;
  }
  return { done, total: done + pending };
}

function progressBar(done, total, width) {
  const ratio = total > 0 ? done / total : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${C.green}${'━'.repeat(filled)}${C.dim}${'─'.repeat(empty)}${C.reset}`;
}

/** ANSI 이스케이프 코드를 제거한 문자열 반환 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** 터미널에서의 실제 표시 너비 (CJK 문자 = 2칸, ANSI = 0칸) */
function visualWidth(str) {
  const plain = stripAnsi(str);
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    // CJK 범위 (Hangul, CJK Unified Ideographs, Fullwidth Forms 등)
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||   // Hangul Jamo
      (cp >= 0x2E80 && cp <= 0x303E) ||   // CJK Radicals / Symbols
      (cp >= 0x3040 && cp <= 0x33BF) ||   // Hiragana, Katakana, CJK Compatibility
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Unified Extension A
      (cp >= 0x4E00 && cp <= 0xA4CF) ||   // CJK Unified / Yi
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
      (cp >= 0xFE30 && cp <= 0xFE6F) ||   // CJK Compatibility Forms
      (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth Forms
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||   // Fullwidth Signs
      (cp >= 0x20000 && cp <= 0x2FA1F)    // CJK Unified Extension B-F
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** 시각적 너비 기준으로 오른쪽 패딩 */
function padEndVisual(str, targetWidth) {
  const vw = visualWidth(str);
  const pad = Math.max(0, targetWidth - vw);
  return str + ' '.repeat(pad);
}

/** 대시보드용 한 줄: │ content (패딩) │ */
function boxLine(content, innerWidth) {
  return `${C.dim}│${C.reset} ${padEndVisual(content, innerWidth)} ${C.dim}│${C.reset}`;
}

/** 대시보드 하단 메뉴 렌더링 */
const MENU_ITEMS = ['마무리 후 종료', '즉시 종료'];

function renderMenuLine(selectedIndex, innerWidth) {
  const parts = MENU_ITEMS.map((label, i) => {
    if (i === selectedIndex) {
      return `${C.cyan}${C.bold}▸ ${label}${C.reset}`;
    }
    return `${C.dim}  ${label}${C.reset}`;
  });
  const content = parts.join('    ');
  return boxLine(`◀ ${content}  ▶`, innerWidth);
}

/** 대시보드 메뉴 키 입력 핸들러 설정 */
function setupMenuInput(state, onRender, onGraceful, onImmediate) {
  if (!process.stdin.isTTY) return null;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const handler = (data) => {
    const key = data.toString();

    // Ctrl+C → 즉시 종료
    if (key === '\x03') {
      onImmediate();
      return;
    }

    // 좌우 화살표 (ESC [ D / ESC [ C)
    if (key === '\x1b[D' || key === '\x1b[C') {
      state.menuIndex = state.menuIndex === 0 ? 1 : 0;
      onRender();
      return;
    }

    // Enter
    if (key === '\r' || key === '\n') {
      if (state.menuIndex === 0) {
        onGraceful();
      } else {
        onImmediate();
      }
    }
  };

  process.stdin.on('data', handler);

  return () => {
    process.stdin.removeListener('data', handler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };
}

// ─── 설정/사용량 관리 ───
function getMonday(date) {
  const d = new Date(date || Date.now());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setHours(0, 0, 0, 0);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function loadConfig(targetDir) {
  const configPath = path.join(targetDir, '.sleepcode', 'config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveConfig(targetDir, config) {
  const configPath = path.join(targetDir, '.sleepcode', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function loadUsage(targetDir) {
  const usagePath = path.join(targetDir, '.sleepcode', 'usage.json');
  const currentWeek = getMonday();
  if (!fs.existsSync(usagePath)) {
    return { weekStart: currentWeek, entries: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    if (data.weekStart !== currentWeek) {
      return { weekStart: currentWeek, entries: [] };
    }
    return data;
  } catch {
    return { weekStart: currentWeek, entries: [] };
  }
}

function saveUsage(targetDir, usage) {
  const usagePath = path.join(targetDir, '.sleepcode', 'usage.json');
  fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n');
}

function recordCost(targetDir, cost, mode, workerName) {
  if (cost == null || cost <= 0) return;
  const usage = loadUsage(targetDir);
  usage.entries.push({
    timestamp: new Date().toISOString(),
    mode,
    worker: workerName || null,
    cost,
  });
  saveUsage(targetDir, usage);
}

function getWeeklyTotal(targetDir) {
  const usage = loadUsage(targetDir);
  return usage.entries.reduce((sum, e) => sum + (e.cost || 0), 0);
}

function isOverBudget(targetDir) {
  const config = loadConfig(targetDir);
  if (!config || !config.weeklyBudget) return null;
  const threshold = (config.budgetThreshold || 90) / 100;
  const limit = config.weeklyBudget * threshold;
  const total = getWeeklyTotal(targetDir);
  return {
    over: total >= limit,
    total,
    limit,
    budget: config.weeklyBudget,
    threshold: config.budgetThreshold || 90,
  };
}

function showUsage() {
  const targetDir = process.cwd();
  const config = loadConfig(targetDir);
  const usage = loadUsage(targetDir);
  const total = usage.entries.reduce((sum, e) => sum + (e.cost || 0), 0);

  console.log(`\n${C.bold}sleepcode 주간 사용량${C.reset}\n`);
  console.log(`  주간 시작: ${C.cyan}${usage.weekStart}${C.reset} (월요일)`);
  console.log(`  세션 수:   ${usage.entries.length}`);
  console.log(`  총 비용:   ${C.bold}$${total.toFixed(4)}${C.reset}`);

  if (config && config.weeklyBudget) {
    const threshold = config.budgetThreshold || 90;
    const limit = config.weeklyBudget * threshold / 100;
    const pct = config.weeklyBudget > 0 ? (total / config.weeklyBudget * 100).toFixed(1) : '0';
    const bar = progressBar(Math.min(total, config.weeklyBudget), config.weeklyBudget, 30);

    console.log(`  주간 예산: $${config.weeklyBudget.toFixed(2)}`);
    console.log(`  임계값:    ${threshold}% ($${limit.toFixed(2)})`);
    console.log(`  사용률:    ${pct}%`);
    console.log(`\n  ${bar}  $${total.toFixed(2)} / $${config.weeklyBudget.toFixed(2)}`);

    if (total >= limit) {
      console.log(`\n  ${C.red}${C.bold}한도 도달 — 워커가 중지됩니다.${C.reset}`);
    } else {
      console.log(`\n  ${C.green}잔여: $${(limit - total).toFixed(2)}${C.reset}`);
    }
  } else {
    console.log(`\n  ${C.dim}예산 미설정. 'npx sleepcode' 초기화 시 설정하거나,${C.reset}`);
    console.log(`  ${C.dim}.sleepcode/config.json 에 직접 설정하세요.${C.reset}`);
  }

  if (usage.entries.length > 0) {
    console.log(`\n${C.bold}최근 세션:${C.reset}\n`);
    const recent = usage.entries.slice(-10);
    for (const entry of recent) {
      const time = new Date(entry.timestamp).toLocaleString();
      const mode = entry.mode || 'unknown';
      const worker = entry.worker ? ` (${entry.worker})` : '';
      console.log(`  ${C.dim}${time}${C.reset}  ${mode}${worker}  ${C.bold}$${entry.cost.toFixed(4)}${C.reset}`);
    }
    if (usage.entries.length > 10) {
      console.log(`  ${C.dim}... 외 ${usage.entries.length - 10}개${C.reset}`);
    }
  }
  console.log('');
}

function mergeWorktrees(targetDir) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'tasks.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.error(`${C.red}tasks.md에 @worker 섹션이 없습니다.${C.reset}`);
    process.exit(1);
  }

  // 현재 브랜치 확인
  let currentBranch;
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
  } catch {
    console.error(`${C.red}git 브랜치를 확인할 수 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}브랜치 머지${C.reset} — 대상: ${C.cyan}${currentBranch}${C.reset}\n`);

  // 머지 전 uncommitted changes 체크
  try {
    const status = execSync('git status --porcelain', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
    if (status) {
      console.error(`${C.red}커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 stash 하세요.${C.reset}`);
      console.log(`${C.dim}${status}${C.reset}`);
      process.exit(1);
    }
  } catch {
    // 무시
  }

  const results = { merged: [], conflicted: [], skipped: [] };

  for (const worker of workers) {
    const branch = `sleepcode/${worker.name}`;

    // 브랜치 존재 확인
    try {
      execSync(`git rev-parse --verify "${branch}"`, { cwd: targetDir, stdio: 'pipe' });
    } catch {
      console.log(`  ${C.dim}-${C.reset} ${branch} ${C.dim}(브랜치 없음, 스킵)${C.reset}`);
      results.skipped.push(worker.name);
      continue;
    }

    // 메인 브랜치와 차이 확인
    try {
      const diff = execSync(`git log "${currentBranch}..${branch}" --oneline`, { cwd: targetDir, stdio: 'pipe' }).toString().trim();
      if (!diff) {
        console.log(`  ${C.dim}-${C.reset} ${branch} ${C.dim}(변경사항 없음, 스킵)${C.reset}`);
        results.skipped.push(worker.name);
        continue;
      }
    } catch {
      // diff 실패 시 머지 시도
    }

    // 머지 시도
    try {
      execSync(`git merge "${branch}" --no-edit`, { cwd: targetDir, stdio: 'pipe' });
      console.log(`  ${C.green}✓${C.reset} ${branch} 머지 완료`);
      results.merged.push(worker.name);
    } catch (e) {
      // 충돌 감지
      const stderr = e.stderr ? e.stderr.toString() : '';
      if (stderr.includes('CONFLICT') || stderr.includes('Merge conflict')) {
        // 머지 중단
        try {
          execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
        } catch {
          // abort 실패 시 무시
        }
        console.log(`  ${C.red}✗${C.reset} ${branch} ${C.yellow}충돌 발생${C.reset} — 수동 머지 필요`);
        results.conflicted.push(worker.name);
      } else {
        // 머지 중단 시도
        try {
          execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
        } catch {
          // abort 실패 시 무시
        }
        console.log(`  ${C.red}✗${C.reset} ${branch} 머지 실패`);
        results.conflicted.push(worker.name);
      }
    }
  }

  // 결과 요약
  console.log(`\n${C.bold}머지 결과:${C.reset}`);
  if (results.merged.length > 0) {
    console.log(`  ${C.green}성공: ${results.merged.length}${C.reset} (${results.merged.join(', ')})`);
  }
  if (results.conflicted.length > 0) {
    console.log(`  ${C.red}충돌: ${results.conflicted.length}${C.reset} (${results.conflicted.join(', ')})`);
    console.log(`\n${C.yellow}충돌 브랜치를 수동으로 머지하세요:${C.reset}`);
    for (const name of results.conflicted) {
      console.log(`  ${C.cyan}git merge sleepcode/${name}${C.reset}  ${C.dim}# 충돌 해결 후 git commit${C.reset}`);
    }
  }
  if (results.skipped.length > 0) {
    console.log(`  ${C.dim}스킵: ${results.skipped.length} (${results.skipped.join(', ')})${C.reset}`);
  }

  if (results.conflicted.length === 0 && results.merged.length > 0) {
    console.log(`\n${C.green}${C.bold}모든 브랜치 머지 완료!${C.reset}`);
    console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}  ${C.dim}# worktree 정리${C.reset}\n`);
  }
}

function autoMergeWorktrees(targetDir, workerStates) {
  let currentBranch;
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
  } catch {
    throw new Error('git 브랜치를 확인할 수 없습니다.');
  }

  // 머지 전 uncommitted changes 체크
  try {
    const status = execSync('git status --porcelain', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
    if (status) {
      throw new Error('커밋되지 않은 변경사항이 있습니다.');
    }
  } catch (e) {
    if (e.message.includes('커밋되지 않은')) throw e;
  }

  const results = { merged: [], conflicted: [], skipped: [] };

  for (const ws of workerStates) {
    const branch = `sleepcode/${ws.name}`;

    try {
      execSync(`git rev-parse --verify "${branch}"`, { cwd: targetDir, stdio: 'pipe' });
    } catch {
      results.skipped.push(ws.name);
      continue;
    }

    try {
      const diff = execSync(`git log "${currentBranch}..${branch}" --oneline`, { cwd: targetDir, stdio: 'pipe' }).toString().trim();
      if (!diff) {
        results.skipped.push(ws.name);
        continue;
      }
    } catch {
      // diff 실패 시 머지 시도
    }

    try {
      execSync(`git merge "${branch}" --no-edit`, { cwd: targetDir, stdio: 'pipe' });
      results.merged.push(ws.name);
    } catch {
      try {
        execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
      } catch {}
      results.conflicted.push(ws.name);
    }
  }

  return results;
}

function runParallel(subArgs) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // 서브 옵션 파싱
  const isSetup = subArgs.includes('--setup');
  const isClean = subArgs.includes('--clean');
  const isStatus = subArgs.includes('--status');
  const isMerge = subArgs.includes('--merge');

  if (isStatus) {
    showParallelStatus(targetDir);
    return;
  }

  if (isMerge) {
    mergeWorktrees(targetDir);
    return;
  }

  if (isClean) {
    console.log(`\n${C.bold}Worktree 정리 중...${C.reset}\n`);
    cleanupWorktrees(targetDir, null);
    console.log(`\n${C.green}정리 완료.${C.reset}`);
    return;
  }

  // --setup 또는 기본 동작: worktree 생성
  const tasksPath = path.join(scDir, 'tasks.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.error(`${C.red}tasks.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`
${C.bold}tasks.md 병렬 포맷 예시:${C.reset}

  ${C.dim}# 작업 목록${C.reset}

  ${C.cyan}## @worker feature-auth${C.reset}
  ${C.dim}- [ ] 로그인 화면 구현${C.reset}
  ${C.dim}- [ ] 회원가입 API 연동${C.reset}

  ${C.cyan}## @worker feature-cart${C.reset}
  ${C.dim}- [ ] 장바구니 화면 구현${C.reset}
  ${C.dim}- [ ] 상품 추가/삭제 API${C.reset}
`);
    process.exit(1);
  }

  console.log(`\n${C.bold}병렬 워커 설정${C.reset} — ${workers.length}개 워커 감지\n`);

  const created = createWorktrees(targetDir, workers);

  if (created.length === 0) {
    console.error(`\n${C.red}생성된 worktree가 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.green}${C.bold}Worktree 생성 완료!${C.reset}`);

  if (isSetup) {
    console.log(`
${C.bold}다음 단계:${C.reset}

  ${C.cyan}npx sleepcode parallel --status${C.reset}  ${C.dim}# 워커 상태 확인${C.reset}
  ${C.cyan}npx sleepcode parallel${C.reset}           ${C.dim}# 병렬 실행${C.reset}
  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}
`);
    return;
  }

  // 병렬 실행
  runParallelWorkers(targetDir, created);
}

function runParallelWorkers(targetDir, workerInfos) {
  const logDir = path.join(targetDir, '.sleepcode', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const py = detectPython();
  if (!py) {
    console.error(`${C.red}python3이 필요합니다.${C.reset}`);
    process.exit(1);
  }

  // 실행 전 예산 체크
  const budgetCheck = isOverBudget(targetDir);
  if (budgetCheck && budgetCheck.over) {
    console.log(`\n${C.red}주간 한도에 도달했습니다.${C.reset}`);
    console.log(`  사용: $${budgetCheck.total.toFixed(2)} / 한도: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.threshold}% of $${budgetCheck.budget.toFixed(2)})`);
    console.log(`${C.dim}다음 주 월요일에 초기화됩니다.${C.reset}`);
    process.exit(0);
  }

  console.log(`\n${C.bold}병렬 실행 시작${C.reset} — ${workerInfos.length}개 워커\n`);

  const workerStates = workerInfos.map(w => ({
    ...w,
    targetDir,
    status: 'running',
    currentTask: '',
    done: 0,
    total: 0,
    cost: 0,
    _proc: null,
    logFile: path.join(logDir, `parallel_${w.name}_${timestamp}.log`),
  }));

  // 초기 태스크 수 계산
  for (const ws of workerStates) {
    const tasksPath = path.join(ws.path, '.sleepcode', 'tasks.md');
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const tc = countTasks(content);
      ws.total = tc.total;
      ws.done = tc.done;
    }
  }

  // 로그 버퍼 (리사이즈 시 재렌더링용)
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let altScreenActive = false;

  function appendLogToScreen(line) {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function pushLog(workerName, msg) {
    const tag = `${C.dim}[${workerName}]${C.reset}`;
    const fullMsg = `${tag} ${msg}`;
    logBuffer.push(fullMsg);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    appendLogToScreen(fullMsg);
  }

  // 대시보드 렌더링
  const startTime = Date.now();
  let renderPending = false;
  const menuState = { menuIndex: 0 };
  let gracefulShutdown = false;

  function renderDashboard() {
    if (!altScreenActive) return;

    const lines = [];
    const W = 50; // 박스 내부 너비
    const totalTasks = workerStates.reduce((s, w) => s + w.total, 0);
    const totalDone = workerStates.reduce((s, w) => s + w.done, 0);
    const activeCount = workerStates.filter(w => w.status === 'running').length;
    const totalCost = workerStates.reduce((s, w) => s + w.cost, 0);

    lines.push(`${C.dim}╭${'─'.repeat(W + 2)}╮${C.reset}`);
    lines.push(boxLine(`${SLEEPCODE_BADGE} parallel  ${C.dim}${activeCount}/${workerStates.length} workers${C.reset}`, W));
    lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);

    for (const ws of workerStates) {
      const bar = progressBar(ws.done, ws.total, 15);
      const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
        : ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(ws.name, 18)}${C.reset} ${bar} ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)}`, W));
      if (ws.currentTask && ws.status === 'running') {
        const maxTaskW = W - 6;
        let task = ws.currentTask;
        if (visualWidth(task) > maxTaskW) {
          let tw = 0;
          let cut = 0;
          for (const ch of task) {
            const cw = visualWidth(ch);
            if (tw + cw > maxTaskW - 3) break;
            tw += cw;
            cut += ch.length;
          }
          task = task.slice(0, cut) + '...';
        }
        lines.push(boxLine(`  ${C.dim}> ${task}${C.reset}`, W));
      } else {
        lines.push(boxLine('', W));
      }
    }

    lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
    const costStr = `$${totalCost.toFixed(4)}`;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`;
    lines.push(boxLine(`비용: ${costStr}  ${C.dim}·${C.reset}  경과: ${elapsedStr}  ${C.dim}·${C.reset}  진행: ${totalDone}/${totalTasks}`, W));
    const budgetInfo = isOverBudget(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
      lines.push(boxLine(`주간: $${budgetInfo.total.toFixed(2)}/$${budgetInfo.budget} (${pct}%) ${budgetBar}${warn}`, W));
    } else {
      lines.push(boxLine('', W));
    }

    // 메뉴
    lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
    if (gracefulShutdown) {
      lines.push(boxLine(`${C.yellow}마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`, W));
    } else {
      lines.push(renderMenuLine(menuState.menuIndex, W));
    }

    lines.push(`${C.dim}╰${'─'.repeat(W + 2)}╯${C.reset}`);
    lines.push(`${C.dim} ─── logs ${'─'.repeat(W - 7)}${C.reset}`);

    // Alternate Screen: 절대 좌표로 대시보드 렌더링
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${lines[i]}\x1b[K`);
    }
  }

  /** 이벤트 기반 렌더 요청을 200ms 디바운스로 처리 (깜빡임 방지) */
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      renderDashboard();
    }, 200);
  }

  // Alternate Screen 초기화
  const dashboardHeight = 11 + workerStates.length * 2;
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[2J');
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    altScreenActive = true;
  }

  function cleanupAltScreen() {
    if (!altScreenActive) return;
    altScreenActive = false;
    process.stdout.write('\x1b[r');
    process.stdout.write('\x1b[?1049l');
  }

  process.stdout.on('resize', () => {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    const logRows = rows - dashboardHeight;
    const recentLogs = logBuffer.slice(-Math.max(0, logRows));
    for (const line of recentLogs) {
      appendLogToScreen(line);
    }
  });

  const sigintHandler = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    for (const ws of workerStates) {
      if (ws._proc) try { ws._proc.kill(); } catch {}
    }
    cleanupAltScreen();
    console.log(`\n${C.yellow}중단됨${C.reset}`);
    process.exit(1);
  };
  process.on('SIGINT', sigintHandler);
  process.on('exit', cleanupAltScreen);

  // 메뉴 키 입력 핸들러
  const cleanupMenuInput = setupMenuInput(
    menuState,
    renderDashboard,
    // 마무리 후 종료: 현재 작업 완료 후 프로세스 종료
    () => {
      if (gracefulShutdown) return;
      gracefulShutdown = true;
      pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
      for (const ws of workerStates) {
        if (ws.status === 'running' && ws._proc) {
          try { ws._proc.kill('SIGINT'); } catch {}
        }
      }
      renderDashboard();
    },
    // 즉시 종료
    () => {
      if (cleanupMenuInput) cleanupMenuInput();
      for (const ws of workerStates) {
        if (ws._proc) try { ws._proc.kill(); } catch {}
      }
      cleanupAltScreen();
      console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
      process.exit(0);
    }
  );

  renderDashboard();

  // 대시보드 갱신 타이머
  const dashboardInterval = setInterval(renderDashboard, 3000);

  // 예산 체크 타이머 (30초마다)
  let budgetStopped = false;
  const budgetCheckInterval = setInterval(() => {
    if (budgetStopped) return;
    const result = isOverBudget(targetDir);
    if (result && result.over) {
      budgetStopped = true;
      pushLog('SYSTEM', `${C.yellow}주간 한도 ${result.threshold}% 도달 ($${result.total.toFixed(2)}) — 워커 중지${C.reset}`);
      for (const ws of workerStates) {
        if (ws.status === 'running' && ws._proc) {
          ws.status = 'budget_stop';
          ws.currentTask = '한도 도달 — 중지됨';
          try { ws._proc.kill(); } catch {}
        }
      }
      renderDashboard();
    }
  }, 30000);

  // 각 워커 프로세스 생성
  let activeWorkers = workerStates.length;

  function onWorkerDone() {
    activeWorkers--;
    renderDashboard();
    if (activeWorkers === 0) {
      clearInterval(dashboardInterval);
      clearInterval(budgetCheckInterval);
      renderDashboard();
      if (cleanupMenuInput) cleanupMenuInput();
      process.removeListener('SIGINT', sigintHandler);
      cleanupAltScreen();
      onAllDone();
    }
  }

  function onAllDone() {
    const failed = workerStates.filter(w => w.status === 'failed');
    const done = workerStates.filter(w => w.status === 'done');
    const stopped = workerStates.filter(w => w.status === 'budget_stop');

    console.log(`\n${C.bold}병렬 실행 완료${C.reset}`);
    const parts = [`${C.green}성공: ${done.length}${C.reset}`];
    if (failed.length > 0) parts.push(`${C.red}실패: ${failed.length}${C.reset}`);
    if (stopped.length > 0) parts.push(`${C.yellow}예산 중지: ${stopped.length}${C.reset}`);
    console.log(`  ${parts.join('  ')}`);

    // 브랜치 목록 출력
    console.log(`\n${C.bold}생성된 브랜치:${C.reset}`);
    for (const ws of workerStates) {
      const icon = ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      console.log(`  ${icon} ${ws.branch}`);
    }

    console.log(`
${C.bold}다음 단계:${C.reset}

  ${C.cyan}npx sleepcode parallel --merge${C.reset}   ${C.dim}# 브랜치 자동 머지${C.reset}
  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}
`);
  }

  for (const ws of workerStates) {
    spawnWorker(ws, py, onWorkerDone, scheduleRender, pushLog);
  }
}

function spawnWorker(ws, py, onDone, onUpdate, pushLog) {
  // CLAUDE.md 동기화 (base_rules + rules → CLAUDE.md, 프롬프트 캐싱)
  const wtDir = ws.path;
  syncClaudeMd(wtDir);

  // 프롬프트 구성 (tasks.md만 전달 — 규칙은 CLAUDE.md로 자동 로드됨)
  const tasksPath = path.join(wtDir, '.sleepcode', 'tasks.md');
  const prompt = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';

  if (!prompt.trim()) {
    pushLog(ws.name, `${C.red}[오류] 프롬프트가 비어있습니다. .sleepcode/ 디렉토리를 확인하세요.${C.reset}`);
    ws.status = 'failed';
    ws.currentTask = '프롬프트 파일 누락';
    onDone();
    return;
  }

  // 로그 파일 스트림
  const logStream = fs.createWriteStream(ws.logFile, { flags: 'a' });
  const logLine = (msg) => logStream.write(`[${new Date().toISOString()}] ${msg}\n`);

  logLine(`=== Worker ${ws.name} 시작 ===`);

  // claude 중첩 세션 방지
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // claude -p 실행 (stream-json)
  const claudeProc = spawn('claude', [
    '-p', '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], {
    cwd: wtDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });

  ws._proc = claudeProc;

  // 프롬프트 전달
  claudeProc.stdin.write(prompt);
  claudeProc.stdin.end();

  // stdout 파싱 (stream-json)
  let buffer = '';
  claudeProc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 마지막 불완전한 줄은 보존

    for (const line of lines) {
      if (!line.trim()) continue;
      logStream.write(line + '\n');

      try {
        const obj = JSON.parse(line);
        processStreamEvent(ws, obj, onUpdate, pushLog);
      } catch {
        // JSON 아닌 줄 무시
      }
    }
  });

  claudeProc.stderr.on('data', (data) => {
    logStream.write(`[STDERR] ${data.toString()}`);
  });

  claudeProc.on('close', (code) => {
    // 버퍼에 남은 마지막 줄 처리 (result 메시지에 cost_usd 포함)
    if (buffer.trim()) {
      logStream.write(buffer + '\n');
      try {
        const obj = JSON.parse(buffer);
        processStreamEvent(ws, obj, onUpdate, pushLog);
      } catch {
        // JSON 아닌 줄 무시
      }
      buffer = '';
    }

    logLine(`=== Worker ${ws.name} 종료 (code: ${code}) ===`);
    logStream.end();

    // 최종 태스크 상태 갱신
    const finalTasksPath = path.join(wtDir, '.sleepcode', 'tasks.md');
    if (fs.existsSync(finalTasksPath)) {
      const content = fs.readFileSync(finalTasksPath, 'utf-8');
      const tc = countTasks(content);
      ws.done = tc.done;
      ws.total = tc.total;
    }

    ws.status = (code === 0) ? 'done' : 'failed';
    ws.currentTask = '';
    onDone();
  });

  claudeProc.on('error', (err) => {
    logLine(`ERROR: ${err.message}`);
    logStream.end();
    ws.status = 'failed';
    ws.currentTask = err.message;
    onDone();
  });
}

function processStreamEvent(ws, obj, onUpdate, pushLog) {
  const msgType = obj.type;

  if (msgType === 'assistant') {
    const contents = (obj.message && obj.message.content) || [];
    for (const c of contents) {
      if (c.type === 'text') {
        const text = (c.text || '').trim();
        if (text) {
          // AI 보고 텍스트 수집 (Notion 페이지 기록용)
          if (!ws.reportLines) ws.reportLines = [];
          ws.reportLines.push(text);

          let short = text;
          if (visualWidth(text) > 135) {
            let tw = 0, cut = 0;
            for (const ch of text) {
              const cw = visualWidth(ch);
              if (tw + cw > 132) break;
              tw += cw;
              cut += ch.length;
            }
            short = text.slice(0, cut) + '...';
          }
          pushLog(ws.name, `${C.dim}${short}${C.reset}`);
          onUpdate();
        }
      } else if (c.type === 'tool_use') {
        const name = c.name || '?';
        const inp = c.input || {};

        // TodoWrite → 대시보드 현재 태스크 갱신
        if (name === 'TodoWrite') {
          const todos = inp.todos || [];
          const active = todos.find(t => t.status === 'in_progress');
          if (active) {
            ws.currentTask = active.activeForm || active.content || '';
          }
        }

        // 도구 사용 로그
        let detail = '';
        if (name === 'Read' || name === 'Write' || name === 'Edit') {
          const fp = inp.file_path || '';
          detail = fp.split(/[/\\]/).pop() || fp;
        } else if (name === 'Bash') {
          const cmd = inp.command || '';
          if (visualWidth(cmd) > 120) {
            let tw = 0, cut = 0;
            for (const ch of cmd) {
              const cw = visualWidth(ch);
              if (tw + cw > 117) break;
              tw += cw;
              cut += ch.length;
            }
            detail = cmd.slice(0, cut) + '...';
          } else {
            detail = cmd;
          }
        } else if (name === 'Glob') {
          detail = inp.pattern || '';
        } else if (name === 'Grep') {
          detail = inp.pattern || '';
        }

        const logMsg = detail
          ? `${C.cyan}[TOOL]${C.reset} ${name}: ${detail}`
          : `${C.cyan}[TOOL]${C.reset} ${name}`;
        pushLog(ws.name, logMsg);
        onUpdate();
      }
    }
  } else if (msgType === 'result') {
    const cost = obj.cost_usd;
    if (cost != null) {
      ws.cost = cost;
      if (ws.targetDir) recordCost(ws.targetDir, cost, 'parallel', ws.name);
    }

    // 최종 태스크 상태 갱신
    const tasksPath2 = path.join(ws.path, '.sleepcode', 'tasks.md');
    if (fs.existsSync(tasksPath2)) {
      const content = fs.readFileSync(tasksPath2, 'utf-8');
      const tc = countTasks(content);
      ws.done = tc.done;
      ws.total = tc.total;
    }

    const msg = typeof obj.message === 'string' ? obj.message : '';
    if (msg) {
      let short = msg;
      if (visualWidth(msg) > 120) {
        let tw = 0, cut = 0;
        for (const ch of msg) {
          const cw = visualWidth(ch);
          if (tw + cw > 117) break;
          tw += cw;
          cut += ch.length;
        }
        short = msg.slice(0, cut) + '...';
      }
      pushLog(ws.name, `${C.green}[DONE]${C.reset} ${short}`);
    }
    onUpdate();
  }
}

// ─── 실행 명령어 ───
function runWorker(loop, cont) {
  const targetDir = process.cwd();

  // 예산 체크
  const budgetCheck = isOverBudget(targetDir);
  if (budgetCheck && budgetCheck.over) {
    console.log(`${C.red}주간 한도에 도달했습니다.${C.reset}`);
    console.log(`  사용: $${budgetCheck.total.toFixed(2)} / 한도: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.threshold}% of $${budgetCheck.budget.toFixed(2)})`);
    console.log(`${C.dim}다음 주 월요일에 초기화됩니다. 'npx sleepcode usage' 로 확인하세요.${C.reset}`);
    process.exit(0);
  }

  const scDir = path.join(targetDir, '.sleepcode');
  const scriptsDir = path.join(scDir, 'scripts');

  if (!fs.existsSync(scriptsDir)) {
    console.error(`${C.red}.sleepcode/scripts/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // --loop 모드는 기존 셸 스크립트 방식 유지
  if (loop) {
    const scriptName = IS_WIN ? 'run_forever.ps1' : 'run_forever.sh';
    const scriptPath = path.join(scriptsDir, scriptName);

    if (!fs.existsSync(scriptPath)) {
      console.error(`${C.red}스크립트를 찾을 수 없습니다: ${scriptPath}${C.reset}`);
      process.exit(1);
    }

    const contFlag = cont ? ' --continue' : '';
    const cmd = IS_WIN ? `powershell -File "${scriptPath}"${contFlag}` : `"${scriptPath}"${contFlag}`;
    const modeLabel = cont ? '무한 루프 실행 (세션 연속 모드)' : '무한 루프 실행';
    console.log(`${C.cyan}${modeLabel}: ${scriptName}${C.reset}\n`);

    try {
      execSync(cmd, { stdio: 'inherit', cwd: targetDir });
    } catch (e) {
      process.exit(e.status || 1);
    }
    return;
  }

  // 1회 실행: 대시보드 모드
  runSingleWithDashboard(targetDir, cont);
}

function runSingleWithDashboard(targetDir, cont) {
  const scDir = path.join(targetDir, '.sleepcode');
  const logDir = path.join(scDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // .env 로드
  const envPath = path.join(scDir, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  }

  // Notion 동기화: pull
  if (process.env.NOTION_API_KEY && process.env.NOTION_DB_ID) {
    const py = detectPython();
    const syncScript = path.join(scDir, 'scripts', 'notion_sync.py');
    if (py && fs.existsSync(syncScript)) {
      try {
        execSync(`${py.cmd} "${syncScript}" pull`, { cwd: targetDir, stdio: 'pipe', timeout: 30000 });
      } catch {}
    }
  }

  // CLAUDE.md 동기화 (base_rules + rules → CLAUDE.md, 프롬프트 캐싱)
  syncClaudeMd(targetDir);

  // 프롬프트 구성 (tasks.md만 전달 — 규칙은 CLAUDE.md로 자동 로드됨)
  const tasksPath = path.join(scDir, 'tasks.md');
  const prompt = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';

  if (!prompt.trim()) {
    console.error(`${C.red}프롬프트가 비어있습니다. .sleepcode/ 디렉토리를 확인하세요.${C.reset}`);
    process.exit(1);
  }

  // 워커 상태
  const ws = {
    name: 'main',
    path: targetDir,
    targetDir,
    status: 'running',
    currentTask: '',
    done: 0,
    total: 0,
    cost: 0,
    reportLines: [],
    _proc: null,
    logFile: path.join(logDir, `run_${timestamp}.log`),
  };

  // 초기 태스크 수 계산
  if (fs.existsSync(tasksPath)) {
    const content = fs.readFileSync(tasksPath, 'utf-8');
    const tc = countTasks(content);
    ws.total = tc.total;
    ws.done = tc.done;
  }

  // 로그 버퍼 (리사이즈 시 재렌더링용)
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let altScreenActive = false;

  function appendLogToScreen(line) {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function pushLog(workerName, msg) {
    logBuffer.push(msg);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    appendLogToScreen(msg);
  }

  // 대시보드 렌더링
  const startTime = Date.now();
  let renderPending = false;
  const menuState = { menuIndex: 0 };
  let gracefulShutdown = false;

  function renderDashboard() {
    if (!altScreenActive) return;

    const lines = [];
    const W = 50;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`;
    const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
      : ws.status === 'done' ? `${C.green}✓${C.reset}`
      : `${C.red}✗${C.reset}`;
    const statusText = ws.status === 'running' ? '실행 중' : ws.status === 'done' ? '완료' : '실패';
    const bar = progressBar(ws.done, ws.total, 20);
    const costStr = `$${ws.cost.toFixed(4)}`;

    lines.push(`${C.dim}╭${'─'.repeat(W + 2)}╮${C.reset}`);
    lines.push(boxLine(`${SLEEPCODE_BADGE} run  ${statusIcon} ${statusText}`, W));
    lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
    lines.push(boxLine(`${bar}  ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} tasks`, W));
    if (ws.currentTask && ws.status === 'running') {
      const maxTaskW = W - 4;
      let task = ws.currentTask;
      if (visualWidth(task) > maxTaskW) {
        let tw = 0;
        let cut = 0;
        for (const ch of task) {
          const cw = visualWidth(ch);
          if (tw + cw > maxTaskW - 3) break;
          tw += cw;
          cut += ch.length;
        }
        task = task.slice(0, cut) + '...';
      }
      lines.push(boxLine(`${C.dim}> ${task}${C.reset}`, W));
    } else {
      lines.push(boxLine('', W));
    }
    lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
    lines.push(boxLine(`비용: ${costStr}  ${C.dim}·${C.reset}  경과: ${elapsedStr}`, W));
    const budgetInfo = isOverBudget(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
      lines.push(boxLine(`주간: $${budgetInfo.total.toFixed(2)}/$${budgetInfo.budget} (${pct}%) ${budgetBar}${warn}`, W));
    } else {
      lines.push(boxLine('', W));
    }

    // 메뉴
    lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
    if (gracefulShutdown) {
      lines.push(boxLine(`${C.yellow}마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`, W));
    } else {
      lines.push(renderMenuLine(menuState.menuIndex, W));
    }

    lines.push(`${C.dim}╰${'─'.repeat(W + 2)}╯${C.reset}`);
    lines.push(`${C.dim} ─── logs ${'─'.repeat(W - 7)}${C.reset}`);

    // Alternate Screen: 절대 좌표로 대시보드 렌더링
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${lines[i]}\x1b[K`);
    }
  }

  /** 이벤트 기반 렌더 요청을 200ms 디바운스로 처리 (깜빡임 방지) */
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      renderDashboard();
    }, 200);
  }

  const modeLabel = cont ? '1회 실행 (세션 연속 모드)' : '1회 실행 (대시보드 모드)';
  console.log(`${C.cyan}${modeLabel}${C.reset}`);

  // Alternate Screen 초기화
  const dashboardHeight = 12;
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[2J');
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    altScreenActive = true;
  }

  function cleanupAltScreen() {
    if (!altScreenActive) return;
    altScreenActive = false;
    process.stdout.write('\x1b[r');
    process.stdout.write('\x1b[?1049l');
  }

  process.stdout.on('resize', () => {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    const logRows = rows - dashboardHeight;
    const recentLogs = logBuffer.slice(-Math.max(0, logRows));
    for (const line of recentLogs) {
      appendLogToScreen(line);
    }
  });

  const sigintHandler = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    if (ws._proc) try { ws._proc.kill(); } catch {}
    cleanupAltScreen();
    console.log(`\n${C.yellow}중단됨${C.reset}`);
    process.exit(1);
  };
  process.on('SIGINT', sigintHandler);
  process.on('exit', cleanupAltScreen);

  // 메뉴 키 입력 핸들러
  const cleanupMenuInput = setupMenuInput(
    menuState,
    renderDashboard,
    // 마무리 후 종료: SIGINT로 현재 작업 완료 후 종료
    () => {
      if (gracefulShutdown) return;
      gracefulShutdown = true;
      pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
      if (ws._proc) try { ws._proc.kill('SIGINT'); } catch {}
      renderDashboard();
    },
    // 즉시 종료
    () => {
      if (cleanupMenuInput) cleanupMenuInput();
      if (ws._proc) try { ws._proc.kill(); } catch {}
      cleanupAltScreen();
      console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
      process.exit(0);
    }
  );

  renderDashboard();

  const dashboardInterval = setInterval(renderDashboard, 3000);

  // 예산 체크 타이머
  const budgetCheckInterval = setInterval(() => {
    const result = isOverBudget(targetDir);
    if (result && result.over) {
      pushLog(ws.name, `${C.yellow}주간 한도 도달 — 중지${C.reset}`);
      ws.status = 'budget_stop';
      ws.currentTask = '한도 도달 — 중지됨';
      if (ws._proc) try { ws._proc.kill(); } catch {}
      renderDashboard();
    }
  }, 30000);

  function onDone() {
    clearInterval(dashboardInterval);
    clearInterval(budgetCheckInterval);
    renderDashboard();
    if (cleanupMenuInput) cleanupMenuInput();
    process.removeListener('SIGINT', sigintHandler);
    cleanupAltScreen();

    // Notion 동기화: push + 보고 기록
    if (process.env.NOTION_API_KEY && process.env.NOTION_DB_ID) {
      const py = detectPython();
      const syncScript = path.join(scDir, 'scripts', 'notion_sync.py');
      if (py && fs.existsSync(syncScript)) {
        try {
          execSync(`${py.cmd} "${syncScript}" push`, { cwd: targetDir, stdio: 'pipe', timeout: 30000 });
        } catch {}

        // AI 보고 내용을 Notion 페이지 본문에 기록
        if (ws.reportLines && ws.reportLines.length > 0) {
          const reportText = ws.reportLines.join('\n');
          if (reportText.trim()) {
            const tasksContent = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';
            const notionPattern = /<!-- notion:([a-f0-9-]+) -->/g;
            let nm;
            while ((nm = notionPattern.exec(tasksContent)) !== null) {
              try {
                execSync(`${py.cmd} "${syncScript}" append-content "${nm[1]}"`, {
                  input: reportText,
                  cwd: targetDir,
                  stdio: ['pipe', 'pipe', 'pipe'],
                  timeout: 60000,
                  env: process.env,
                });
              } catch {}
            }
          }
        }
      }
    }

    if (ws.status === 'done') {
      console.log(`\n${C.green}실행 완료${C.reset} — 비용: $${ws.cost.toFixed(4)}`);
    } else {
      console.log(`\n${C.red}실행 실패${C.reset}`);
      process.exit(1);
    }
  }

  // claude 프로세스 실행
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const claudeArgs = [];
  if (cont) {
    claudeArgs.push('--continue');
  }
  claudeArgs.push('-p', '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose');

  const claudeProc = spawn('claude', claudeArgs, {
    cwd: targetDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });

  ws._proc = claudeProc;

  // --continue 모드에서는 간결한 프롬프트 전달
  const stdinPrompt = cont ? '다음 태스크를 진행하세요.' : prompt;
  claudeProc.stdin.write(stdinPrompt);
  claudeProc.stdin.end();

  // 로그 파일
  const logStream = fs.createWriteStream(ws.logFile, { flags: 'a' });
  logStream.write(`[${new Date().toISOString()}] === Run 시작 ===\n`);

  // stdout 파싱
  let buffer = '';
  claudeProc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      logStream.write(line + '\n');

      try {
        const obj = JSON.parse(line);
        processStreamEvent(ws, obj, scheduleRender, pushLog);
      } catch {}
    }
  });

  claudeProc.stderr.on('data', (data) => {
    logStream.write(`[STDERR] ${data.toString()}`);
  });

  claudeProc.on('close', (code) => {
    logStream.write(`[${new Date().toISOString()}] === Run 종료 (code: ${code}) ===\n`);
    logStream.end();

    // 최종 태스크 상태 갱신
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const tc = countTasks(content);
      ws.done = tc.done;
      ws.total = tc.total;
    }

    ws.status = (code === 0) ? 'done' : 'failed';
    ws.currentTask = '';
    onDone();
  });

  claudeProc.on('error', (err) => {
    logStream.write(`ERROR: ${err.message}\n`);
    logStream.end();
    ws.status = 'failed';
    ws.currentTask = err.message;
    onDone();
  });
}

// ─── Watch 모드 (Notion 제어판) ───

function cmdWatch() {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // .env 로드
  const envPath = path.join(scDir, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  }

  // CLI 인자로 Notion 설정 오버라이드
  const cliArgs = parseArgs();
  if (cliArgs.notionKey) process.env.NOTION_API_KEY = cliArgs.notionKey;
  if (cliArgs.notionDb) process.env.NOTION_DB_ID = parseNotionDbId(cliArgs.notionDb);
  if (cliArgs.notionFilter) process.env.NOTION_FILTER = cliArgs.notionFilter;

  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DB_ID;

  if (!apiKey || !dbId) {
    console.error(`${C.red}Notion API Key와 DB ID가 필요합니다.${C.reset}`);
    console.log(`\n  ${C.cyan}npx sleepcode watch --notion-key <KEY> --notion-db <DB_ID>${C.reset}`);
    console.log(`  ${C.dim}또는 .sleepcode/.env에 NOTION_API_KEY, NOTION_DB_ID를 설정하세요.${C.reset}`);
    process.exit(1);
  }

  const py = detectPython();
  if (!py) {
    console.error(`${C.red}python3이 필요합니다.${C.reset}`);
    process.exit(1);
  }

  // notion_sync.py 확인 (없으면 templates에서 복사)
  const syncScript = path.join(scDir, 'scripts', 'notion_sync.py');
  if (!fs.existsSync(syncScript)) {
    const src = path.join(TEMPLATES_DIR, 'common', 'notion_sync.py');
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(syncScript), { recursive: true });
      fs.writeFileSync(syncScript, fs.readFileSync(src, 'utf-8').replace(/\r\n/g, '\n'));
      if (!IS_WIN) fs.chmodSync(syncScript, 0o755);
    } else {
      console.error(`${C.red}notion_sync.py를 찾을 수 없습니다.${C.reset}`);
      process.exit(1);
    }
  }

  const pollIntervalSec = parseInt(cliArgs.interval || '30', 10);
  const pollIntervalMs = pollIntervalSec * 1000;
  const logDir = path.join(scDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  let isExecuting = false;
  let executingTaskIds = new Set(); // 현재 실행 중인 Notion task ID들
  let currentSchema = null; // 현재 실행에서 사용 중인 schema
  let currentNotionTasks = []; // 현재 실행 중인 Notion task 목록 (finishExecution에서 참조)

  // ─── 대시보드 상태 ───
  let watchPhase = 'waiting'; // 'waiting' | 'executing'
  let pollInfo = { total: 0, pending: 0 };
  let lastPollTime = null;
  let currentWorkerStates = [];
  let execStartTime = null;
  let currentDashboardHeight = 11;
  const menuState = { menuIndex: 0 };
  let gracefulShutdown = false;

  // 로그 버퍼 (리사이즈 시 재렌더링용)
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let altScreenActive = false;

  function getDashboardHeight() {
    if (watchPhase !== 'executing' || currentWorkerStates.length === 0) return 11;
    if (currentWorkerStates.length === 1) return 12;
    return 9 + currentWorkerStates.length * 2;
  }

  function appendLogToScreen(line) {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function watchPushLog(name, msg) {
    const t = new Date().toLocaleTimeString();
    const formatted = name && name !== 'SYSTEM'
      ? `${C.dim}[${t}] [${name}]${C.reset} ${msg}`
      : `${C.dim}[${t}]${C.reset} ${msg}`;
    logBuffer.push(formatted);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    appendLogToScreen(formatted);
  }

  let renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      renderDashboard();
    }, 200);
  }

  function renderDashboard() {
    if (!altScreenActive) return;

    const lines = [];
    const W = 50;

    lines.push(`${C.dim}╭${'─'.repeat(W + 2)}╮${C.reset}`);

    if (watchPhase === 'executing' && currentWorkerStates.length > 0) {
      const useParallel = currentWorkerStates.length > 1;

      if (useParallel) {
        const activeCount = currentWorkerStates.filter(w => w.status === 'running').length;
        lines.push(boxLine(`${SLEEPCODE_BADGE} watch  ${C.cyan}⟳${C.reset} ${activeCount}/${currentWorkerStates.length} workers`, W));
        lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);

        for (const ws of currentWorkerStates) {
          const bar = progressBar(ws.done, ws.total, 15);
          const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
            : ws.status === 'done' ? `${C.green}✓${C.reset}`
            : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
            : `${C.red}✗${C.reset}`;
          lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(ws.name, 18)}${C.reset} ${bar} ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)}`, W));
          if (ws.currentTask && ws.status === 'running') {
            const maxTaskW = W - 6;
            let task = ws.currentTask;
            if (visualWidth(task) > maxTaskW) {
              let tw = 0, cut = 0;
              for (const ch of task) {
                const cw = visualWidth(ch);
                if (tw + cw > maxTaskW - 3) break;
                tw += cw;
                cut += ch.length;
              }
              task = task.slice(0, cut) + '...';
            }
            lines.push(boxLine(`  ${C.dim}> ${task}${C.reset}`, W));
          } else {
            lines.push(boxLine('', W));
          }
        }
      } else {
        const ws = currentWorkerStates[0];
        const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
          : ws.status === 'done' ? `${C.green}✓${C.reset}`
          : `${C.red}✗${C.reset}`;
        const statusText = ws.status === 'running' ? '실행 중' : ws.status === 'done' ? '완료' : '실패';
        lines.push(boxLine(`${SLEEPCODE_BADGE} watch  ${statusIcon} ${statusText}`, W));
        lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);

        const bar = progressBar(ws.done, ws.total, 20);
        lines.push(boxLine(`${bar}  ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} tasks`, W));
        if (ws.currentTask && ws.status === 'running') {
          const maxTaskW = W - 4;
          let task = ws.currentTask;
          if (visualWidth(task) > maxTaskW) {
            let tw = 0, cut = 0;
            for (const ch of task) {
              const cw = visualWidth(ch);
              if (tw + cw > maxTaskW - 3) break;
              tw += cw;
              cut += ch.length;
            }
            task = task.slice(0, cut) + '...';
          }
          lines.push(boxLine(`${C.dim}> ${task}${C.reset}`, W));
        } else {
          lines.push(boxLine('', W));
        }
      }

      lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);

      const totalCost = currentWorkerStates.reduce((s, w) => s + (w.cost || 0), 0);
      const costStr = `$${totalCost.toFixed(4)}`;
      const elapsed = execStartTime ? Math.floor((Date.now() - execStartTime) / 1000) : 0;
      const elapsedStr = elapsed >= 3600
        ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
        : elapsed >= 60
          ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
          : `${elapsed}s`;
      lines.push(boxLine(`비용: ${costStr}  ${C.dim}·${C.reset}  경과: ${elapsedStr}`, W));
    } else {
      // Waiting mode
      lines.push(boxLine(`${SLEEPCODE_BADGE} watch  ${C.dim}◆${C.reset} 대기 중`, W));
      lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
      const remaining = lastPollTime ? Math.max(0, pollIntervalSec - Math.floor((Date.now() - lastPollTime) / 1000)) : pollIntervalSec;
      lines.push(boxLine(`DB: ${dbId.slice(0, 8)}...  ${C.dim}·${C.reset}  다음 폴링: ${remaining}초`, W));
      lines.push(boxLine(`전체: ${pollInfo.total}  ${C.dim}·${C.reset}  대기: ${pollInfo.pending}`, W));
      lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
    }

    const budgetInfo = isOverBudget(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
      lines.push(boxLine(`주간: $${budgetInfo.total.toFixed(2)}/$${budgetInfo.budget} (${pct}%) ${budgetBar}${warn}`, W));
    } else {
      lines.push(boxLine('', W));
    }

    // 메뉴
    lines.push(`${C.dim}├${'─'.repeat(W + 2)}┤${C.reset}`);
    if (gracefulShutdown) {
      lines.push(boxLine(`${C.yellow}마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`, W));
    } else {
      lines.push(renderMenuLine(menuState.menuIndex, W));
    }

    lines.push(`${C.dim}╰${'─'.repeat(W + 2)}╯${C.reset}`);
    lines.push(`${C.dim} ─── logs ${'─'.repeat(W - 7)}${C.reset}`);

    // Alternate Screen: 절대 좌표로 대시보드 렌더링
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${lines[i]}\x1b[K`);
    }
  }

  function setWatchPhase(newPhase) {
    watchPhase = newPhase;
    if (!altScreenActive) return;
    currentDashboardHeight = getDashboardHeight();
    const rows = process.stdout.rows || 24;
    if (rows > currentDashboardHeight) {
      process.stdout.write(`\x1b[${currentDashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    const logRows = rows - currentDashboardHeight;
    const recentLogs = logBuffer.slice(-Math.max(0, logRows));
    for (const line of recentLogs) {
      appendLogToScreen(line);
    }
  }

  // Alternate Screen 초기화
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[2J');
    currentDashboardHeight = getDashboardHeight();
    const rows = process.stdout.rows || 24;
    if (rows > currentDashboardHeight) {
      process.stdout.write(`\x1b[${currentDashboardHeight + 1};${rows}r`);
    }
    altScreenActive = true;
  }

  function cleanupAltScreen() {
    if (!altScreenActive) return;
    altScreenActive = false;
    process.stdout.write('\x1b[r');
    process.stdout.write('\x1b[?1049l');
  }

  process.stdout.on('resize', () => {
    if (!altScreenActive) return;
    currentDashboardHeight = getDashboardHeight();
    const rows = process.stdout.rows || 24;
    if (rows > currentDashboardHeight) {
      process.stdout.write(`\x1b[${currentDashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    const logRows = rows - currentDashboardHeight;
    const recentLogs = logBuffer.slice(-Math.max(0, logRows));
    for (const line of recentLogs) {
      appendLogToScreen(line);
    }
  });

  renderDashboard();

  // ─── Notion API 헬퍼 ───

  function notionPoll() {
    try {
      const result = execSync(`${py.cmd} "${syncScript}" poll`, {
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
        env: process.env,
      }).toString().trim();
      return JSON.parse(result);
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString().trim() : '';
      return { error: 'poll_failed', message: stderr || e.message || 'unknown error' };
    }
  }

  function notionUpdatePage(pageId, props) {
    try {
      execSync(`${py.cmd} "${syncScript}" update-page "${pageId}"`, {
        input: JSON.stringify(props),
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        env: process.env,
      });
      return true;
    } catch {
      return false;
    }
  }

  function buildStatusProps(schema, statusValue) {
    if (!schema.status_prop) return null;
    if (schema.status_type === 'status') {
      return { [schema.status_prop]: { status: { name: statusValue } } };
    } else if (schema.status_type === 'select') {
      return { [schema.status_prop]: { select: { name: statusValue } } };
    }
    return null;
  }

  // ─── 태스크 실행 ───

  function executeNotionTasks(tasks, schema) {
    isExecuting = true;
    execStartTime = Date.now();
    currentSchema = schema;
    currentNotionTasks = [...tasks];
    executingTaskIds = new Set(tasks.map(t => t.id));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // 워커 그룹핑
    const workerGroups = {};
    for (const task of tasks) {
      const rawWorker = (task.worker || '').trim();
      const workerKey = rawWorker.replace(/^@worker\s*/i, '').trim() || 'main';
      if (!workerGroups[workerKey]) workerGroups[workerKey] = [];
      workerGroups[workerKey].push(task);
    }

    const workerNames = Object.keys(workerGroups);
    const useParallel = workerNames.length > 1 ||
      (workerNames.length === 1 && workerNames[0] !== 'main');

    watchPushLog('SYSTEM', `${C.bold}▶ ${tasks.length}개 태스크 실행 시작${C.reset}`);

    // Notion 상태: In Progress + Run 해제
    for (const task of tasks) {
      const props = {};
      const sp = buildStatusProps(schema, 'In Progress');
      if (sp) Object.assign(props, sp);
      if (schema.run_prop) props[schema.run_prop] = { checkbox: false };
      if (Object.keys(props).length > 0) notionUpdatePage(task.id, props);
    }

    // tasks.md 생성
    const tasksPath = path.join(scDir, 'tasks.md');

    if (useParallel) {
      watchPushLog('SYSTEM', `${C.cyan}병렬 모드${C.reset}: ${workerNames.join(', ')}`);
      const lines = ['# 작업 목록\n'];
      for (const [worker, wTasks] of Object.entries(workerGroups)) {
        lines.push(`## @worker ${worker}`);
        for (const t of wTasks) {
          lines.push(`- [ ] ${t.title} <!-- notion:${t.id} -->`);
        }
        lines.push('');
      }
      fs.writeFileSync(tasksPath, lines.join('\n'));

      syncClaudeMd(targetDir);
      const workers = parseParallelTasks(tasksPath);
      if (!workers || workers.length === 0) {
        finishExecution(tasks, schema, []);
        return;
      }
      const created = createWorktrees(targetDir, workers);
      if (created.length === 0) {
        finishExecution(tasks, schema, []);
        return;
      }

      // 워커 상태 생성
      const workerStates = created.map(w => ({
        ...w,
        targetDir,
        status: 'running',
        currentTask: '',
        done: 0,
        total: 0,
        cost: 0,
        reportLines: [],
        _proc: null,
        logFile: path.join(logDir, `watch_${w.name}_${timestamp}.log`),
      }));

      for (const ws of workerStates) {
        const tp = path.join(ws.path, '.sleepcode', 'tasks.md');
        if (fs.existsSync(tp)) {
          const tc = countTasks(fs.readFileSync(tp, 'utf-8'));
          ws.total = tc.total;
          ws.done = tc.done;
        }
      }

      // 대시보드를 실행 모드로 전환
      currentWorkerStates = workerStates;
      setWatchPhase('executing');

      function onWorkerDone() {
        scheduleRender();
        const allDone = currentWorkerStates.every(s => s.status !== 'running');
        if (allDone) {
          finishExecution(currentNotionTasks, currentSchema, currentWorkerStates);
        }
      }

      for (const ws of workerStates) {
        spawnWorker(ws, py, onWorkerDone, scheduleRender, watchPushLog);
      }
    } else {
      // 단일 모드
      const allTasks = Object.values(workerGroups).flat();
      watchPushLog('SYSTEM', `${C.cyan}단일 모드${C.reset}: ${allTasks.length}개 태스크`);
      const lines = ['# 작업 목록\n', '아래 태스크를 순서대로 진행하세요.\n', '---\n'];
      for (const t of allTasks) {
        lines.push(`- [ ] ${t.title} <!-- notion:${t.id} -->`);
      }
      fs.writeFileSync(tasksPath, lines.join('\n') + '\n');

      syncClaudeMd(targetDir);

      const ws = {
        name: 'main',
        path: targetDir,
        targetDir,
        status: 'running',
        currentTask: '',
        done: 0,
        total: 0,
        cost: 0,
        reportLines: [],
        _proc: null,
        logFile: path.join(logDir, `watch_main_${timestamp}.log`),
      };

      const tc = countTasks(fs.readFileSync(tasksPath, 'utf-8'));
      ws.total = tc.total;
      ws.done = tc.done;

      // 대시보드를 실행 모드로 전환
      currentWorkerStates = [ws];
      setWatchPhase('executing');

      spawnWorker(ws, py, () => {
        const allDone = currentWorkerStates.every(s => s.status !== 'running');
        if (allDone) {
          finishExecution(currentNotionTasks, currentSchema, currentWorkerStates);
        }
      }, scheduleRender, watchPushLog);
    }
  }

  function finishExecution(notionTasks, schema, workerStates) {
    watchPushLog('SYSTEM', `${C.bold}실행 완료 — Notion 업데이트${C.reset}`);

    // tasks.md에서 완료 상태 확인 (notion page ID 매칭)
    const taskCompletion = {};
    const workerPaths = (workerStates && workerStates.length > 0)
      ? workerStates.map(ws => ws.path)
      : [targetDir];

    for (const wsPath of workerPaths) {
      const tp = path.join(wsPath, '.sleepcode', 'tasks.md');
      if (!fs.existsSync(tp)) continue;
      const content = fs.readFileSync(tp, 'utf-8');
      const pattern = /^- \[([ x])\] .+<!-- notion:([a-f0-9-]+) -->/gm;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        taskCompletion[match[2]] = match[1] === 'x';
      }
    }

    // 총 비용
    const totalCost = (workerStates && workerStates.length > 0)
      ? workerStates.reduce((s, ws) => s + (ws.cost || 0), 0)
      : 0;

    // Notion 업데이트
    for (const task of notionTasks) {
      const isDone = taskCompletion[task.id] || false;
      const newStatus = isDone ? 'Done' : 'Failed';
      const props = {};

      const sp = buildStatusProps(schema, newStatus);
      if (sp) Object.assign(props, sp);

      if (schema.cost_prop && totalCost > 0) {
        const perTaskCost = totalCost / notionTasks.length;
        props[schema.cost_prop] = { number: Math.round(perTaskCost * 10000) / 10000 };
      }

      if (schema.completed_at_prop && isDone) {
        const now = new Date();
        const kstOffset = 9 * 60 * 60 * 1000;
        const kst = new Date(now.getTime() + kstOffset);
        const isoStr = kst.toISOString().replace('Z', '+09:00');
        props[schema.completed_at_prop] = {
          date: { start: isoStr },
        };
      }

      if (schema.log_prop) {
        const logText = isDone
          ? `완료 ($${(totalCost / notionTasks.length).toFixed(4)})`
          : '실행 실패';
        props[schema.log_prop] = {
          rich_text: [{ text: { content: logText } }],
        };
      }

      if (Object.keys(props).length > 0) {
        notionUpdatePage(task.id, props);
      }

      const icon = isDone ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
      watchPushLog('SYSTEM', `${icon} ${task.title} → ${newStatus}`);
    }

    // AI 보고 내용을 Notion 페이지 본문에 기록
    const reportText = (workerStates && workerStates.length > 0)
      ? workerStates.map(ws => (ws.reportLines || []).join('\n')).filter(t => t.trim()).join('\n\n---\n\n')
      : '';

    if (reportText.trim()) {
      for (const task of notionTasks) {
        try {
          execSync(`${py.cmd} "${syncScript}" append-content "${task.id}"`, {
            input: reportText,
            cwd: targetDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 60000,
            env: process.env,
          });
        } catch {}
      }
      watchPushLog('SYSTEM', `${C.dim}Notion 페이지에 보고 기록 완료${C.reset}`);
    }

    // 비용 기록
    if (totalCost > 0) {
      recordCost(targetDir, totalCost, 'watch');
    }

    // 병렬 실행 후 자동 머지 및 워크트리 정리
    if (workerStates && workerStates.length > 1) {
      watchPushLog('SYSTEM', `${C.bold}자동 머지 시작${C.reset}`);
      try {
        const mergeResults = autoMergeWorktrees(targetDir, workerStates);
        if (mergeResults.merged.length > 0) {
          watchPushLog('SYSTEM', `${C.green}머지 성공: ${mergeResults.merged.join(', ')}${C.reset}`);
        }
        if (mergeResults.conflicted.length > 0) {
          watchPushLog('SYSTEM', `${C.red}머지 충돌: ${mergeResults.conflicted.join(', ')} (수동 머지 필요)${C.reset}`);
        }
        if (mergeResults.skipped.length > 0) {
          watchPushLog('SYSTEM', `${C.dim}머지 스킵: ${mergeResults.skipped.join(', ')}${C.reset}`);
        }
      } catch (e) {
        watchPushLog('SYSTEM', `${C.red}자동 머지 실패: ${e.message}${C.reset}`);
      }

      watchPushLog('SYSTEM', `${C.bold}워크트리 정리${C.reset}`);
      try {
        cleanupWorktrees(targetDir, null);
        watchPushLog('SYSTEM', `${C.green}워크트리 정리 완료${C.reset}`);
      } catch (e) {
        watchPushLog('SYSTEM', `${C.red}워크트리 정리 실패: ${e.message}${C.reset}`);
      }
    }

    isExecuting = false;
    executingTaskIds = new Set();
    currentSchema = null;
    currentNotionTasks = [];
    currentWorkerStates = [];
    execStartTime = null;
    setWatchPhase('waiting');
    watchPushLog('SYSTEM', `${C.dim}폴링 재개...${C.reset}`);
  }

  // ─── 실행 중 새 태스크 추가 ───

  function addTasksDuringExecution(newTasks, schema) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // 새 태스크 ID 등록
    for (const task of newTasks) {
      executingTaskIds.add(task.id);
      currentNotionTasks.push(task);
    }

    // Notion 상태: In Progress + Run 해제
    for (const task of newTasks) {
      const props = {};
      const sp = buildStatusProps(schema, 'In Progress');
      if (sp) Object.assign(props, sp);
      if (schema.run_prop) props[schema.run_prop] = { checkbox: false };
      if (Object.keys(props).length > 0) notionUpdatePage(task.id, props);
    }

    // 새 태스크에 worker가 설정된 것이 있는지 확인
    const hasWorker = newTasks.some(t => (t.worker || '').trim());

    if (hasWorker) {
      // worker가 설정된 태스크 → 병렬 모드로 새 워커 spawn
      const workerGroups = {};
      for (const task of newTasks) {
        const rawWorker = (task.worker || '').trim();
        const workerKey = rawWorker.replace(/^@worker\s*/i, '').trim() || 'main';
        if (!workerGroups[workerKey]) workerGroups[workerKey] = [];
        workerGroups[workerKey].push(task);
      }

      for (const [workerName, wTasks] of Object.entries(workerGroups)) {
        // 이미 같은 이름의 워커가 실행 중인지 확인
        const existingWorker = currentWorkerStates.find(
          ws => ws.name === workerName && ws.status === 'running'
        );

        if (existingWorker) {
          // 기존 실행 중인 워커의 tasks.md에 태스크 추가
          const tp = path.join(existingWorker.path, '.sleepcode', 'tasks.md');
          if (fs.existsSync(tp)) {
            let content = fs.readFileSync(tp, 'utf-8');
            const newLines = wTasks.map(t => `- [ ] ${t.title} <!-- notion:${t.id} -->`).join('\n');
            content = content.trimEnd() + '\n' + newLines + '\n';
            fs.writeFileSync(tp, content);
            const tc = countTasks(content);
            existingWorker.total = tc.total;
            existingWorker.done = tc.done;
            watchPushLog('SYSTEM', `${C.cyan}+${wTasks.length}${C.reset} 태스크 → ${C.bold}${workerName}${C.reset} (기존 워커에 추가)`);
          }
        } else {
          // 새 워커 생성 (worktree 기반)
          const workerTaskLines = ['# 작업 목록\n', '아래 태스크를 순서대로 진행하세요.\n', '---\n'];
          for (const t of wTasks) {
            workerTaskLines.push(`- [ ] ${t.title} <!-- notion:${t.id} -->`);
          }
          const workerTaskContent = workerTaskLines.join('\n') + '\n';

          // worktree용 tasks.md 작성 (임시로 main의 tasks.md에 @worker 섹션 추가)
          const tempWorkers = [{ name: workerName, tasks: workerTaskContent, remaining: wTasks.length }];
          const created = createWorktrees(targetDir, tempWorkers);

          if (created.length > 0) {
            const w = created[0];
            const ws = {
              ...w,
              targetDir,
              status: 'running',
              currentTask: '',
              done: 0,
              total: wTasks.length,
              cost: 0,
              reportLines: [],
              _proc: null,
              logFile: path.join(path.join(scDir, 'logs'), `watch_${w.name}_${timestamp}.log`),
            };

            currentWorkerStates.push(ws);
            setWatchPhase('executing');

            watchPushLog('SYSTEM', `${C.green}+${C.reset} 새 워커 ${C.bold}${workerName}${C.reset} spawn (${wTasks.length}개 태스크)`);

            spawnWorker(ws, py, () => {
              // 워커 완료 시: 모든 워커가 끝났는지 확인
              const allDone = currentWorkerStates.every(s => s.status !== 'running');
              scheduleRender();
              if (allDone) {
                finishExecution(currentNotionTasks, currentSchema, currentWorkerStates);
              }
            }, scheduleRender, watchPushLog);
          }
        }
      }
    } else {
      // worker 없는 태스크 → 단일 모드의 main 워커 tasks.md에 추가
      const mainWorker = currentWorkerStates.find(ws => ws.name === 'main' && ws.status === 'running');
      if (mainWorker) {
        const tp = path.join(mainWorker.path, '.sleepcode', 'tasks.md');
        if (fs.existsSync(tp)) {
          let content = fs.readFileSync(tp, 'utf-8');
          const newLines = newTasks.map(t => `- [ ] ${t.title} <!-- notion:${t.id} -->`).join('\n');
          content = content.trimEnd() + '\n' + newLines + '\n';
          fs.writeFileSync(tp, content);
          const tc = countTasks(content);
          mainWorker.total = tc.total;
          mainWorker.done = tc.done;
          watchPushLog('SYSTEM', `${C.cyan}+${newTasks.length}${C.reset} 태스크 대기열에 추가`);
        }
      }
    }

    scheduleRender();
  }

  // ─── 폴링 루프 ───

  function doPoll() {
    lastPollTime = Date.now();

    // graceful_stop 체크
    if (fs.existsSync(path.join(scDir, 'graceful_stop'))) {
      cleanupAltScreen();
      console.log(`\n${C.yellow}graceful_stop 감지 — watch 종료${C.reset}`);
      process.exit(0);
    }

    // 예산 체크
    const budgetCheck = isOverBudget(targetDir);
    if (budgetCheck && budgetCheck.over) {
      watchPushLog('SYSTEM', `${C.yellow}주간 한도 도달 — 대기${C.reset}`);
      renderDashboard();
      return;
    }

    const data = notionPoll();

    if (!data || data.error) {
      const errMsg = data && data.message ? `: ${data.message}` : '';
      watchPushLog('SYSTEM', `${C.red}폴링 실패${errMsg}${C.reset}`);
      return;
    }

    const schema = data.schema;

    // 폴링 정보 업데이트
    const total = data.tasks.length;
    const pending = data.tasks.filter(t => {
      const s = (t.status || '').toLowerCase();
      return ['to do', '할 일', '', 'not started'].includes(s);
    }).length;
    pollInfo = { total, pending };

    // 실행할 태스크 찾기
    let tasksToRun = [];

    // 1. Run 체크박스가 true인 태스크
    if (schema.run_prop) {
      tasksToRun = data.tasks.filter(t => {
        if (!t.run) return false;
        const status = (t.status || '').toLowerCase();
        return !['in progress', '진행 중'].includes(status);
      });
    }

    // 2. Run 프로퍼티 없으면 Status == "Start" 또는 "시작"인 태스크
    if (tasksToRun.length === 0 && !schema.run_prop) {
      tasksToRun = data.tasks.filter(t => {
        const status = (t.status || '').toLowerCase();
        return status === 'start' || status === '시작';
      });
    }

    // 실행 중일 때: 새로 추가된 태스크만 필터링하여 대기열에 추가
    if (isExecuting) {
      const newTasks = tasksToRun.filter(t => !executingTaskIds.has(t.id));
      if (newTasks.length > 0) {
        addTasksDuringExecution(newTasks, schema);
      }
      renderDashboard();
      return;
    }

    if (tasksToRun.length > 0) {
      executeNotionTasks(tasksToRun, schema);
    } else {
      renderDashboard();
    }
  }

  // 대시보드 갱신 타이머 (카운트다운을 위해 1초 간격)
  const dashboardInterval = setInterval(renderDashboard, 1000);

  // 초기 폴링
  doPoll();

  // 주기적 폴링
  const pollTimer = setInterval(doPoll, pollIntervalMs);

  // 메뉴 키 입력 핸들러
  const cleanupMenuInput = setupMenuInput(
    menuState,
    renderDashboard,
    // 마무리 후 종료
    () => {
      if (gracefulShutdown) return;
      gracefulShutdown = true;
      watchPushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
      clearInterval(pollTimer);
      for (const ws of currentWorkerStates) {
        if (ws.status === 'running' && ws._proc) {
          try { ws._proc.kill('SIGINT'); } catch {}
        }
      }
      renderDashboard();
    },
    // 즉시 종료
    () => {
      if (cleanupMenuInput) cleanupMenuInput();
      clearInterval(pollTimer);
      clearInterval(dashboardInterval);
      for (const ws of currentWorkerStates) {
        if (ws._proc) try { ws._proc.kill(); } catch {}
      }
      cleanupAltScreen();
      console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
      process.exit(0);
    }
  );

  // 종료 핸들러
  const sigintHandler = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    clearInterval(pollTimer);
    clearInterval(dashboardInterval);
    // 실행 중인 워커 프로세스 종료
    for (const ws of currentWorkerStates) {
      if (ws._proc) try { ws._proc.kill(); } catch {}
    }
    cleanupAltScreen();
    console.log(`\n${C.yellow}watch 종료${C.reset}`);
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);
  process.on('exit', cleanupAltScreen);
}

// ─── 태스크 자동 생성 ───
function generateTasks() {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // claude CLI 확인
  if (!checkCommand('claude --version')) {
    console.error(`${C.red}claude CLI가 설치되어 있지 않습니다.${C.reset}`);
    process.exit(1);
  }

  // sources.json 상태 표시
  const sources = loadSources(targetDir);
  if (sources) {
    const n = (sources.notion || []).length;
    const f = (sources.figma || []).length;
    const u = (sources.urls || []).length;
    const total = n + f + u;
    if (total > 0) {
      console.log(`${C.dim}참고자료: Notion ${n}개, Figma ${f}개, URL ${u}개 (sources.json)${C.reset}`);
    }
  }

  console.log(`${C.cyan}태스크 자동 생성 중...${C.reset}\n`);

  // 참고 자료 수집
  const parts = [];

  // 1. base_rules.md (프로젝트 공통 규칙 — 역할 파악용)
  const baseRulesPath = path.join(scDir, 'scripts', 'base_rules.md');
  if (fs.existsSync(baseRulesPath)) {
    parts.push(fs.readFileSync(baseRulesPath, 'utf-8'));
  }

  // 2. rules.md (프로젝트별 역할/작업방식)
  const rulesPath = path.join(scDir, 'rules.md');
  if (fs.existsSync(rulesPath)) {
    parts.push(fs.readFileSync(rulesPath, 'utf-8'));
  }

  // 3. docs/ 디렉토리 파일 목록 + 내용
  const docsDir = path.join(scDir, 'docs');
  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).filter(f => f !== '.gitkeep');
    for (const file of files) {
      const filePath = path.join(docsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.size < 100000) {
        // 텍스트 파일만 읽기 (이미지 등은 파일명만)
        const ext = path.extname(file).toLowerCase();
        if (['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.html'].includes(ext)) {
          parts.push(`--- docs/${file} ---\n${fs.readFileSync(filePath, 'utf-8')}`);
        } else {
          parts.push(`--- docs/${file} --- (파일 존재, 내용은 직접 참고)`);
        }
      }
    }
  }

  // 4. 현재 프로젝트 구조 (이미 구현된 것 파악용)
  try {
    const tree = execSync('git ls-files', { cwd: targetDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 })
      .toString().trim();
    if (tree) {
      parts.push(`--- 현재 프로젝트 파일 목록 (이미 구현됨) ---\n${tree}`);
    }
  } catch {
    // git이 없거나 실패하면 무시
  }

  // 5. sources.json (참고자료 URL)
  const sourceContents = fetchSourceContents(targetDir);
  if (sourceContents) {
    parts.push(sourceContents);
  }

  // 6. 기존 tasks.md (있으면 참고)
  const tasksPath = path.join(scDir, 'tasks.md');
  if (fs.existsSync(tasksPath)) {
    const existing = fs.readFileSync(tasksPath, 'utf-8');
    if (existing.includes('[ ]') || existing.includes('[x]')) {
      parts.push(`--- 기존 tasks.md ---\n${existing}`);
    }
  }

  // 프롬프트 구성
  const context = parts.join('\n\n---\n\n');
  const prompt = `${context}

---

위 프로젝트 정보와 참고 자료를 바탕으로 .sleepcode/tasks.md 파일을 생성해주세요.

규칙:
- 마크다운 체크리스트 형식으로 작성: \`- [ ] 태스크 내용\`
- 구체적이고 실행 가능한 단위로 태스크를 나눌 것
- 태스크 순서는 의존성을 고려하여 배치
- Figma 디자인 URL이 있으면 Figma MCP 도구로 디자인을 조회하여 UI 구현 태스크 포함
- Notion 페이지 URL이 있으면 Notion MCP 도구로 페이지를 조회하여 기획 내용을 반영
- 참고 URL이 있으면 WebFetch 도구로 내용을 가져와 반영
- docs/ 폴더의 참고 자료를 반영
- **이미 프로젝트에 구현되어 있는 기능은 태스크에 포함하지 않는다**
- 현재 프로젝트 파일 목록을 분석하여 아직 구현되지 않은 것만 태스크로 작성
- 첫 줄은 \`# 작업 목록\` 으로 시작
- 태스크 목록 앞에 간단한 안내 문구 포함

tasks.md 내용만 출력하세요. 다른 설명은 하지 마세요.`;

  // claude 중첩 세션 방지: CLAUDECODE 환경변수 제거
  const env = { ...process.env };
  delete env.CLAUDECODE;

  try {
    const result = execSync(
      'claude -p --output-format text',
      {
        input: prompt,
        cwd: targetDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000,
        maxBuffer: 1024 * 1024,
      }
    ).toString().trim();

    // tasks.md에 저장
    fs.writeFileSync(tasksPath, result + '\n');
    console.log(`${C.green}✓${C.reset} .sleepcode/tasks.md 생성 완료\n`);
    console.log(`${C.dim}${result}${C.reset}\n`);
    console.log(`필요하면 tasks.md를 직접 수정한 뒤 실행하세요:`);
    console.log(`  ${C.cyan}npx sleepcode run${C.reset}          ${C.dim}# 1회 실행${C.reset}`);
    console.log(`  ${C.cyan}npx sleepcode run --loop${C.reset}   ${C.dim}# 무한 루프${C.reset}`);
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.error(`${C.red}태스크 생성 실패:${C.reset}`);
    if (stderr) console.error(stderr);
    else console.error(e.message);
    process.exit(1);
  }
}

// ─── 메인 ───
async function main() {
  const targetDir = process.cwd();

  // 서브커맨드 처리
  const firstArg = process.argv[2];
  if (firstArg === 'help') {
    showHelp();
    return;
  }
  if (firstArg === 'version') {
    showVersion();
    return;
  }
  if (firstArg === 'run') {
    const loop = process.argv.includes('--loop');
    const cont = process.argv.includes('--continue') || process.argv.includes('-c');
    runWorker(loop, cont);
    return;
  }
  if (firstArg === 'generate') {
    generateTasks();
    return;
  }
  if (firstArg === 'sources') {
    showSources();
    return;
  }
  if (firstArg === 'parallel') {
    const subArgs = process.argv.slice(3);
    runParallel(subArgs);
    return;
  }
  if (firstArg === 'usage') {
    showUsage();
    return;
  }
  if (firstArg === 'watch') {
    cmdWatch();
    return;
  }

  const cliArgs = parseArgs();

  console.log(`
    ${SLEEPCODE_BADGE}
    ${C.dim}AI codes while you sleep${C.reset}
`);

  // 비대화형 모드: --type 이 있으면 인터랙티브 스킵
  if (cliArgs.type) {
    // 비대화형: 사전 준비 체크 (자동 설치 제안 없음)
    await checkPrerequisites(null);

    const typeKey = cliArgs.type;
    if (!PROJECT_TYPES[typeKey]) {
      console.error(`${C.red}알 수 없는 타입: ${typeKey}${C.reset}`);
      console.error(`사용 가능: ${Object.keys(PROJECT_TYPES).join(', ')}`);
      process.exit(1);
    }

    if (fs.existsSync(path.join(targetDir, '.sleepcode')) && !cliArgs.force) {
      console.error(`${C.red}.sleepcode/ 폴더가 이미 존재합니다. --force 로 덮어쓰세요.${C.reset}`);
      process.exit(1);
    }

    const typeConfig = PROJECT_TYPES[typeKey];
    const projectName = cliArgs.name || path.basename(targetDir);
    const role = cliArgs.role || `${projectName} 서비스 개발`;
    const figmaKey = cliArgs.figmaKey || '';
    const figmaFileNames = cliArgs.figmaFileNames || '';
    const notionKey = cliArgs.notionKey || '';
    if (!notionKey) {
      console.error(`${C.red}--notion-key <KEY> 는 필수입니다.${C.reset}`);
      process.exit(1);
    }
    if (!cliArgs.notionDb) {
      console.error(`${C.red}--notion-db <ID|URL|create> 는 필수입니다.${C.reset}`);
      process.exit(1);
    }
    const notionPages = cliArgs.notionPages || '';
    let notionDbId = '';
    if (cliArgs.notionDb === 'create') {
      // 새 Notion DB 생성 모드
      if (!notionKey) {
        console.error(`${C.red}Notion DB 생성에는 --notion-key 가 필요합니다.${C.reset}`);
        process.exit(1);
      }
      const parentPageId = parseNotionDbId(cliArgs.notionParent || '');
      if (!parentPageId) {
        console.error(`${C.red}--notion-parent <페이지 URL 또는 ID> 를 지정해주세요.${C.reset}`);
        process.exit(1);
      }
      const dbName = cliArgs.notionDbName || `${projectName} - sleepcode tasks`;
      console.log(`${C.dim}Notion DB 생성 중...${C.reset}`);
      try {
        notionDbId = await createNotionDb(notionKey, parentPageId, dbName);
        console.log(`${C.green}✓${C.reset} Notion DB 생성 완료 (ID: ${notionDbId})`);
      } catch (e) {
        console.error(`${C.red}Notion DB 생성 실패: ${e.message}${C.reset}`);
        process.exit(1);
      }
    } else {
      const rawId = parseNotionDbId(cliArgs.notionDb || '');
      console.log(`${C.dim}Notion DB 확인 중...${C.reset}`);
      try {
        notionDbId = await validateNotionDbId(notionKey, rawId);
      } catch (e) {
        console.error(`${C.red}${e.message}${C.reset}`);
        process.exit(1);
      }
    }
    const notionFilter = cliArgs.notionFilter || '';
    const sleepInterval = cliArgs.interval || '30';

    console.log(`${C.dim}타입: ${typeConfig.label}${C.reset}`);
    console.log(`${C.dim}이름: ${projectName}${C.reset}`);
    console.log(`${C.dim}역할: ${role}${C.reset}`);
    console.log(`${C.dim}태스크: Notion DB${C.reset}`);

    generateFiles(targetDir, {
      typeKey,
      projectName,
      role,
      buildCmd: typeConfig.buildCmd,
      testCmd: typeConfig.testCmd,
      lintCmd: typeConfig.lintCmd,
      figmaKey,
      figmaFileNames,
      notionKey,
      notionPages,
      notionDbId,
      notionFilter,
      sleepInterval,
    });

    const weeklyBudget = parseFloat(cliArgs.budget) || 0;
    const budgetThreshold = parseInt(cliArgs.threshold, 10) || 90;
    if (weeklyBudget > 0) {
      saveConfig(targetDir, { weeklyBudget, budgetThreshold });
    }

    printResult(notionDbId);
    return;
  }

  // 인터랙티브 모드
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // 인터랙티브: 사전 준비 체크 (자동 설치 제안 포함)
    await checkPrerequisites(rl);

    if (fs.existsSync(path.join(targetDir, '.sleepcode'))) {
      console.log(`${C.yellow}⚠ .sleepcode/ 폴더가 이미 존재합니다.${C.reset}`);
      const overwrite = await ask(rl, '덮어쓸까요? (y/N)', 'N');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('취소됨.');
        rl.close();
        return;
      }
    }

    const typeOptions = Object.entries(PROJECT_TYPES).map(([key, val]) => ({
      key,
      label: val.label,
    }));
    const selectedType = await select(rl, '프로젝트 타입', typeOptions);
    const typeKey = selectedType.key;
    const typeConfig = PROJECT_TYPES[typeKey];

    const projectName = await ask(rl, '프로젝트 이름', path.basename(targetDir));
    const role = await ask(rl, 'AI 역할 설명', `${projectName} 서비스 개발`);

    let buildCmd = typeConfig.buildCmd;
    let testCmd = typeConfig.testCmd;
    let lintCmd = typeConfig.lintCmd;

    if (typeKey === 'custom') {
      buildCmd = await ask(rl, '빌드 커맨드 (없으면 Enter)', '');
      testCmd = await ask(rl, '테스트 커맨드 (없으면 Enter)', '');
      lintCmd = await ask(rl, '린트 커맨드 (없으면 Enter)', '');
    } else {
      console.log(`${C.dim}  빌드: ${buildCmd || '(없음)'}${C.reset}`);
      console.log(`${C.dim}  테스트: ${testCmd || '(없음)'}${C.reset}`);
      console.log(`${C.dim}  린트: ${lintCmd || '(없음)'}${C.reset}`);
    }

    // Figma 연동
    let figmaKey = '';
    let figmaFileNames = '';
    const useFigma = await ask(rl, 'Figma 디자인을 참고하나요? (y/N)', 'N');
    if (useFigma.toLowerCase() === 'y') {
      figmaKey = await ask(rl, 'Figma API Key', '');
      figmaFileNames = await ask(rl, '참고할 Figma 파일명 (예: 홈화면, 로그인)', '');
    }

    // Notion 연동 (필수)
    let notionKey = '';
    let notionPages = '';
    let notionDbId = '';
    let notionFilter = '';
    notionKey = await ask(rl, 'Notion API Key', '');
    if (!notionKey) {
      console.error(`\n${C.red}Notion API Key는 필수입니다.${C.reset}`);
      console.log(`${C.dim}Notion 통합에서 API Key를 발급받으세요: https://www.notion.so/my-integrations${C.reset}`);
      process.exit(1);
    }

    // Notion DB 선택 (필수)
    const taskSource = await select(rl, '할 일(Task) 관리 방식', [
      { key: 'notion', label: 'Notion DB (기존 Notion 데이터베이스 연결)' },
      { key: 'notion-create', label: 'Notion DB 새로 만들기 (자동 생성)' },
    ]);

    if (taskSource.key === 'notion') {
      const dbInput = await ask(rl, '할 일을 저장해 둔 Notion DB (URL 또는 ID)', '');
      const rawId = parseNotionDbId(dbInput);
      if (!rawId) {
        console.error(`${C.red}유효한 Notion DB URL 또는 ID를 입력해주세요.${C.reset}`);
        process.exit(1);
      }
      console.log(`${C.dim}Notion DB 확인 중...${C.reset}`);
      try {
        notionDbId = await validateNotionDbId(notionKey, rawId);
        if (notionDbId !== rawId) {
          console.log(`${C.green}✓${C.reset} 페이지 내 DB를 자동 감지했습니다.`);
        } else {
          console.log(`${C.green}✓${C.reset} Notion DB 확인 완료`);
        }
      } catch (e) {
        console.error(`${C.red}${e.message}${C.reset}`);
        process.exit(1);
      }
    } else if (taskSource.key === 'notion-create') {
      const parentInput = await ask(rl, 'DB를 생성할 Notion 페이지 (URL 또는 ID)', '');
      const parentPageId = parseNotionDbId(parentInput);
      if (!parentPageId) {
        console.error(`${C.red}유효한 Notion 페이지 URL 또는 ID를 입력해주세요.${C.reset}`);
        process.exit(1);
      }
      const dbName = await ask(rl, 'DB 이름', `${projectName} - sleepcode tasks`);
      console.log(`\n${C.dim}Notion DB 생성 중...${C.reset}`);
      try {
        notionDbId = await createNotionDb(notionKey, parentPageId, dbName);
        console.log(`${C.green}✓${C.reset} Notion DB 생성 완료 (ID: ${notionDbId})`);
      } catch (e) {
        console.error(`${C.red}Notion DB 생성 실패: ${e.message}${C.reset}`);
        process.exit(1);
      }
    }

    notionPages = await ask(rl, '참고할 Notion 페이지명 (없으면 Enter)', '');

    const sleepInterval = await ask(rl, '반복 간격 (초)', '30');

    // 주간 예산 설정
    let weeklyBudget = 0;
    let budgetThreshold = 90;
    const useBudget = await ask(rl, '주간 비용 한도를 설정할까요? (y/N)', 'N');
    if (useBudget.toLowerCase() === 'y') {
      const budgetStr = await ask(rl, '주간 최대 비용 (USD)', '50');
      weeklyBudget = parseFloat(budgetStr) || 50;
      const thresholdStr = await ask(rl, '사용량 임계값 (%)', '90');
      budgetThreshold = parseInt(thresholdStr, 10) || 90;
    }

    rl.close();

    generateFiles(targetDir, {
      typeKey,
      projectName,
      role,
      buildCmd,
      testCmd,
      lintCmd,
      figmaKey,
      figmaFileNames,
      notionKey,
      notionPages,
      notionDbId,
      notionFilter,
      sleepInterval,
    });

    if (weeklyBudget > 0) {
      saveConfig(targetDir, { weeklyBudget, budgetThreshold });
      console.log(`  ${C.green}✓${C.reset} .sleepcode/config.json       ${C.dim}← 주간 예산: $${weeklyBudget} (${budgetThreshold}%)${C.reset}`);
    }

    printResult(notionDbId);
  } catch (e) {
    console.error(`${C.red}오류: ${e.message}${C.reset}`);
    rl.close();
    process.exit(1);
  }
}

main();

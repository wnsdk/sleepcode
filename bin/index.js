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
};

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const IS_WIN = process.platform === 'win32';

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
  custom: {
    label: 'Custom (직접 설정)',
    buildCmd: '',
    testCmd: '',
    lintCmd: '',
  },
};

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
    else if (args[i] === '--notion-filter' && args[i + 1]) parsed.notionFilter = args[++i];
    else if (args[i] === '--interval' && args[i + 1]) parsed.interval = args[++i];
    else if (args[i] === '--budget' && args[i + 1]) parsed.budget = args[++i];
    else if (args[i] === '--threshold' && args[i + 1]) parsed.threshold = args[++i];
    else if (args[i] === '--force' || args[i] === '-f') parsed.force = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
사용법: sleepcode [옵션]
       sleepcode run [--loop]
       sleepcode generate
       sleepcode parallel [--setup|--clean|--merge|--status]
       sleepcode usage

옵션 없이 실행하면 인터랙티브 모드로 동작합니다.

명령어:
  run              1회 실행 (ai_worker 스크립트)
  run --loop       무한 루프 실행 (run_forever 스크립트)
  generate         참고자료 기반으로 tasks.md 자동 생성
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
  --notion-db <id|url> Notion DB (ID 또는 URL, 태스크 동기화용)
  --notion-filter <f>  Notion 필터 (예: "Status = To Do")
  --interval <sec>     반복 간격 (초, 기본 30)
  --budget <usd>       주간 예산 ($, 예: 50)
  --threshold <pct>    사용량 임계값 (%, 기본 90)
  -f, --force          기존 .sleepcode/ 덮어쓰기
  -h, --help           도움말
`);
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

function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
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

    // Notion 섹션
    if (notionKey) {
      let notionSection = `\n## Notion\n\n- **기획/문서**: Notion MCP 도구로 직접 조회 가능 (API Key: \`${notionKey}\`)`;
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

  // tasks.md (Notion DB 모드가 아닐 때만 기본 템플릿 생성)
  if (!notionDbId) {
    writeFile(
      path.join(scDir, 'tasks.md'),
      `# 작업 목록

아래 태스크를 순서대로 진행하세요. 완료한 항목은 \`[x]\`로 체크하세요.

---

- [ ] 여기에 첫 번째 작업을 적어주세요
`
    );
  }

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

  // .gitignore
  const gitignorePath = path.join(targetDir, '.gitignore');
  const gitignoreEntries = [
    { marker: '.sleepcode/logs/', line: '\n# AI worker logs\n.sleepcode/logs/\n' },
    { marker: '.sleepcode/.env', line: '\n# AI worker secrets (API keys)\n.sleepcode/.env\n' },
    { marker: '.sleepcode/.notion_state.json', line: '\n# Notion sync state\n.sleepcode/.notion_state.json\n' },
  ];
  if (fs.existsSync(gitignorePath)) {
    let gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    for (const entry of gitignoreEntries) {
      if (!gitignore.includes(entry.marker)) {
        fs.appendFileSync(gitignorePath, entry.line);
        gitignore += entry.line;
      }
    }
    if (!gitignore.includes('.sleepcode/worktrees/')) {
      fs.appendFileSync(gitignorePath, '.sleepcode/worktrees/\n');
    }
    if (!gitignore.includes('.sleepcode/usage.json')) {
      fs.appendFileSync(gitignorePath, '.sleepcode/usage.json\n');
    }
  }
}

function printResult(notionDbId) {
  const workerScript = IS_WIN ? 'ai_worker.ps1' : 'ai_worker.sh';
  const foreverScript = IS_WIN ? 'run_forever.ps1' : 'run_forever.sh';

  console.log(`\n${C.bold}파일 생성 완료:${C.reset}\n`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/rules.md          ${C.dim}← 수정하세요${C.reset}`);
  if (notionDbId) {
    console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/notion_sync.py`);
  } else {
    console.log(`  ${C.green}✓${C.reset} .sleepcode/tasks.md          ${C.dim}← 수정하세요${C.reset}`);
  }
  console.log(`  ${C.green}✓${C.reset} .sleepcode/docs/             ${C.dim}← 참고자료 추가${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/base_rules.md`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/${workerScript}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/${foreverScript}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/log_filter.py`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/README.md`);
  console.log(`  ${C.green}✓${C.reset} .claude/settings.local.json`);

  const taskStep = notionDbId
    ? `${C.bold}3.${C.reset} Notion DB에 할 일을 작성해두세요 (첫 실행 시 자동 동기화)`
    : `${C.bold}3.${C.reset} 태스크 생성:
     ${C.cyan}npx sleepcode generate${C.reset}     ${C.dim}# 참고자료 기반 tasks.md 자동 생성${C.reset}
     ${C.dim}또는 .sleepcode/tasks.md 를 직접 작성${C.reset}`;

  console.log(`
${C.bold}${C.green}완료!${C.reset} 다음 단계:

  ${C.bold}1.${C.reset} .sleepcode/rules.md 를 프로젝트에 맞게 수정
  ${C.bold}2.${C.reset} .sleepcode/docs/ 에 참고 자료 추가 (기획서, 스크린샷 등)
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
    remaining: w.lines.filter(l => l.match(/- \[ \]/)).length,
  }));
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
      // 태스크 파일만 갱신
      const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
      if (fs.existsSync(path.dirname(wtTasksPath))) {
        fs.writeFileSync(wtTasksPath, worker.tasks);
      }
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

    // worktree 안의 tasks.md를 해당 워커 태스크만으로 덮어쓰기
    const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
    if (fs.existsSync(path.dirname(wtTasksPath))) {
      fs.writeFileSync(wtTasksPath, worker.tasks);
    }

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
        done = (wtContent.match(/- \[x\]/gi) || []).length;
        total = done + (wtContent.match(/- \[ \]/g) || []).length;
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

function progressBar(done, total, width) {
  const ratio = total > 0 ? done / total : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${C.green}${'█'.repeat(filled)}${C.dim}${'░'.repeat(empty)}${C.reset}`;
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
      ws.total = (content.match(/- \[ \]/g) || []).length + (content.match(/- \[x\]/gi) || []).length;
      ws.done = (content.match(/- \[x\]/gi) || []).length;
    }
  }

  // 실시간 로그 링 버퍼 (최근 N줄)
  const MAX_LOG_LINES = 8;
  const logBuffer = [];
  function pushLog(workerName, msg) {
    const tag = `${C.dim}[${workerName}]${C.reset}`;
    logBuffer.push(`${tag} ${msg}`);
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  }

  // 대시보드 렌더링
  let dashboardLines = 0;
  function renderDashboard() {
    // 이전 출력 지우기
    if (dashboardLines > 0) {
      process.stdout.write(`\x1b[${dashboardLines}A\x1b[J`);
    }

    const lines = [];
    const totalTasks = workerStates.reduce((s, w) => s + w.total, 0);
    const totalDone = workerStates.reduce((s, w) => s + w.done, 0);
    const activeCount = workerStates.filter(w => w.status === 'running').length;
    const totalCost = workerStates.reduce((s, w) => s + w.cost, 0);

    lines.push(`${C.bold}┌─────────────────────────────────────────────────────┐${C.reset}`);
    lines.push(`${C.bold}│${C.reset}  sleepcode parallel — ${activeCount}/${workerStates.length} workers active          ${C.bold}│${C.reset}`);
    lines.push(`${C.bold}├─────────────────────────────────────────────────────┤${C.reset}`);

    for (const ws of workerStates) {
      const bar = progressBar(ws.done, ws.total, 15);
      const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
        : ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      lines.push(`${C.bold}│${C.reset}  ${statusIcon} ${C.bold}${ws.name.padEnd(20)}${C.reset} ${bar} ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} ${C.bold}│${C.reset}`);
      if (ws.currentTask && ws.status === 'running') {
        const task = ws.currentTask.length > 45 ? ws.currentTask.slice(0, 42) + '...' : ws.currentTask;
        lines.push(`${C.bold}│${C.reset}    ${C.dim}> ${task}${C.reset}${' '.repeat(Math.max(0, 47 - task.length))}${C.bold}│${C.reset}`);
      }
    }

    lines.push(`${C.bold}├─────────────────────────────────────────────────────┤${C.reset}`);
    const costStr = `$${totalCost.toFixed(4)}`;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`;
    lines.push(`${C.bold}│${C.reset}  비용: ${costStr}  |  경과: ${elapsedStr}  |  진행: ${totalDone}/${totalTasks}       ${C.bold}│${C.reset}`);
    // 예산 정보
    const budgetInfo = isOverBudget(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? `${C.red}한도 도달!${C.reset}` : '';
      lines.push(`${C.bold}│${C.reset}  주간: $${budgetInfo.total.toFixed(2)}/$${budgetInfo.budget} (${pct}%) ${budgetBar} ${warn}       ${C.bold}│${C.reset}`);
    }
    lines.push(`${C.bold}└─────────────────────────────────────────────────────┘${C.reset}`);

    // 실시간 로그 출력
    if (logBuffer.length > 0) {
      lines.push('');
      for (const log of logBuffer) {
        lines.push(`  ${log}`);
      }
    }

    const output = lines.join('\n');
    process.stdout.write(output + '\n');
    dashboardLines = lines.length;
  }

  const startTime = Date.now();
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
    spawnWorker(ws, py, onWorkerDone, renderDashboard, pushLog);
  }
}

function spawnWorker(ws, py, onDone, onUpdate, pushLog) {
  // 프롬프트 구성 (base_rules + rules + tasks)
  const wtDir = ws.path;
  const baseRulesPath = path.join(wtDir, '.sleepcode', 'scripts', 'base_rules.md');
  const rulesPath = path.join(wtDir, '.sleepcode', 'rules.md');
  const tasksPath = path.join(wtDir, '.sleepcode', 'tasks.md');

  const parts = [];
  if (fs.existsSync(baseRulesPath)) parts.push(fs.readFileSync(baseRulesPath, 'utf-8'));
  if (fs.existsSync(rulesPath)) parts.push(fs.readFileSync(rulesPath, 'utf-8'));
  if (fs.existsSync(tasksPath)) parts.push(fs.readFileSync(tasksPath, 'utf-8'));
  const prompt = parts.join('\n\n---\n\n');

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
    logLine(`=== Worker ${ws.name} 종료 (code: ${code}) ===`);
    logStream.end();

    // 최종 태스크 상태 갱신
    const finalTasksPath = path.join(wtDir, '.sleepcode', 'tasks.md');
    if (fs.existsSync(finalTasksPath)) {
      const content = fs.readFileSync(finalTasksPath, 'utf-8');
      ws.done = (content.match(/- \[x\]/gi) || []).length;
      ws.total = ws.done + (content.match(/- \[ \]/g) || []).length;
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
          const short = text.length > 80 ? text.slice(0, 77) + '...' : text;
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
          detail = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
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
    const tasksPath = path.join(ws.path, '.sleepcode', 'tasks.md');
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      ws.done = (content.match(/- \[x\]/gi) || []).length;
      ws.total = ws.done + (content.match(/- \[ \]/g) || []).length;
    }

    const msg = typeof obj.message === 'string' ? obj.message : '';
    if (msg) {
      const short = msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
      pushLog(ws.name, `${C.green}[DONE]${C.reset} ${short}`);
    }
    onUpdate();
  }
}

// ─── 실행 명령어 ───
function runWorker(loop) {
  const targetDir = process.cwd();

  // 예산 체크
  const budgetCheck = isOverBudget(targetDir);
  if (budgetCheck && budgetCheck.over) {
    console.log(`${C.red}주간 한도에 도달했습니다.${C.reset}`);
    console.log(`  사용: $${budgetCheck.total.toFixed(2)} / 한도: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.threshold}% of $${budgetCheck.budget.toFixed(2)})`);
    console.log(`${C.dim}다음 주 월요일에 초기화됩니다. 'npx sleepcode usage' 로 확인하세요.${C.reset}`);
    process.exit(0);
  }

  const scDir = path.join(targetDir, '.sleepcode', 'scripts');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/scripts/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  const scriptName = loop
    ? (IS_WIN ? 'run_forever.ps1' : 'run_forever.sh')
    : (IS_WIN ? 'ai_worker.ps1' : 'ai_worker.sh');
  const scriptPath = path.join(scDir, scriptName);

  if (!fs.existsSync(scriptPath)) {
    console.error(`${C.red}스크립트를 찾을 수 없습니다: ${scriptPath}${C.reset}`);
    process.exit(1);
  }

  const cmd = IS_WIN
    ? `powershell -File "${scriptPath}"`
    : `"${scriptPath}"`;

  console.log(`${C.cyan}${loop ? '무한 루프' : '1회'} 실행: ${scriptName}${C.reset}\n`);

  try {
    execSync(cmd, { stdio: 'inherit', cwd: targetDir });
  } catch (e) {
    process.exit(e.status || 1);
  }
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

  // 5. 기존 tasks.md (있으면 참고)
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
- Figma 디자인이 있으면 UI 구현 태스크도 포함
- Notion 문서가 있으면 기획 내용을 반영
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
  if (firstArg === 'run') {
    const loop = process.argv.includes('--loop');
    runWorker(loop);
    return;
  }
  if (firstArg === 'generate') {
    generateTasks();
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

  const cliArgs = parseArgs();

  console.log(`
${C.bold}${C.magenta}  ╔══════════════════════════════════╗
  ║   sleepcode                      ║
  ║   AI codes while you sleep       ║
  ╚══════════════════════════════════╝${C.reset}
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
    const notionPages = cliArgs.notionPages || '';
    const notionDbId = parseNotionDbId(cliArgs.notionDb || '');
    const notionFilter = cliArgs.notionFilter || '';
    const sleepInterval = cliArgs.interval || '30';

    console.log(`${C.dim}타입: ${typeConfig.label}${C.reset}`);
    console.log(`${C.dim}이름: ${projectName}${C.reset}`);
    console.log(`${C.dim}역할: ${role}${C.reset}`);
    if (notionDbId) console.log(`${C.dim}태스크: Notion DB${C.reset}`);

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

    // Notion 연동
    let notionKey = '';
    let notionPages = '';
    let notionDbId = '';
    let notionFilter = '';
    const notionKeyInput = await ask(rl, 'Notion API Key (없으면 Enter)', '');
    if (notionKeyInput) {
      notionKey = notionKeyInput;

      // 태스크 관리 방식 선택
      const taskSource = await select(rl, '할 일(Task) 관리 방식', [
        { key: 'md', label: 'tasks.md (로컬 파일에 직접 작성)' },
        { key: 'notion', label: 'Notion DB (Notion 데이터베이스에서 불러오기)' },
      ]);

      if (taskSource.key === 'notion') {
        const dbInput = await ask(rl, '할 일을 저장해 둔 Notion DB (URL 또는 ID)', '');
        notionDbId = parseNotionDbId(dbInput);
        console.log(`${C.dim}  예: Status = To Do, Sprint = v2.0${C.reset}`);
        notionFilter = await ask(rl, '실행할 태스크 필터 (없으면 Enter)', '');
      } else {
        notionPages = await ask(rl, '참고할 Notion 페이지명 (예: 기획서, API명세)', '');
      }
    }

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

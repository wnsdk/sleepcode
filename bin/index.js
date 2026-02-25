#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
    else if (args[i] === '--interval' && args[i + 1]) parsed.interval = args[++i];
    else if (args[i] === '--force' || args[i] === '-f') parsed.force = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
사용법: sleepcode [옵션]
       sleepcode run [--loop]
       sleepcode generate

옵션 없이 실행하면 인터랙티브 모드로 동작합니다.

명령어:
  run              1회 실행 (ai_worker 스크립트)
  run --loop       무한 루프 실행 (run_forever 스크립트)
  generate         참고자료 기반으로 tasks.md 자동 생성

옵션:
  --type <type>        프로젝트 타입 (spring-boot, react-native, nextjs, custom)
  --name <name>        프로젝트 이름
  --role <desc>        AI 역할 설명
  --figma-key <key>    Figma API Key
  --figma-file <name>  Figma 참고 파일명
  --notion-key <key>   Notion API Key
  --notion-page <name> Notion 참고 페이지명
  --interval <sec>     반복 간격 (초, 기본 30)
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

function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
}

function generateFiles(targetDir, { typeKey, projectName, role, buildCmd, testCmd, lintCmd, figmaKey, figmaFileNames, notionKey, notionPages, sleepInterval }) {
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

  for (const file of allScriptFiles) {
    const src = path.join(TEMPLATES_DIR, 'common', file);
    const dest = path.join(scDir, 'scripts', file);
    if (fs.existsSync(src)) {
      let content = fs.readFileSync(src, 'utf-8');
      content = content.replace(/\{\{SLEEP_INTERVAL\}\}/g, sleepInterval);
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
  }

  // docs/.gitkeep
  writeFile(path.join(scDir, 'docs', '.gitkeep'), '');

  // tasks.md
  writeFile(
    path.join(scDir, 'tasks.md'),
    `# 작업 목록

아래 태스크를 순서대로 진행하세요. 완료한 항목은 \`[x]\`로 체크하세요.

---

- [ ] 여기에 첫 번째 작업을 적어주세요
`
  );

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

  // .gitignore
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('.sleepcode/logs/')) {
      fs.appendFileSync(gitignorePath, '\n# AI worker logs\n.sleepcode/logs/\n');
    }
  }
}

function printResult() {
  const workerScript = IS_WIN ? 'ai_worker.ps1' : 'ai_worker.sh';
  const foreverScript = IS_WIN ? 'run_forever.ps1' : 'run_forever.sh';

  console.log(`\n${C.bold}파일 생성 완료:${C.reset}\n`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/rules.md          ${C.dim}← 수정하세요${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/tasks.md          ${C.dim}← 수정하세요${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/docs/             ${C.dim}← 참고자료 추가${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/base_rules.md`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/${workerScript}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/${foreverScript}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/log_filter.py`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/README.md`);
  console.log(`  ${C.green}✓${C.reset} .claude/settings.local.json`);

  console.log(`
${C.bold}${C.green}완료!${C.reset} 다음 단계:

  ${C.bold}1.${C.reset} .sleepcode/rules.md 를 프로젝트에 맞게 수정
  ${C.bold}2.${C.reset} .sleepcode/docs/ 에 참고 자료 추가 (기획서, 스크린샷 등)
  ${C.bold}3.${C.reset} 태스크 생성:
     ${C.cyan}npx sleepcode generate${C.reset}     ${C.dim}# 참고자료 기반 tasks.md 자동 생성${C.reset}
     ${C.dim}또는 .sleepcode/tasks.md 를 직접 작성${C.reset}
  ${C.bold}4.${C.reset} 실행:
     ${C.cyan}npx sleepcode run${C.reset}          ${C.dim}# 1회 실행${C.reset}
     ${C.cyan}npx sleepcode run --loop${C.reset}   ${C.dim}# 무한 루프${C.reset}
`);
}

// ─── 실행 명령어 ───
function runWorker(loop) {
  const targetDir = process.cwd();
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
    const sleepInterval = cliArgs.interval || '30';

    console.log(`${C.dim}타입: ${typeConfig.label}${C.reset}`);
    console.log(`${C.dim}이름: ${projectName}${C.reset}`);
    console.log(`${C.dim}역할: ${role}${C.reset}`);

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
      sleepInterval,
    });

    printResult();
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
    const useNotion = await ask(rl, 'Notion 문서를 참고하나요? (y/N)', 'N');
    if (useNotion.toLowerCase() === 'y') {
      notionKey = await ask(rl, 'Notion API Key', '');
      notionPages = await ask(rl, '참고할 Notion 페이지명 (예: 기획서, API명세)', '');
    }

    const sleepInterval = await ask(rl, '반복 간격 (초)', '30');

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
      sleepInterval,
    });

    printResult();
  } catch (e) {
    console.error(`${C.red}오류: ${e.message}${C.reset}`);
    rl.close();
    process.exit(1);
  }
}

main();

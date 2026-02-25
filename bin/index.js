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
    else if (args[i] === '--interval' && args[i + 1]) parsed.interval = args[++i];
    else if (args[i] === '--force' || args[i] === '-f') parsed.force = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
사용법: sleepcode [옵션]

옵션 없이 실행하면 인터랙티브 모드로 동작합니다.

옵션:
  --type <type>        프로젝트 타입 (spring-boot, react-native, nextjs, custom)
  --name <name>        프로젝트 이름
  --role <desc>        AI 역할 설명
  --figma-key <key>    Figma API Key
  --interval <sec>     반복 간격 (초, 기본 30)
  -f, --force          기존 .ai/ 덮어쓰기
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

function generateFiles(targetDir, { typeKey, projectName, role, buildCmd, testCmd, lintCmd, figmaKey, sleepInterval }) {
  const aiDir = path.join(targetDir, '.ai');
  const claudeDir = path.join(targetDir, '.claude');
  fs.mkdirSync(path.join(aiDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(aiDir, 'logs'), { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });

  // 공통 파일 복사 (OS별 분기)
  const scriptFiles = IS_WIN
    ? ['ai_worker.ps1', 'run_forever.ps1']
    : ['ai_worker.sh', 'run_forever.sh'];
  const commonFiles = [...scriptFiles, 'log_filter.py', 'README.md'];

  for (const file of commonFiles) {
    const src = path.join(TEMPLATES_DIR, 'common', file);
    const dest = path.join(aiDir, file);
    if (fs.existsSync(src)) {
      let content = fs.readFileSync(src, 'utf-8');
      content = content.replace(/\{\{SLEEP_INTERVAL\}\}/g, sleepInterval);
      fs.writeFileSync(dest, content);
    }
  }

  // 실행 권한 (Unix만)
  if (!IS_WIN) {
    fs.chmodSync(path.join(aiDir, 'ai_worker.sh'), 0o755);
    fs.chmodSync(path.join(aiDir, 'run_forever.sh'), 0o755);
    fs.chmodSync(path.join(aiDir, 'log_filter.py'), 0o755);
  }

  // docs/.gitkeep
  writeFile(path.join(aiDir, 'docs', '.gitkeep'), '');

  // tasks.md
  writeFile(
    path.join(aiDir, 'tasks.md'),
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
    rules = rules.replace(/\{\{FIGMA_API_KEY\}\}/g, figmaKey);

    if (!figmaKey) {
      rules = rules.replace(/\n## Figma[\s\S]*?(?=\n## |$)/, '');
    }

    writeFile(path.join(aiDir, 'rules.md'), rules);
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
    if (!gitignore.includes('.ai/logs/')) {
      fs.appendFileSync(gitignorePath, '\n# AI worker logs\n.ai/logs/\n');
    }
  }
}

function printResult() {
  const workerScript = IS_WIN ? 'ai_worker.ps1' : 'ai_worker.sh';
  const foreverScript = IS_WIN ? 'run_forever.ps1' : 'run_forever.sh';

  console.log(`\n${C.bold}파일 생성 완료:${C.reset}\n`);
  console.log(`  ${C.green}✓${C.reset} .ai/rules.md`);
  console.log(`  ${C.green}✓${C.reset} .ai/tasks.md`);
  console.log(`  ${C.green}✓${C.reset} .ai/${workerScript}`);
  console.log(`  ${C.green}✓${C.reset} .ai/${foreverScript}`);
  console.log(`  ${C.green}✓${C.reset} .ai/log_filter.py`);
  console.log(`  ${C.green}✓${C.reset} .ai/README.md`);
  console.log(`  ${C.green}✓${C.reset} .ai/docs/`);
  console.log(`  ${C.green}✓${C.reset} .claude/settings.local.json`);

  if (IS_WIN) {
    console.log(`
${C.bold}${C.green}완료!${C.reset} 다음 단계:

  ${C.bold}1.${C.reset} .ai/rules.md 를 프로젝트에 맞게 수정
  ${C.bold}2.${C.reset} .ai/tasks.md 에 작업 목록 작성
  ${C.bold}3.${C.reset} 실행 (PowerShell):
     ${C.dim}# 1회 실행${C.reset}
     powershell -File .\\.ai\\ai_worker.ps1

     ${C.dim}# 무한 루프${C.reset}
     powershell -File .\\.ai\\run_forever.ps1
`);
  } else {
    console.log(`
${C.bold}${C.green}완료!${C.reset} 다음 단계:

  ${C.bold}1.${C.reset} .ai/rules.md 를 프로젝트에 맞게 수정
  ${C.bold}2.${C.reset} .ai/tasks.md 에 작업 목록 작성
  ${C.bold}3.${C.reset} 실행:
     ${C.dim}# 1회 실행${C.reset}
     ./.ai/ai_worker.sh

     ${C.dim}# 무한 루프 (tmux)${C.reset}
     tmux new -s ai './.ai/run_forever.sh'
`);
  }
}

// ─── 메인 ───
async function main() {
  const targetDir = process.cwd();
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

    if (fs.existsSync(path.join(targetDir, '.ai')) && !cliArgs.force) {
      console.error(`${C.red}.ai/ 폴더가 이미 존재합니다. --force 로 덮어쓰세요.${C.reset}`);
      process.exit(1);
    }

    const typeConfig = PROJECT_TYPES[typeKey];
    const projectName = cliArgs.name || path.basename(targetDir);
    const role = cliArgs.role || `${projectName} 서비스 개발`;
    const figmaKey = cliArgs.figmaKey || '';
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

    if (fs.existsSync(path.join(targetDir, '.ai'))) {
      console.log(`${C.yellow}⚠ .ai/ 폴더가 이미 존재합니다.${C.reset}`);
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

    const figmaKey = await ask(rl, 'Figma API Key (없으면 Enter)', '');
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

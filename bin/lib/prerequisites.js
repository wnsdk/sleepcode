const { execSync } = require('child_process');
const { C, IS_WIN } = require('./constants');
const { ask } = require('./utils');

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
    console.log(`  ${C.dim}-${C.reset} claude not installed`);
    results.claude = false;
  }

  // codex
  const codexVer = checkCommand('codex --version');
  if (codexVer) {
    console.log(`  ${C.green}✓${C.reset} codex (${codexVer})`);
    results.codex = true;
  } else {
    console.log(`  ${C.dim}-${C.reset} codex not installed`);
    results.codex = false;
  }

  if (!(results.claude || results.codex)) {
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
  if (!(results.claude || results.codex) && rl) {
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
  if (!(results.claude || results.codex)) {
    missing.push({ name: 'ai provider (claude|codex)', hint: 'claude: npm install -g @anthropic-ai/claude-code / codex: install Codex CLI' });
  }

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

module.exports = {
  checkCommand,
  detectPython,
  getInstallHint,
  checkPrerequisites,
};

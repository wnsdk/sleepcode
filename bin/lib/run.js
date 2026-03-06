const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { C, SLEEPCODE_BADGE, IS_WIN, PROVIDERS, notionLink } = require('./constants');
const { countTasks, progressBar, visualWidth, loadEnvFileToProcessEnv } = require('./utils');
const { detectPython } = require('./prerequisites');
const { resolveProviderPlan, providerLabel, getProviderRunCommand, buildExecutionPrompt } = require('./provider');
const { isOverBudget, recordCost } = require('./config');
const { syncClaudeMd } = require('./files');
const { boxLine, renderMenuLine, setupMenuInput } = require('./dashboard');
const { processStreamEvent } = require('./worker');

function runWorker(loop, cont, cliProvider) {
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

    let providerPlan;
    try {
      providerPlan = resolveProviderPlan(targetDir, cliProvider);
    } catch (e) {
      console.error(C.red + e.message + C.reset);
      process.exit(1);
    }
    if (providerPlan.requestedUnavailable) {
      console.log(C.yellow + 'requested provider unavailable, switched to ' + providerLabel(providerPlan.selected) + '.' + C.reset);
    }

    const contFlag = cont ? ' --continue' : '';
    const providerFlag = ' --provider ' + providerPlan.selected;
    const cmd = IS_WIN
      ? `powershell -File "${scriptPath}"${contFlag}${providerFlag}`
      : `"${scriptPath}"${contFlag}${providerFlag}`;
    const modeLabel = cont ? '무한 루프 실행 (세션 연속 모드)' : '무한 루프 실행';
    console.log(`${C.cyan}${modeLabel}: ${scriptName}${C.reset}\n`);

    try {
      execSync(cmd, { stdio: 'inherit', cwd: targetDir, env: { ...process.env, SLEEPCODE_PROVIDER: providerPlan.selected } });
    } catch (e) {
      process.exit(e.status || 1);
    }
    return;
  }

  // 1회 실행: 대시보드 모드
  runSingleWithDashboard(targetDir, cont, cliProvider);
}

function runSingleWithDashboard(targetDir, cont, cliProvider) {
  const scDir = path.join(targetDir, '.sleepcode');
  const logDir = path.join(scDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // .env load
  const envPath = path.join(scDir, '.env');
  loadEnvFileToProcessEnv(envPath);

  let providerPlan;
  try {
    providerPlan = resolveProviderPlan(targetDir, cliProvider);
  } catch (e) {
    console.error(C.red + e.message + C.reset);
    process.exit(1);
  }
  if (providerPlan.requestedUnavailable) {
    console.log(C.yellow + 'requested provider unavailable, switched to ' + providerLabel(providerPlan.selected) + '.' + C.reset);
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
  const promptsByProvider = {
    [PROVIDERS.CLAUDE]: prompt,
    [PROVIDERS.CODEX]: buildExecutionPrompt(targetDir, prompt, PROVIDERS.CODEX),
  };

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
    provider: providerPlan.selected,
    fallbackProvider: providerPlan.fallback,
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
    const W = 62;
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

    lines.push(`${C.dim}╔${'═'.repeat(W + 2)}╗${C.reset}`);
    lines.push(boxLine(`${SLEEPCODE_BADGE} run  ${C.dim}[${providerLabel(ws.provider)}]${C.reset} ${statusIcon} ${statusText}${notionLink(process.env.NOTION_DB_ID)}`, W));
    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);
    const pct = ws.total > 0 ? Math.round(ws.done / ws.total * 100) : 0;
    lines.push(boxLine(`${bar}  ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} tasks  ${C.cyan}${pct}%${C.reset}`, W));
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
    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);
    lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}${costStr}${C.reset}  ${C.dim}·  경과${C.reset} ${C.cyan}${elapsedStr}${C.reset}`, W));
    const budgetInfo = isOverBudget(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
      lines.push(boxLine(`${C.dim}주간${C.reset} ${C.yellow}$${budgetInfo.total.toFixed(2)}${C.reset}/${C.dim}$${budgetInfo.budget}${C.reset} (${pct}%) ${budgetBar}${warn}`, W));
    } else {
      lines.push(boxLine('', W));
    }

    // 테이블 닫기
    lines.push(`${C.dim}╚${'═'.repeat(W + 2)}╝${C.reset}`);

    // 메뉴 (테이블 밖)
    if (gracefulShutdown) {
      lines.push(`  ${C.yellow}⏳ 마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`);
    } else {
      lines.push(renderMenuLine(menuState.menuIndex, W, menuState.confirmPending, menuState._menuItems));
    }
    lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(W - 6)}${C.reset}`);

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

  // 5초마다 tasks.md를 읽어 진행률 갱신
  const taskProgressInterval = setInterval(() => {
    if (ws.status !== 'running') return;
    try {
      if (fs.existsSync(tasksPath)) {
        const content = fs.readFileSync(tasksPath, 'utf-8');
        const tc = countTasks(content);
        ws.done = tc.done;
        ws.total = tc.total;
      }
    } catch {}
    scheduleRender();
  }, 5000);

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
    clearInterval(taskProgressInterval);
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

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const logStream = fs.createWriteStream(ws.logFile, { flags: 'a' });
  logStream.write(`[${new Date().toISOString()}] === Run start (provider: ${ws.provider}) ===\n`);

  const continuePrompt = '다음 태스크를 진행하세요.';

  function finalizeRun(code, errMsg) {
    logStream.write(`[${new Date().toISOString()}] === Run end (code: ${code}) ===\n`);
    if (errMsg) logStream.write(`ERROR: ${errMsg}\n`);
    logStream.end();

    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const tc = countTasks(content);
      ws.done = tc.done;
      ws.total = tc.total;
    }

    ws.status = (code === 0) ? 'done' : 'failed';
    ws.currentTask = errMsg || '';
    onDone();
  }

  function runAttempt(provider, allowFallback) {
    ws.provider = provider;
    const invoke = getProviderRunCommand(provider, cont);
    const stdinPrompt = cont ? continuePrompt : (promptsByProvider[provider] || prompt);

    const proc = spawn(invoke.command, invoke.args, {
      cwd: targetDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    ws._proc = proc;
    proc.stdin.write(stdinPrompt);
    proc.stdin.end();

    let buffer = '';
    let sawEvents = false;

    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        logStream.write(line + '\n');
        sawEvents = true;
        try {
          const obj = JSON.parse(line);
          processStreamEvent(ws, obj, scheduleRender, pushLog);
        } catch {}
      }
    });

    proc.stderr.on('data', (data) => {
      logStream.write(`[STDERR] ${data.toString()}`);
    });

    proc.on('close', (code) => {
      if (buffer.trim()) {
        logStream.write(buffer + '\n');
        try {
          const obj = JSON.parse(buffer);
          processStreamEvent(ws, obj, scheduleRender, pushLog);
          sawEvents = true;
        } catch {}
      }

      if (code !== 0 && allowFallback && ws.fallbackProvider && ws.fallbackProvider !== provider && !sawEvents) {
        const fromLabel = providerLabel(provider);
        const toLabel = providerLabel(ws.fallbackProvider);
        pushLog(ws.name, `${C.yellow}[FALLBACK]${C.reset} ${fromLabel} failed, retrying with ${toLabel}`);
        logStream.write(`[${new Date().toISOString()}] FALLBACK: ${provider} -> ${ws.fallbackProvider}\n`);
        runAttempt(ws.fallbackProvider, false);
        return;
      }

      finalizeRun(code);
    });

    proc.on('error', (err) => {
      if (allowFallback && ws.fallbackProvider && ws.fallbackProvider !== provider) {
        const fromLabel = providerLabel(provider);
        const toLabel = providerLabel(ws.fallbackProvider);
        pushLog(ws.name, `${C.yellow}[FALLBACK]${C.reset} ${fromLabel} failed, retrying with ${toLabel}`);
        logStream.write(`[${new Date().toISOString()}] FALLBACK_ERROR: ${err.message}\n`);
        runAttempt(ws.fallbackProvider, false);
        return;
      }
      finalizeRun(1, err.message);
    });
  }

  runAttempt(ws.provider, true);
}

module.exports = {
  runWorker,
  runSingleWithDashboard,
};

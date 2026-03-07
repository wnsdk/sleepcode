const fs = require('fs');
const path = require('path');
const { C, SLEEPCODE_BADGE, notionLink, branchColor } = require('./constants');
const {
  progressBar,
  visualWidth,
  padEndVisual,
} = require('./utils');
const { detectPython } = require('./prerequisites');
const { resolveProviderPlan } = require('./provider');
const { isOverBudget, recordCost } = require('./config');
const { boxLine, renderMenuLineWithLayout, setupMenuInput } = require('./dashboard');
const { spawnWorker } = require('./worker');
const { syncWorkerTaskProgress } = require('./taskState');
const {
  ensureRuntimeDirs,
} = require('./runtimePaths');
const {
  cleanupWorktrees,
  copySleepcodeDirToWorktree,
  createWorktrees,
  parseParallelTasks,
  showParallelStatus,
} = require('./parallelWorktrees');
const {
  autoMergeWorktrees,
  mergeWorktrees,
} = require('./parallelMerge');

function runParallel(subArgs, cliProvider) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode init'으로 초기화하세요.${C.reset}`);
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
    mergeWorktrees(targetDir, cliProvider);
    return;
  }

  if (isClean) {
    console.log(`\n${C.bold}Worktree 정리 중...${C.reset}\n`);
    cleanupWorktrees(targetDir, null);
    console.log(`\n${C.green}정리 완료.${C.reset}`);
    return;
  }

  // --setup 또는 기본 동작: worktree 생성
  const tasksPath = path.join(scDir, 'task_queue.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.error(`${C.red}task_queue.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`
${C.bold}task_queue.md 병렬 포맷 예시:${C.reset}

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
  runParallelWorkers(targetDir, created, cliProvider);
}

function runParallelWorkers(targetDir, workerInfos, cliProvider) {
  const { logsDir: logDir } = ensureRuntimeDirs(targetDir);
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

  // provider 가용성만 검증 (실제 선택은 워커가 태스크마다 ratio에 따라 수행)
  try {
    resolveProviderPlan(targetDir, cliProvider);
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}`);
    process.exit(1);
  }

  const workerStates = workerInfos.map(w => ({
    ...w,
    targetDir,
    status: 'running',
    currentTask: '',
    done: 0,
    total: 0,
    cost: 0,
    provider: null,
    fallbackProvider: null,
    _proc: null,
    logFile: path.join(logDir, `parallel_${w.name}_${timestamp}.log`),
  }));

  // 초기 태스크 수 계산
  for (const ws of workerStates) {
    const tasksPath = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      syncWorkerTaskProgress(ws, null, content);
    }
  }

  // 로그 버퍼 (리사이즈 시 재렌더링용)
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let altScreenActive = false;
  let cursorHidden = false;
  let logScroll = 0;

  function getLogRows(dashboardHeight) {
    const rows = process.stdout.rows || 24;
    return Math.max(0, rows - dashboardHeight);
  }

  function getMaxLogScroll(dashboardHeight) {
    const logRows = getLogRows(dashboardHeight);
    return Math.max(0, logBuffer.length - logRows);
  }

  function appendLogToScreen(line) {
    if (!altScreenActive) return;
    if (logScroll > 0) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function renderLogs(dashboardHeight, force = false) {
    if (!altScreenActive) return;
    const logRows = getLogRows(dashboardHeight);
    if (logRows <= 0) return;

    const maxScroll = getMaxLogScroll(dashboardHeight);
    if (logScroll > maxScroll) logScroll = maxScroll;
    if (!force && logScroll === 0) return;

    const start = Math.max(0, logBuffer.length - logRows - logScroll);
    const slice = logBuffer.slice(start, start + logRows);
    for (let i = 0; i < logRows; i++) {
      const line = slice[i] || '';
      process.stdout.write(`\x1b[${dashboardHeight + 1 + i};1H`);
      process.stdout.write(`  ${line}\x1b[K`);
    }
    process.stdout.write('\x1b[1;1H');
  }

  function pushLog(workerName, msg) {
    const color = branchColor(workerName);
    const tag = `${color}[${workerName}]${C.reset}`;
    const fullMsg = `${tag} ${msg}`;
    logBuffer.push(fullMsg);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    if (logScroll > 0) {
      logScroll = Math.min(logScroll + 1, getMaxLogScroll(dashboardHeight));
    }
    appendLogToScreen(fullMsg);
  }

  // 대시보드 렌더링
  const startTime = Date.now();
  let renderPending = false;
  let renderTimer = null;
  const menuState = { menuIndex: 0 };
  let gracefulShutdown = false;

  function renderDashboard() {
    if (!altScreenActive) return;

    const lines = [];
    const W = 62; // 박스 내부 너비
    const totalTasks = workerStates.reduce((s, w) => s + w.total, 0);
    const totalDone = workerStates.reduce((s, w) => s + w.done, 0);
    const activeCount = workerStates.filter(w => w.status === 'running').length;
    const totalCost = workerStates.reduce((s, w) => s + w.cost, 0);

    lines.push(`${C.dim}╔${'═'.repeat(W + 2)}╗${C.reset}`);
    lines.push(boxLine(`${SLEEPCODE_BADGE} parallel  ${C.dim}${activeCount}/${workerStates.length} workers${C.reset}${notionLink(process.env.NOTION_DB_ID)}`, W));
    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);

    for (const ws of workerStates) {
      const bar = progressBar(ws.done, ws.total, 15);
      const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
        : ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      const wPct = ws.total > 0 ? Math.round(ws.done / ws.total * 100) : 0;
      const diffTag = ws.difficultyLabel ? ` ${C.yellow}${ws.difficulty}${C.reset}` : '';
      lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(ws.name, 18)}${C.reset} ${bar} ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} ${C.cyan}${String(wPct).padStart(3)}%${C.reset}${diffTag}`, W));
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

    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);
    const costStr = `$${totalCost.toFixed(4)}`;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`;
    const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
    lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}${costStr}${C.reset}  ${C.dim}·  경과${C.reset} ${C.cyan}${elapsedStr}${C.reset}  ${C.dim}·  진행${C.reset} ${totalDone}/${totalTasks} ${C.cyan}${totalPct}%${C.reset}`, W));
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
      menuState._menuLayout = null;
    } else {
      const menuRender = renderMenuLineWithLayout(menuState.menuIndex, W, menuState.confirmPending, menuState._menuItems);
      lines.push(menuRender.line);
      menuState._menuLayout = { row: lines.length, items: menuRender.items };
    }
    lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(W - 6)}${C.reset}`);

    // Alternate Screen: 절대 좌표로 대시보드 렌더링
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${lines[i]}\x1b[K`);
    }
    // 커서를 한 곳에 고정 (숨김 미지원 터미널 대비)
    process.stdout.write('\x1b[1;1H');
    if (logScroll > 0) renderLogs(dashboardHeight);
  }

  /** 이벤트 기반 렌더 요청을 200ms 디바운스로 처리 (깜빡임 방지) */
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    renderTimer = setTimeout(() => {
      renderPending = false;
      renderTimer = null;
      renderDashboard();
    }, 200);
  }

  function flushRender() {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    renderPending = false;
    renderDashboard();
    renderLogs(dashboardHeight, true);
  }

  // Alternate Screen 초기화
  const dashboardHeight = 11 + workerStates.length * 2;
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[?25l');
    cursorHidden = true;
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
    if (cursorHidden) {
      process.stdout.write('\x1b[?25h');
      cursorHidden = false;
    }
  }

  process.stdout.on('resize', () => {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    renderLogs(dashboardHeight, true);
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
  const gracefulExit = () => {
    if (gracefulShutdown) return;
    gracefulShutdown = true;
    pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
    for (const ws of workerStates) {
      if (ws.status === 'running' && ws._proc) {
        try { ws._proc.kill('SIGINT'); } catch {}
      }
    }
    renderDashboard();
  };

  const immediateExit = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    for (const ws of workerStates) {
      if (ws._proc) try { ws._proc.kill(); } catch {}
    }
    cleanupAltScreen();
    console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
    process.exit(0);
  };

  let cleanupMenuInput;
  cleanupMenuInput = setupMenuInput(
    menuState,
    renderDashboard,
    [
      { label: '마무리 후 종료', handler: gracefulExit },
      { label: '즉시 종료', handler: immediateExit },
    ],
    immediateExit,
    (action) => {
      const logRows = getLogRows(dashboardHeight);
      if (logRows <= 0) return false;
      const maxScroll = getMaxLogScroll(dashboardHeight);
      let next = logScroll;
      const page = Math.max(1, logRows - 1);
      switch (action) {
        case 'lineUp':
          next = Math.min(maxScroll, logScroll + 1);
          break;
        case 'lineDown':
          next = Math.max(0, logScroll - 1);
          break;
        case 'pageUp':
          next = Math.min(maxScroll, logScroll + page);
          break;
        case 'pageDown':
          next = Math.max(0, logScroll - page);
          break;
        case 'top':
          next = maxScroll;
          break;
        case 'bottom':
          next = 0;
          break;
        case 'wheelUp':
          next = Math.min(maxScroll, logScroll + 3);
          break;
        case 'wheelDown':
          next = Math.max(0, logScroll - 3);
          break;
        default:
          return false;
      }
      if (next === logScroll) return true;
      logScroll = next;
      renderLogs(dashboardHeight, true);
      return true;
    }
  );

  renderDashboard();
  renderLogs(dashboardHeight, true);

  // 대시보드 갱신 타이머
  const dashboardInterval = setInterval(renderDashboard, 3000);

  // 5초마다 task_queue.md를 읽어 진행률 갱신
  const taskProgressInterval = setInterval(() => {
    for (const ws of workerStates) {
      if (ws.status !== 'running') continue;
      const tp = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');
      try {
        if (fs.existsSync(tp)) {
          const content = fs.readFileSync(tp, 'utf-8');
          syncWorkerTaskProgress(ws, null, content);
        }
      } catch {}
    }
    scheduleRender();
  }, 5000);

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

  function onWorkerDone(completedWs) {
    activeWorkers--;
    renderDashboard();

    // 워커가 모든 태스크를 완료했으면 즉시 main 브랜치에 병합
    if (completedWs && completedWs.status === 'done') {
      pushLog('SYSTEM', `${C.green}${completedWs.name} 완료 — main 브랜치에 즉시 병합 중...${C.reset}`);
      try {
        const mergeResults = autoMergeWorktrees(targetDir, [completedWs], cliProvider);
        if (mergeResults.merged.length > 0) {
          pushLog('SYSTEM', `${C.green}✓ ${completedWs.name} — main 브랜치 병합 완료${C.reset}`);
          completedWs.merged = true;
        } else if (mergeResults.skipped.length > 0) {
          pushLog('SYSTEM', `${C.dim}${completedWs.name} — 병합 스킵 (변경 없음)${C.reset}`);
          completedWs.merged = true;
        } else if (mergeResults.conflicted.length > 0) {
          pushLog('SYSTEM', `${C.red}✗ ${completedWs.name} — 병합 충돌 (수동 처리 필요)${C.reset}`);
        }
      } catch (e) {
        pushLog('SYSTEM', `${C.red}✗ ${completedWs.name} — 병합 오류: ${e.message}${C.reset}`);
      }
      scheduleRender();
    }

    if (activeWorkers === 0) {
      clearInterval(dashboardInterval);
      clearInterval(budgetCheckInterval);
      clearInterval(taskProgressInterval);
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
    const alreadyMerged = workerStates.filter(w => w.merged);
    const needsMerge = done.filter(w => !w.merged);

    console.log(`\n${C.bold}병렬 실행 완료${C.reset}`);
    const parts = [`${C.green}성공: ${done.length}${C.reset}`];
    if (failed.length > 0) parts.push(`${C.red}실패: ${failed.length}${C.reset}`);
    if (stopped.length > 0) parts.push(`${C.yellow}예산 중지: ${stopped.length}${C.reset}`);
    console.log(`  ${parts.join('  ')}`);

    // 브랜치 목록 출력
    console.log(`\n${C.bold}생성된 브랜치:${C.reset}`);
    for (const ws of workerStates) {
      const mergedTag = ws.merged ? ` ${C.dim}(병합됨)${C.reset}` : '';
      const icon = ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      console.log(`  ${icon} ${ws.branch}${mergedTag}`);
    }

    if (alreadyMerged.length > 0) {
      console.log(`\n${C.green}✓ 자동 병합 완료: ${alreadyMerged.map(w => w.name).join(', ')}${C.reset}`);
    }

    if (needsMerge.length > 0) {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --merge${C.reset}   ${C.dim}# 남은 브랜치 병합${C.reset}`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    } else if (done.length > 0) {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    } else {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --merge${C.reset}   ${C.dim}# 브랜치 자동 머지${C.reset}`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    }
    console.log('');
  }

  function handleTaskUiUpdated() {
    flushRender();
  }

  for (const ws of workerStates) {
    spawnWorker(ws, py, () => onWorkerDone(ws), scheduleRender, pushLog, cliProvider, null, null, handleTaskUiUpdated);
  }
}

module.exports = {
  parseParallelTasks,
  copySleepcodeDirToWorktree,
  createWorktrees,
  cleanupWorktrees,
  showParallelStatus,
  mergeWorktrees,
  autoMergeWorktrees,
  runParallel,
  runParallelWorkers,
};

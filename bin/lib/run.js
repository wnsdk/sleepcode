const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { C, SLEEPCODE_BADGE_HOVER, IS_WIN, TEMPLATES_DIR, branchColor, notionLink } = require('./constants');
const { countTasks, progressBar, visualWidth, padEndVisual, loadEnvFileToProcessEnv, parseNotionDbId } = require('./utils');
const { detectPython } = require('./prerequisites');
const { providerLabel, providerLabelWithModel } = require('./provider');
const { isOverBudget, recordCost } = require('./config');
const { syncClaudeMd } = require('./files');
const { boxLine, renderMenuLineWithLayout, setupMenuInput } = require('./dashboard');
const { spawnWorker } = require('./worker');
const { parseParallelTasks, createWorktrees, cleanupWorktrees, autoMergeWorktrees } = require('./parallel');

function cmdWatch(cliProvider) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // .env load
  const envPath = path.join(scDir, '.env');
  loadEnvFileToProcessEnv(envPath);

  // CLI 인자로 Notion 설정 오버라이드
  const { parseArgs } = require('./cli');
  const cliArgs = parseArgs();
  if (cliArgs.notionKey) process.env.NOTION_API_KEY = cliArgs.notionKey;
  if (cliArgs.notionDb) process.env.NOTION_DB_ID = parseNotionDbId(cliArgs.notionDb);
  if (cliArgs.notionFilter) process.env.NOTION_FILTER = cliArgs.notionFilter;

  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DB_ID;

  if (!apiKey || !dbId) {
    console.error(`${C.red}Notion API Key와 DB ID가 필요합니다.${C.reset}`);
    console.log(`\n  ${C.cyan}npx sleepcode run --notion-key <KEY> --notion-db <DB_ID>${C.reset}`);
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
  let currentDashboardHeight = 12;
  const menuState = { menuIndex: 0 };
  let gracefulShutdown = false;

  // 로그 버퍼 (리사이즈 시 재렌더링용)
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let altScreenActive = false;

  function getDashboardHeight() {
    if (watchPhase !== 'executing' || currentWorkerStates.length === 0) return 12;
    return 8 + currentWorkerStates.length * 2;
  }

  function appendLogToScreen(line) {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function watchPushLog(name, msg) {
    const t = new Date().toLocaleTimeString();
    const color = branchColor(name);
    const formatted = name && name !== 'SYSTEM'
      ? `${C.dim}[${t}]${C.reset} ${color}[${name}]${C.reset} ${msg}`
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
    const W = 62;

    lines.push(`${C.dim}╔${'═'.repeat(W + 2)}╗${C.reset}`);

    if (watchPhase === 'executing' && currentWorkerStates.length > 0) {
      const activeCount = currentWorkerStates.filter(w => w.status === 'running').length;
      lines.push(boxLine(`${SLEEPCODE_BADGE_HOVER}  run  ${C.cyan}⟳${C.reset} ${activeCount}/${currentWorkerStates.length} workers${notionLink(dbId)}`, W));
      lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);

      for (const ws of currentWorkerStates) {
        const bar = progressBar(ws.done, ws.total, 15);
        const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
          : ws.status === 'done' ? `${C.green}✓${C.reset}`
          : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
          : `${C.red}✗${C.reset}`;
        const wPct = ws.total > 0 ? Math.round(ws.done / ws.total * 100) : 0;
        const wModel = ws.provider ? `${C.dim}[${providerLabelWithModel(ws.provider, ws.model)}]${C.reset} ` : '';
        const wDiff = ws.difficultyLabel ? ` ${C.yellow}${ws.difficulty}${C.reset}` : '';
        lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(ws.name, 18)}${C.reset} ${bar} ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} ${C.cyan}${String(wPct).padStart(3)}%${C.reset} ${wModel}${wDiff}`, W));
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

      lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);

      const totalCost = currentWorkerStates.reduce((s, w) => s + (w.cost || 0), 0);
      const costStr = `$${totalCost.toFixed(4)}`;
      const elapsed = execStartTime ? Math.floor((Date.now() - execStartTime) / 1000) : 0;
      const elapsedStr = elapsed >= 3600
        ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
        : elapsed >= 60
          ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
          : `${elapsed}s`;
      const totalDone = currentWorkerStates.reduce((s, w) => s + w.done, 0);
      const totalTasks = currentWorkerStates.reduce((s, w) => s + w.total, 0);
      const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
      const remaining = lastPollTime ? Math.max(0, pollIntervalSec - Math.floor((Date.now() - lastPollTime) / 1000)) : pollIntervalSec;
      lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}${costStr}${C.reset} ${C.dim}·${C.reset} ${C.dim}경과${C.reset} ${C.cyan}${elapsedStr}${C.reset} ${C.dim}·${C.reset} ${C.cyan}${totalPct}%${C.reset} ${C.dim}·${C.reset} ${C.dim}폴링${C.reset} ${remaining}초`, W));
    } else {
      // Waiting mode
      lines.push(boxLine(`${SLEEPCODE_BADGE_HOVER}  run  ${C.dim}◆${C.reset} 대기 중${notionLink(dbId)}`, W));
      lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);
      lines.push(boxLine(`${C.dim}전체${C.reset} ${pollInfo.total}  ${C.dim}·  대기${C.reset} ${C.cyan}${pollInfo.pending}${C.reset}`, W));
      lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);
      const remaining = lastPollTime ? Math.max(0, pollIntervalSec - Math.floor((Date.now() - lastPollTime) / 1000)) : pollIntervalSec;
      lines.push(boxLine(`${C.dim}다음 폴링${C.reset} ${C.cyan}${remaining}초${C.reset}`, W));
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

  // task_queue.md에서 개별 태스크의 완료 상태를 파싱 (notion page ID 매칭)
  function parseTaskStatuses(workerPaths) {
    const statuses = {}; // { notionId: boolean (true=done) }
    for (const wsPath of workerPaths) {
      const tp = path.join(wsPath, '.sleepcode', 'task_queue.md');
      if (!fs.existsSync(tp)) continue;
      try {
        const content = fs.readFileSync(tp, 'utf-8');
        const pattern = /^- \[([ x])\] .+<!-- notion:([a-f0-9-]+) -->/gm;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          statuses[match[2]] = match[1] === 'x';
        }
      } catch {}
    }
    return statuses;
  }

  // 태스크 완료 감지 시 다음 대기 태스크를 Running으로 업데이트
  const notionInProgressIds = new Set(); // 이미 Running으로 설정된 태스크 ID 추적

  function updateNextTaskStatus(workerPaths) {
    if (!currentSchema || !currentNotionTasks || currentNotionTasks.length === 0) return;
    const statuses = parseTaskStatuses(workerPaths);

    // 워커 그룹별로 처리
    const workerGroups = {};
    for (const task of currentNotionTasks) {
      const rawWorker = (task.worker || '').trim();
      const workerKey = rawWorker.replace(/^@worker\s*/i, '').trim() || 'main';
      if (!workerGroups[workerKey]) workerGroups[workerKey] = [];
      workerGroups[workerKey].push(task);
    }

    for (const [, wTasks] of Object.entries(workerGroups)) {
      // 현재 워커 그룹에서 아직 완료되지 않은 첫 번째 태스크 찾기
      let foundRunning = false;
      for (const task of wTasks) {
        const isDone = statuses[task.id] || false;
        if (isDone) continue;
        if (!foundRunning) {
          // 이 태스크가 현재 실행 중이어야 함
          if (!notionInProgressIds.has(task.id)) {
            notionInProgressIds.add(task.id);
            const sp = buildStatusProps(currentSchema, 'Running');
            if (sp) notionUpdatePage(task.id, sp);
          }
          foundRunning = true;
        }
        // 나머지는 Queued 상태 유지 (이미 설정되어 있으므로 업데이트 불필요)
      }
    }
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

    // Notion 상태: 첫 번째 태스크만 Running, 나머지는 Pending + Run 해제
    notionInProgressIds.clear();
    const firstTaskPerWorker = new Set();
    for (const [, wTasks] of Object.entries(workerGroups)) {
      if (wTasks.length > 0) firstTaskPerWorker.add(wTasks[0].id);
    }
    for (const task of tasks) {
      const props = {};
      const statusValue = firstTaskPerWorker.has(task.id) ? 'Running' : 'Pending';
      if (statusValue === 'Running') notionInProgressIds.add(task.id);
      const sp = buildStatusProps(schema, statusValue);
      if (sp) Object.assign(props, sp);
      if (schema.run_prop) props[schema.run_prop] = { checkbox: false };
      if (Object.keys(props).length > 0) notionUpdatePage(task.id, props);
    }

    // task_queue.md 생성
    const tasksPath = path.join(scDir, 'task_queue.md');

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
        logFile: path.join(logDir, `run_${w.name}_${timestamp}.log`),
      }));

      for (const ws of workerStates) {
        const tp = path.join(ws.path, '.sleepcode', 'task_queue.md');
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
        spawnWorker(ws, py, onWorkerDone, scheduleRender, watchPushLog, cliProvider);
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
        logFile: path.join(logDir, `run_main_${timestamp}.log`),
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
      }, scheduleRender, watchPushLog, cliProvider);
    }
  }

  function finishExecution(notionTasks, schema, workerStates) {
    watchPushLog('SYSTEM', `${C.bold}실행 완료 — Notion 업데이트${C.reset}`);

    // task_queue.md에서 완료 상태 확인 (notion page ID 매칭)
    const taskCompletion = {};
    const workerPaths = (workerStates && workerStates.length > 0)
      ? workerStates.map(ws => ws.path)
      : [targetDir];

    for (const wsPath of workerPaths) {
      const tp = path.join(wsPath, '.sleepcode', 'task_queue.md');
      if (!fs.existsSync(tp)) continue;
      const content = fs.readFileSync(tp, 'utf-8');
      const pattern = /^- \[([ x])\] .+<!-- notion:([a-f0-9-]+) -->/gm;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        taskCompletion[match[2]] = match[1] === 'x';
      }
    }

    // git 커밋 기록에서 [x] 완료된 태스크 확인
    if (execStartTime) {
      const sinceISO = new Date(execStartTime - 5000).toISOString();
      for (const wsPath of workerPaths) {
        try {
          const gitLog = execSync(
            `git log --format= -p --since="${sinceISO}" -- ".sleepcode/task_queue.md"`,
            { cwd: wsPath, stdio: 'pipe', timeout: 15000 }
          ).toString();
          for (const line of gitLog.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++') && line.includes('[x]')) {
              const m = line.match(/notion:([a-f0-9-]+)/);
              if (m && !taskCompletion[m[1]]) {
                taskCompletion[m[1]] = true;
              }
            }
          }
        } catch {}
      }
    }

    // 총 비용
    const totalCost = (workerStates && workerStates.length > 0)
      ? workerStates.reduce((s, ws) => s + (ws.cost || 0), 0)
      : 0;

    // Notion 업데이트
    for (const task of notionTasks) {
      const isDone = taskCompletion[task.id] || false;
      const newStatus = isDone ? 'Success' : 'Failed';
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
      recordCost(targetDir, totalCost, 'run');
    }

    // 병렬 실행 후 자동 머지 및 워크트리 정리
    if (workerStates && workerStates.length > 1) {
      watchPushLog('SYSTEM', `${C.bold}자동 머지 시작${C.reset}`);
      let hasConflicts = false;
      try {
        const mergeResults = autoMergeWorktrees(targetDir, workerStates);
        if (mergeResults.merged.length > 0) {
          watchPushLog('SYSTEM', `${C.green}머지 성공: ${mergeResults.merged.join(', ')}${C.reset}`);
        }
        if (mergeResults.conflicted.length > 0) {
          hasConflicts = true;
          watchPushLog('SYSTEM', `${C.red}머지 충돌: ${mergeResults.conflicted.join(', ')} (수동 머지 필요)${C.reset}`);
        }
        if (mergeResults.skipped.length > 0) {
          watchPushLog('SYSTEM', `${C.dim}머지 스킵: ${mergeResults.skipped.join(', ')}${C.reset}`);
        }
      } catch (e) {
        hasConflicts = true;
        watchPushLog('SYSTEM', `${C.red}자동 머지 실패: ${e.message}${C.reset}`);
      }

      if (hasConflicts) {
        watchPushLog('SYSTEM', `${C.yellow}머지 충돌이 남아있어 워크트리를 유지합니다. 수동 해결 후 'npx sleepcode parallel --clean'으로 정리하세요.${C.reset}`);
      } else {
        watchPushLog('SYSTEM', `${C.bold}워크트리 정리${C.reset}`);
        try {
          cleanupWorktrees(targetDir, null);
          watchPushLog('SYSTEM', `${C.green}워크트리 정리 완료${C.reset}`);
        } catch (e) {
          watchPushLog('SYSTEM', `${C.red}워크트리 정리 실패: ${e.message}${C.reset}`);
        }
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

    // 실행 완료 후 즉시 폴링 — 실행 중 추가된 태스크를 바로 감지
    if (!gracefulShutdown) {
      setTimeout(doPoll, 1000);
    }
  }

  // ─── 실행 중 새 태스크 추가 ───

  function addTasksDuringExecution(newTasks, schema) {
    for (const task of newTasks) {
      executingTaskIds.add(task.id);
      watchPushLog('SYSTEM', `${C.yellow}↷${C.reset} ${task.title} — 현재 배치 완료 후 다음 실행`);
    }

    scheduleRender();
  }

  // ─── 폴링 루프 ───

  function doPoll() {
    lastPollTime = Date.now();

    // graceful_stop 체크
    if (fs.existsSync(path.join(scDir, 'graceful_stop'))) {
      cleanupAltScreen();
      console.log(`\n${C.yellow}graceful_stop 감지 — run 종료${C.reset}`);
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
        return !['in progress', '진행 중', 'running', 'pending'].includes(status);
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

  // 5초마다 task_queue.md를 읽어 진행률 갱신 + 개별 태스크 Notion 상태 업데이트
  const taskProgressInterval = setInterval(() => {
    if (watchPhase !== 'executing' || currentWorkerStates.length === 0) return;
    for (const ws of currentWorkerStates) {
      if (ws.status !== 'running') continue;
      const tp = path.join(ws.path, '.sleepcode', 'task_queue.md');
      try {
        if (fs.existsSync(tp)) {
          const content = fs.readFileSync(tp, 'utf-8');
          const tc = countTasks(content);
          ws.done = tc.done;
          ws.total = tc.total;
        }
      } catch {}
    }
    // 완료된 태스크 감지 → 다음 대기 태스크를 Running으로 업데이트
    const workerPaths = currentWorkerStates.map(ws => ws.path);
    updateNextTaskStatus(workerPaths);
    scheduleRender();
  }, 5000);

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
      clearInterval(taskProgressInterval);
      for (const ws of currentWorkerStates) {
        if (ws._proc) try { ws._proc.kill(); } catch {}
      }
      cleanupAltScreen();
      console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
      process.exit(0);
    },
    // 추가 메뉴: 즉시 폴링
    [{ label: '즉시 폴링', noConfirm: true, handler: () => {
      watchPushLog('SYSTEM', `${C.cyan}즉시 폴링 실행${C.reset}`);
      doPoll();
      renderDashboard();
    }}]
  );

  // 종료 핸들러
  const sigintHandler = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    clearInterval(pollTimer);
    clearInterval(dashboardInterval);
    clearInterval(taskProgressInterval);
    // 실행 중인 워커 프로세스 종료
    for (const ws of currentWorkerStates) {
      if (ws._proc) try { ws._proc.kill(); } catch {}
    }
    cleanupAltScreen();
    console.log(`\n${C.yellow}run 종료${C.reset}`);
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);
  process.on('exit', cleanupAltScreen);
}

module.exports = {
  runWorker: cmdWatch,
};

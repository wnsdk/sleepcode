const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { C, PROVIDERS } = require('./constants');
const {
  countTasks,
  getNextPendingTask,
  getNextPendingTaskEntry,
  getTaskDoneFilePath,
  readTaskDoneSet,
  readCurrentRunTaskDoneSet,
  appendTaskDone,
  visualWidth,
} = require('./utils');
const {
  resolveProviderPlan,
  providerLabel,
  getProviderRunCommand,
  buildExecutionPrompt,
  assessTaskDifficulty,
  DEFAULT_PROVIDER_MODELS,
} = require('./provider');
const { recordCost } = require('./config');
const { buildClaudeMdContent, syncClaudeMd } = require('./files');

function processStreamEvent(ws, obj, onUpdate, pushLog) {
  const msgType = obj.type;

  const trimByWidth = (text, width) => {
    const src = (text || '').trim();
    if (!src) return '';
    if (visualWidth(src) <= width) return src;
    let tw = 0;
    let cut = 0;
    for (const ch of src) {
      const cw = visualWidth(ch);
      if (tw + cw > width - 3) break;
      tw += cw;
      cut += ch.length;
    }
    return src.slice(0, cut) + '...';
  };

  const appendReport = (text) => {
    const body = (text || '').trim();
    if (!body) return;
    if (!ws.reportLines) ws.reportLines = [];
    ws.reportLines.push(body);
    pushLog(ws.name, `${C.dim}${trimByWidth(body, 132)}${C.reset}`);
    onUpdate();
  };

  if (msgType === 'assistant') {
    const contents = (obj.message && obj.message.content) || [];
    for (const c of contents) {
      if (c.type === 'text') {
        appendReport(c.text || '');
      } else if (c.type === 'tool_use') {
        const name = c.name || '?';
        const inp = c.input || {};

        if (name === 'TodoWrite') {
          const todos = inp.todos || [];
          const active = todos.find(t => t.status === 'in_progress');
          if (active) ws.currentTask = active.activeForm || active.content || '';
        }

        let detail = '';
        if (name === 'Read' || name === 'Write' || name === 'Edit') {
          const fp = inp.file_path || '';
          detail = fp.split(/[/\\]/).pop() || fp;
        } else if (name === 'Bash') {
          detail = trimByWidth(inp.command || '', 117);
        } else if (name === 'Glob' || name === 'Grep') {
          detail = inp.pattern || '';
        }

        const logMsg = detail
          ? `${C.cyan}[TOOL]${C.reset} ${name}: ${detail}`
          : `${C.cyan}[TOOL]${C.reset} ${name}`;
        pushLog(ws.name, logMsg);
        onUpdate();
      }
    }
    return;
  }

  if (msgType === 'result') {
    const cost = obj.cost_usd;
    if (cost != null) {
      ws.cost = cost;
      if (ws.targetDir) recordCost(ws.targetDir, cost, 'parallel', ws.name);
    }

  const tasksPath2 = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');
  if (fs.existsSync(tasksPath2)) {
    const content = fs.readFileSync(tasksPath2, 'utf-8');
    const doneState = getWorkerDoneState(ws);
    const tc = countTasks(content, doneState.doneSet);
    ws.done = tc.done;
    ws.total = tc.total;
    }

    const msg = typeof obj.message === 'string' ? obj.message : '';
    if (msg) {
      pushLog(ws.name, `${C.green}[DONE]${C.reset} ${trimByWidth(msg, 117)}`);
    }
    onUpdate();
    return;
  }

  if ((msgType === 'item.started' || msgType === 'item.completed') && obj.item) {
    const item = obj.item;

    if (item.type === 'agent_message') {
      appendReport(item.text || '');
      return;
    }

    if (item.type === 'command_execution') {
      const command = trimByWidth(item.command || '', 110);
      if (msgType === 'item.started') {
        pushLog(ws.name, `${C.cyan}[TOOL]${C.reset} Bash: ${command}`);
      } else {
        const exitCode = (typeof item.exit_code === 'number') ? item.exit_code : null;
        const tail = exitCode == null ? '' : ` (exit ${exitCode})`;
        pushLog(ws.name, `${C.cyan}[TOOL]${C.reset} Bash done${tail}: ${command}`);
      }
      onUpdate();
      return;
    }
  }

  if (msgType === 'turn.completed') {
    const usage = obj.usage || {};
    const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
    const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (inputTokens + outputTokens);
    if (totalTokens > 0) {
      pushLog(ws.name, `${C.dim}[TOKENS] in:${inputTokens} out:${outputTokens} total:${totalTokens}${C.reset}`);
      onUpdate();
    }
  }
}

function formatExecError(err) {
  if (!err) return 'unknown error';
  const stderr = err.stderr ? String(err.stderr).trim() : '';
  if (stderr) return stderr;
  const stdout = err.stdout ? String(err.stdout).trim() : '';
  if (stdout) return stdout;
  return err.message || 'unknown error';
}

function gitOutput(targetDir, args) {
  return execFileSync('git', args, {
    cwd: targetDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim();
}

function getHeadCommit(targetDir) {
  return gitOutput(targetDir, ['rev-parse', 'HEAD']);
}

function ensureWorkerDoneTracking(ws, targetDir = null) {
  const resolvedTargetDir = targetDir || ws.path;
  const initialState = readTaskDoneSet(resolvedTargetDir, ws.doneFilePath);
  ws.doneFilePath = initialState.doneFilePath;
  if (!ws.initialDoneKeys) ws.initialDoneKeys = new Set(initialState.doneSet);
  if (!ws.completedTaskKeys) ws.completedTaskKeys = new Set();
}

function getWorkerDoneState(ws, targetDir = null) {
  const resolvedTargetDir = targetDir || ws.path;
  ensureWorkerDoneTracking(ws, resolvedTargetDir);
  return readCurrentRunTaskDoneSet(
    resolvedTargetDir,
    ws.doneFilePath,
    ws.initialDoneKeys,
    ws.completedTaskKeys
  );
}

function detectForbiddenGitWriteCommand(obj) {
  if (!obj || !obj.item || obj.item.type !== 'command_execution') return null;
  const command = String(obj.item.command || '').trim();
  if (!command) return null;

  const lowered = command.toLowerCase();
  const forbiddenPattern = /\bgit\s+(add|commit|merge|checkout|switch|cherry-pick|rebase|reset|restore|stash|worktree|clean)\b/;
  if (!forbiddenPattern.test(lowered)) return null;
  return command;
}

function getTerminalResultMeta(obj) {
  if (!obj || obj.type !== 'result') return null;

  const subtype = String(obj.subtype || '').trim().toLowerCase();
  const stopReason = String(obj.stop_reason || '').trim().toLowerCase();
  const message = typeof obj.message === 'string'
    ? obj.message.trim()
    : typeof obj.result === 'string'
      ? obj.result.trim()
      : '';

  return {
    success: obj.is_error !== true && subtype !== 'error',
    subtype,
    stopReason,
    message,
  };
}

function terminateProcessTree(proc) {
  if (!proc || !proc.pid) return;

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return;
    } catch {}
  }

  try {
    proc.kill('SIGTERM');
  } catch {}
}

function stageTaskChanges(targetDir) {
  try {
    execFileSync('git', ['add', '-u', '--', '.'], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { ok: false, reason: 'git_add_failed', error: formatExecError(e) };
  }

  let untrackedFiles = [];
  try {
    untrackedFiles = gitOutput(targetDir, ['ls-files', '--others', '--exclude-standard', '--']).split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return { ok: false, reason: 'git_ls_untracked_failed', error: formatExecError(e) };
  }

  const addableUntracked = untrackedFiles.filter((filePath) => {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return normalized !== '.sleepcode' && !normalized.startsWith('.sleepcode/');
  });

  if (addableUntracked.length > 0) {
    try {
      execFileSync('git', ['add', '--', ...addableUntracked], {
        cwd: targetDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      return { ok: false, reason: 'git_add_untracked_failed', error: formatExecError(e) };
    }
  }

  let stagedFiles = [];
  try {
    stagedFiles = gitOutput(targetDir, ['diff', '--cached', '--name-only', '--']).split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return { ok: false, reason: 'git_diff_cached_failed', error: formatExecError(e) };
  }

  if (stagedFiles.length === 0) {
    return { ok: false, reason: 'no_changes' };
  }

  return { ok: true, stagedFiles };
}

function normalizeCommitSubject(taskTitle) {
  let subject = String(taskTitle || '')
    .replace(/\s*<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!subject) return 'update project files';

  const prefixed = subject.match(/^([a-z]+(?:\([^)]+\))?):\s+(.+)$/i);
  if (prefixed) {
    subject = prefixed[2].trim();
  }

  subject = subject
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .replace(/[.。!！?？]+$/g, '')
    .trim();

  const trailingPatterns = [
    /\s*(?:해줘|해주세요|해\s*주세요|부탁해(?:요)?|부탁합니다)$/u,
    /\s*(?:해주기|진행해줘|진행해주세요|반영해줘|반영해주세요)$/u,
    /\s*(?:되게 해줘|되도록 해줘|되게 해주세요|되도록 해주세요)$/u,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of trailingPatterns) {
      const next = subject.replace(pattern, '').trim();
      if (next && next !== subject) {
        subject = next;
        changed = true;
      }
    }
  }

  return subject || 'update project files';
}

function inferCommitPrefix(taskTitle, stagedFiles = []) {
  const title = String(taskTitle || '');
  const lowered = title.toLowerCase();
  const files = stagedFiles.map((filePath) => String(filePath || '').replace(/\\/g, '/').toLowerCase());
  const hasFile = (pattern) => files.some((filePath) => pattern.test(filePath));
  const allFilesMatch = (predicate) => files.length > 0 && files.every(predicate);

  const prefixed = title.match(/^([a-z]+(?:\([^)]+\))?):\s+(.+)$/i);
  if (prefixed) {
    return prefixed[1].toLowerCase();
  }

  if (
    /\b(readme|docs?)\b/i.test(title)
    || /문서|가이드|설명|주석/u.test(title)
    || allFilesMatch((filePath) => filePath.endsWith('.md') || filePath.startsWith('docs/') || filePath.startsWith('.sleepcode/docs/'))
  ) {
    return 'docs';
  }

  if (/\b(test|spec|jest|vitest|cypress|playwright)\b/i.test(title) || /테스트|검증|커버리지/u.test(title)) {
    return 'test';
  }

  if (/\b(fix|bug|hotfix|regression|crash|incident)\b/i.test(title) || /버그|오류|에러|실패|깨짐|충돌|문제/u.test(title)) {
    return 'fix';
  }

  if (/\b(refactor|cleanup|clean up)\b/i.test(title) || /리팩토링|정리/u.test(title)) {
    return 'refactor';
  }

  if (/\b(perf|performance|optimi[sz]e)\b/i.test(title) || /성능|최적화/u.test(title)) {
    return 'perf';
  }

  if (/\b(ci|workflow|github actions)\b/i.test(title) || hasFile(/(^|\/)\.github\/workflows\//)) {
    return 'ci';
  }

  if (/\b(lint|format|prettier|eslint|style)\b/i.test(title) || /포맷|스타일|오타/u.test(title)) {
    return 'style';
  }

  if (
    /\b(build|deploy|release|publish|package|version|dependency|dependencies|deps|npm|pnpm|yarn)\b/i.test(title)
    || /배포|릴리즈|퍼블리시|버전|의존성/u.test(title)
    || hasFile(/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/)
  ) {
    return 'chore';
  }

  if (
    /\b(config|setting|settings|env|dotenv|gitignore|gitattributes)\b/i.test(title)
    || /설정|환경변수|초기화/u.test(title)
  ) {
    return 'chore';
  }

  if (/\b(add|create|implement|support|introduce|enable|integrat(e|ion)|new)\b/i.test(lowered) || /추가|구현|생성|작성|도입|연동|지원|만들/u.test(title)) {
    return 'feat';
  }

  return 'feat';
}

function buildTaskCommitMessage(taskEntry, stagedFiles = []) {
  const taskTitle = taskEntry && taskEntry.title ? taskEntry.title : '';
  const subject = normalizeCommitSubject(taskTitle);
  const prefix = inferCommitPrefix(subject, stagedFiles);
  return `${prefix}: ${subject}`;
}

function commitTaskNow(targetDir, taskEntry, startHead) {
  if (!taskEntry || !taskEntry.title) {
    return { committed: false, reason: 'empty_task' };
  }

  if (!startHead) {
    return { committed: false, reason: 'missing_start_head' };
  }

  let currentHead = '';
  try {
    currentHead = getHeadCommit(targetDir);
  } catch (e) {
    return {
      committed: false,
      reason: 'git_head_failed',
      error: formatExecError(e),
    };
  }

  if (currentHead !== startHead) {
    return {
      committed: false,
      reason: 'manual_commit_detected',
      startHead,
      endHead: currentHead,
    };
  }

  const stageResult = stageTaskChanges(targetDir);
  if (!stageResult.ok) {
    return {
      committed: false,
      reason: stageResult.reason,
      error: stageResult.error,
    };
  }

  const msg = buildTaskCommitMessage(taskEntry, stageResult.stagedFiles);
  try {
    execFileSync('git', ['commit', '-m', msg], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return {
      committed: false,
      reason: 'git_commit_failed',
      error: formatExecError(e),
      stagedFiles: stageResult.stagedFiles,
    };
  }

  let endHead = '';
  try {
    endHead = getHeadCommit(targetDir);
  } catch (e) {
    return {
      committed: false,
      reason: 'git_head_failed',
      error: formatExecError(e),
      stagedFiles: stageResult.stagedFiles,
    };
  }

  if (!endHead || endHead === startHead) {
    return {
      committed: false,
      reason: 'head_unchanged',
      stagedFiles: stageResult.stagedFiles,
      startHead,
      endHead,
    };
  }

  return {
    committed: true,
    message: msg,
    stagedFiles: stageResult.stagedFiles,
    startHead,
    endHead,
  };
}

function spawnWorker(ws, py, onDone, onUpdate, pushLog, cliProvider, onTaskCompleted, onTaskStarted, onTaskUiUpdated) {
  const wtDir = ws.path;
  const tasksPath = ws.tasksPath || path.join(wtDir, '.sleepcode', 'task_queue.md');
  const claudeMdPath = path.join(wtDir, 'CLAUDE.md');
  const generatedClaudeMd = buildClaudeMdContent(wtDir);
  const initialClaudeMd = fs.existsSync(claudeMdPath)
    ? { exists: true, content: fs.readFileSync(claudeMdPath, 'utf-8') }
    : { exists: false, content: '' };
  syncClaudeMd(wtDir);
  ws.doneFilePath = ws.doneFilePath || getTaskDoneFilePath(wtDir);
  ensureWorkerDoneTracking(ws, wtDir);

  const restoreRuntimeClaudeMd = () => {
    if (!generatedClaudeMd) return;
    if (!fs.existsSync(claudeMdPath)) return;
    const current = fs.readFileSync(claudeMdPath, 'utf-8');
    if (current !== generatedClaudeMd) return;
    if (initialClaudeMd.exists) {
      fs.writeFileSync(claudeMdPath, initialClaudeMd.content);
    } else {
      fs.unlinkSync(claudeMdPath);
    }
  };

  const readDoneLogText = () => {
    if (fs.existsSync(ws.doneFilePath)) {
      return fs.readFileSync(ws.doneFilePath, 'utf-8');
    }
    return '# 완료 기록\n\n';
  };
  const doneFileRel = path.relative(wtDir, ws.doneFilePath).replace(/\\/g, '/');
  const runtimeRules = [
    '# Runtime Rules',
    '- This run owns exactly one task. Complete only the current task shown below.',
    '- Do not continue to another task even if more backlog items exist.',
    '- .sleepcode/task_queue.md is read-only backlog. Never edit it.',
    `- Never edit ${doneFileRel} or any other .sleepcode/task_done file.`,
    '- Never run git add, git commit, git merge, git checkout, git switch, git restore, git reset, git stash, or git worktree commands.',
    '- The runtime will append task_done entries and create the git commit after you exit.',
    '- After implementing the current task, stop and return a short summary.',
    '',
  ].join('\n');
  const buildTaskPrompt = (taskEntry) => {
    const notionTag = taskEntry && taskEntry.notionId ? ` <!-- notion:${taskEntry.notionId} -->` : '';
    const currentTaskBlock = taskEntry
      ? `# Current Task\n\n- [ ] ${taskEntry.title}${notionTag}`
      : '# Current Task\n\n- [ ] (missing task)';
    const doneLog = readDoneLogText().trimEnd();
    if (!doneLog) return `${runtimeRules}\n${currentTaskBlock}`;
    return `${runtimeRules}\n${currentTaskBlock}\n\n---\n\n${doneLog}\n`;
  };

  const logStream = fs.createWriteStream(ws.logFile, { flags: 'a' });
  const logLine = (msg) => logStream.write(`[${new Date().toISOString()}] ${msg}\n`);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  function finalize(code, errMsg) {
    try {
      restoreRuntimeClaudeMd();
    } catch {}

    logLine(`=== Worker ${ws.name} end (code: ${code}) ===`);
    if (errMsg) logLine(`ERROR: ${errMsg}`);
    logStream.end();

    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const doneState = getWorkerDoneState(ws, wtDir);
      const tc = countTasks(content, doneState.doneSet);
      ws.done = tc.done;
      ws.total = tc.total;
    }

    ws.status = (code === 0) ? 'done' : 'failed';
    ws.currentTask = errMsg || '';
    onUpdate();
    onDone();
  }

  /** 태스크 1개를 실행하는 내부 함수. 완료 후 다음 태스크가 있으면 재귀 호출. */
  function runNextTask() {
    const taskQueueText = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';

    if (!taskQueueText.trim()) {
      const relTasksPath = path.relative(wtDir, tasksPath).replace(/\\/g, '/');
      pushLog(ws.name, `${C.red}[ERROR] task prompt is empty (${relTasksPath}).${C.reset}`);
      finalize(1, 'task prompt is empty');
      return;
    }

    // 미완료 태스크가 없으면 완료 처리
    const doneState = getWorkerDoneState(ws, wtDir);
    const nextTaskEntry = getNextPendingTaskEntry(taskQueueText, doneState.doneSet);
    const nextTask = nextTaskEntry ? nextTaskEntry.title : null;
    if (!nextTaskEntry) {
      finalize(0);
      return;
    }

    // 태스크마다 provider를 ratio에 따라 새로 선택
    try {
      const plan = resolveProviderPlan(ws.targetDir || wtDir, cliProvider);
      ws.provider = plan.selected;
      ws.fallbackProvider = plan.fallback;
      if (plan.ratioSelected) {
        pushLog(ws.name, `${C.dim}[비율 선택] ${providerLabel(plan.selected)}${C.reset}`);
      }
      if (plan.requestedUnavailable) {
        pushLog(ws.name, `${C.yellow}[PROVIDER] requested provider unavailable, switched to ${providerLabel(plan.selected)}${C.reset}`);
      }
    } catch (e) {
      pushLog(ws.name, `${C.red}[ERROR] ${e.message}${C.reset}`);
      finalize(1, e.message);
      return;
    }

    // 태스크마다 난이도 재평가
    try {
      const assessment = assessTaskDifficulty(nextTask, ws.targetDir || wtDir, ws.provider);
      ws.difficulty = assessment.difficulty;
      ws.difficultyLabel = assessment.label;
      ws.model = assessment.model;
      pushLog(ws.name, `${C.cyan}[DIFFICULTY]${C.reset} ${assessment.label} (${assessment.difficulty}/5) → ${assessment.model}`);
    } catch {
      ws.difficulty = 3;
      ws.difficultyLabel = '★★★☆☆';
      ws.model = DEFAULT_PROVIDER_MODELS[ws.provider] || DEFAULT_PROVIDER_MODELS[PROVIDERS.CLAUDE];
    }
    onUpdate();

    let taskStartHead = '';
    try {
      taskStartHead = getHeadCommit(wtDir);
    } catch (e) {
      const message = `git head unavailable: ${formatExecError(e)}`;
      pushLog(ws.name, `${C.red}[ERROR] ${message}${C.reset}`);
      finalize(1, message);
      return;
    }

    logLine(`=== Task start (provider: ${ws.provider}, model: ${ws.model || 'default'}, difficulty: ${ws.difficulty || 'N/A'}) task: ${nextTask} ===`);

    if (typeof onTaskStarted === 'function') {
      try {
        onTaskStarted({
          worker: ws,
          taskEntry: nextTaskEntry,
          model: ws.model,
          provider: ws.provider,
          difficulty: ws.difficulty,
        });
      } catch {}
    }

    const taskPrompt = buildTaskPrompt(nextTaskEntry);
    const promptsByProvider = {
      [PROVIDERS.CLAUDE]: taskPrompt,
      [PROVIDERS.CODEX]: buildExecutionPrompt(wtDir, taskPrompt, PROVIDERS.CODEX),
    };

    function runAttempt(provider, allowFallback) {
      ws.provider = provider;
      const invoke = getProviderRunCommand(provider, false, ws.model);
      const stdinPrompt = promptsByProvider[provider] || taskPrompt;

      const proc = spawn(invoke.command, invoke.args, {
        cwd: wtDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      ws._proc = proc;
      proc.stdin.write(stdinPrompt);
      proc.stdin.end();

      let buffer = '';
      let sawEvents = false;
      let blockedCommandError = null;
      let terminalResult = null;
      let resultExitTimer = null;

      const clearResultExitTimer = () => {
        if (!resultExitTimer) return;
        clearTimeout(resultExitTimer);
        resultExitTimer = null;
      };

      const scheduleResultExit = () => {
        if (provider !== PROVIDERS.CLAUDE || !terminalResult || resultExitTimer) return;
        // Claude may emit a terminal result while a background Bash task keeps the CLI process alive.
        resultExitTimer = setTimeout(() => {
          resultExitTimer = null;
          if (proc.exitCode != null || proc.killed) return;
          logLine(`FORCE_CLOSE_AFTER_RESULT: ${provider}`);
          pushLog(ws.name, `${C.dim}[EXIT]${C.reset} Claude result 수신 후 남은 프로세스를 정리합니다`);
          onUpdate();
          terminateProcessTree(proc);
        }, 1500);
      };

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
            const forbiddenCommand = detectForbiddenGitWriteCommand(obj);
            if (forbiddenCommand && !blockedCommandError) {
              blockedCommandError = `forbidden git write command attempted: ${forbiddenCommand}`;
              logLine(`BLOCKED_GIT_WRITE: ${forbiddenCommand}`);
              pushLog(ws.name, `${C.red}[BLOCK]${C.reset} git write command 차단`);
              onUpdate();
              terminateProcessTree(proc);
            }
            const resultMeta = getTerminalResultMeta(obj);
            if (resultMeta && !terminalResult) {
              terminalResult = resultMeta;
              scheduleResultExit();
            }
            processStreamEvent(ws, obj, onUpdate, pushLog);
          } catch {}
        }
      });

      proc.stderr.on('data', (data) => {
        logStream.write(`[STDERR] ${data.toString()}`);
      });

      proc.on('close', async (code) => {
        clearResultExitTimer();

        if (buffer.trim()) {
          logStream.write(buffer + '\n');
          try {
            const obj = JSON.parse(buffer);
            const forbiddenCommand = detectForbiddenGitWriteCommand(obj);
            if (forbiddenCommand && !blockedCommandError) {
              blockedCommandError = `forbidden git write command attempted: ${forbiddenCommand}`;
              logLine(`BLOCKED_GIT_WRITE: ${forbiddenCommand}`);
            }
            const resultMeta = getTerminalResultMeta(obj);
            if (resultMeta && !terminalResult) {
              terminalResult = resultMeta;
            }
            processStreamEvent(ws, obj, onUpdate, pushLog);
            sawEvents = true;
          } catch {}
        }

        if (blockedCommandError) {
          finalize(1, blockedCommandError);
          return;
        }

        let effectiveCode = code;
        if (terminalResult) {
          effectiveCode = terminalResult.success ? 0 : 1;
        }
        const closeError = terminalResult && !terminalResult.success
          ? (terminalResult.message || 'provider returned an error')
          : null;

        if (effectiveCode !== 0 && allowFallback && ws.fallbackProvider && ws.fallbackProvider !== provider && !sawEvents && !terminalResult) {
          const fromLabel = providerLabel(provider);
          const toLabel = providerLabel(ws.fallbackProvider);
          pushLog(ws.name, `${C.yellow}[FALLBACK]${C.reset} ${fromLabel} failed, retrying with ${toLabel}`);
          logLine(`FALLBACK: ${provider} -> ${ws.fallbackProvider}`);
          onUpdate();
          runAttempt(ws.fallbackProvider, false);
          return;
        }

        // 태스크 완료 여부 확인 후 다음 태스크로 이동
        if (fs.existsSync(tasksPath)) {
          const updatedContent = fs.readFileSync(tasksPath, 'utf-8');
          let updatedDoneState = getWorkerDoneState(ws, wtDir);
          let finalCode = effectiveCode;
          let finalError = closeError;
          let commitResult = null;

          if (finalCode === 0 && nextTaskEntry) {
            try {
              restoreRuntimeClaudeMd();
            } catch (e) {
              finalCode = 1;
              finalError = `runtime cleanup failed: ${e.message}`;
            }

            commitResult = finalCode === 0
              ? commitTaskNow(wtDir, nextTaskEntry, taskStartHead)
              : { committed: false, reason: 'runtime_cleanup_failed', error: finalError };

            if (commitResult.committed) {
              pushLog(ws.name, `${C.green}[COMMIT]${C.reset} ${nextTaskEntry.title}`);
              try {
                const appended = appendTaskDone(
                  wtDir,
                  nextTaskEntry,
                  ws.doneFilePath,
                  updatedDoneState.doneSet
                );
                if (appended) {
                  ws.completedTaskKeys.add(nextTaskEntry.key);
                  pushLog(ws.name, `${C.green}[DONELOG]${C.reset} ${nextTaskEntry.title}`);
                  updatedDoneState = getWorkerDoneState(ws, wtDir);
                } else {
                  finalCode = 1;
                  finalError = 'task_done append skipped unexpectedly';
                  pushLog(ws.name, `${C.red}[DONELOG]${C.reset} ${nextTaskEntry.title} (duplicate)`);
                }
              } catch (e) {
                finalCode = 1;
                finalError = `task_done append failed: ${e.message}`;
                pushLog(ws.name, `${C.red}[DONELOG]${C.reset} ${nextTaskEntry.title} (${e.message})`);
              }
            } else {
              finalCode = 1;
              finalError = `commit failed: ${commitResult.reason}${commitResult.error ? ` (${commitResult.error})` : ''}`;
              pushLog(ws.name, `${C.red}[COMMIT]${C.reset} ${nextTaskEntry.title} (${commitResult.reason})`);
            }

          }

          const tc = countTasks(updatedContent, updatedDoneState.doneSet);
          ws.done = tc.done;
          ws.total = tc.total;
          if (typeof onTaskCompleted === 'function') {
            try {
              await Promise.resolve(onTaskCompleted({
                worker: ws,
                taskEntry: nextTaskEntry,
                commit: commitResult,
              }));
            } catch {}
          }

          onUpdate();
          if (typeof onTaskUiUpdated === 'function') {
            try {
              await Promise.resolve(onTaskUiUpdated({
                worker: ws,
                taskEntry: nextTaskEntry,
                code: finalCode,
                error: finalError,
              }));
            } catch {}
          }

          // 미완료 태스크가 남아있으면 다음 태스크 실행 (provider 재선택)
          const remaining = getNextPendingTask(updatedContent, updatedDoneState.doneSet);
          if (remaining && finalCode === 0) {
            pushLog(ws.name, `${C.cyan}[NEXT]${C.reset} 다음 태스크로 이동`);
            runNextTask();
            return;
          }

          finalize(finalCode, finalError);
          return;
        }

        finalize(effectiveCode, effectiveCode === 0 ? null : closeError);
      });

      proc.on('error', (err) => {
        clearResultExitTimer();
        if (allowFallback && ws.fallbackProvider && ws.fallbackProvider !== provider) {
          const fromLabel = providerLabel(provider);
          const toLabel = providerLabel(ws.fallbackProvider);
          pushLog(ws.name, `${C.yellow}[FALLBACK]${C.reset} ${fromLabel} failed, retrying with ${toLabel}`);
          logLine(`FALLBACK_ERROR: ${err.message}`);
          onUpdate();
          runAttempt(ws.fallbackProvider, false);
          return;
        }
        finalize(1, err.message);
      });
    }

    runAttempt(ws.provider, true);
  }

  // 첫 번째 태스크 실행 시작
  runNextTask();
}

module.exports = {
  buildTaskCommitMessage,
  processStreamEvent,
  spawnWorker,
};

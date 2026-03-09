const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { C, PROVIDERS } = require('./constants');
const {
  getNextPendingTaskEntry,
  getTaskDoneFilePath,
} = require('./utils');
const {
  providerLabel,
  getProviderRunCommand,
} = require('./provider');
const { buildClaudeMdContent, syncClaudeMd } = require('./files');
const {
  ensureWorkerDoneTracking,
  getWorkerDoneState,
  syncWorkerTaskProgress,
} = require('./taskState');
const { processStreamEvent, getTerminalResultMeta, isAiLimitError } = require('./workerStreamProcessing');
const { loadConfig } = require('./config');
const { detectForbiddenGitWriteCommand, terminateProcessTree } = require('./workerGitOps');
const { buildTaskCommitMessage, commitTaskNow } = require('./workerCommit');
const { prepareTaskExecution } = require('./workerTaskPrep');
const { handleTaskCompletion } = require('./workerTaskCompletion');

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
  const tasksFileRel = path.relative(wtDir, tasksPath).replace(/\\/g, '/');
  const doneFileRel = path.relative(wtDir, ws.doneFilePath).replace(/\\/g, '/');
  const runtimeRules = [
    '# Runtime Rules',
    '- This run owns exactly one task. Complete only the current task shown below.',
    '- Do not continue to another task even if more backlog items exist.',
    '- .sleepcode/task_queue.md is read-only backlog. Never edit it.',
    `- Never edit ${tasksFileRel}; runtime manages the active task list.`,
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
      syncWorkerTaskProgress(ws, wtDir, content);
    }

    if (ws.stopRequested === 'immediate') {
      ws.status = 'terminated';
      ws.currentTask = '사용자 요청으로 즉시 종료됨';
      ws.stopRequested = null;
    } else {
      ws.status = (code === 0) ? 'done' : 'failed';
      ws.currentTask = errMsg || '';
    }
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
    const completedTaskKeys = doneState.allDoneSet || doneState.rawDoneSet || doneState.doneSet;
    const nextTaskEntry = getNextPendingTaskEntry(taskQueueText, completedTaskKeys);
    const nextTask = nextTaskEntry ? nextTaskEntry.title : null;
    if (!nextTaskEntry) {
      finalize(0);
      return;
    }

    const prep = prepareTaskExecution({
      ws, wtDir, nextTask, cliProvider,
      buildTaskPrompt, nextTaskEntry, pushLog, onUpdate,
    });
    if (prep.error) {
      pushLog(ws.name, `${C.red}[ERROR] ${prep.error}${C.reset}`);
      finalize(1, prep.error);
      return;
    }
    const { taskStartHead, promptsByProvider, taskPrompt } = prep;

    // AI 한도 초과 시 동작 설정: 'fail'(기본) 또는 'wait'
    const config = loadConfig(wtDir) || {};
    const onAiLimit = config.onAiLimit || 'fail';
    // 지수 백오프: 60s → 120s → 240s → ... (최대 3600s)
    let aiLimitRetryCount = 0;

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

        // AI 한도 초과 에러 처리: onAiLimit === 'wait'이면 대기 후 재시도
        if (effectiveCode !== 0 && isAiLimitError(closeError) && onAiLimit === 'wait') {
          const waitSeconds = Math.min(60 * Math.pow(2, aiLimitRetryCount), 3600);
          aiLimitRetryCount += 1;
          const waitMin = Math.round(waitSeconds / 60);
          const waitLabel = waitSeconds >= 60 ? `${waitMin}분` : `${waitSeconds}초`;
          pushLog(ws.name, `${C.yellow}[AI_LIMIT]${C.reset} AI 한도 초과 — ${waitLabel} 후 재시도 (${aiLimitRetryCount}회차)`);
          logLine(`AI_LIMIT_WAIT: waitSeconds=${waitSeconds} retryCount=${aiLimitRetryCount} error=${closeError}`);
          onUpdate();
          setTimeout(() => runAttempt(provider, allowFallback), waitSeconds * 1000);
          return;
        }

        const result = await handleTaskCompletion({
          ws, wtDir, tasksPath, nextTaskEntry, taskStartHead,
          effectiveCode, closeError, restoreRuntimeClaudeMd,
          pushLog, onUpdate, onTaskCompleted, onTaskUiUpdated,
        });

        if (result.shouldContinue) {
          pushLog(ws.name, `${C.cyan}[NEXT]${C.reset} 다음 태스크로 이동`);
          runNextTask();
          return;
        }

        finalize(result.finalCode, result.finalError);
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
  _internals: {
    commitTaskNow,
  },
};

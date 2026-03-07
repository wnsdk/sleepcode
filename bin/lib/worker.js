const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { C, PROVIDERS } = require('./constants');
const {
  getNextPendingTask,
  getNextPendingTaskEntry,
  getTaskDoneFilePath,
} = require('./utils');
const {
  resolveProviderPlan,
  providerLabel,
  getProviderRunCommand,
  buildExecutionPrompt,
  assessTaskDifficulty,
  DEFAULT_PROVIDER_MODELS,
} = require('./provider');
const { buildClaudeMdContent, syncClaudeMd } = require('./files');
const {
  ensureWorkerDoneTracking,
  getWorkerDoneState,
  syncWorkerTaskProgress,
} = require('./taskState');
const { processStreamEvent, getTerminalResultMeta } = require('./workerStreamProcessing');
const { formatExecError, getHeadCommit, detectForbiddenGitWriteCommand, terminateProcessTree } = require('./workerGitOps');
const { buildTaskCommitMessage, commitTaskNow } = require('./workerCommit');

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
              ? commitTaskNow(wtDir, nextTaskEntry, taskStartHead, {
                doneFilePath: ws.doneFilePath,
                dedupeSet: updatedDoneState.doneSet,
              })
              : { committed: false, reason: 'runtime_cleanup_failed', error: finalError };

            if (commitResult.committed) {
              ws.completedTaskKeys.add(nextTaskEntry.key);
              pushLog(ws.name, `${C.green}[DONELOG]${C.reset} ${nextTaskEntry.title}`);
              pushLog(ws.name, `${C.green}[COMMIT]${C.reset} ${nextTaskEntry.title}`);
              updatedDoneState = getWorkerDoneState(ws, wtDir);
            } else {
              finalCode = 1;
              finalError = `commit failed: ${commitResult.reason}${commitResult.error ? ` (${commitResult.error})` : ''}`;
              if (commitResult.rollbackError) {
                finalError += ` [rollback: ${commitResult.rollbackError}]`;
              }
              pushLog(ws.name, `${C.red}[COMMIT]${C.reset} ${nextTaskEntry.title} (${commitResult.reason})`);
            }

          }

          syncWorkerTaskProgress(ws, wtDir, updatedContent);
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
  _internals: {
    commitTaskNow,
  },
};

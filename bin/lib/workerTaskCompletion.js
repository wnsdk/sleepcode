const fs = require('fs');
const { C } = require('./constants');
const { getNextPendingTask } = require('./utils');
const { getWorkerDoneState, syncWorkerTaskProgress } = require('./taskState');
const { commitTaskNow } = require('./workerCommit');

/**
 * 태스크 프로세스 종료 후 완료 처리:
 * - CLAUDE.md 복원
 * - git commit
 * - done 상태 갱신
 * - 콜백 호출
 *
 * Returns { finalCode, finalError, shouldContinue }
 */
async function handleTaskCompletion({
  ws,
  wtDir,
  tasksPath,
  nextTaskEntry,
  taskStartHead,
  effectiveCode,
  closeError,
  restoreRuntimeClaudeMd,
  pushLog,
  onUpdate,
  onTaskCompleted,
  onTaskUiUpdated,
}) {
  if (!fs.existsSync(tasksPath)) {
    return { finalCode: effectiveCode, finalError: closeError, shouldContinue: false };
  }

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
    process.stderr.write(`[notion:debug] onTaskCompleted 콜백 호출: task="${nextTaskEntry ? nextTaskEntry.title : 'null'}" commit=${commitResult ? commitResult.committed : 'null'}\n`);
    try {
      await Promise.resolve(onTaskCompleted({
        worker: ws,
        taskEntry: nextTaskEntry,
        commit: commitResult,
      }));
    } catch (e) {
      process.stderr.write(`[notion:debug] onTaskCompleted 콜백 에러: ${e.message}\n`);
    }
  } else {
    process.stderr.write(`[notion:debug] onTaskCompleted 콜백이 없음 (typeof=${typeof onTaskCompleted})\n`);
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

  // 미완료 태스크가 남아있으면 다음 태스크 실행
  const remaining = getNextPendingTask(updatedContent, updatedDoneState.doneSet);
  const shouldContinue = remaining && finalCode === 0;

  return { finalCode, finalError, shouldContinue };
}

module.exports = { handleTaskCompletion };

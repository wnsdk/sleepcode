const { C } = require('./constants');
const {
  parseTaskStatuses,
  updateFirstPendingStatuses,
  updateTaskCompletion,
  updateTaskModel,
} = require('./notionRun');

function handleTaskCompletedEvent({
  payload,
  schema,
  notionCompletedIds,
  updatePage,
  appendContent,
  getUpdateError,
  pushLog,
}) {
  process.stderr.write(`[notion:debug] handleTaskCompletedEvent 진입\n`);
  const taskEntry = payload && payload.taskEntry ? payload.taskEntry : null;
  if (!taskEntry) {
    process.stderr.write(`[notion:debug] handleTaskCompletedEvent: taskEntry 없음\n`);
    return { handled: false, updated: null };
  }

  process.stderr.write(`[notion:debug] handleTaskCompletedEvent: task="${taskEntry.title}" notionId=${taskEntry.notionId || 'none'}\n`);

  const commit = payload && payload.commit ? payload.commit : null;
  const reportText = payload && payload.reportText ? String(payload.reportText) : '';
  let reportAppended = null;

  if (taskEntry.notionId && reportText.trim() && typeof appendContent === 'function') {
    reportAppended = appendContent(taskEntry.notionId, reportText);
    if (!reportAppended && typeof pushLog === 'function') {
      pushLog(`${C.yellow}⚠${C.reset} ${taskEntry.title} → AI Report 기록 실패`);
    }
  }

  if (!commit || !commit.committed) {
    const reason = commit && commit.reason ? commit.reason : 'unknown';
    process.stderr.write(`[notion:debug] handleTaskCompletedEvent: commit 실패 reason=${reason}\n`);
    if (typeof pushLog === 'function') {
      pushLog(`${C.red}✗${C.reset} ${taskEntry.title} → commit 실패 (${reason})`);
    }
    return { handled: true, updated: false, reportAppended };
  }

  process.stderr.write(`[notion:debug] handleTaskCompletedEvent: commit OK, schema=${!!schema}, updatePage=${typeof updatePage}\n`);
  const worker = payload.worker || null;
  const updated = updateTaskCompletion({
    taskEntry,
    schema,
    notionCompletedIds,
    updatePage,
    worker,
    commit,
  });
  process.stderr.write(`[notion:debug] handleTaskCompletedEvent: updateTaskCompletion 결과=${updated}\n`);

  if (taskEntry.notionId && updated !== null && typeof pushLog === 'function') {
    if (updated) {
      pushLog(`${C.green}✓${C.reset} ${taskEntry.title} → Success`);
    } else {
      const reason = typeof getUpdateError === 'function' ? String(getUpdateError() || '').trim() : '';
      pushLog(`${C.yellow}⚠${C.reset} ${taskEntry.title} → Notion 업데이트 실패`);
      if (reason) {
        pushLog(`${C.dim}  error: ${reason}${C.reset}`);
      }
    }
  }

  return { handled: true, updated, reportAppended };
}

function handleTaskStartedEvent({
  payload,
  schema,
  updatePage,
  getUpdateError,
  pushLog,
}) {
  const taskEntry = payload && payload.taskEntry ? payload.taskEntry : null;
  const model = payload && payload.model ? payload.model : '';
  const ok = updateTaskModel({
    taskEntry,
    schema,
    model,
    updatePage,
  });

  if (!taskEntry) {
    return { handled: false, updated: false };
  }

  if (typeof pushLog === 'function') {
    if (ok) {
      pushLog(`${C.dim}Model 업데이트: ${taskEntry.title} → ${model}${C.reset}`);
    } else {
      const reason = typeof getUpdateError === 'function' ? String(getUpdateError() || '').trim() : '';
      pushLog(`${C.yellow}⚠${C.reset} ${taskEntry.title} → Model 업데이트 실패`);
      if (reason) {
        pushLog(`${C.dim}  error: ${reason}${C.reset}`);
      }
    }
  }

  return { handled: true, updated: ok };
}

function syncNextPendingTaskStatus({
  schema,
  tasks,
  workerPaths,
  notionInProgressIds,
  updatePage,
  getWorkerDoneState,
}) {
  if (!schema || !tasks || tasks.length === 0) {
    return false;
  }

  const taskStatuses = parseTaskStatuses(workerPaths, getWorkerDoneState);
  updateFirstPendingStatuses({
    schema,
    tasks,
    taskStatuses,
    notionInProgressIds,
    updatePage,
  });
  return true;
}

module.exports = {
  handleTaskCompletedEvent,
  handleTaskStartedEvent,
  syncNextPendingTaskStatus,
};

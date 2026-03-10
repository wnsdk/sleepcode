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
  const taskEntry = payload && payload.taskEntry ? payload.taskEntry : null;
  if (!taskEntry) {
    return { handled: false, updated: null };
  }

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
    if (typeof pushLog === 'function') {
      pushLog(`${C.red}✗${C.reset} ${taskEntry.title} → commit 실패 (${reason})`);
    }
    return { handled: true, updated: false, reportAppended };
  }

  const worker = payload.worker || null;
  const updated = updateTaskCompletion({
    taskEntry,
    schema,
    notionCompletedIds,
    updatePage,
    worker,
    commit,
  });
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
  const difficulty = payload && payload.difficulty != null ? payload.difficulty : null;
  const ok = updateTaskModel({
    taskEntry,
    schema,
    model,
    difficulty,
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

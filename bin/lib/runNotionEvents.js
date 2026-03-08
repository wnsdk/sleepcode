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
  pushLog,
}) {
  const taskEntry = payload && payload.taskEntry ? payload.taskEntry : null;
  if (!taskEntry) {
    return { handled: false, updated: null };
  }

  const commit = payload && payload.commit ? payload.commit : null;
  if (!commit || !commit.committed) {
    const reason = commit && commit.reason ? commit.reason : 'unknown';
    if (typeof pushLog === 'function') {
      pushLog(`${C.red}✗${C.reset} ${taskEntry.title} → commit 실패 (${reason})`);
    }
    return { handled: true, updated: false };
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
      pushLog(`${C.yellow}⚠${C.reset} ${taskEntry.title} → Notion 업데이트 실패`);
    }
  }

  return { handled: true, updated };
}

function handleTaskStartedEvent({
  payload,
  schema,
  updatePage,
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
      pushLog(`${C.yellow}⚠${C.reset} ${taskEntry.title} → Model 업데이트 실패`);
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

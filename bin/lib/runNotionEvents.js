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
  process.stderr.write(`[notion:debug] handleTaskCompletedEvent 진입\n`);
  const taskEntry = payload && payload.taskEntry ? payload.taskEntry : null;
  if (!taskEntry) {
    process.stderr.write(`[notion:debug] handleTaskCompletedEvent: taskEntry 없음\n`);
    return { handled: false, updated: null };
  }

  process.stderr.write(`[notion:debug] handleTaskCompletedEvent: task="${taskEntry.title}" notionId=${taskEntry.notionId || 'none'}\n`);

  const commit = payload && payload.commit ? payload.commit : null;
  if (!commit || !commit.committed) {
    const reason = commit && commit.reason ? commit.reason : 'unknown';
    process.stderr.write(`[notion:debug] handleTaskCompletedEvent: commit 실패 reason=${reason}\n`);
    if (typeof pushLog === 'function') {
      pushLog(`${C.red}✗${C.reset} ${taskEntry.title} → commit 실패 (${reason})`);
    }
    return { handled: true, updated: false };
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

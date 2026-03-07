const fs = require('fs');
const path = require('path');

const { buildStatusProps } = require('./notionSync');
const { buildRuntimeTaskQueueContent, normalizeWorkerName } = require('./notionRun');

function buildTaskQueueLine(task) {
  return `- [ ] ${task.title} <!-- notion:${task.id} -->`;
}

function appendTasksToQueueContent(content, tasks) {
  const base = String(content || '').trimEnd();
  const extraLines = (tasks || []).map(buildTaskQueueLine);
  if (extraLines.length === 0) {
    return base ? `${base}\n` : '';
  }
  if (!base) {
    return `${extraLines.join('\n')}\n`;
  }
  return `${base}\n${extraLines.join('\n')}\n`;
}

function splitTasksByWorkerPresence(tasks, existingWorkerNames) {
  const existingNames = new Set(existingWorkerNames || []);
  const existingGroups = {};
  const newGroups = {};

  for (const task of tasks || []) {
    const workerName = normalizeWorkerName(task.worker);
    const target = existingNames.has(workerName) ? existingGroups : newGroups;
    if (!target[workerName]) target[workerName] = [];
    target[workerName].push(task);
  }

  return { existingGroups, newGroups };
}

function buildWorkerTaskQueueContent(workerName, tasks) {
  return buildRuntimeTaskQueueContent({ [workerName]: tasks || [] }, { parallel: true });
}

function getFirstTaskIdsByWorker(workerGroups) {
  const firstTaskIds = new Set();
  for (const tasks of Object.values(workerGroups || {})) {
    if (tasks && tasks.length > 0) firstTaskIds.add(tasks[0].id);
  }
  return firstTaskIds;
}

function buildRunWorkerState({ workerInfo, targetDir, logDir, timestamp, total = 0, merged = false }) {
  return {
    ...workerInfo,
    targetDir,
    status: 'running',
    currentTask: '',
    done: 0,
    total,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    merged,
    reportLines: [],
    _proc: null,
    logFile: path.join(logDir, `run_${workerInfo.name}_${timestamp}.log`),
  };
}

function buildTaskRunUpdates(tasks, schema, firstRunningTaskIds) {
  const runningIds = firstRunningTaskIds instanceof Set
    ? firstRunningTaskIds
    : new Set(firstRunningTaskIds || []);

  return (tasks || []).map((task) => {
    const statusValue = runningIds.has(task.id) ? 'Running' : 'Pending';
    const props = {};
    const statusProps = buildStatusProps(schema, statusValue);
    if (statusProps) Object.assign(props, statusProps);
    if (schema && schema.run_prop) props[schema.run_prop] = { checkbox: false };

    return {
      props,
      statusValue,
      task,
    };
  });
}

function applyTaskRunUpdates({
  tasks,
  schema,
  firstRunningTaskIds,
  trackTasks = true,
  trackedTasks = null,
  notionInProgressIds = null,
  updatePage,
}) {
  const updates = buildTaskRunUpdates(tasks, schema, firstRunningTaskIds);
  for (const update of updates) {
    if (trackTasks && Array.isArray(trackedTasks)) {
      trackedTasks.push(update.task);
    }
    if (update.statusValue === 'Running' && notionInProgressIds) {
      notionInProgressIds.add(update.task.id);
    }
    if (Object.keys(update.props).length > 0 && typeof updatePage === 'function') {
      updatePage(update.task.id, update.props);
    }
  }
  return updates;
}

function appendWorkerTasks({
  workerState,
  tasks,
  schema,
  firstRunningTaskIds = new Set(),
  trackedTasks = null,
  notionInProgressIds = null,
  updatePage,
  syncWorkerTaskProgress,
  onSuccess,
  onError,
}) {
  const tasksPath = workerState.tasksPath || path.join(workerState.path, '.sleepcode', 'task_queue.md');

  try {
    const existingContent = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';
    const nextContent = appendTasksToQueueContent(existingContent, tasks);
    applyTaskRunUpdates({
      tasks,
      schema,
      firstRunningTaskIds,
      trackTasks: true,
      trackedTasks,
      notionInProgressIds,
      updatePage,
    });
    fs.writeFileSync(tasksPath, nextContent);
    syncWorkerTaskProgress(workerState, null, nextContent);
    if (typeof onSuccess === 'function') onSuccess(nextContent);
    return { ok: true, content: nextContent };
  } catch (error) {
    if (typeof onError === 'function') onError(error);
    return { ok: false, error };
  }
}

module.exports = {
  appendWorkerTasks,
  appendTasksToQueueContent,
  applyTaskRunUpdates,
  buildRunWorkerState,
  buildTaskQueueLine,
  buildTaskRunUpdates,
  buildWorkerTaskQueueContent,
  getFirstTaskIdsByWorker,
  splitTasksByWorkerPresence,
};

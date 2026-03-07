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

module.exports = {
  appendTasksToQueueContent,
  buildRunWorkerState,
  buildTaskQueueLine,
  buildTaskRunUpdates,
  buildWorkerTaskQueueContent,
  getFirstTaskIdsByWorker,
  splitTasksByWorkerPresence,
};

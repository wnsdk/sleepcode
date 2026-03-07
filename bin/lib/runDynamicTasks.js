const { C } = require('./constants');

function trackDynamicTaskIds(executingTaskIds, tasks) {
  for (const task of tasks || []) {
    executingTaskIds.add(task.id);
  }
}

function isSingleMainWorkerMode(workerStates) {
  return Array.isArray(workerStates) &&
    workerStates.length === 1 &&
    workerStates[0] &&
    workerStates[0].name === 'main';
}

function startDynamicWorker({
  currentWorkerStates,
  workerName,
  tasks,
  schema,
  targetDir,
  logDir,
  createWorktrees,
  createRunTimestamp,
  createDynamicWorkerState,
  applyRunTaskUpdates,
  setWatchPhase,
  pushLog,
  spawnRunWorker,
}) {
  const timestamp = createRunTimestamp();
  const workerState = createDynamicWorkerState({
    targetDir,
    workerName,
    tasks,
    timestamp,
    logDir,
    createWorktrees,
  });
  if (!workerState) {
    return null;
  }

  applyRunTaskUpdates(tasks, schema, new Set([tasks[0].id]), { trackTasks: true });
  currentWorkerStates.push(workerState);
  setWatchPhase('executing');
  pushLog(`${C.green}▶${C.reset} 새 워커 ${C.cyan}${workerName}${C.reset} 시작 (${tasks.length}개 태스크)`);
  spawnRunWorker(workerState);
  return workerState;
}

module.exports = {
  isSingleMainWorkerMode,
  startDynamicWorker,
  trackDynamicTaskIds,
};

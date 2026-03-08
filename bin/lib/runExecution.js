const fs = require('fs');

const {
  buildRuntimeTaskQueueContent,
  groupTasksByWorker,
} = require('./notionRun');
const {
  buildRunWorkerState,
  buildWorkerTaskQueueContent,
} = require('./runWorkers');

function buildExecutionPlan(tasks, { defaultWorker } = {}) {
  const workerGroups = groupTasksByWorker(tasks, { defaultWorker });
  const workerNames = Object.keys(workerGroups);

  return {
    workerGroups,
    workerNames,
  };
}

function prepareParallelExecution({
  targetDir,
  runtimeTasksPath,
  workerGroups,
  timestamp,
  logDir,
  syncClaudeMd,
  parseParallelTasks,
  createWorktrees,
  syncWorkerTaskProgress,
}) {
  fs.writeFileSync(
    runtimeTasksPath,
    buildRuntimeTaskQueueContent(workerGroups, { parallel: true })
  );

  syncClaudeMd(targetDir);
  const workers = parseParallelTasks(runtimeTasksPath);
  if (!workers || workers.length === 0) {
    return [];
  }

  const created = createWorktrees(targetDir, workers);
  if (created.length === 0) {
    return [];
  }

  const workerStates = created.map((workerInfo) => buildRunWorkerState({
    workerInfo,
    targetDir,
    logDir,
    timestamp,
    total: 0,
    merged: false,
  }));

  for (const workerState of workerStates) {
    syncWorkerTaskProgress(workerState);
  }

  return workerStates;
}

function createDynamicWorkerState({
  targetDir,
  workerName,
  tasks,
  timestamp,
  logDir,
  createWorktrees,
}) {
  const created = createWorktrees(targetDir, [{
    name: workerName,
    tasks: buildWorkerTaskQueueContent(workerName, tasks),
    remaining: tasks.length,
  }]);
  if (created.length === 0) return null;

  return buildRunWorkerState({
    workerInfo: created[0],
    targetDir,
    logDir,
    timestamp,
    total: tasks.length,
    merged: false,
  });
}

module.exports = {
  buildExecutionPlan,
  createDynamicWorkerState,
  prepareParallelExecution,
};

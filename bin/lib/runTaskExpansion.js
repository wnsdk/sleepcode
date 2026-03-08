const { C } = require('./constants');
const {
  isSingleMainWorkerMode,
  startDynamicWorker,
  trackDynamicTaskIds,
} = require('./runDynamicTasks');
const {
  appendWorkerTasks,
  applyTaskRunUpdates,
  splitTasksByWorkerPresence,
} = require('./runWorkers');

function addTasksDuringExecution({
  newTasks,
  schema,
  executingTaskIds,
  currentWorkerStates,
  currentNotionTasks,
  notionInProgressIds,
  updatePage,
  syncWorkerTaskProgress,
  targetDir,
  logDir,
  createWorktrees,
  createRunTimestamp,
  createDynamicWorkerState,
  setWatchPhase,
  spawnRunWorker,
  scheduleRender,
  pushLog,
  defaultWorker,
  trackDynamicTaskIdsFn = trackDynamicTaskIds,
  splitTasksByWorkerPresenceFn = splitTasksByWorkerPresence,
  appendWorkerTasksFn = appendWorkerTasks,
  startDynamicWorkerFn = startDynamicWorker,
  isSingleMainWorkerModeFn = isSingleMainWorkerMode,
  applyTaskRunUpdatesFn = applyTaskRunUpdates,
}) {
  trackDynamicTaskIdsFn(executingTaskIds, newTasks);

  const { existingGroups: tasksForExisting, newGroups: tasksForNew } = splitTasksByWorkerPresenceFn(
    newTasks,
    currentWorkerStates.map((workerState) => workerState.name),
    { defaultWorker }
  );

  for (const [workerName, tasks] of Object.entries(tasksForExisting)) {
    const workerState = currentWorkerStates.find((item) => item.name === workerName);
    if (!workerState) continue;

    const result = appendWorkerTasksFn({
      workerState,
      tasks,
      schema,
      trackedTasks: currentNotionTasks,
      notionInProgressIds,
      updatePage,
      syncWorkerTaskProgress,
      onError: (error) => {
        pushLog('SYSTEM', `${C.red}태스크 추가 실패 (${workerName}): ${error.message}${C.reset}`);
      },
    });
    if (!result.ok) {
      continue;
    }

    for (const task of tasks) {
      pushLog('SYSTEM', `${C.green}+${C.reset} ${task.title} → ${C.cyan}${workerName}${C.reset} 에 추가`);
    }
  }

  for (const [workerName, tasks] of Object.entries(tasksForNew)) {
    const newWorkerState = startDynamicWorkerFn({
      currentWorkerStates,
      workerName,
      tasks,
      schema,
      targetDir,
      logDir,
      createWorktrees,
      createRunTimestamp,
      createDynamicWorkerState,
      applyRunTaskUpdates: ({ tasks, schema, firstRunningTaskIds, options }) => applyTaskRunUpdatesFn({
        tasks,
        schema,
        firstRunningTaskIds,
        trackTasks: options && Object.prototype.hasOwnProperty.call(options, 'trackTasks')
          ? options.trackTasks
          : true,
        trackedTasks: currentNotionTasks,
        notionInProgressIds,
        updatePage,
      }),
      setWatchPhase,
      pushLog: (message) => pushLog('SYSTEM', message),
      spawnRunWorker,
    });

    if (newWorkerState) {
      continue;
    }

    if (isSingleMainWorkerModeFn(currentWorkerStates)) {
      const mainWorkerState = currentWorkerStates[0];
      const result = appendWorkerTasksFn({
        workerState: mainWorkerState,
        tasks,
        schema,
        trackedTasks: currentNotionTasks,
        notionInProgressIds,
        updatePage,
        syncWorkerTaskProgress,
        onSuccess: () => {
          pushLog('SYSTEM', `${C.yellow}↷${C.reset} worktree 생성 실패 → main에 ${tasks.length}개 태스크 추가`);
        },
      });
      if (!result.ok) {
        continue;
      }
    } else {
      pushLog('SYSTEM', `${C.red}워커 ${workerName} worktree 생성 실패${C.reset}`);
    }
  }

  scheduleRender();
}

module.exports = {
  addTasksDuringExecution,
};

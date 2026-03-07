const fs = require('fs');
const path = require('path');

const { C } = require('./constants');

function syncRunningWorkerProgress({
  watchPhase,
  workerStates,
  syncWorkerTaskProgress,
  updateNextTaskStatus,
  scheduleRender,
}) {
  if (watchPhase !== 'executing' || !Array.isArray(workerStates) || workerStates.length === 0) {
    return false;
  }

  for (const workerState of workerStates) {
    if (workerState.status !== 'running') continue;
    const tasksPath = workerState.tasksPath || path.join(workerState.path, '.sleepcode', 'task_queue.md');
    try {
      if (fs.existsSync(tasksPath)) {
        const content = fs.readFileSync(tasksPath, 'utf-8');
        syncWorkerTaskProgress(workerState, null, content);
      }
    } catch {}
  }

  updateNextTaskStatus(workerStates);
  scheduleRender();
  return true;
}

function processPollResponse({
  data,
  isExecuting,
  executingTaskIds,
  setPollInfo,
  buildPollInfo,
  selectTasksToRun,
  filterNewTasks,
  addTasksDuringExecution,
  executeNotionTasks,
  renderDashboard,
}) {
  const schema = data.schema;
  setPollInfo(buildPollInfo(data.tasks));
  const tasksToRun = selectTasksToRun(data.tasks, schema);

  if (isExecuting) {
    const newTasks = filterNewTasks(tasksToRun, executingTaskIds);
    if (newTasks.length > 0) {
      addTasksDuringExecution(newTasks, schema);
    }
    renderDashboard();
    return { mode: 'executing', tasksToRun, schema };
  }

  if (tasksToRun.length > 0) {
    executeNotionTasks(tasksToRun, schema);
    return { mode: 'started', tasksToRun, schema };
  }

  renderDashboard();
  return { mode: 'idle', tasksToRun: [], schema };
}

function createRunPollingController({
  targetDir,
  gracefulStopPath,
  pollIntervalMs,
  notionPoll,
  isOverBudget,
  buildPollInfo,
  selectTasksToRun,
  filterNewTasks,
  getIsExecuting,
  getExecutingTaskIds,
  getWatchPhase,
  getCurrentWorkerStates,
  setLastPollTime,
  setPollInfo,
  addTasksDuringExecution,
  executeNotionTasks,
  renderDashboard,
  scheduleRender,
  updateNextTaskStatus,
  syncWorkerTaskProgress,
  dashboard,
  pushLog,
  onGracefulStopDetected,
}) {
  let pollTimer = null;
  let dashboardTimer = null;
  let progressTimer = null;

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function stopAll() {
    stopPolling();
    clearInterval(dashboardTimer);
    clearInterval(progressTimer);
    dashboardTimer = null;
    progressTimer = null;
  }

  function pollOnce() {
    setLastPollTime(Date.now());

    if (fs.existsSync(gracefulStopPath)) {
      if (typeof onGracefulStopDetected === 'function') {
        onGracefulStopDetected();
      }
      return { mode: 'stopped' };
    }

    const budgetCheck = isOverBudget(targetDir);
    if (budgetCheck && budgetCheck.over) {
      pushLog('SYSTEM', `${C.yellow}주간 한도 도달 — 대기${C.reset}`);
      renderDashboard();
      return { mode: 'budget_stop' };
    }

    const data = notionPoll();
    if (!data || data.error) {
      const errMsg = data && data.message ? `: ${data.message}` : '';
      pushLog('SYSTEM', `${C.red}폴링 실패${errMsg}${C.reset}`);
      return { mode: 'error', data };
    }

    return processPollResponse({
      data,
      isExecuting: getIsExecuting(),
      executingTaskIds: getExecutingTaskIds(),
      setPollInfo,
      buildPollInfo,
      selectTasksToRun,
      filterNewTasks,
      addTasksDuringExecution,
      executeNotionTasks,
      renderDashboard,
    });
  }

  function pollNow() {
    pushLog('SYSTEM', `${C.cyan}즉시 폴링 실행${C.reset}`);
    const result = pollOnce();
    renderDashboard();
    return result;
  }

  function start() {
    dashboard.start();
    dashboardTimer = setInterval(renderDashboard, 1000);
    progressTimer = setInterval(() => {
      syncRunningWorkerProgress({
        watchPhase: getWatchPhase(),
        workerStates: getCurrentWorkerStates(),
        syncWorkerTaskProgress,
        updateNextTaskStatus,
        scheduleRender,
      });
    }, 5000);

    pollOnce();
    pollTimer = setInterval(pollOnce, pollIntervalMs);
  }

  return {
    pollNow,
    pollOnce,
    start,
    stopAll,
    stopPolling,
  };
}

module.exports = {
  createRunPollingController,
  processPollResponse,
  syncRunningWorkerProgress,
};

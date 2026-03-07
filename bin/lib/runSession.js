function createRunTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function createActiveRunState(tasks, schema, startedAt = Date.now()) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  return {
    currentNotionTasks: [...taskList],
    currentSchema: schema || null,
    execStartTime: startedAt,
    executingTaskIds: new Set(taskList.map((task) => task.id)),
    isExecuting: true,
  };
}

function createIdleRunState() {
  return {
    currentNotionTasks: [],
    currentSchema: null,
    currentWorkerStates: [],
    execStartTime: null,
    executingTaskIds: new Set(),
    isExecuting: false,
    notionCompletedIds: new Set(),
  };
}

module.exports = {
  createActiveRunState,
  createIdleRunState,
  createRunTimestamp,
};

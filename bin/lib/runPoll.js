function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function buildPollInfo(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const pending = list.filter((task) => {
    const status = normalizeStatus(task && task.status);
    return ['to do', '할 일', '', 'not started'].includes(status);
  }).length;

  return {
    total: list.length,
    pending,
  };
}

function selectTasksToRun(tasks, schema) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (schema && schema.run_prop) {
    return list.filter((task) => {
      if (!task || !task.run) return false;
      const status = normalizeStatus(task.status);
      return !['in progress', '진행 중', 'running', 'pending'].includes(status);
    });
  }

  return list.filter((task) => {
    const status = normalizeStatus(task && task.status);
    return status === 'start' || status === '시작';
  });
}

function filterNewTasks(tasks, executingTaskIds) {
  const list = Array.isArray(tasks) ? tasks : [];
  const ids = executingTaskIds instanceof Set
    ? executingTaskIds
    : new Set(executingTaskIds || []);
  return list.filter((task) => !ids.has(task.id));
}

module.exports = {
  buildPollInfo,
  filterNewTasks,
  normalizeStatus,
  selectTasksToRun,
};

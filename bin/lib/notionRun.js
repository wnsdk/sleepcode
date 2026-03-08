const fs = require('fs');
const path = require('path');

const { extractTaskItems } = require('./utils');
const {
  buildCompletedAtProp,
  buildModelProp,
  buildStatusProps,
} = require('./notionSync');

function normalizeWorkerName(worker, defaultWorker) {
  return String(worker || '').trim().replace(/^@worker\s*/i, '').trim() || (defaultWorker || 'main');
}

function groupTasksByWorker(tasks, { defaultWorker } = {}) {
  const workerGroups = {};
  for (const task of tasks || []) {
    const workerKey = normalizeWorkerName(task.worker, defaultWorker);
    if (!workerGroups[workerKey]) workerGroups[workerKey] = [];
    workerGroups[workerKey].push(task);
  }
  return workerGroups;
}

function buildRuntimeTaskQueueContent(workerGroups, options = {}) {
  const isParallel = options.parallel !== false;

  if (isParallel) {
    const lines = ['# 작업 목록\n', 'task_queue.md는 backlog(읽기 전용)로 유지하세요.\n'];
    for (const [worker, tasks] of Object.entries(workerGroups || {})) {
      lines.push(`## @worker ${worker}`);
      for (const task of tasks) {
        lines.push(`- [ ] ${task.title} <!-- notion:${task.id} -->`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  const lines = [
    '# 작업 목록\n',
    '아래 태스크를 순서대로 진행하세요. task_queue.md는 backlog(읽기 전용)로 유지하세요.\n',
    '---\n',
  ];

  for (const task of Object.values(workerGroups || {}).flat()) {
    lines.push(`- [ ] ${task.title} <!-- notion:${task.id} -->`);
  }

  return lines.join('\n') + '\n';
}

function parseTaskStatuses(workerRefs, getWorkerDoneState) {
  const statuses = {};

  for (const ref of workerRefs || []) {
    const wsPath = typeof ref === 'string' ? ref : ref.path;
    const tasksPath = typeof ref === 'string'
      ? path.join(wsPath, '.sleepcode', 'task_queue.md')
      : (ref.tasksPath || path.join(wsPath, '.sleepcode', 'task_queue.md'));

    if (!fs.existsSync(tasksPath)) continue;

    try {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const doneState = typeof ref === 'string'
        ? { doneSet: new Set() }
        : getWorkerDoneState(ref);
      const tasks = extractTaskItems(content);
      for (const task of tasks) {
        if (!task.notionId) continue;
        statuses[task.notionId] = task.checked || doneState.doneSet.has(task.key);
      }
    } catch {}
  }

  return statuses;
}

function updateTaskCompletion({ taskEntry, schema, notionCompletedIds, updatePage, worker }) {
  if (!taskEntry || !taskEntry.notionId) return false;
  if (!schema) return false;
  if (!schema.status_prop && !schema.completed_at_prop && !schema.cost_prop) return null;
  if (notionCompletedIds.has(taskEntry.notionId)) return true;

  const props = {};
  const statusProps = buildStatusProps(schema, 'Success');
  if (statusProps) Object.assign(props, statusProps);
  const completedAtProps = buildCompletedAtProp(schema);
  if (completedAtProps) Object.assign(props, completedAtProps);

  if (schema.cost_prop && worker) {
    const totalTokens = (worker.inputTokens || 0) + (worker.outputTokens || 0);
    if (totalTokens > 0) {
      props[schema.cost_prop] = { number: Math.round(totalTokens) };
    }
  }

  if (Object.keys(props).length === 0) return false;

  const ok = updatePage(taskEntry.notionId, props);
  if (ok) notionCompletedIds.add(taskEntry.notionId);
  return ok;
}

function updateTaskModel({ taskEntry, schema, model, updatePage }) {
  if (!taskEntry || !taskEntry.notionId || !schema) return false;
  const modelProps = buildModelProp(schema, model);
  if (!modelProps) return false;
  return updatePage(taskEntry.notionId, modelProps);
}

function updateFirstPendingStatuses({ schema, tasks, taskStatuses, notionInProgressIds, updatePage, defaultWorker }) {
  if (!schema || !tasks || tasks.length === 0) return;

  const workerGroups = groupTasksByWorker(tasks, { defaultWorker });
  for (const workerTasks of Object.values(workerGroups)) {
    for (const task of workerTasks) {
      if (taskStatuses[task.id]) continue;
      if (notionInProgressIds.has(task.id)) break;

      notionInProgressIds.add(task.id);
      const statusProps = buildStatusProps(schema, 'Running');
      if (statusProps) updatePage(task.id, statusProps);
      break;
    }
  }
}

function buildFinalTaskProps({ schema, isDone, totalCost, totalTasks, totalInputTokens, totalOutputTokens, alreadyCompleted }) {
  const props = {};

  if (!alreadyCompleted) {
    const statusProps = buildStatusProps(schema, isDone ? 'Success' : 'Failed');
    if (statusProps) Object.assign(props, statusProps);

    if (schema.completed_at_prop && isDone) {
      const completedAtProps = buildCompletedAtProp(schema);
      if (completedAtProps) Object.assign(props, completedAtProps);
    }
  }

  if (schema.cost_prop) {
    const totalTokens = (totalInputTokens || 0) + (totalOutputTokens || 0);
    if (totalTokens > 0) {
      const perTaskTokens = totalTasks > 0 ? Math.round(totalTokens / totalTasks) : totalTokens;
      props[schema.cost_prop] = { number: perTaskTokens };
    }
  }

  if (schema.log_prop) {
    const perTaskCost = totalTasks > 0 ? totalCost / totalTasks : 0;
    props[schema.log_prop] = {
      rich_text: [{
        text: { content: isDone ? `완료 ($${perTaskCost.toFixed(4)})` : '실행 실패' },
      }],
    };
  }

  return props;
}

function buildExecutionReportText(workerStates, tokenInfo) {
  const parts = (workerStates || [])
    .map((worker) => (worker.reportLines || []).join('\n'))
    .filter((text) => text.trim());

  if (tokenInfo) {
    const totalInput = tokenInfo.totalInputTokens || 0;
    const totalOutput = tokenInfo.totalOutputTokens || 0;
    const totalTokens = totalInput + totalOutput;
    if (totalTokens > 0) {
      const lines = ['## Cost (가중 토큰)', ''];
      lines.push(`- Input: ${totalInput.toLocaleString()}`);
      lines.push(`- Output: ${totalOutput.toLocaleString()}`);
      lines.push(`- **Total: ${totalTokens.toLocaleString()}**`);

      const entries = Object.entries(tokenInfo.tokensByProvider || {});
      if (entries.length > 1) {
        lines.push('');
        lines.push('### Provider');
        for (const [provider, tokens] of entries) {
          const provTotal = (tokens.input || 0) + (tokens.output || 0);
          lines.push(`- ${provider}: 입력 ${(tokens.input || 0).toLocaleString()} + 출력 ${(tokens.output || 0).toLocaleString()} = ${provTotal.toLocaleString()}`);
        }
      }

      parts.push(lines.join('\n'));
    }
  }

  return parts.join('\n\n---\n\n');
}

module.exports = {
  normalizeWorkerName,
  groupTasksByWorker,
  buildRuntimeTaskQueueContent,
  parseTaskStatuses,
  updateTaskCompletion,
  updateTaskModel,
  updateFirstPendingStatuses,
  buildFinalTaskProps,
  buildExecutionReportText,
};

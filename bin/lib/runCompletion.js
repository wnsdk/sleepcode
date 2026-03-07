const { C } = require('./constants');
const { buildExecutionReportText, buildFinalTaskProps } = require('./notionRun');

function summarizeExecutionResults({
  notionTasks,
  schema,
  workerStates,
  notionCompletedIds,
  getTaskCompletion,
}) {
  const workers = Array.isArray(workerStates) ? workerStates : [];
  const tasks = Array.isArray(notionTasks) ? notionTasks : [];
  const completedIds = notionCompletedIds instanceof Set
    ? notionCompletedIds
    : new Set(notionCompletedIds || []);
  const taskCompletion = typeof getTaskCompletion === 'function'
    ? (getTaskCompletion(workers) || {})
    : {};
  const totalCost = workers.reduce((sum, worker) => sum + (worker.cost || 0), 0);
  const totalInputTokens = workers.reduce((sum, worker) => sum + (worker.inputTokens || 0), 0);
  const totalOutputTokens = workers.reduce((sum, worker) => sum + (worker.outputTokens || 0), 0);

  // 프로바이더별 토큰 집계
  const tokensByProvider = {};
  for (const worker of workers) {
    const provider = worker.provider || 'unknown';
    if (!tokensByProvider[provider]) tokensByProvider[provider] = { input: 0, output: 0 };
    tokensByProvider[provider].input += worker.inputTokens || 0;
    tokensByProvider[provider].output += worker.outputTokens || 0;
  }

  return {
    reportText: buildExecutionReportText(workers, { totalInputTokens, totalOutputTokens, tokensByProvider }),
    pendingMergeWorkers: workers.filter((worker) => !worker.merged),
    taskResults: tasks.map((task) => {
      const isDone = Boolean(taskCompletion[task.id]);
      return {
        isDone,
        newStatus: isDone ? 'Success' : 'Failed',
        props: buildFinalTaskProps({
          schema,
          isDone,
          totalCost,
          totalTasks: tasks.length,
          totalInputTokens,
          totalOutputTokens,
          alreadyCompleted: completedIds.has(task.id),
        }),
        task,
      };
    }),
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    tokensByProvider,
  };
}

function finalizeParallelWorkers({
  targetDir,
  workerStates,
  cliProvider,
  autoMergeWorktrees,
  cleanupWorktrees,
  pushLog,
}) {
  const workers = Array.isArray(workerStates) ? workerStates : [];
  const log = typeof pushLog === 'function' ? pushLog : () => {};

  if (workers.length <= 1) {
    return {
      cleaned: false,
      hasConflicts: false,
      mergeResults: { conflicted: [], merged: [], skipped: [] },
      skipped: true,
    };
  }

  const pendingMergeWorkers = workers.filter((worker) => !worker.merged);
  let hasConflicts = false;
  let mergeResults = { conflicted: [], merged: [], skipped: [] };

  if (pendingMergeWorkers.length > 0) {
    log(`${C.bold}남은 브랜치 자동 머지 시작${C.reset}`);
    try {
      mergeResults = autoMergeWorktrees(targetDir, pendingMergeWorkers, cliProvider);
      if (mergeResults.merged.length > 0) {
        log(`${C.green}머지 성공: ${mergeResults.merged.join(', ')}${C.reset}`);
      }
      if (mergeResults.conflicted.length > 0) {
        hasConflicts = true;
        log(`${C.red}머지 충돌: ${mergeResults.conflicted.join(', ')} (수동 머지 필요)${C.reset}`);
      }
      if (mergeResults.skipped.length > 0) {
        log(`${C.dim}머지 스킵: ${mergeResults.skipped.join(', ')}${C.reset}`);
      }
    } catch (e) {
      hasConflicts = true;
      log(`${C.red}자동 머지 실패: ${e.message}${C.reset}`);
    }
  }

  if (hasConflicts) {
    log(`${C.yellow}머지 충돌이 남아있어 워크트리를 유지합니다. 수동 해결 후 'npx sleepcode parallel --clean'으로 정리하세요.${C.reset}`);
    return {
      cleaned: false,
      hasConflicts,
      mergeResults,
      skipped: false,
    };
  }

  log(`${C.bold}워크트리 정리${C.reset}`);
  try {
    cleanupWorktrees(targetDir, null);
    log(`${C.green}워크트리 정리 완료${C.reset}`);
    return {
      cleaned: true,
      hasConflicts: false,
      mergeResults,
      skipped: false,
    };
  } catch (e) {
    log(`${C.red}워크트리 정리 실패: ${e.message}${C.reset}`);
    return {
      cleaned: false,
      cleanupError: e,
      hasConflicts: false,
      mergeResults,
      skipped: false,
    };
  }
}

module.exports = {
  finalizeParallelWorkers,
  summarizeExecutionResults,
};

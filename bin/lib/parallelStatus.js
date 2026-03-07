const fs = require('fs');
const path = require('path');

const { C } = require('./constants');
const { progressBar } = require('./utils');
const { getPersistedTaskProgress } = require('./taskState');
const { MAIN_WORKER_NAME, parseParallelTasks } = require('./parallelTasks');
const {
  getRuntimeMainTaskQueuePath,
  getRuntimeTaskQueuePath,
  getRuntimeWorktreesDir,
} = require('./runtimePaths');

function buildParallelStatusRows({
  targetDir,
  workers,
  existsSync = fs.existsSync,
  getPersistedTaskProgressFn = getPersistedTaskProgress,
  getRuntimeMainTaskQueuePathFn = getRuntimeMainTaskQueuePath,
  getRuntimeTaskQueuePathFn = getRuntimeTaskQueuePath,
  getRuntimeWorktreesDirFn = getRuntimeWorktreesDir,
}) {
  const mainTasksPath = getRuntimeMainTaskQueuePathFn(targetDir);
  const wtBase = getRuntimeWorktreesDirFn(targetDir);

  return workers.map((worker) => {
    const isMainWorker = worker.name === MAIN_WORKER_NAME;
    const wtPath = path.join(wtBase, worker.name);
    const exists = isMainWorker ? true : existsSync(wtPath);
    const sourcePath = isMainWorker
      ? (existsSync(mainTasksPath) ? mainTasksPath : '')
      : getRuntimeTaskQueuePathFn(wtPath);

    let done = 0;
    let total = 0;
    if (sourcePath && existsSync(sourcePath)) {
      const progress = getPersistedTaskProgressFn(
        isMainWorker ? targetDir : wtPath,
        sourcePath
      );
      done = progress.counts.done;
      total = progress.counts.total;
    } else {
      total = worker.remaining;
    }

    return {
      done,
      exists,
      isMainWorker,
      name: worker.name,
      total,
    };
  });
}

function showParallelStatus(targetDir) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'task_queue.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.log(`${C.yellow}task_queue.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`${C.dim}병렬 실행을 위해 task_queue.md에 ## @worker <name> 섹션을 추가하세요.${C.reset}`);
    return;
  }

  const rows = buildParallelStatusRows({
    targetDir,
    workers,
  });

  console.log(`\n${C.bold}워커 상태:${C.reset}\n`);
  for (const row of rows) {
    const bar = row.total > 0 ? progressBar(row.done, row.total, 20) : C.dim + '(태스크 없음)' + C.reset;
    const status = row.isMainWorker
      ? `${C.green}현재 브랜치${C.reset}`
      : row.exists
        ? `${C.green}준비됨${C.reset}`
        : `${C.dim}미생성${C.reset}`;

    console.log(`  ${C.bold}${row.name}${C.reset}  ${bar}  ${row.done}/${row.total}  ${status}`);
  }
  console.log('');
}

module.exports = {
  buildParallelStatusRows,
  showParallelStatus,
};

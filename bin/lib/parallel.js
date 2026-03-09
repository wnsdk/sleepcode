const fs = require('fs');
const path = require('path');

const { C } = require('./constants');
const {
  cleanupWorktrees,
  copySleepcodeDirToWorktree,
  createWorktrees,
  parseParallelTasks,
  parseTaskQueueWorkers,
  showParallelStatus,
} = require('./parallelWorktrees');
const {
  autoMergeWorktrees,
  mergeWorktrees,
} = require('./parallelMerge');
const { requestParallelWorkerStop } = require('./parallelRunnerControl');
const { runParallelWorkers } = require('./parallelRunner');

function showTaskQueueFormatError() {
  console.error(`${C.red}task_queue.md에 실행할 태스크가 없습니다.${C.reset}`);
  console.log(`
${C.bold}task_queue.md 예시:${C.reset}

  ${C.dim}# 작업 목록${C.reset}
  ${C.dim}- [ ] 로그인 화면 구현${C.reset}
  ${C.dim}- [ ] 회원가입 API 연동${C.reset}

  ${C.dim}# 또는 워커별 분배${C.reset}
  ${C.cyan}## @worker feature-auth${C.reset}
  ${C.dim}- [ ] 로그인 화면 구현${C.reset}
  ${C.dim}- [ ] 회원가입 API 연동${C.reset}

  ${C.cyan}## @worker feature-cart${C.reset}
  ${C.dim}- [ ] 장바구니 화면 구현${C.reset}
  ${C.dim}- [ ] 상품 추가/삭제 API${C.reset}
`);
}

function runTaskQueueCommand({ cliArgs = {}, cliProvider, targetDir = process.cwd() } = {}) {
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode init'으로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  const isSetup = Boolean(cliArgs.setup);
  const isClean = Boolean(cliArgs.clean);
  const isStatus = Boolean(cliArgs.status);
  const isMerge = Boolean(cliArgs.merge);
  const stopWorkerName = typeof cliArgs.stopWorker === 'string' ? cliArgs.stopWorker.trim() : '';

  if (isStatus) {
    showParallelStatus(targetDir);
    return;
  }

  if (isMerge) {
    mergeWorktrees(targetDir, cliProvider);
    return;
  }

  if (isClean) {
    console.log(`\n${C.bold}Worktree 정리 중...${C.reset}\n`);
    cleanupWorktrees(targetDir, null);
    console.log(`\n${C.green}정리 완료.${C.reset}`);
    return;
  }

  if (stopWorkerName) {
    const request = requestParallelWorkerStop(targetDir, stopWorkerName);
    console.log(`\n${C.yellow}즉시 종료 요청 등록${C.reset} — ${C.cyan}${request.workerName}${C.reset}`);
    console.log(`  ${C.dim}실행 중인 병렬 세션이 요청을 감지하면 해당 워커만 즉시 종료합니다.${C.reset}\n`);
    return;
  }

  const tasksPath = path.join(scDir, 'task_queue.md');
  const workers = parseTaskQueueWorkers(tasksPath);
  if (!workers) {
    showTaskQueueFormatError();
    process.exit(1);
  }

  console.log(`\n${C.bold}실행 워커 설정${C.reset} — ${workers.length}개 워커 감지\n`);

  const created = createWorktrees(targetDir, workers);
  if (created.length === 0) {
    console.error(`\n${C.red}생성된 worktree가 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.green}${C.bold}Worktree 생성 완료!${C.reset}`);

  if (isSetup) {
    console.log(`
${C.bold}다음 단계:${C.reset}

  ${C.cyan}npx sleepcode run --status${C.reset}  ${C.dim}# 워커 상태 확인${C.reset}
  ${C.cyan}npx sleepcode run${C.reset}           ${C.dim}# 실행${C.reset}
  ${C.cyan}npx sleepcode run --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}
`);
    return;
  }

  runParallelWorkers(targetDir, created, cliProvider);
}

module.exports = {
  autoMergeWorktrees,
  cleanupWorktrees,
  copySleepcodeDirToWorktree,
  createWorktrees,
  mergeWorktrees,
  parseParallelTasks,
  parseTaskQueueWorkers,
  runTaskQueueCommand,
  runParallelWorkers,
  showParallelStatus,
};

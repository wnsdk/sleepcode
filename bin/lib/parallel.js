const fs = require('fs');
const path = require('path');

const { C } = require('./constants');
const {
  cleanupWorktrees,
  copySleepcodeDirToWorktree,
  createWorktrees,
  parseParallelTasks,
  showParallelStatus,
} = require('./parallelWorktrees');
const {
  autoMergeWorktrees,
  mergeWorktrees,
} = require('./parallelMerge');
const { runParallelWorkers } = require('./parallelRunner');

function showParallelTaskFormatError() {
  console.error(`${C.red}task_queue.md에 @worker 섹션이 없습니다.${C.reset}`);
  console.log(`
${C.bold}task_queue.md 병렬 포맷 예시:${C.reset}

  ${C.dim}# 작업 목록${C.reset}
  ${C.cyan}## @worker feature-auth${C.reset}
  ${C.dim}- [ ] 로그인 화면 구현${C.reset}
  ${C.dim}- [ ] 회원가입 API 연동${C.reset}

  ${C.cyan}## @worker feature-cart${C.reset}
  ${C.dim}- [ ] 장바구니 화면 구현${C.reset}
  ${C.dim}- [ ] 상품 추가/삭제 API${C.reset}
`);
}

function runParallel(subArgs, cliProvider) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode init'으로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  const isSetup = subArgs.includes('--setup');
  const isClean = subArgs.includes('--clean');
  const isStatus = subArgs.includes('--status');
  const isMerge = subArgs.includes('--merge');

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

  const tasksPath = path.join(scDir, 'task_queue.md');
  const workers = parseParallelTasks(tasksPath);
  if (!workers) {
    showParallelTaskFormatError();
    process.exit(1);
  }

  console.log(`\n${C.bold}병렬 워커 설정${C.reset} — ${workers.length}개 워커 감지\n`);

  const created = createWorktrees(targetDir, workers);
  if (created.length === 0) {
    console.error(`\n${C.red}생성된 worktree가 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.green}${C.bold}Worktree 생성 완료!${C.reset}`);

  if (isSetup) {
    console.log(`
${C.bold}다음 단계:${C.reset}

  ${C.cyan}npx sleepcode parallel --status${C.reset}  ${C.dim}# 워커 상태 확인${C.reset}
  ${C.cyan}npx sleepcode parallel${C.reset}           ${C.dim}# 병렬 실행${C.reset}
  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}
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
  runParallel,
  runParallelWorkers,
  showParallelStatus,
};

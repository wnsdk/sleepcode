const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { C, SLEEPCODE_BADGE, notionLink, branchColor } = require('./constants');
const { countTasks, progressBar, visualWidth, padEndVisual } = require('./utils');
const { detectPython } = require('./prerequisites');
const { resolveProviderPlan, providerLabel, providerLabelWithModel } = require('./provider');
const { isOverBudget, recordCost } = require('./config');
const { syncClaudeMd } = require('./files');
const { boxLine, renderMenuLine, setupMenuInput } = require('./dashboard');
const { spawnWorker } = require('./worker');

function parseParallelTasks(tasksPath) {
  if (!fs.existsSync(tasksPath)) return null;
  const content = fs.readFileSync(tasksPath, 'utf-8');
  const lines = content.split('\n');

  const workers = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## @worker\s+(\S+)/);
    if (match) {
      current = { name: match[1], lines: [line] };
      workers.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (workers.length === 0) return null;

  // 각 워커의 tasks.md 콘텐츠 구성
  return workers.map(w => ({
    name: w.name,
    tasks: `# 작업 목록\n\n${w.lines.join('\n')}`,
    remaining: countTasks(w.lines.join('\n')).total - countTasks(w.lines.join('\n')).done,
  }));
}

/**
 * .sleepcode/ 디렉토리를 worktree로 복사 (worktrees/, logs/ 제외)
 */
function copySleepcodeDirToWorktree(srcDir, wtPath) {
  const sleepcodeDir = path.join(srcDir, '.sleepcode');
  const wtSleepcodeDir = path.join(wtPath, '.sleepcode');

  if (!fs.existsSync(sleepcodeDir)) return;

  // 복사에서 제외할 디렉토리 (재귀 방지 + 불필요한 파일)
  const EXCLUDE_DIRS = new Set(['worktrees', 'logs']);

  function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        // 최상위 .sleepcode/ 직속 하위인 경우만 제외 체크
        if (src === sleepcodeDir && EXCLUDE_DIRS.has(entry.name)) continue;
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDirRecursive(sleepcodeDir, wtSleepcodeDir);
}

function createWorktrees(targetDir, workers) {
  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');
  fs.mkdirSync(wtBase, { recursive: true });

  const created = [];
  for (const worker of workers) {
    const wtPath = path.join(wtBase, worker.name);
    const branch = `sleepcode/${worker.name}`;

    if (fs.existsSync(wtPath)) {
      console.log(`  ${C.dim}-${C.reset} ${worker.name} ${C.dim}(이미 존재)${C.reset}`);
      // .sleepcode 디렉토리가 없으면 복사
      const wtSleepcodeDir = path.join(wtPath, '.sleepcode');
      if (!fs.existsSync(wtSleepcodeDir)) {
        copySleepcodeDirToWorktree(targetDir, wtPath);
      }
      // 태스크 파일 갱신
      const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
      fs.mkdirSync(path.dirname(wtTasksPath), { recursive: true });
      fs.writeFileSync(wtTasksPath, worker.tasks);
      created.push({ name: worker.name, path: wtPath, branch });
      continue;
    }

    try {
      execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
        cwd: targetDir,
        stdio: 'pipe',
      });
    } catch (e) {
      // 브랜치가 이미 있으면 -b 없이 재시도
      try {
        execSync(`git worktree add "${wtPath}" "${branch}"`, {
          cwd: targetDir,
          stdio: 'pipe',
        });
      } catch (e2) {
        console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e2.message}`);
        continue;
      }
    }

    // .sleepcode 디렉토리를 worktree로 복사 (scripts, rules, docs 등)
    copySleepcodeDirToWorktree(targetDir, wtPath);

    // worktree 안의 tasks.md를 해당 워커 태스크만으로 덮어쓰기
    const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
    fs.mkdirSync(path.dirname(wtTasksPath), { recursive: true });
    fs.writeFileSync(wtTasksPath, worker.tasks);

    console.log(`  ${C.green}✓${C.reset} ${worker.name} ${C.dim}(${branch})${C.reset} — ${worker.remaining}개 태스크`);
    created.push({ name: worker.name, path: wtPath, branch });
  }

  return created;
}

function cleanupWorktrees(targetDir, workers) {
  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');

  if (workers) {
    // 특정 워커들만 정리
    for (const worker of workers) {
      const wtPath = path.join(wtBase, worker.name);
      if (!fs.existsSync(wtPath)) continue;
      try {
        execSync(`git worktree remove "${wtPath}" --force`, { cwd: targetDir, stdio: 'pipe' });
        console.log(`  ${C.green}✓${C.reset} ${worker.name} worktree 제거`);
      } catch (e) {
        console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e.message}`);
      }
    }
  } else {
    // 전체 정리: .sleepcode/worktrees/ 아래 모든 디렉토리
    if (!fs.existsSync(wtBase)) {
      console.log(`${C.dim}정리할 worktree가 없습니다.${C.reset}`);
      return;
    }
    const dirs = fs.readdirSync(wtBase).filter(d =>
      fs.statSync(path.join(wtBase, d)).isDirectory()
    );
    for (const dir of dirs) {
      const wtPath = path.join(wtBase, dir);
      try {
        execSync(`git worktree remove "${wtPath}" --force`, { cwd: targetDir, stdio: 'pipe' });
        console.log(`  ${C.green}✓${C.reset} ${dir} worktree 제거`);
      } catch (e) {
        console.error(`  ${C.red}✗${C.reset} ${dir}: ${e.message}`);
      }
    }
  }

  // worktrees 디렉토리가 비었으면 삭제
  if (fs.existsSync(wtBase)) {
    const remaining = fs.readdirSync(wtBase);
    if (remaining.length === 0) {
      fs.rmdirSync(wtBase);
    }
  }
}

function showParallelStatus(targetDir) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'tasks.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.log(`${C.yellow}tasks.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`${C.dim}병렬 실행을 위해 tasks.md에 ## @worker <name> 섹션을 추가하세요.${C.reset}`);
    return;
  }

  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');

  console.log(`\n${C.bold}워커 상태:${C.reset}\n`);
  for (const worker of workers) {
    const wtPath = path.join(wtBase, worker.name);
    const exists = fs.existsSync(wtPath);

    // worktree가 있으면 그 안의 tasks.md에서 진행률 확인
    let done = 0;
    let total = 0;
    if (exists) {
      const wtTasksPath = path.join(wtPath, '.sleepcode', 'tasks.md');
      if (fs.existsSync(wtTasksPath)) {
        const wtContent = fs.readFileSync(wtTasksPath, 'utf-8');
        const tc = countTasks(wtContent);
        done = tc.done;
        total = tc.total;
      }
    } else {
      total = worker.remaining;
    }

    const bar = total > 0 ? progressBar(done, total, 20) : C.dim + '(태스크 없음)' + C.reset;
    const status = exists
      ? `${C.green}준비됨${C.reset}`
      : `${C.dim}미생성${C.reset}`;

    console.log(`  ${C.bold}${worker.name}${C.reset}  ${bar}  ${done}/${total}  ${status}`);
  }
  console.log('');
}

/**
 * AI를 이용하여 merge conflict를 해결한다.
 * merge가 진행 중인 상태(충돌 파일이 있는 상태)에서 호출해야 한다.
 * @returns {boolean} 해결 성공 여부
 */
function resolveConflictsWithAI(targetDir, branch) {
  // 충돌 파일 목록 가져오기
  let conflictFiles;
  try {
    const output = execSync('git diff --name-only --diff-filter=U', {
      cwd: targetDir,
      stdio: 'pipe',
    }).toString().trim();
    conflictFiles = output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return false;
  }

  if (conflictFiles.length === 0) return false;

  // 충돌 파일들의 내용 수집
  const conflictContents = [];
  for (const file of conflictFiles) {
    try {
      const content = fs.readFileSync(path.join(targetDir, file), 'utf-8');
      conflictContents.push(`--- ${file} ---\n${content}`);
    } catch {
      conflictContents.push(`--- ${file} --- (읽기 실패)`);
    }
  }

  const prompt = `You are resolving git merge conflicts. Branch "${branch}" is being merged into the current branch.

The following files have merge conflicts (marked with <<<<<<<, =======, >>>>>>>).
Resolve each conflict by choosing the best combination of both sides. Keep all meaningful changes from both branches.

For each file, output ONLY the resolved content in this exact format:
===FILE: <filepath>===
<resolved content>
===END===

Conflicted files:

${conflictContents.join('\n\n')}

IMPORTANT:
- Remove ALL conflict markers (<<<<<<<, =======, >>>>>>>)
- Preserve proper formatting and indentation
- If both sides add different things, include both
- Output nothing except the resolved files in the specified format`;

  try {
    const resolved = execSync(
      'claude -p --output-format text',
      {
        input: prompt,
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
      }
    ).toString();

    // 파싱: ===FILE: <path>=== ... ===END===
    const filePattern = /===FILE:\s*(.+?)===\n([\s\S]*?)===END===/g;
    let match;
    let resolvedCount = 0;

    while ((match = filePattern.exec(resolved)) !== null) {
      const filePath = match[1].trim();
      const content = match[2];

      // 안전 검사: 충돌 마커가 남아있지 않은지 확인
      if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
        continue;
      }

      // 충돌 파일 목록에 있는지 확인
      if (!conflictFiles.includes(filePath)) continue;

      try {
        fs.writeFileSync(path.join(targetDir, filePath), content);
        execSync(`git add "${filePath}"`, { cwd: targetDir, stdio: 'pipe' });
        resolvedCount++;
      } catch {
        // 파일 쓰기/스테이징 실패
      }
    }

    if (resolvedCount === 0) return false;

    // 남은 충돌 파일 체크
    try {
      const remaining = execSync('git diff --name-only --diff-filter=U', {
        cwd: targetDir,
        stdio: 'pipe',
      }).toString().trim();
      if (remaining) return false; // 아직 해결되지 않은 파일이 있음
    } catch {
      // diff 명령 실패 = 충돌 없음으로 간주
    }

    // 머지 커밋 완료
    try {
      execSync('git commit --no-edit', { cwd: targetDir, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function mergeWorktrees(targetDir) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'tasks.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.error(`${C.red}tasks.md에 @worker 섹션이 없습니다.${C.reset}`);
    process.exit(1);
  }

  // 현재 브랜치 확인
  let currentBranch;
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
  } catch {
    console.error(`${C.red}git 브랜치를 확인할 수 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}브랜치 머지${C.reset} — 대상: ${C.cyan}${currentBranch}${C.reset}\n`);

  // 머지 전 uncommitted changes 체크
  try {
    const status = execSync('git status --porcelain', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
    if (status) {
      console.error(`${C.red}커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 stash 하세요.${C.reset}`);
      console.log(`${C.dim}${status}${C.reset}`);
      process.exit(1);
    }
  } catch {
    // 무시
  }

  const results = { merged: [], conflicted: [], skipped: [] };

  for (const worker of workers) {
    const branch = `sleepcode/${worker.name}`;

    // 브랜치 존재 확인
    try {
      execSync(`git rev-parse --verify "${branch}"`, { cwd: targetDir, stdio: 'pipe' });
    } catch {
      console.log(`  ${C.dim}-${C.reset} ${branch} ${C.dim}(브랜치 없음, 스킵)${C.reset}`);
      results.skipped.push(worker.name);
      continue;
    }

    // 메인 브랜치와 차이 확인
    try {
      const diff = execSync(`git log "${currentBranch}..${branch}" --oneline`, { cwd: targetDir, stdio: 'pipe' }).toString().trim();
      if (!diff) {
        console.log(`  ${C.dim}-${C.reset} ${branch} ${C.dim}(변경사항 없음, 스킵)${C.reset}`);
        results.skipped.push(worker.name);
        continue;
      }
    } catch {
      // diff 실패 시 머지 시도
    }

    // 머지 시도
    try {
      execSync(`git merge "${branch}" --no-edit`, { cwd: targetDir, stdio: 'pipe' });
      console.log(`  ${C.green}✓${C.reset} ${branch} 머지 완료`);
      results.merged.push(worker.name);
    } catch (e) {
      // 충돌 감지 — AI로 해결 시도
      const stderr = e.stderr ? e.stderr.toString() : '';
      if (stderr.includes('CONFLICT') || stderr.includes('Merge conflict')) {
        console.log(`  ${C.yellow}⟳${C.reset} ${branch} ${C.yellow}충돌 발생${C.reset} — AI 자동 해결 시도 중...`);
        const resolved = resolveConflictsWithAI(targetDir, branch);
        if (resolved) {
          console.log(`  ${C.green}✓${C.reset} ${branch} AI 머지 완료 (충돌 자동 해결)`);
          results.merged.push(worker.name);
        } else {
          // AI 해결 실패 — 머지 중단
          try {
            execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
          } catch {}
          console.log(`  ${C.red}✗${C.reset} ${branch} ${C.red}AI 해결 실패${C.reset} — 수동 머지 필요`);
          results.conflicted.push(worker.name);
        }
      } else {
        // 충돌 외 머지 실패
        try {
          execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
        } catch {}
        console.log(`  ${C.red}✗${C.reset} ${branch} 머지 실패`);
        results.conflicted.push(worker.name);
      }
    }
  }

  // 결과 요약
  console.log(`\n${C.bold}머지 결과:${C.reset}`);
  if (results.merged.length > 0) {
    console.log(`  ${C.green}성공: ${results.merged.length}${C.reset} (${results.merged.join(', ')})`);
  }
  if (results.conflicted.length > 0) {
    console.log(`  ${C.red}충돌: ${results.conflicted.length}${C.reset} (${results.conflicted.join(', ')}) ${C.dim}(AI 자동 해결 실패)${C.reset}`);
    console.log(`\n${C.yellow}충돌 브랜치를 수동으로 머지하세요:${C.reset}`);
    for (const name of results.conflicted) {
      console.log(`  ${C.cyan}git merge sleepcode/${name}${C.reset}  ${C.dim}# 충돌 해결 후 git commit${C.reset}`);
    }
    console.log(`\n${C.yellow}⚠ 충돌이 남아있으므로 워크트리를 정리하지 마세요.${C.reset}`);
    console.log(`  ${C.dim}수동 머지 완료 후 'npx sleepcode parallel --clean'으로 정리하세요.${C.reset}`);
  }
  if (results.skipped.length > 0) {
    console.log(`  ${C.dim}스킵: ${results.skipped.length} (${results.skipped.join(', ')})${C.reset}`);
  }

  if (results.conflicted.length === 0 && results.merged.length > 0) {
    console.log(`\n${C.green}${C.bold}모든 브랜치 머지 완료!${C.reset}`);
    console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}  ${C.dim}# worktree 정리${C.reset}\n`);
  }
}

function autoMergeWorktrees(targetDir, workerStates) {
  let currentBranch;
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
  } catch {
    throw new Error('git 브랜치를 확인할 수 없습니다.');
  }

  // 머지 전 uncommitted changes 체크
  try {
    const status = execSync('git status --porcelain', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
    if (status) {
      throw new Error('커밋되지 않은 변경사항이 있습니다.');
    }
  } catch (e) {
    if (e.message.includes('커밋되지 않은')) throw e;
  }

  const results = { merged: [], conflicted: [], skipped: [] };

  for (const ws of workerStates) {
    const branch = `sleepcode/${ws.name}`;

    try {
      execSync(`git rev-parse --verify "${branch}"`, { cwd: targetDir, stdio: 'pipe' });
    } catch {
      results.skipped.push(ws.name);
      continue;
    }

    try {
      const diff = execSync(`git log "${currentBranch}..${branch}" --oneline`, { cwd: targetDir, stdio: 'pipe' }).toString().trim();
      if (!diff) {
        results.skipped.push(ws.name);
        continue;
      }
    } catch {
      // diff 실패 시 머지 시도
    }

    try {
      execSync(`git merge "${branch}" --no-edit`, { cwd: targetDir, stdio: 'pipe' });
      results.merged.push(ws.name);
    } catch {
      // 충돌 시 AI로 해결 시도
      const resolved = resolveConflictsWithAI(targetDir, branch);
      if (resolved) {
        results.merged.push(ws.name);
      } else {
        try {
          execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
        } catch {}
        results.conflicted.push(ws.name);
      }
    }
  }

  return results;
}

function runParallel(subArgs, cliProvider) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // 서브 옵션 파싱
  const isSetup = subArgs.includes('--setup');
  const isClean = subArgs.includes('--clean');
  const isStatus = subArgs.includes('--status');
  const isMerge = subArgs.includes('--merge');

  if (isStatus) {
    showParallelStatus(targetDir);
    return;
  }

  if (isMerge) {
    mergeWorktrees(targetDir);
    return;
  }

  if (isClean) {
    console.log(`\n${C.bold}Worktree 정리 중...${C.reset}\n`);
    cleanupWorktrees(targetDir, null);
    console.log(`\n${C.green}정리 완료.${C.reset}`);
    return;
  }

  // --setup 또는 기본 동작: worktree 생성
  const tasksPath = path.join(scDir, 'tasks.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.error(`${C.red}tasks.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`
${C.bold}tasks.md 병렬 포맷 예시:${C.reset}

  ${C.dim}# 작업 목록${C.reset}
  ${C.cyan}## @worker feature-auth${C.reset}
  ${C.dim}- [ ] 로그인 화면 구현${C.reset}
  ${C.dim}- [ ] 회원가입 API 연동${C.reset}

  ${C.cyan}## @worker feature-cart${C.reset}
  ${C.dim}- [ ] 장바구니 화면 구현${C.reset}
  ${C.dim}- [ ] 상품 추가/삭제 API${C.reset}
`);
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

  // 병렬 실행
  runParallelWorkers(targetDir, created, cliProvider);
}

function runParallelWorkers(targetDir, workerInfos, cliProvider) {
  const logDir = path.join(targetDir, '.sleepcode', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const py = detectPython();
  if (!py) {
    console.error(`${C.red}python3이 필요합니다.${C.reset}`);
    process.exit(1);
  }

  // 실행 전 예산 체크
  const budgetCheck = isOverBudget(targetDir);
  if (budgetCheck && budgetCheck.over) {
    console.log(`\n${C.red}주간 한도에 도달했습니다.${C.reset}`);
    console.log(`  사용: $${budgetCheck.total.toFixed(2)} / 한도: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.threshold}% of $${budgetCheck.budget.toFixed(2)})`);
    console.log(`${C.dim}다음 주 월요일에 초기화됩니다.${C.reset}`);
    process.exit(0);
  }

  console.log(`\n${C.bold}병렬 실행 시작${C.reset} — ${workerInfos.length}개 워커\n`);

  let providerPlan;
  try {
    providerPlan = resolveProviderPlan(targetDir, cliProvider);
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}`);
    process.exit(1);
  }
  if (providerPlan.requestedUnavailable) {
    console.log(`${C.yellow}requested provider unavailable, switched to ${providerLabel(providerPlan.selected)}.${C.reset}`);
  }

  const workerStates = workerInfos.map(w => ({
    ...w,
    targetDir,
    status: 'running',
    currentTask: '',
    done: 0,
    total: 0,
    cost: 0,
    provider: providerPlan.selected,
    fallbackProvider: providerPlan.fallback,
    _proc: null,
    logFile: path.join(logDir, `parallel_${w.name}_${timestamp}.log`),
  }));

  // 초기 태스크 수 계산
  for (const ws of workerStates) {
    const tasksPath = path.join(ws.path, '.sleepcode', 'tasks.md');
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const tc = countTasks(content);
      ws.total = tc.total;
      ws.done = tc.done;
    }
  }

  // 로그 버퍼 (리사이즈 시 재렌더링용)
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let altScreenActive = false;

  function appendLogToScreen(line) {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function pushLog(workerName, msg) {
    const color = branchColor(workerName);
    const tag = `${color}[${workerName}]${C.reset}`;
    const fullMsg = `${tag} ${msg}`;
    logBuffer.push(fullMsg);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    appendLogToScreen(fullMsg);
  }

  // 대시보드 렌더링
  const startTime = Date.now();
  let renderPending = false;
  const menuState = { menuIndex: 0 };
  let gracefulShutdown = false;

  function renderDashboard() {
    if (!altScreenActive) return;

    const lines = [];
    const W = 62; // 박스 내부 너비
    const totalTasks = workerStates.reduce((s, w) => s + w.total, 0);
    const totalDone = workerStates.reduce((s, w) => s + w.done, 0);
    const activeCount = workerStates.filter(w => w.status === 'running').length;
    const totalCost = workerStates.reduce((s, w) => s + w.cost, 0);

    lines.push(`${C.dim}╔${'═'.repeat(W + 2)}╗${C.reset}`);
    lines.push(boxLine(`${SLEEPCODE_BADGE} parallel  ${C.dim}${activeCount}/${workerStates.length} workers${C.reset}${notionLink(process.env.NOTION_DB_ID)}`, W));
    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);

    for (const ws of workerStates) {
      const bar = progressBar(ws.done, ws.total, 15);
      const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
        : ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      const wPct = ws.total > 0 ? Math.round(ws.done / ws.total * 100) : 0;
      const diffTag = ws.difficultyLabel ? ` ${C.yellow}${ws.difficulty}${C.reset}` : '';
      lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(ws.name, 18)}${C.reset} ${bar} ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} ${C.cyan}${String(wPct).padStart(3)}%${C.reset}${diffTag}`, W));
      if (ws.currentTask && ws.status === 'running') {
        const maxTaskW = W - 6;
        let task = ws.currentTask;
        if (visualWidth(task) > maxTaskW) {
          let tw = 0;
          let cut = 0;
          for (const ch of task) {
            const cw = visualWidth(ch);
            if (tw + cw > maxTaskW - 3) break;
            tw += cw;
            cut += ch.length;
          }
          task = task.slice(0, cut) + '...';
        }
        lines.push(boxLine(`  ${C.dim}> ${task}${C.reset}`, W));
      } else {
        lines.push(boxLine('', W));
      }
    }

    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);
    const costStr = `$${totalCost.toFixed(4)}`;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`;
    const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
    lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}${costStr}${C.reset}  ${C.dim}·  경과${C.reset} ${C.cyan}${elapsedStr}${C.reset}  ${C.dim}·  진행${C.reset} ${totalDone}/${totalTasks} ${C.cyan}${totalPct}%${C.reset}`, W));
    const budgetInfo = isOverBudget(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
      lines.push(boxLine(`${C.dim}주간${C.reset} ${C.yellow}$${budgetInfo.total.toFixed(2)}${C.reset}/${C.dim}$${budgetInfo.budget}${C.reset} (${pct}%) ${budgetBar}${warn}`, W));
    } else {
      lines.push(boxLine('', W));
    }

    // 테이블 닫기
    lines.push(`${C.dim}╚${'═'.repeat(W + 2)}╝${C.reset}`);

    // 메뉴 (테이블 밖)
    if (gracefulShutdown) {
      lines.push(`  ${C.yellow}⏳ 마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`);
    } else {
      lines.push(renderMenuLine(menuState.menuIndex, W, menuState.confirmPending, menuState._menuItems));
    }
    lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(W - 6)}${C.reset}`);

    // Alternate Screen: 절대 좌표로 대시보드 렌더링
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${lines[i]}\x1b[K`);
    }
  }

  /** 이벤트 기반 렌더 요청을 200ms 디바운스로 처리 (깜빡임 방지) */
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      renderDashboard();
    }, 200);
  }

  // Alternate Screen 초기화
  const dashboardHeight = 11 + workerStates.length * 2;
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[2J');
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    altScreenActive = true;
  }

  function cleanupAltScreen() {
    if (!altScreenActive) return;
    altScreenActive = false;
    process.stdout.write('\x1b[r');
    process.stdout.write('\x1b[?1049l');
  }

  process.stdout.on('resize', () => {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    const logRows = rows - dashboardHeight;
    const recentLogs = logBuffer.slice(-Math.max(0, logRows));
    for (const line of recentLogs) {
      appendLogToScreen(line);
    }
  });

  const sigintHandler = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    for (const ws of workerStates) {
      if (ws._proc) try { ws._proc.kill(); } catch {}
    }
    cleanupAltScreen();
    console.log(`\n${C.yellow}중단됨${C.reset}`);
    process.exit(1);
  };
  process.on('SIGINT', sigintHandler);
  process.on('exit', cleanupAltScreen);

  // 메뉴 키 입력 핸들러
  const cleanupMenuInput = setupMenuInput(
    menuState,
    renderDashboard,
    // 마무리 후 종료: 현재 작업 완료 후 프로세스 종료
    () => {
      if (gracefulShutdown) return;
      gracefulShutdown = true;
      pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
      for (const ws of workerStates) {
        if (ws.status === 'running' && ws._proc) {
          try { ws._proc.kill('SIGINT'); } catch {}
        }
      }
      renderDashboard();
    },
    // 즉시 종료
    () => {
      if (cleanupMenuInput) cleanupMenuInput();
      for (const ws of workerStates) {
        if (ws._proc) try { ws._proc.kill(); } catch {}
      }
      cleanupAltScreen();
      console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
      process.exit(0);
    }
  );

  renderDashboard();

  // 대시보드 갱신 타이머
  const dashboardInterval = setInterval(renderDashboard, 3000);

  // 5초마다 tasks.md를 읽어 진행률 갱신
  const taskProgressInterval = setInterval(() => {
    for (const ws of workerStates) {
      if (ws.status !== 'running') continue;
      const tp = path.join(ws.path, '.sleepcode', 'tasks.md');
      try {
        if (fs.existsSync(tp)) {
          const content = fs.readFileSync(tp, 'utf-8');
          const tc = countTasks(content);
          ws.done = tc.done;
          ws.total = tc.total;
        }
      } catch {}
    }
    scheduleRender();
  }, 5000);

  // 예산 체크 타이머 (30초마다)
  let budgetStopped = false;
  const budgetCheckInterval = setInterval(() => {
    if (budgetStopped) return;
    const result = isOverBudget(targetDir);
    if (result && result.over) {
      budgetStopped = true;
      pushLog('SYSTEM', `${C.yellow}주간 한도 ${result.threshold}% 도달 ($${result.total.toFixed(2)}) — 워커 중지${C.reset}`);
      for (const ws of workerStates) {
        if (ws.status === 'running' && ws._proc) {
          ws.status = 'budget_stop';
          ws.currentTask = '한도 도달 — 중지됨';
          try { ws._proc.kill(); } catch {}
        }
      }
      renderDashboard();
    }
  }, 30000);

  // 각 워커 프로세스 생성
  let activeWorkers = workerStates.length;

  function onWorkerDone(completedWs) {
    activeWorkers--;
    renderDashboard();

    // 워커가 모든 태스크를 완료했으면 즉시 main 브랜치에 병합
    if (completedWs && completedWs.status === 'done') {
      pushLog('SYSTEM', `${C.green}${completedWs.name} 완료 — main 브랜치에 즉시 병합 중...${C.reset}`);
      try {
        const mergeResults = autoMergeWorktrees(targetDir, [completedWs]);
        if (mergeResults.merged.length > 0) {
          pushLog('SYSTEM', `${C.green}✓ ${completedWs.name} — main 브랜치 병합 완료${C.reset}`);
          completedWs.merged = true;
        } else if (mergeResults.skipped.length > 0) {
          pushLog('SYSTEM', `${C.dim}${completedWs.name} — 병합 스킵 (변경 없음)${C.reset}`);
          completedWs.merged = true;
        } else if (mergeResults.conflicted.length > 0) {
          pushLog('SYSTEM', `${C.red}✗ ${completedWs.name} — 병합 충돌 (수동 처리 필요)${C.reset}`);
        }
      } catch (e) {
        pushLog('SYSTEM', `${C.red}✗ ${completedWs.name} — 병합 오류: ${e.message}${C.reset}`);
      }
      scheduleRender();
    }

    if (activeWorkers === 0) {
      clearInterval(dashboardInterval);
      clearInterval(budgetCheckInterval);
      clearInterval(taskProgressInterval);
      renderDashboard();
      if (cleanupMenuInput) cleanupMenuInput();
      process.removeListener('SIGINT', sigintHandler);
      cleanupAltScreen();
      onAllDone();
    }
  }

  function onAllDone() {
    const failed = workerStates.filter(w => w.status === 'failed');
    const done = workerStates.filter(w => w.status === 'done');
    const stopped = workerStates.filter(w => w.status === 'budget_stop');
    const alreadyMerged = workerStates.filter(w => w.merged);
    const needsMerge = done.filter(w => !w.merged);

    console.log(`\n${C.bold}병렬 실행 완료${C.reset}`);
    const parts = [`${C.green}성공: ${done.length}${C.reset}`];
    if (failed.length > 0) parts.push(`${C.red}실패: ${failed.length}${C.reset}`);
    if (stopped.length > 0) parts.push(`${C.yellow}예산 중지: ${stopped.length}${C.reset}`);
    console.log(`  ${parts.join('  ')}`);

    // 브랜치 목록 출력
    console.log(`\n${C.bold}생성된 브랜치:${C.reset}`);
    for (const ws of workerStates) {
      const mergedTag = ws.merged ? ` ${C.dim}(병합됨)${C.reset}` : '';
      const icon = ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      console.log(`  ${icon} ${ws.branch}${mergedTag}`);
    }

    if (alreadyMerged.length > 0) {
      console.log(`\n${C.green}✓ 자동 병합 완료: ${alreadyMerged.map(w => w.name).join(', ')}${C.reset}`);
    }

    if (needsMerge.length > 0) {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --merge${C.reset}   ${C.dim}# 남은 브랜치 병합${C.reset}`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    } else if (done.length > 0) {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    } else {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --merge${C.reset}   ${C.dim}# 브랜치 자동 머지${C.reset}`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    }
    console.log('');
  }

  for (const ws of workerStates) {
    spawnWorker(ws, py, () => onWorkerDone(ws), scheduleRender, pushLog, cliProvider);
  }
}

module.exports = {
  parseParallelTasks,
  copySleepcodeDirToWorktree,
  createWorktrees,
  cleanupWorktrees,
  showParallelStatus,
  mergeWorktrees,
  autoMergeWorktrees,
  runParallel,
  runParallelWorkers,
};

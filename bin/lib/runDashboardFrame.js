const { C, SLEEPCODE_BADGE_WITH_VERSION, notionLink } = require('./constants');
const { progressBar, padEndVisual } = require('./utils');
const { providerLabelWithModel, providerLabel } = require('./provider');
const { boxLine, renderMenuLineWithLayout } = require('./dashboard');
const { clipVisualText, formatElapsedSeconds, formatProviderTokens } = require('./dashboardUtils');

const MAX_TASKS_DISPLAY = 8;

function countWorkerTaskLines(worker) {
  const tasks = worker.taskEntries || [];
  if (tasks.length === 0) return 1; // fallback: current task line only
  if (tasks.length <= MAX_TASKS_DISPLAY) return tasks.length;
  // compact: done summary(1) + 2 recent done + current(1) + 3 pending + remaining(1)
  const done = worker.done || 0;
  const doneShown = Math.min(done, 2);
  const hasDoneSummary = done > doneShown ? 1 : 0;
  const hasCurrent = (done < tasks.length && worker.status === 'running') ? 1 : 0;
  const pendingAfter = tasks.length - done - (hasCurrent ? 1 : 0);
  const pendingShown = Math.min(pendingAfter, 3);
  const hasRemaining = (pendingAfter - pendingShown) > 0 ? 1 : 0;
  return hasDoneSummary + doneShown + hasCurrent + pendingShown + hasRemaining;
}

function getRunDashboardHeight(phase, workerStates) {
  if (phase !== 'executing' || !Array.isArray(workerStates) || workerStates.length === 0) {
    return 12;
  }
  let taskLines = 0;
  for (const worker of workerStates) {
    taskLines += 1 + countWorkerTaskLines(worker); // 1 header + task lines
  }
  return 8 + taskLines;
}

function buildWorkerTaskLines(worker, width, lines) {
  const tasks = worker.taskEntries || [];
  const done = worker.done || 0;

  if (tasks.length === 0) {
    // Fallback: show current task only (legacy behavior)
    if (worker.currentTask && worker.status === 'running') {
      lines.push(boxLine(`  ${C.dim}> ${clipVisualText(worker.currentTask, width - 6)}${C.reset}`, width));
    } else {
      lines.push(boxLine('', width));
    }
    return;
  }

  if (tasks.length <= MAX_TASKS_DISPLAY) {
    // Show all tasks
    for (let i = 0; i < tasks.length; i++) {
      const title = tasks[i].title || `Task ${i + 1}`;
      if (i < done) {
        lines.push(boxLine(`  ${C.green}✓${C.reset} ${C.dim}${clipVisualText(title, width - 8)}${C.reset}`, width));
      } else if (i === done && worker.status === 'running') {
        lines.push(boxLine(`  ${C.cyan}▶${C.reset} ${clipVisualText(title, width - 8)}`, width));
      } else {
        lines.push(boxLine(`  ${C.dim}○ ${clipVisualText(title, width - 8)}${C.reset}`, width));
      }
    }
    return;
  }

  // Compact: too many tasks
  const doneShown = Math.min(done, 2);
  if (done > doneShown) {
    lines.push(boxLine(`  ${C.green}✓${C.reset} ${C.dim}완료 ${done}개${C.reset}`, width));
  }
  for (let i = Math.max(0, done - doneShown); i < done; i++) {
    const title = tasks[i].title || `Task ${i + 1}`;
    lines.push(boxLine(`  ${C.green}✓${C.reset} ${C.dim}${clipVisualText(title, width - 8)}${C.reset}`, width));
  }
  if (done < tasks.length && worker.status === 'running') {
    const title = tasks[done].title || `Task ${done + 1}`;
    lines.push(boxLine(`  ${C.cyan}▶${C.reset} ${clipVisualText(title, width - 8)}`, width));
  }
  const pendingStart = done + (worker.status === 'running' ? 1 : 0);
  const pendingCount = tasks.length - pendingStart;
  const pendingToShow = Math.min(pendingCount, 3);
  for (let i = pendingStart; i < pendingStart + pendingToShow; i++) {
    const title = tasks[i].title || `Task ${i + 1}`;
    lines.push(boxLine(`  ${C.dim}○ ${clipVisualText(title, width - 8)}${C.reset}`, width));
  }
  const remaining = pendingCount - pendingToShow;
  if (remaining > 0) {
    lines.push(boxLine(`  ${C.dim}  ... +${remaining}개 대기${C.reset}`, width));
  }
}

function buildRunDashboardFrame({
  dbId,
  pollIntervalSec,
  watchPhase,
  workerStates,
  pollInfo,
  lastPollTime,
  execStartTime,
  gracefulShutdown,
  menuState,
}) {
  const lines = [];
  const width = 62;

  lines.push(`${C.dim}╔${'═'.repeat(width + 2)}╗${C.reset}`);

  if (watchPhase === 'executing' && workerStates.length > 0) {
    const activeCount = workerStates.filter((worker) => worker.status === 'running').length;
    lines.push(boxLine(`${SLEEPCODE_BADGE_WITH_VERSION}  ${C.cyan}⟳${C.reset} ${activeCount}/${workerStates.length} workers${notionLink(dbId)}`, width));
    lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);

    for (const worker of workerStates) {
      const bar = progressBar(worker.done, worker.total, 15);
      const statusIcon = worker.status === 'running'
        ? `${C.cyan}⟳${C.reset}`
        : worker.status === 'done'
          ? `${C.green}✓${C.reset}`
          : worker.status === 'budget_stop'
            ? `${C.yellow}■${C.reset}`
            : `${C.red}✗${C.reset}`;
      const percent = worker.total > 0 ? Math.round(worker.done / worker.total * 100) : 0;
      const model = worker.provider
        ? `${C.dim}[${providerLabelWithModel(worker.provider, worker.model)}]${C.reset} `
        : '';
      const difficulty = worker.difficultyLabel
        ? ` ${C.yellow}${worker.difficulty}${C.reset}`
        : '';
      lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(worker.name, 18)}${C.reset} ${bar} ${String(worker.done).padStart(2)}/${String(worker.total).padEnd(2)} ${C.cyan}${String(percent).padStart(3)}%${C.reset} ${model}${difficulty}`, width));
      buildWorkerTaskLines(worker, width, lines);
    }

    lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);

    const totalDone = workerStates.reduce((sum, worker) => sum + worker.done, 0);
    const totalTasks = workerStates.reduce((sum, worker) => sum + worker.total, 0);
    const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
    const elapsed = execStartTime ? Math.floor((Date.now() - execStartTime) / 1000) : 0;
    const remaining = lastPollTime
      ? Math.max(0, pollIntervalSec - Math.floor((Date.now() - lastPollTime) / 1000))
      : pollIntervalSec;
    const tokenLabel = formatProviderTokens(workerStates, providerLabel);
    lines.push(boxLine(`${C.dim}${tokenLabel}${C.reset} ${C.dim}·${C.reset} ${C.dim}경과${C.reset} ${C.cyan}${formatElapsedSeconds(elapsed)}${C.reset} ${C.dim}·${C.reset} ${C.cyan}${totalPct}%${C.reset} ${C.dim}·${C.reset} ${C.dim}폴링${C.reset} ${remaining}초`, width));
  } else {
    const remaining = lastPollTime
      ? Math.max(0, pollIntervalSec - Math.floor((Date.now() - lastPollTime) / 1000))
      : pollIntervalSec;
    lines.push(boxLine(`${SLEEPCODE_BADGE_WITH_VERSION}  ${C.dim}◆${C.reset} 대기 중${notionLink(dbId)}`, width));
    lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);
    lines.push(boxLine(`${C.dim}전체${C.reset} ${pollInfo.total}  ${C.dim}·  대기${C.reset} ${C.cyan}${pollInfo.pending}${C.reset}`, width));
    lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);
    lines.push(boxLine(`${C.dim}다음 폴링${C.reset} ${C.cyan}${remaining}초${C.reset}`, width));
  }

  lines.push(`${C.dim}╚${'═'.repeat(width + 2)}╝${C.reset}`);

  if (gracefulShutdown) {
    lines.push(`  ${C.yellow}⏳ 마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`);
    menuState._menuLayout = null;
  } else {
    const menuRender = renderMenuLineWithLayout(menuState.menuIndex, width, menuState.confirmPending, menuState._menuItems);
    lines.push(menuRender.line);
    menuState._menuLayout = { row: lines.length, items: menuRender.items };
  }
  lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(width - 6)}${C.reset}`);

  return lines;
}

module.exports = {
  buildRunDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  getRunDashboardHeight,
};

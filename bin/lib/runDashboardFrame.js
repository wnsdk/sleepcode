const { C, SLEEPCODE_BADGE_WITH_VERSION, notionLink } = require('./constants');
const { progressBar, padEndVisual } = require('./utils');
const { providerLabelWithModel, providerLabel } = require('./provider');
const { boxLine, renderMenuLineWithLayout } = require('./dashboard');
const { clipVisualText, formatElapsedSeconds, formatProviderTokens } = require('./dashboardUtils');

function getRunDashboardHeight(phase, workerStates) {
  if (phase !== 'executing' || !Array.isArray(workerStates) || workerStates.length === 0) {
    return 12;
  }
  return 8 + workerStates.length * 2;
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
      if (worker.currentTask && worker.status === 'running') {
        lines.push(boxLine(`  ${C.dim}> ${clipVisualText(worker.currentTask, width - 6)}${C.reset}`, width));
      } else {
        lines.push(boxLine('', width));
      }
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

const { C, SLEEPCODE_BADGE_WITH_VERSION, notionLink } = require('./constants');
const { progressBar, padEndVisual, visualWidth } = require('./utils');
const { providerLabelWithModel, providerLabel } = require('./provider');
const { boxLine, renderMenuLineWithLayout } = require('./dashboard');
const { clipVisualText, formatElapsedSeconds, formatProviderTokens } = require('./dashboardUtils');

const MAX_TASKS_DISPLAY = 8;

function countWorkerTaskLines(worker) {
  // Always show exactly 1 line: current running task only
  return 1;
}

const MIN_WORKTREE_ROWS = 5;

function getRunDashboardHeight(phase, workerStates) {
  if (phase !== 'executing' || !Array.isArray(workerStates) || workerStates.length === 0) {
    return 12;
  }
  let taskLines = 0;
  for (const worker of workerStates) {
    taskLines += 1 + countWorkerTaskLines(worker); // 1 header + task lines
  }
  return 8 + Math.max(MIN_WORKTREE_ROWS, taskLines);
}

function buildWorkerTaskLines(worker, width, lines) {
  const tasks = worker.taskEntries || [];
  const done = worker.done || 0;

  // Show only the currently running task in dim text
  if (tasks.length > 0 && done < tasks.length && worker.status === 'running') {
    const title = tasks[done].title || `Task ${done + 1}`;
    lines.push(boxLine(`  ${C.dim}> ${clipVisualText(title, width - 6)}${C.reset}`, width));
  } else if (tasks.length === 0 && worker.currentTask && worker.status === 'running') {
    // Fallback legacy behavior
    lines.push(boxLine(`  ${C.dim}> ${clipVisualText(worker.currentTask, width - 6)}${C.reset}`, width));
  } else {
    lines.push(boxLine('', width));
  }
}

/** 우측 태스크 패널 박스 라인 생성 */
function buildTaskPanelLines(worker, panelWidth, panelState) {
  const inner = panelWidth - 4; // 2 border + 2 padding
  if (inner < 10) return [];

  const selectedTaskIdx = panelState && panelState.selectedTaskIdx != null ? panelState.selectedTaskIdx : -1;
  const cancelConfirm = panelState && panelState.cancelConfirm;

  const pLines = [];
  const tasks = worker.taskEntries || [];
  const done = worker.done || 0;
  const workerName = worker.name || 'worktree';
  const isRunning = worker.status === 'running';
  const firstPendingIdx = isRunning ? done + 1 : done;

  // 패널 내부 한 줄 생성
  const pBox = (content) => {
    return `${C.dim}║${C.reset} ${padEndVisual(content, inner)} ${C.dim}║${C.reset}`;
  };

  pLines.push(`${C.dim}╔${'═'.repeat(inner + 2)}╗${C.reset}`);
  pLines.push(pBox(`${C.cyan}${C.bold}${clipVisualText(workerName, inner)}${C.reset}`));
  pLines.push(`${C.dim}╠${'═'.repeat(inner + 2)}╣${C.reset}`);

  if (tasks.length === 0) {
    pLines.push(pBox(`${C.dim}태스크 없음${C.reset}`));
  } else {
    for (let i = 0; i < tasks.length; i++) {
      const title = tasks[i].title || `Task ${i + 1}`;
      const isPending = i >= firstPendingIdx;
      const isSelected = isPending && selectedTaskIdx === i;

      if (i < done) {
        pLines.push(pBox(`${C.green}✓${C.reset} ${C.dim}${clipVisualText(title, inner - 4)}${C.reset}`));
      } else if (i === done && isRunning) {
        pLines.push(pBox(`${C.cyan}▶${C.reset} ${clipVisualText(title, inner - 4)}`));
      } else if (isSelected && cancelConfirm) {
        const clipped = clipVisualText(title, Math.max(0, inner - 10));
        pLines.push(pBox(`${C.red}✗${C.reset} ${C.bold}${clipped}${C.reset} ${C.red}취소?${C.reset}`));
      } else if (isSelected) {
        pLines.push(pBox(`${C.yellow}▸${C.reset} ${clipVisualText(title, inner - 4)}`));
      } else {
        pLines.push(pBox(`${C.dim}○ ${clipVisualText(title, inner - 4)}${C.reset}`));
      }
    }
  }

  pLines.push(pBox(''));
  const summary = `${C.green}완료${C.reset} ${done}/${tasks.length}`;
  pLines.push(pBox(summary));

  // 취소 힌트 / 확인 메시지
  const hasPending = tasks.length > firstPendingIdx;
  if (hasPending) {
    if (cancelConfirm) {
      pLines.push(pBox(`${C.red}[Y] 취소확인  [N/Esc] 취소안함${C.reset}`));
    } else {
      pLines.push(pBox(`${C.dim}[↑↓] 선택  [x] 취소${C.reset}`));
    }
  }

  pLines.push(`${C.dim}╚${'═'.repeat(inner + 2)}╝${C.reset}`);

  return pLines;
}

function buildRunDashboardFrame({
  dbId,
  pollIntervalSec,
  projectName,
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
  const projectLabel = projectName ? `  ${C.bold}${projectName}${C.reset}` : '';
  const focusedIdx = (menuState && menuState.worktreeIndex != null) ? menuState.worktreeIndex : -1;
  const taskPanelOpen = menuState && menuState.taskPanelOpen;
  const worktreeAreaFocused = !menuState || !menuState.focusArea || menuState.focusArea === 'worktree';
  const menuAreaFocused = !menuState || menuState.focusArea === 'menu';

  lines.push(`${C.dim}╔${'═'.repeat(width + 2)}╗${C.reset}`);

  if (watchPhase === 'executing' && workerStates.length > 0) {
    const activeCount = workerStates.filter((worker) => worker.status === 'running').length;
    lines.push(boxLine(`${SLEEPCODE_BADGE_WITH_VERSION}${projectLabel}  ${C.cyan}⟳${C.reset} ${activeCount}/${workerStates.length} workers${notionLink(dbId)}`, width));
    lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);

    const workerAreaStart = lines.length;
    for (let wi = 0; wi < workerStates.length; wi++) {
      const worker = workerStates[wi];
      const isFocused = wi === focusedIdx;
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
      const focusIndicator = (isFocused && worktreeAreaFocused) ? `${C.cyan}▸${C.reset}` : ' ';
      lines.push(boxLine(`${focusIndicator}${statusIcon} ${C.bold}${padEndVisual(worker.name, 17)}${C.reset} ${bar} ${String(worker.done).padStart(2)}/${String(worker.total).padEnd(2)} ${C.cyan}${String(percent).padStart(3)}%${C.reset} ${model}${difficulty}`, width));
      buildWorkerTaskLines(worker, width, lines);
    }
    while (lines.length - workerAreaStart < MIN_WORKTREE_ROWS) {
      lines.push(boxLine('', width));
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
    lines.push(boxLine(`${SLEEPCODE_BADGE_WITH_VERSION}${projectLabel}  ${C.dim}◆${C.reset} 대기 중${notionLink(dbId)}`, width));
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
    const hasWorktrees = Array.isArray(workerStates) && workerStates.length > 0;
    const tabHint = hasWorktrees
      ? { text: `${C.dim}[Tab: 포커스전환]${C.reset}`, plain: '[Tab: 포커스전환]' }
      : null;
    const menuRender = renderMenuLineWithLayout(
      menuState.menuIndex, width, menuState.confirmPending, menuState._menuItems,
      menuAreaFocused || !hasWorktrees,
      tabHint
    );
    lines.push(menuRender.line);
    menuState._menuLayout = { row: lines.length, items: menuRender.items };
  }
  const termCols = (process.stdout.columns || 120);
  lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(Math.max(0, termCols - 9))}${C.reset}`);

  // 우측 태스크 패널 합성
  if (taskPanelOpen && focusedIdx >= 0 && focusedIdx < (workerStates || []).length) {
    const termCols = (process.stdout.columns || 120);
    const mainBoxWidth = width + 4; // inner + 2 borders + 2 padding(║ + space)
    const gap = 1;
    const panelWidth = termCols - mainBoxWidth - gap;
    if (panelWidth >= 20) {
      const focusedWorker = workerStates[focusedIdx];
      const panelState = {
        selectedTaskIdx: menuState && menuState.taskPanelSelectedIndex != null ? menuState.taskPanelSelectedIndex : -1,
        cancelConfirm: menuState && menuState.taskCancelConfirm,
      };
      const panelLines = buildTaskPanelLines(focusedWorker, panelWidth, panelState);
      // 패널이 더 긴 경우 빈 줄 추가
      while (lines.length < panelLines.length) {
        lines.push('');
      }
      for (let i = 0; i < lines.length; i++) {
        const panelLine = panelLines[i] || '';
        if (!panelLine) continue;
        const mainVw = visualWidth(lines[i]);
        const padNeeded = Math.max(0, mainBoxWidth - mainVw + gap);
        lines[i] = lines[i] + ' '.repeat(padNeeded) + panelLine;
      }
    }
  }

  return lines;
}

module.exports = {
  buildRunDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  getRunDashboardHeight,
};

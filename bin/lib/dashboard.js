const { C } = require('./constants');
const { visualWidth, padEndVisual } = require('./utils');

/** 대시보드용 한 줄: ║ content (패딩) ║ */
function boxLine(content, innerWidth) {
  return `${C.dim}║${C.reset} ${padEndVisual(content, innerWidth)} ${C.dim}║${C.reset}`;
}

/** 대시보드 하단 메뉴 렌더링 */

function renderMenuLineWithLayout(selectedIndex, innerWidth, confirmPending, menuItems, focused, hint) {
  const items = menuItems || [];
  const isMenuFocused = focused !== false; // default true for backwards compat
  const parts = items.map((label, i) => {
    if (i === selectedIndex) {
      if (isMenuFocused) {
        return `${C.cyan}${C.bold}▸ ${label}${C.reset}`;
      }
      return `${C.dim}▸ ${label}${C.reset}`;
    }
    return `${C.dim}  ${label}${C.reset}`;
  });
  const plainParts = items.map((label, i) => (i === selectedIndex ? `▸ ${label}` : `  ${label}`));
  const joiner = '    ';
  let content = parts.join(joiner);
  let contentPlain = plainParts.join(joiner);
  if (confirmPending) {
    content += `  ${C.yellow}← Enter로 확인${C.reset}`;
    contentPlain += '  ← Enter로 확인';
  }
  const hintPlain = hint ? `  ${hint.plain}` : '';
  const hintText = hint ? `  ${hint.text}` : '';
  const rawPlain = `  ${contentPlain}  ${hintPlain}`;
  const vw = visualWidth(rawPlain);
  const pad = Math.max(0, innerWidth - vw);
  const line = `  ${content}  ${hintText}${' '.repeat(pad)}`;

  // 클릭 영역 계산 (1-based column)
  const layout = [];
  let col = 1 + 2; // leading "  "
  for (let i = 0; i < plainParts.length; i++) {
    const w = visualWidth(plainParts[i]);
    layout.push({ index: i, start: col, end: col + w - 1 });
    col += w;
    if (i < plainParts.length - 1) col += visualWidth(joiner);
  }

  return { line, items: layout };
}

function renderMenuLine(selectedIndex, innerWidth, confirmPending, menuItems, focused, hint) {
  return renderMenuLineWithLayout(selectedIndex, innerWidth, confirmPending, menuItems, focused, hint).line;
}

/** 대시보드 메뉴 키 입력 핸들러 설정 */
function setupMenuInput(state, onRender, menuEntries, onImmediate, onScroll, worktreeOpts, scrollbarOpts, ratioOpts) {
  if (!process.stdin.isTTY) return null;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  if (process.stdout.isTTY) {
    // ?1000h: basic mouse, ?1006h: SGR extended, ?1002h: button motion tracking (drag)
    process.stdout.write('\x1b[?1000h\x1b[?1006h\x1b[?1002h');
  }

  const entries = Array.isArray(menuEntries) ? menuEntries : [];
  if (entries.length === 0) {
    throw new Error('setupMenuInput requires at least one menu entry');
  }
  state.confirmPending = false;
  if (!state.focusArea) state.focusArea = 'worktree';
  const actions = entries.map(entry => entry.handler);
  state._menuItems = entries.map(entry => entry.label);
  const itemCount = entries.length;
  const getWorktreeCount = (worktreeOpts && worktreeOpts.getWorktreeCount) || (() => 0);
  const sbOpts = scrollbarOpts || null;
  let sbDrag = null; // { startY, startThumbTop, thumbTravel }

  const handler = (data) => {
    const input = data.toString();

    // Mouse (SGR) 처리: \x1b[<b;x;yM
    if (input.includes('\x1b[<')) {
      const re = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
      let match;
      let handledMouse = false;
      while ((match = re.exec(input)) !== null) {
        handledMouse = true;
        const btn = parseInt(match[1], 10);
        const x = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        const type = match[4];
        const isPress = type === 'M';
        const isMotion = (btn & 32) !== 0 && (btn & 64) === 0;
        const isLeftBtn = (btn & 3) === 0 && (btn & 64) === 0;
        const isLeftPress = isPress && isLeftBtn && !isMotion;
        const isLeftDrag = isPress && isLeftBtn && isMotion;
        const isLeftRelease = !isPress && isLeftBtn;
        const isWheelUp = btn === 64;
        const isWheelDown = btn === 65;

        // 스크롤바 드래그 진행 중
        if (sbDrag) {
          if (isLeftDrag || isLeftRelease) {
            const dy = y - sbDrag.startY;
            const newThumbTop = Math.max(0, Math.min(sbDrag.thumbTravel, sbDrag.startThumbTop + dy));
            if (sbOpts && typeof sbOpts.scrollToThumbTop === 'function') {
              sbOpts.scrollToThumbTop(newThumbTop);
            }
            if (isLeftRelease) sbDrag = null;
            continue;
          }
        }

        if (isPress && (isWheelUp || isWheelDown) && typeof onScroll === 'function') {
          onScroll(isWheelUp ? 'wheelUp' : 'wheelDown');
          continue;
        }

        if (isLeftPress) {
          // 스크롤바 열(마지막 열) 클릭 여부 확인
          const scrollbarCol = process.stdout.columns || 80;
          if (x === scrollbarCol && sbOpts && typeof sbOpts.getScrollbarMetrics === 'function') {
            const metrics = sbOpts.getScrollbarMetrics();
            if (metrics) {
              const dbH = typeof sbOpts.getDashboardHeight === 'function' ? sbOpts.getDashboardHeight() : 0;
              const trackRow = y - dbH - 1; // 0-based within track
              if (trackRow >= 0 && trackRow < metrics.trackHeight) {
                const thumbTravel = metrics.trackHeight - metrics.thumbSize;
                if (trackRow >= metrics.thumbTop && trackRow < metrics.thumbTop + metrics.thumbSize) {
                  // 썸 위에 클릭 → 드래그 시작
                  sbDrag = { startY: y, startThumbTop: metrics.thumbTop, thumbTravel };
                } else {
                  // 트랙 위에 클릭 → 해당 위치로 이동
                  const newThumbTop = Math.max(0, Math.min(thumbTravel, trackRow - Math.floor(metrics.thumbSize / 2)));
                  if (typeof sbOpts.scrollToThumbTop === 'function') {
                    sbOpts.scrollToThumbTop(newThumbTop);
                  }
                }
                continue;
              }
            }
          }

          // 메뉴 클릭 처리
          const layout = state._menuLayout;
          if (!layout || layout.row !== y) continue;
          const hit = layout.items.find(it => x >= it.start && x <= it.end);
          if (!hit) continue;
          if (hit.index !== state.menuIndex) {
            state.confirmPending = false;
            state.menuIndex = hit.index;
            state.focusArea = 'menu';
            onRender();
            continue;
          }
          state.focusArea = 'menu';
          const action = actions[state.menuIndex];
          const entry = entries[state.menuIndex];
          const isNoConfirm = entry && entry.noConfirm;
          if (isNoConfirm) {
            action();
            continue;
          }
          if (!state.confirmPending) {
            state.confirmPending = true;
            onRender();
            continue;
          }
          state.confirmPending = false;
          action();
        }
      }
      if (handledMouse) return;
    }

    const key = input;
    const wtCount = getWorktreeCount();

    // 비율 조정 모드
    if (state.ratioAdjustOpen) {
      if (key === '\x1b' && input.length === 1) {
        state.ratioAdjustOpen = false;
        state.ratioAdjustValue = null;
        onRender();
        return;
      }
      if (key === '\r' || key === '\n') {
        if (state.ratioAdjustValue !== null && ratioOpts && typeof ratioOpts.saveRatio === 'function') {
          ratioOpts.saveRatio(state.ratioAdjustValue);
        }
        state.ratioAdjustOpen = false;
        state.ratioAdjustValue = null;
        onRender();
        return;
      }
      if (key === '\x1b[D') { // Left: decrease claude ratio by 10%
        const v = Math.round((state.ratioAdjustValue - 0.1) * 10) / 10;
        state.ratioAdjustValue = Math.max(0, v);
        onRender();
        return;
      }
      if (key === '\x1b[C') { // Right: increase claude ratio by 10%
        const v = Math.round((state.ratioAdjustValue + 0.1) * 10) / 10;
        state.ratioAdjustValue = Math.min(1, v);
        onRender();
        return;
      }
      if (key === '\x03') {
        if (typeof onImmediate === 'function') onImmediate();
        return;
      }
      return; // 다른 키 소비
    }

    // Tab: 포커스 전환 (워크트리 ↔ 메뉴)
    if (key === '\t' && wtCount > 0) {
      state.focusArea = state.focusArea === 'menu' ? 'worktree' : 'menu';
      state.confirmPending = false;
      onRender();
      return;
    }

    // 태스크 패널 열린 상태: 패널 내 태스크 탐색 및 취소 처리
    if (state.taskPanelOpen && wtCount > 0 && state.focusArea !== 'menu') {
      const getWorkerStatesFn = worktreeOpts && typeof worktreeOpts.getWorkerStates === 'function'
        ? worktreeOpts.getWorkerStates
        : null;
      const worker = getWorkerStatesFn
        ? (getWorkerStatesFn()[state.worktreeIndex] || null)
        : null;
      const tasks = (worker && worker.taskEntries) || [];
      const done = (worker && worker.done) || 0;
      const isRunning = worker && worker.status === 'running';
      const firstPendingIdx = isRunning ? done + 1 : done;
      const hasPending = tasks.length > firstPendingIdx;
      const hasTasks = tasks.length > 0;

      if (key === '\x1b[A' && hasTasks) {
        const cur = state.taskPanelSelectedIndex != null ? state.taskPanelSelectedIndex : firstPendingIdx;
        state.taskPanelSelectedIndex = Math.max(0, cur - 1);
        state.taskCancelConfirm = false;
        onRender();
        return;
      }
      if (key === '\x1b[B' && hasTasks) {
        const cur = state.taskPanelSelectedIndex != null ? state.taskPanelSelectedIndex : firstPendingIdx;
        state.taskPanelSelectedIndex = Math.min(tasks.length - 1, cur + 1);
        state.taskCancelConfirm = false;
        onRender();
        return;
      }
      if (key === 'x' && hasPending && !state.taskCancelConfirm) {
        const cur = state.taskPanelSelectedIndex != null ? state.taskPanelSelectedIndex : firstPendingIdx;
        const validIdx = Math.max(0, Math.min(tasks.length - 1, cur));
        const canCancel = validIdx >= firstPendingIdx;
        if (canCancel) {
          state.taskPanelSelectedIndex = validIdx;
          state.taskCancelConfirm = true;
          onRender();
          return;
        }
      }
    }

    // 워크트리 위아래 이동 (워크트리 포커스 상태에서, 패널 닫힘)
    if (wtCount > 0 && state.focusArea !== 'menu' && !state.taskPanelOpen) {
      if (key === '\x1b[A') {
        // Up arrow: 워크트리 위로 이동
        if (state.worktreeIndex == null) state.worktreeIndex = 0;
        state.worktreeIndex = (state.worktreeIndex - 1 + wtCount) % wtCount;
        state.taskPanelOpen = false;
        state.taskPanelScrollOffset = 0;
        onRender();
        return;
      }
      if (key === '\x1b[B') {
        // Down arrow: 워크트리 아래로 이동
        if (state.worktreeIndex == null) state.worktreeIndex = 0;
        state.worktreeIndex = (state.worktreeIndex + 1) % wtCount;
        state.taskPanelOpen = false;
        state.taskPanelScrollOffset = 0;
        onRender();
        return;
      }
    } else if (wtCount === 0) {
      // 워크트리 없을 때는 기존 로그 스크롤
      if (typeof onScroll === 'function') {
        if (key === '\x1b[A') {
          if (onScroll('lineUp')) return;
        }
        if (key === '\x1b[B') {
          if (onScroll('lineDown')) return;
        }
      }
    }

    // 로그 스크롤 (Page Up/Down, Home/End)
    if (typeof onScroll === 'function') {
      if (key === '\x1b[5~') {
        if (onScroll('pageUp')) return;
      }
      if (key === '\x1b[6~') {
        if (onScroll('pageDown')) return;
      }
      if (key === '\x1b[H') {
        if (onScroll('top')) return;
      }
      if (key === '\x1b[F') {
        if (onScroll('bottom')) return;
      }
    }

    // Ctrl+C → 즉시 종료
    if (key === '\x03') {
      if (typeof onImmediate === 'function') {
        onImmediate();
      }
      return;
    }

    // Esc: 취소 확인 해제 또는 태스크 패널 닫기
    if (key === '\x1b' && input.length === 1) {
      if (state.taskCancelConfirm) {
        state.taskCancelConfirm = false;
        onRender();
        return;
      }
      if (state.taskPanelOpen) {
        state.taskPanelOpen = false;
        state.taskPanelSelectedIndex = null;
        state.taskPanelScrollOffset = 0;
        onRender();
        return;
      }
    }

    // 좌우 화살표 - 메뉴 포커스 상태(또는 워크트리 없을 때)에서만 메뉴 이동
    if (key === '\x1b[D' && (state.focusArea === 'menu' || wtCount === 0)) {
      state.confirmPending = false;
      state.menuIndex = (state.menuIndex - 1 + itemCount) % itemCount;
      onRender();
      return;
    }
    if (key === '\x1b[C' && (state.focusArea === 'menu' || wtCount === 0)) {
      state.confirmPending = false;
      state.menuIndex = (state.menuIndex + 1) % itemCount;
      onRender();
      return;
    }

    // Enter
    if (key === '\r' || key === '\n') {
      // taskCancelConfirm → 취소 확인
      if (state.taskCancelConfirm) {
        state.taskCancelConfirm = false;
        if (worktreeOpts && typeof worktreeOpts.onCancelTask === 'function') {
          worktreeOpts.onCancelTask(state.worktreeIndex, state.taskPanelSelectedIndex);
        }
        return;
      }

      // confirmPending → 메뉴 액션 실행
      if (state.confirmPending) {
        state.confirmPending = false;
        const action = actions[state.menuIndex];
        action();
        return;
      }

      // 메뉴 포커스 상태(또는 워크트리 없을 때) → 메뉴 확인/실행
      if (state.focusArea === 'menu' || wtCount === 0) {
        const action = actions[state.menuIndex];
        const entry = entries[state.menuIndex];
        const isNoConfirm = entry && entry.noConfirm;
        if (isNoConfirm) {
          action();
          return;
        }
        state.confirmPending = true;
        onRender();
        return;
      }

      // 워크트리 포커스 상태 → 태스크 패널 토글
      if (wtCount > 0 && state.worktreeIndex != null && state.worktreeIndex >= 0) {
        state.taskPanelOpen = !state.taskPanelOpen;
        if (!state.taskPanelOpen) {
          state.taskPanelSelectedIndex = null;
          state.taskCancelConfirm = false;
          state.taskPanelScrollOffset = 0;
        }
        onRender();
        return;
      }
    }
  };

  process.stdin.on('data', handler);

  return () => {
    process.stdin.removeListener('data', handler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?1002l\x1b[?1000l\x1b[?1006l');
    }
  };
}

module.exports = {
  boxLine,
  renderMenuLine,
  renderMenuLineWithLayout,
  setupMenuInput,
};

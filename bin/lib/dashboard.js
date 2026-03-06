const { C } = require('./constants');
const { visualWidth, padEndVisual } = require('./utils');

/** 대시보드용 한 줄: ║ content (패딩) ║ */
function boxLine(content, innerWidth) {
  return `${C.dim}║${C.reset} ${padEndVisual(content, innerWidth)} ${C.dim}║${C.reset}`;
}

/** 대시보드 하단 메뉴 렌더링 */
const MENU_ITEMS = ['마무리 후 종료', '즉시 종료'];

function renderMenuLine(selectedIndex, innerWidth, confirmPending, menuItems) {
  const items = menuItems || MENU_ITEMS;
  const parts = items.map((label, i) => {
    if (i === selectedIndex) {
      return `${C.cyan}${C.bold}▸ ${label}${C.reset}`;
    }
    return `${C.dim}  ${label}${C.reset}`;
  });
  let content = parts.join('    ');
  if (confirmPending) {
    content += `  ${C.yellow}← Enter로 확인${C.reset}`;
  }
  const raw = `  ${content}  `;
  const vw = visualWidth(raw.replace(/\x1b\[[0-9;]*m/g, ''));
  const pad = Math.max(0, innerWidth - vw);
  return `  ${content}  ${' '.repeat(pad)}`;
}

/** 대시보드 메뉴 키 입력 핸들러 설정 */
function setupMenuInput(state, onRender, onGraceful, onImmediate, extraActions) {
  if (!process.stdin.isTTY) return null;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  state.confirmPending = false;
  const actions = [onGraceful, onImmediate, ...(extraActions || []).map(a => a.handler)];
  state._menuItems = extraActions ? [...MENU_ITEMS, ...extraActions.map(a => a.label)] : MENU_ITEMS;
  const itemCount = state._menuItems.length;

  const handler = (data) => {
    const key = data.toString();

    // Ctrl+C → 즉시 종료
    if (key === '\x03') {
      onImmediate();
      return;
    }

    // 좌우 화살표 (ESC [ D / ESC [ C)
    if (key === '\x1b[D') {
      state.confirmPending = false;
      state.menuIndex = (state.menuIndex - 1 + itemCount) % itemCount;
      onRender();
      return;
    }
    if (key === '\x1b[C') {
      state.confirmPending = false;
      state.menuIndex = (state.menuIndex + 1) % itemCount;
      onRender();
      return;
    }

    // Enter: 한 번 누르면 확인 대기, 다시 누르면 실행 (즉시 폴링은 확인 없이 바로 실행)
    if (key === '\r' || key === '\n') {
      const action = actions[state.menuIndex];
      // extraActions에 noConfirm이 설정된 경우 확인 없이 바로 실행
      const extraIdx = state.menuIndex - 2;
      const isNoConfirm = extraIdx >= 0 && extraActions && extraActions[extraIdx] && extraActions[extraIdx].noConfirm;
      if (isNoConfirm) {
        action();
        return;
      }
      if (!state.confirmPending) {
        state.confirmPending = true;
        onRender();
        return;
      }
      state.confirmPending = false;
      action();
    }
  };

  process.stdin.on('data', handler);

  return () => {
    process.stdin.removeListener('data', handler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };
}

module.exports = {
  boxLine,
  MENU_ITEMS,
  renderMenuLine,
  setupMenuInput,
};

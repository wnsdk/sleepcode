const { C } = require('./constants');
const { visualWidth, padEndVisual } = require('./utils');

/** 대시보드용 한 줄: ║ content (패딩) ║ */
function boxLine(content, innerWidth) {
  return `${C.dim}║${C.reset} ${padEndVisual(content, innerWidth)} ${C.dim}║${C.reset}`;
}

/** 대시보드 하단 메뉴 렌더링 */

function renderMenuLineWithLayout(selectedIndex, innerWidth, confirmPending, menuItems) {
  const items = menuItems || [];
  const parts = items.map((label, i) => {
    if (i === selectedIndex) {
      return `${C.cyan}${C.bold}▸ ${label}${C.reset}`;
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
  const rawPlain = `  ${contentPlain}  `;
  const vw = visualWidth(rawPlain);
  const pad = Math.max(0, innerWidth - vw);
  const line = `  ${content}  ${' '.repeat(pad)}`;

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

function renderMenuLine(selectedIndex, innerWidth, confirmPending, menuItems) {
  return renderMenuLineWithLayout(selectedIndex, innerWidth, confirmPending, menuItems).line;
}

/** 대시보드 메뉴 키 입력 핸들러 설정 */
function setupMenuInput(state, onRender, menuEntries, onImmediate, onScroll) {
  if (!process.stdin.isTTY) return null;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
  }

  const entries = Array.isArray(menuEntries) ? menuEntries : [];
  if (entries.length === 0) {
    throw new Error('setupMenuInput requires at least one menu entry');
  }
  state.confirmPending = false;
  const actions = entries.map(entry => entry.handler);
  state._menuItems = entries.map(entry => entry.label);
  const itemCount = entries.length;

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
        const isLeft = (btn & 3) === 0 && btn < 64;
        const isWheelUp = btn === 64;
        const isWheelDown = btn === 65;
        if (isPress && (isWheelUp || isWheelDown) && typeof onScroll === 'function') {
          onScroll(isWheelUp ? 'wheelUp' : 'wheelDown');
          continue;
        }
        if (isPress && isLeft) {
          const layout = state._menuLayout;
          if (!layout || layout.row !== y) continue;
          const hit = layout.items.find(it => x >= it.start && x <= it.end);
          if (!hit) continue;
          if (hit.index !== state.menuIndex) {
            state.confirmPending = false;
            state.menuIndex = hit.index;
            onRender();
            continue;
          }
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

    // 로그 스크롤
    if (typeof onScroll === 'function') {
      if (key === '\x1b[A') {
        if (onScroll('lineUp')) return;
      }
      if (key === '\x1b[B') {
        if (onScroll('lineDown')) return;
      }
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
      const entry = entries[state.menuIndex];
      const isNoConfirm = entry && entry.noConfirm;
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
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?1000l\x1b[?1006l');
    }
  };
}

module.exports = {
  boxLine,
  renderMenuLine,
  renderMenuLineWithLayout,
  setupMenuInput,
};

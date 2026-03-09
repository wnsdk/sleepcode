const ANSI_RE = /\x1b\[[0-9;]*m/g;
const ANSI_SEQ_RE = /\x1b\[([0-9;]*)m/;
const CONT_INDENT = '      ';
const CONT_WIDTH = CONT_INDENT.length;
const SCROLLBAR_THUMB = '█';

/**
 * ANSI 이스케이프를 제외한 시각적 너비를 계산한다.
 * CJK / 전각 문자는 2칸으로 센다.
 */
function measureVisualWidth(str) {
  const plain = str.replace(ANSI_RE, '');
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||
      (cp >= 0x2E80 && cp <= 0x303E) ||
      (cp >= 0x3040 && cp <= 0x33BF) ||
      (cp >= 0x3400 && cp <= 0x4DBF) ||
      (cp >= 0x4E00 && cp <= 0xA4CF) ||
      (cp >= 0xAC00 && cp <= 0xD7AF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE6F) ||
      (cp >= 0xFF01 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||
      (cp >= 0x20000 && cp <= 0x2FA1F)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function charWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0x33BF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x20000 && cp <= 0x2FA1F)
  ) {
    return 2;
  }
  return 1;
}

/**
 * 긴 로그 줄을 터미널 너비에 맞게 여러 줄로 나눈다.
 * ANSI 색상 상태를 줄 경계에서 유지한다.
 */
function wrapLogLine(line, maxWidth) {
  if (maxWidth <= 0 || measureVisualWidth(line) <= maxWidth) {
    return [line];
  }

  const result = [];
  let current = '';
  let width = 0;
  let limit = maxWidth;
  let ansiStack = [];
  let i = 0;

  while (i < line.length) {
    // ANSI escape sequence
    if (line[i] === '\x1b' && i + 1 < line.length && line[i + 1] === '[') {
      let end = i + 2;
      while (end < line.length && line[end] !== 'm') end++;
      if (end < line.length) {
        const seq = line.slice(i, end + 1);
        current += seq;
        const match = seq.match(ANSI_SEQ_RE);
        if (match) {
          const code = match[1];
          if (code === '0' || code === '') {
            ansiStack = [];
          } else {
            ansiStack.push(seq);
          }
        }
        i = end + 1;
        continue;
      }
    }

    const cp = line.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);

    if (width + cw > limit) {
      current += '\x1b[0m';
      result.push(current);
      const restore = ansiStack.length > 0 ? ansiStack.join('') : '';
      current = CONT_INDENT + restore;
      width = CONT_WIDTH;
      limit = maxWidth;
    }

    current += ch;
    width += cw;
    i += ch.length;
  }

  if (current) result.push(current);
  return result;
}

function createDashboardLogs({
  getDashboardHeight,
  isAltScreenActive,
  formatLogLine,
  stdout = process.stdout,
  maxBuffer = 200,
}) {
  const logBuffer = [];
  let logScroll = 0;

  function getLogRows() {
    const rows = stdout.rows || 24;
    return Math.max(0, rows - getDashboardHeight());
  }

  function getMaxLogScroll() {
    return Math.max(0, logBuffer.length - getLogRows());
  }

  function getMaxContentWidth() {
    return Math.max(20, (stdout.columns || 80) - 3);
  }

  function getScrollbarMetrics(logRows = getLogRows()) {
    if (logRows <= 0 || logBuffer.length <= logRows) {
      return null;
    }

    const totalLines = logBuffer.length;
    const maxOffset = totalLines - logRows;
    const viewportStart = Math.max(0, totalLines - logRows - logScroll);
    const thumbSize = Math.max(1, Math.floor((logRows * logRows) / totalLines));
    const thumbTravel = Math.max(0, logRows - thumbSize);
    const thumbTop = maxOffset === 0
      ? 0
      : Math.round((viewportStart * thumbTravel) / maxOffset);

    return {
      thumbSize,
      thumbTop,
      trackHeight: logRows,
    };
  }

  function renderScrollbar(logRows) {
    const columns = stdout.columns || 80;
    const metrics = getScrollbarMetrics(logRows);
    const scrollbarColumn = columns;

    for (let i = 0; i < logRows; i++) {
      const row = getDashboardHeight() + 1 + i;
      const withinThumb = metrics
        ? i >= metrics.thumbTop && i < metrics.thumbTop + metrics.thumbSize
        : false;
      stdout.write(`\x1b[${row};${scrollbarColumn}H${withinThumb ? SCROLLBAR_THUMB : ' '}`);
    }
  }

  function appendLogToScreen(line) {
    if (!isAltScreenActive() || logScroll > 0) return;
    renderLogs(true);
  }

  function renderLogs(force = false) {
    if (!isAltScreenActive()) return;

    const logRows = getLogRows();
    if (logRows <= 0) return;

    const maxScroll = getMaxLogScroll();
    if (logScroll > maxScroll) logScroll = maxScroll;
    if (!force && logScroll === 0) return;

    const start = Math.max(0, logBuffer.length - logRows - logScroll);
    const slice = logBuffer.slice(start, start + logRows);
    for (let i = 0; i < logRows; i++) {
      const line = slice[i] || '';
      stdout.write(`\x1b[${getDashboardHeight() + 1 + i};1H`);
      stdout.write(`  ${line}\x1b[K`);
    }
    renderScrollbar(logRows);
    stdout.write('\x1b[1;1H');
  }

  function pushLog(workerName, message) {
    const line = formatLogLine(workerName, message);
    const maxWidth = getMaxContentWidth();
    const wrapped = wrapLogLine(line, maxWidth);

    for (const wLine of wrapped) {
      logBuffer.push(wLine);
    }
    while (logBuffer.length > maxBuffer) logBuffer.shift();

    if (logScroll > 0) {
      logScroll = Math.min(logScroll + wrapped.length, getMaxLogScroll());
    }
    appendLogToScreen(wrapped[wrapped.length - 1]);
    return line;
  }

  function handleScroll(action) {
    const logRows = getLogRows();
    if (logRows <= 0) return false;

    const maxScroll = getMaxLogScroll();
    let next = logScroll;
    const page = Math.max(1, logRows - 1);

    switch (action) {
      case 'lineUp':
        next = Math.min(maxScroll, logScroll + 1);
        break;
      case 'lineDown':
        next = Math.max(0, logScroll - 1);
        break;
      case 'pageUp':
        next = Math.min(maxScroll, logScroll + page);
        break;
      case 'pageDown':
        next = Math.max(0, logScroll - page);
        break;
      case 'top':
        next = maxScroll;
        break;
      case 'bottom':
        next = 0;
        break;
      case 'wheelUp':
        next = Math.min(maxScroll, logScroll + 3);
        break;
      case 'wheelDown':
        next = Math.max(0, logScroll - 3);
        break;
      default:
        return false;
    }

    if (next === logScroll) return true;
    logScroll = next;
    renderLogs(true);
    return true;
  }

  function isScrolled() {
    return logScroll > 0;
  }

  return {
    appendLogToScreen,
    getLogBuffer: () => [...logBuffer],
    getLogRows,
    getLogScroll: () => logScroll,
    getMaxLogScroll,
    getScrollbarMetrics,
    handleScroll,
    isScrolled,
    pushLog,
    renderLogs,
  };
}

module.exports = { createDashboardLogs, measureVisualWidth, wrapLogLine };

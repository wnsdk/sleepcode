const { C, branchColor } = require('./constants');

function createRunDashboardLogs({ getDashboardHeight, isAltScreenActive, stdout = process.stdout }) {
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let logScroll = 0;

  function getLogRows() {
    const rows = stdout.rows || 24;
    return Math.max(0, rows - getDashboardHeight());
  }

  function getMaxLogScroll() {
    const logRows = getLogRows();
    return Math.max(0, logBuffer.length - logRows);
  }

  function appendLogToScreen(line) {
    if (!isAltScreenActive() || logScroll > 0) return;
    const rows = stdout.rows || 24;
    stdout.write(`\x1b[${rows};1H`);
    stdout.write(`\n  ${line}\x1b[K`);
  }

  function renderLogs(force = false) {
    if (!isAltScreenActive()) return;

    const dashboardHeight = getDashboardHeight();
    const logRows = getLogRows();
    if (logRows <= 0) return;

    const maxScroll = getMaxLogScroll();
    if (logScroll > maxScroll) logScroll = maxScroll;
    if (!force && logScroll === 0) return;

    const start = Math.max(0, logBuffer.length - logRows - logScroll);
    const slice = logBuffer.slice(start, start + logRows);
    for (let i = 0; i < logRows; i++) {
      const line = slice[i] || '';
      stdout.write(`\x1b[${dashboardHeight + 1 + i};1H`);
      stdout.write(`  ${line}\x1b[K`);
    }
    stdout.write('\x1b[1;1H');
  }

  function pushLog(name, msg) {
    const timestamp = new Date().toLocaleTimeString();
    const color = branchColor(name);
    const formatted = name && name !== 'SYSTEM'
      ? `${C.dim}[${timestamp}]${C.reset} ${color}[${name}]${C.reset} ${msg}`
      : `${C.dim}[${timestamp}]${C.reset} ${msg}`;
    logBuffer.push(formatted);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    if (logScroll > 0) {
      logScroll = Math.min(logScroll + 1, getMaxLogScroll());
    }
    appendLogToScreen(formatted);
  }

  function handleScroll(action) {
    const logRows = getLogRows();
    if (logRows <= 0) return false;

    const maxScroll = getMaxLogScroll();
    const page = Math.max(1, logRows - 1);
    let next = logScroll;
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
    handleScroll,
    isScrolled,
    pushLog,
    renderLogs,
  };
}

module.exports = { createRunDashboardLogs };

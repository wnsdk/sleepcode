const { C, branchColor } = require('./constants');

function formatParallelDashboardLogLine(workerName, message) {
  if (!workerName || workerName === 'SYSTEM') {
    return String(message || '');
  }
  const tag = `${branchColor(workerName)}[${workerName}]${C.reset}`;
  return `${tag} ${message}`;
}

function createParallelDashboardLogs({
  getDashboardHeight,
  isAltScreenActive,
  stdout = process.stdout,
  maxBuffer = 200,
  formatLogLine = formatParallelDashboardLogLine,
}) {
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
    stdout.write('\x1b[1;1H');
  }

  function pushLog(workerName, message) {
    const line = formatLogLine(workerName, message);
    logBuffer.push(line);
    if (logBuffer.length > maxBuffer) logBuffer.shift();
    if (logScroll > 0) {
      logScroll = Math.min(logScroll + 1, getMaxLogScroll());
    }
    appendLogToScreen(line);
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

  return {
    appendLogToScreen,
    getLogBuffer: () => [...logBuffer],
    getLogRows,
    getLogScroll: () => logScroll,
    getMaxLogScroll,
    handleScroll,
    pushLog,
    renderLogs,
  };
}

module.exports = {
  createParallelDashboardLogs,
  formatParallelDashboardLogLine,
};

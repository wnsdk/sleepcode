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

  function isScrolled() {
    return logScroll > 0;
  }

  return {
    appendLogToScreen,
    getLogBuffer: () => [...logBuffer],
    getLogRows,
    getLogScroll: () => logScroll,
    getMaxLogScroll,
    handleScroll,
    isScrolled,
    pushLog,
    renderLogs,
  };
}

module.exports = { createDashboardLogs };

function createParallelDashboardTerminal({
  getDashboardHeight,
  onResize,
  stdout = process.stdout,
  processRef = process,
}) {
  let altScreenActive = false;
  let cursorHidden = false;

  function isActive() {
    return altScreenActive;
  }

  function syncViewport(clearScreen = false) {
    if (!altScreenActive) return;

    const rows = stdout.rows || 24;
    const dashboardHeight = getDashboardHeight();
    if (rows > dashboardHeight) {
      stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    if (clearScreen) {
      stdout.write('\x1b[2J');
    }
  }

  function cleanupAltScreen() {
    if (!altScreenActive) return;
    altScreenActive = false;
    stdout.write('\x1b[r');
    stdout.write('\x1b[?1049l');
    if (cursorHidden) {
      stdout.write('\x1b[?25h');
      cursorHidden = false;
    }
  }

  function resizeHandler() {
    if (!altScreenActive) return;
    syncViewport(true);
    if (typeof onResize === 'function') onResize();
  }

  function start() {
    if (stdout.isTTY) {
      stdout.write('\x1b[?1049h');
      stdout.write('\x1b[H');
      stdout.write('\x1b[2J');
      stdout.write('\x1b[?25l');
      cursorHidden = true;
      altScreenActive = true;
      syncViewport(false);
    }

    if (typeof stdout.on === 'function') {
      stdout.on('resize', resizeHandler);
    }
    if (typeof processRef.on === 'function') {
      processRef.on('exit', cleanupAltScreen);
    }
  }

  function dispose() {
    if (typeof stdout.removeListener === 'function') {
      stdout.removeListener('resize', resizeHandler);
    }
    if (typeof processRef.removeListener === 'function') {
      processRef.removeListener('exit', cleanupAltScreen);
    }
    cleanupAltScreen();
  }

  return {
    cleanupAltScreen,
    dispose,
    isActive,
    resizeHandler,
    start,
    syncViewport,
  };
}

module.exports = {
  createParallelDashboardTerminal,
};

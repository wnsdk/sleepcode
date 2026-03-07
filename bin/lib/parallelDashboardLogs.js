const { C, branchColor } = require('./constants');
const { createDashboardLogs } = require('./dashboardLogs');

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
  return createDashboardLogs({
    getDashboardHeight,
    isAltScreenActive,
    formatLogLine,
    stdout,
    maxBuffer,
  });
}

module.exports = {
  createParallelDashboardLogs,
  formatParallelDashboardLogLine,
};

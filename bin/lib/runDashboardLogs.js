const { C, branchColor } = require('./constants');
const { createDashboardLogs } = require('./dashboardLogs');

function formatRunDashboardLogLine(name, msg) {
  const timestamp = new Date().toLocaleTimeString();
  if (name && name !== 'SYSTEM') {
    const color = branchColor(name);
    return `${C.dim}[${timestamp}]${C.reset} ${color}[${name}]${C.reset} ${msg}`;
  }
  return `${C.dim}[${timestamp}]${C.reset} ${msg}`;
}

function createRunDashboardLogs({ getDashboardHeight, isAltScreenActive, stdout = process.stdout }) {
  return createDashboardLogs({
    getDashboardHeight,
    isAltScreenActive,
    formatLogLine: formatRunDashboardLogLine,
    stdout,
    maxBuffer: 200,
  });
}

module.exports = { createRunDashboardLogs };

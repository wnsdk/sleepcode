const { createDashboardTerminal } = require('./dashboardTerminal');

function createRunDashboardTerminal({
  getDashboardHeight,
  onResize,
  stdout = process.stdout,
  processRef = process,
}) {
  return createDashboardTerminal({
    getDashboardHeight,
    onResize,
    stdout,
    processRef,
  });
}

module.exports = { createRunDashboardTerminal };

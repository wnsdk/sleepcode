const { createDashboardTerminal } = require('./dashboardTerminal');

function createParallelDashboardTerminal({
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

module.exports = {
  createParallelDashboardTerminal,
};

const { createNotionSyncBridge, ensureNotionSyncScript } = require('./notionSyncBridge');
const {
  buildCompletedAtProp,
  buildCommitProp,
  buildModelProp,
  buildStatusProps,
} = require('./notionPropertyBuilders');

function createNotionSyncClient({
  targetDir,
  pythonCommand,
  syncScript = null,
  env = process.env,
  createNotionSyncBridgeFn = createNotionSyncBridge,
} = {}) {
  const bridge = createNotionSyncBridgeFn({
    targetDir,
    pythonCommand,
    syncScript,
    env,
  });

  return {
    syncScript: bridge.scriptPath,
    poll() {
      try {
        return bridge.poll();
      } catch (e) {
        const stderr = e.stderr ? String(e.stderr).trim() : '';
        return { error: 'poll_failed', message: stderr || e.message || 'unknown error' };
      }
    },
    updatePage(pageId, props) {
      try {
        const result = bridge.updatePage(pageId, props);
        return !result || result.ok !== false;
      } catch {
        return false;
      }
    },
    appendContent(pageId, text) {
      try {
        bridge.appendContent(pageId, text);
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = {
  ensureNotionSyncScript,
  buildStatusProps,
  buildCompletedAtProp,
  buildCommitProp,
  buildModelProp,
  createNotionSyncClient,
};

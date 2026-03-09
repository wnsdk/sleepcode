const { createNotionSyncBridge, ensureNotionSyncScript } = require('./notionSyncBridge');
const {
  buildCompletedAtProp,
  buildCommitProp,
  buildDifficultyProp,
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
  let lastUpdateError = '';

  return {
    syncScript: bridge.scriptPath,
    getLastUpdateError() {
      return lastUpdateError;
    },
    poll() {
      try {
        return bridge.poll();
      } catch (e) {
        const stderr = e.stderr ? String(e.stderr).trim() : '';
        return { error: 'poll_failed', message: stderr || e.message || 'unknown error' };
      }
    },
    updatePage(pageId, props) {
      lastUpdateError = '';
      try {
        process.stderr.write(`[notionSync:debug] updatePage 호출: ${pageId} props=${JSON.stringify(Object.keys(props))}\n`);
        const result = bridge.updatePage(pageId, props);
        const ok = !result || result.ok !== false;
        if (!ok) {
          lastUpdateError = result && result.error ? String(result.error).trim() : 'unknown error';
        }
        process.stderr.write(`[notionSync:debug] updatePage 결과: ${pageId} ok=${ok}\n`);
        return ok;
      } catch (e) {
        const stderr = e.stderr ? String(e.stderr).trim() : '';
        const msg = stderr || e.message || 'unknown error';
        lastUpdateError = msg;
        process.stderr.write(`[notionSync] updatePage 실패 (${pageId}): ${msg}\n`);
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
  buildDifficultyProp,
  buildModelProp,
  createNotionSyncClient,
};

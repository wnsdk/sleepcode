const { createNotionSyncBridge, ensureNotionSyncScript } = require('./notionSyncBridge');

function buildStatusProps(schema, statusValue) {
  if (!schema || !schema.status_prop) return null;
  if (schema.status_type === 'status') {
    return { [schema.status_prop]: { status: { name: statusValue } } };
  }
  if (schema.status_type === 'select') {
    return { [schema.status_prop]: { select: { name: statusValue } } };
  }
  return null;
}

function buildCompletedAtProp(schema, date = new Date()) {
  if (!schema || !schema.completed_at_prop) return null;
  const offsetMinutes = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offsetMinutes * 60 * 1000);
  const offsetSign = offsetMinutes <= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
  const offsetMins = String(absoluteMinutes % 60).padStart(2, '0');
  const isoStr = `${localDate.toISOString().slice(0, 19)}${offsetSign}${offsetHours}:${offsetMins}`;
  return { [schema.completed_at_prop]: { date: { start: isoStr } } };
}

function buildModelProp(schema, modelName) {
  if (!schema || !schema.model_prop || !modelName) return null;
  if (schema.model_type === 'select') {
    return { [schema.model_prop]: { select: { name: modelName } } };
  }
  return { [schema.model_prop]: { rich_text: [{ text: { content: modelName } }] } };
}

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
  buildModelProp,
  createNotionSyncClient,
};

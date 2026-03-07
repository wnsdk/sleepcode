const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { TEMPLATES_DIR, IS_WIN } = require('./constants');

function ensureNotionSyncScript(targetDir) {
  const syncScript = path.join(targetDir, '.sleepcode', 'scripts', 'notion_sync.py');
  if (fs.existsSync(syncScript)) return syncScript;

  const src = path.join(TEMPLATES_DIR, 'common', 'notion_sync.py');
  if (!fs.existsSync(src)) {
    throw new Error('notion_sync.py를 찾을 수 없습니다.');
  }

  fs.mkdirSync(path.dirname(syncScript), { recursive: true });
  fs.writeFileSync(syncScript, fs.readFileSync(src, 'utf-8').replace(/\r\n/g, '\n'));
  if (!IS_WIN) fs.chmodSync(syncScript, 0o755);
  return syncScript;
}

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

function createNotionSyncClient({ targetDir, pythonCommand, syncScript = null, env = process.env }) {
  const scriptPath = syncScript || ensureNotionSyncScript(targetDir);

  function runSyncCommand(args, options = {}) {
    return execFileSync(pythonCommand, [scriptPath, ...args], {
      cwd: targetDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: options.timeoutMs || 30000,
      input: options.input,
    });
  }

  return {
    syncScript: scriptPath,
    poll() {
      try {
        const result = runSyncCommand(['poll']).trim();
        return JSON.parse(result);
      } catch (e) {
        const stderr = e.stderr ? String(e.stderr).trim() : '';
        return { error: 'poll_failed', message: stderr || e.message || 'unknown error' };
      }
    },
    updatePage(pageId, props) {
      try {
        runSyncCommand(['update-page', String(pageId)], {
          input: JSON.stringify(props),
          timeoutMs: 15000,
        });
        return true;
      } catch {
        return false;
      }
    },
    appendContent(pageId, text) {
      try {
        runSyncCommand(['append-content', String(pageId)], {
          input: text,
          timeoutMs: 60000,
        });
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

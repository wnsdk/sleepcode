const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { TEMPLATES_DIR, IS_WIN } = require('./constants');
const {
  SYNC_COMMANDS,
  SYNC_SCRIPT_REL_PATH,
  SYNC_TEMPLATE_REL_PATH,
} = require('./notionSyncProtocol');

function ensureNotionSyncScript(
  targetDir,
  {
    templatePath = path.join(TEMPLATES_DIR, SYNC_TEMPLATE_REL_PATH),
    existsSync = fs.existsSync,
    mkdirSync = fs.mkdirSync,
    readFileSync = fs.readFileSync,
    writeFileSync = fs.writeFileSync,
    chmodSync = fs.chmodSync,
  } = {}
) {
  const syncScript = path.join(targetDir, SYNC_SCRIPT_REL_PATH);
  if (existsSync(syncScript)) return syncScript;

  if (!existsSync(templatePath)) {
    throw new Error('notion_sync.py를 찾을 수 없습니다.');
  }

  mkdirSync(path.dirname(syncScript), { recursive: true });
  writeFileSync(syncScript, readFileSync(templatePath, 'utf-8').replace(/\r\n/g, '\n'));
  if (!IS_WIN) chmodSync(syncScript, 0o755);
  return syncScript;
}

function createNotionSyncBridge({
  targetDir,
  pythonCommand,
  syncScript = null,
  env = process.env,
  ensureNotionSyncScriptFn = ensureNotionSyncScript,
  execFileSyncFn = execFileSync,
} = {}) {
  const scriptPath = syncScript || ensureNotionSyncScriptFn(targetDir);

  function runCommand(command, args = [], options = {}) {
    const cmd = typeof command === 'object' ? command : { name: command, timeoutMs: 30000 };
    return execFileSyncFn(pythonCommand, [scriptPath, cmd.name, ...args], {
      cwd: targetDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: options.timeoutMs || cmd.timeoutMs || 30000,
      input: options.input,
    });
  }

  return {
    scriptPath,
    appendContent(pageId, text) {
      runCommand(SYNC_COMMANDS.APPEND_CONTENT, [String(pageId)], {
        input: text,
      });
    },
    poll() {
      const result = runCommand(SYNC_COMMANDS.POLL).trim();
      return JSON.parse(result);
    },
    runCommand,
    updatePage(pageId, props) {
      const result = runCommand(SYNC_COMMANDS.UPDATE_PAGE, [String(pageId)], {
        input: JSON.stringify(props),
      }).trim();
      return result ? JSON.parse(result) : null;
    },
  };
}

module.exports = {
  createNotionSyncBridge,
  ensureNotionSyncScript,
};

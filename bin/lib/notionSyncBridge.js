const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { TEMPLATES_DIR, IS_WIN } = require('./constants');

function ensureNotionSyncScript(
  targetDir,
  {
    templatePath = path.join(TEMPLATES_DIR, 'common', 'notion_sync.py'),
    existsSync = fs.existsSync,
    mkdirSync = fs.mkdirSync,
    readFileSync = fs.readFileSync,
    writeFileSync = fs.writeFileSync,
    chmodSync = fs.chmodSync,
  } = {}
) {
  const syncScript = path.join(targetDir, '.sleepcode', 'scripts', 'notion_sync.py');
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
    return execFileSyncFn(pythonCommand, [scriptPath, command, ...args], {
      cwd: targetDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: options.timeoutMs || 30000,
      input: options.input,
    });
  }

  return {
    scriptPath,
    appendContent(pageId, text) {
      runCommand('append-content', [String(pageId)], {
        input: text,
        timeoutMs: 60000,
      });
    },
    poll() {
      const result = runCommand('poll').trim();
      return JSON.parse(result);
    },
    runCommand,
    updatePage(pageId, props) {
      const result = runCommand('update-page', [String(pageId)], {
        input: JSON.stringify(props),
        timeoutMs: 15000,
      }).trim();
      return result ? JSON.parse(result) : null;
    },
  };
}

module.exports = {
  createNotionSyncBridge,
  ensureNotionSyncScript,
};

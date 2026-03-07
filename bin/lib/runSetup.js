const fs = require('fs');
const path = require('path');
const { C } = require('./constants');
const { parseArgs } = require('./cli');
const { detectPython } = require('./prerequisites');
const { createNotionSyncClient } = require('./notionSync');
const {
  loadEnvFileToProcessEnv,
  parseNotionDbId,
} = require('./utils');
const {
  ensureRuntimeDirs,
  getRuntimeGracefulStopPath,
  getRuntimeTaskQueuePath,
} = require('./runtimePaths');

function createRunSetupError(outputLines, exitCode = 1) {
  const normalizedLines = Array.isArray(outputLines) ? outputLines : [outputLines];
  const plainMessage = String(normalizedLines[0] || 'run setup failed').replace(/\x1B\[[0-9;]*m/g, '');
  const error = new Error(plainMessage);
  error.outputLines = normalizedLines;
  error.exitCode = exitCode;
  return error;
}

function printRunSetupError(error, log = console.log) {
  const outputLines = Array.isArray(error.outputLines)
    ? error.outputLines
    : [`${C.red}${error.message}${C.reset}`];

  for (const line of outputLines) {
    if (!line) continue;
    log(line);
  }
}

function resolveRunSetupOrExit({
  createRunSetupFn = createRunSetup,
  exit = process.exit,
  log = console.log,
} = {}) {
  try {
    return createRunSetupFn();
  } catch (error) {
    printRunSetupError(error, log);
    exit(error.exitCode || 1);
    return null;
  }
}

function createRunSetup({
  targetDir = process.cwd(),
  env = process.env,
  existsSync = fs.existsSync,
  loadEnvFileToProcessEnvFn = loadEnvFileToProcessEnv,
  parseArgsFn = parseArgs,
  parseNotionDbIdFn = parseNotionDbId,
  detectPythonFn = detectPython,
  createNotionSyncClientFn = createNotionSyncClient,
  ensureRuntimeDirsFn = ensureRuntimeDirs,
  getRuntimeTaskQueuePathFn = getRuntimeTaskQueuePath,
  getRuntimeGracefulStopPathFn = getRuntimeGracefulStopPath,
} = {}) {
  const scDir = path.join(targetDir, '.sleepcode');
  if (!existsSync(scDir)) {
    throw createRunSetupError(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode init'으로 초기화하세요.${C.reset}`);
  }

  const envPath = path.join(scDir, '.env');
  loadEnvFileToProcessEnvFn(envPath);

  const cliArgs = parseArgsFn();
  if (cliArgs.notionKey) env.NOTION_API_KEY = cliArgs.notionKey;
  if (cliArgs.notionDb) env.NOTION_DB_ID = parseNotionDbIdFn(cliArgs.notionDb);
  if (cliArgs.notionFilter) env.NOTION_FILTER = cliArgs.notionFilter;

  const apiKey = env.NOTION_API_KEY;
  const dbId = env.NOTION_DB_ID;
  if (!apiKey || !dbId) {
    throw createRunSetupError([
      `${C.red}Notion API Key와 DB ID가 필요합니다.${C.reset}`,
      `\n  ${C.cyan}npx sleepcode run --notion-key <KEY> --notion-db <DB_ID>${C.reset}`,
      `  ${C.dim}또는 .sleepcode/.env에 NOTION_API_KEY, NOTION_DB_ID를 설정하세요.${C.reset}`,
    ]);
  }

  const py = detectPythonFn();
  if (!py) {
    throw createRunSetupError(`${C.red}python3이 필요합니다.${C.reset}`);
  }

  let notionSync;
  try {
    notionSync = createNotionSyncClientFn({
      targetDir,
      pythonCommand: py.cmd,
      env,
    });
  } catch (error) {
    throw createRunSetupError(`${C.red}${error.message}${C.reset}`);
  }

  const pollIntervalSec = parseInt(cliArgs.interval || '30', 10);
  const pollIntervalMs = pollIntervalSec * 1000;
  const { logsDir: logDir } = ensureRuntimeDirsFn(targetDir);

  return {
    cliArgs,
    dbId,
    gracefulStopPath: getRuntimeGracefulStopPathFn(targetDir),
    logDir,
    notionSync,
    pollIntervalMs,
    pollIntervalSec,
    py,
    runtimeTasksPath: getRuntimeTaskQueuePathFn(targetDir),
    targetDir,
  };
}

module.exports = {
  createRunSetup,
  createRunSetupError,
  printRunSetupError,
  resolveRunSetupOrExit,
};

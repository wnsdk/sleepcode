#!/usr/bin/env node

const { C } = require('./lib/constants');
const { showUsage } = require('./lib/configBudget');
const { showHelp, showVersion, parseArgs, parseCommand } = require('./lib/cli');
const { loadConfig, saveConfig } = require('./lib/config');
const { runInit } = require('./lib/init');
const { runNotionUpdate } = require('./lib/notionUpdate');
const { runParallel } = require('./lib/parallel');
const { normalizeProvider } = require('./lib/provider');
const { runWorker } = require('./lib/run');

async function main() {
  const targetDir = process.cwd();
  const cliArgs = parseArgs();
  const providerArg = normalizeProvider(cliArgs.provider, '');
  const command = parseCommand();

  // --on-ai-limit 옵션이 run/parallel 실행 시 전달된 경우 config.json에 즉시 반영
  if (cliArgs.onAiLimit && (command === 'run' || command === 'parallel')) {
    const onAiLimitValue = cliArgs.onAiLimit === 'wait' ? 'wait' : 'fail';
    const currentConfig = loadConfig(targetDir) || {};
    if (currentConfig.onAiLimit !== onAiLimitValue) {
      saveConfig(targetDir, { ...currentConfig, onAiLimit: onAiLimitValue });
      console.log(`${C.dim}[config] onAiLimit → ${onAiLimitValue}${C.reset}`);
    }
  }

  if (cliArgs.provider && !providerArg) {
    console.error(`${C.red}--provider 값은 claude, codex, auto 중 하나여야 합니다.${C.reset}`);
    process.exit(1);
  }

  if (command === 'help') {
    showHelp();
    return;
  }

  if (command === 'version') {
    showVersion();
    return;
  }

  if (command === 'run') {
    runWorker(providerArg);
    return;
  }

  if (command === 'parallel') {
    runParallel(process.argv.slice(3), providerArg);
    return;
  }

  if (command === 'usage') {
    showUsage();
    return;
  }

  if (command === 'notion-update') {
    await runNotionUpdate(targetDir, cliArgs);
    return;
  }

  await runInit(targetDir, cliArgs, providerArg);
}

main();

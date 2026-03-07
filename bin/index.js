#!/usr/bin/env node

const { C } = require('./lib/constants');
const { showUsage } = require('./lib/config');
const { showHelp, showVersion, parseArgs, parseCommand } = require('./lib/cli');
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

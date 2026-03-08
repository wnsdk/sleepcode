#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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

  // 명령어 없이 config 전용 플래그만 전달된 경우: .sleepcode/가 이미 존재하면 init 없이 config만 업데이트
  if (!command) {
    const CONFIG_FLAG_TRANSFORMS = {
      onAiLimit: v => (v === 'wait' ? 'wait' : 'fail'),
      budget: v => parseFloat(v),
      threshold: v => parseInt(v, 10),
      interval: v => parseInt(v, 10),
      provider: () => providerArg,
      claudeRatio: v => parseInt(v, 10),
    };
    const hasConfigFlags = Object.keys(CONFIG_FLAG_TRANSFORMS).some(k => cliArgs[k] !== undefined);
    if (hasConfigFlags && fs.existsSync(path.join(targetDir, '.sleepcode'))) {
      const currentConfig = loadConfig(targetDir) || {};
      const updates = {};
      for (const [k, transform] of Object.entries(CONFIG_FLAG_TRANSFORMS)) {
        if (cliArgs[k] !== undefined) updates[k] = transform(cliArgs[k]);
      }
      saveConfig(targetDir, { ...currentConfig, ...updates });
      for (const [k, v] of Object.entries(updates)) {
        console.log(`${C.dim}[config] ${k} → ${v}${C.reset}`);
      }
      return;
    }
  }

  await runInit(targetDir, cliArgs, providerArg);
}

main();

/**
 * 주간 예산 추적: 사용량 기록, 한도 확인, 사용량 표시.
 */

const fs = require('fs');
const path = require('path');
const { C } = require('./constants');
const { progressBar } = require('./utils');
const { loadConfig } = require('./config');

function getMonday(date) {
  const d = new Date(date || Date.now());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setHours(0, 0, 0, 0);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function loadUsage(targetDir) {
  const usagePath = path.join(targetDir, '.sleepcode', 'usage.json');
  const currentWeek = getMonday();
  if (!fs.existsSync(usagePath)) {
    return { weekStart: currentWeek, entries: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    if (data.weekStart !== currentWeek) {
      return { weekStart: currentWeek, entries: [] };
    }
    return data;
  } catch {
    return { weekStart: currentWeek, entries: [] };
  }
}

function saveUsage(targetDir, usage) {
  const usagePath = path.join(targetDir, '.sleepcode', 'usage.json');
  fs.writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n');
}

function recordCost(targetDir, cost, mode, workerName) {
  if (cost == null || cost <= 0) return;
  const usage = loadUsage(targetDir);
  usage.entries.push({
    timestamp: new Date().toISOString(),
    mode,
    worker: workerName || null,
    cost,
  });
  saveUsage(targetDir, usage);
}

function getWeeklyTotal(targetDir) {
  const usage = loadUsage(targetDir);
  return usage.entries.reduce((sum, e) => sum + (e.cost || 0), 0);
}

function isOverBudget(targetDir) {
  const config = loadConfig(targetDir);
  if (!config || !config.weeklyBudget) return null;
  const threshold = (config.budgetThreshold || 90) / 100;
  const limit = config.weeklyBudget * threshold;
  const total = getWeeklyTotal(targetDir);
  return {
    over: total >= limit,
    total,
    limit,
    budget: config.weeklyBudget,
    threshold: config.budgetThreshold || 90,
  };
}

function showUsage() {
  const targetDir = process.cwd();
  const config = loadConfig(targetDir);
  const usage = loadUsage(targetDir);
  const total = usage.entries.reduce((sum, e) => sum + (e.cost || 0), 0);

  console.log(`\n${C.bold}sleepcode 주간 사용량${C.reset}\n`);
  console.log(`  주간 시작: ${C.cyan}${usage.weekStart}${C.reset} (월요일)`);
  console.log(`  세션 수:   ${usage.entries.length}`);
  console.log(`  총 비용:   ${C.bold}$${total.toFixed(4)}${C.reset}`);

  if (config && config.weeklyBudget) {
    const threshold = config.budgetThreshold || 90;
    const limit = config.weeklyBudget * threshold / 100;
    const pct = config.weeklyBudget > 0 ? (total / config.weeklyBudget * 100).toFixed(1) : '0';
    const bar = progressBar(Math.min(total, config.weeklyBudget), config.weeklyBudget, 30);

    console.log(`  주간 예산: $${config.weeklyBudget.toFixed(2)}`);
    console.log(`  임계값:    ${threshold}% ($${limit.toFixed(2)})`);
    console.log(`  사용률:    ${pct}%`);
    console.log(`\n  ${bar}  $${total.toFixed(2)} / $${config.weeklyBudget.toFixed(2)}`);

    if (total >= limit) {
      console.log(`\n  ${C.red}${C.bold}한도 도달 — 워커가 중지됩니다.${C.reset}`);
    } else {
      console.log(`\n  ${C.green}잔여: $${(limit - total).toFixed(2)}${C.reset}`);
    }
  } else {
    console.log(`\n  ${C.dim}예산 미설정. 'npx sleepcode' 초기화 시 설정하거나,${C.reset}`);
    console.log(`  ${C.dim}.sleepcode/config.json 에 직접 설정하세요.${C.reset}`);
  }

  if (usage.entries.length > 0) {
    console.log(`\n${C.bold}최근 세션:${C.reset}\n`);
    const recent = usage.entries.slice(-10);
    for (const entry of recent) {
      const time = new Date(entry.timestamp).toLocaleString();
      const mode = entry.mode || 'unknown';
      const worker = entry.worker ? ` (${entry.worker})` : '';
      console.log(`  ${C.dim}${time}${C.reset}  ${mode}${worker}  ${C.bold}$${entry.cost.toFixed(4)}${C.reset}`);
    }
    if (usage.entries.length > 10) {
      console.log(`  ${C.dim}... 외 ${usage.entries.length - 10}개${C.reset}`);
    }
  }
  console.log('');
}

module.exports = {
  getMonday,
  loadUsage,
  saveUsage,
  recordCost,
  getWeeklyTotal,
  isOverBudget,
  showUsage,
};

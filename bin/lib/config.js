/**
 * sleepcode 프로젝트 설정 I/O (.sleepcode/config.json).
 * 예산/사용량 추적은 configBudget.js 참조.
 */

const fs = require('fs');
const path = require('path');

function loadConfig(targetDir) {
  const configPath = path.join(targetDir, '.sleepcode', 'config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveConfig(targetDir, config) {
  const configPath = path.join(targetDir, '.sleepcode', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

module.exports = {
  loadConfig,
  saveConfig,
};

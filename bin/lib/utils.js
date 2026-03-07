const fs = require('fs');
const { C } = require('./constants');

// ─── 유틸 ───
function ask(rl, question, defaultVal) {
  const suffix = defaultVal ? ` ${C.dim}(${defaultVal})${C.reset}` : '';
  return new Promise((resolve) => {
    rl.question(`${C.cyan}?${C.reset} ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function select(rl, question, options) {
  return new Promise((resolve) => {
    console.log(`\n${C.cyan}?${C.reset} ${question}`);
    options.forEach((opt, i) => {
      console.log(`  ${C.bold}${i + 1})${C.reset} ${opt.label}`);
    });
    rl.question(`${C.cyan}>${C.reset} 번호 선택: `, (answer) => {
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]);
      } else {
        resolve(options[0]);
      }
    });
  });
}

function parseNotionDbId(input) {
  if (!input) return '';
  // URL: https://www.notion.so/workspace/abc123...?v=xyz → 32자리 hex 추출
  const urlMatch = input.match(/([a-f0-9]{32})/);
  if (urlMatch) return urlMatch[1];
  // 대시 포함 UUID: abc-def-... → 대시 제거
  const dashless = input.replace(/-/g, '');
  if (/^[a-f0-9]{32}$/.test(dashless)) return dashless;
  return input;
}

function parseEnvFile(envPath) {
  const env = {};
  if (!envPath || !fs.existsSync(envPath)) return env;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

function loadEnvFileToProcessEnv(envPath) {
  const parsed = parseEnvFile(envPath);
  for (const [k, v] of Object.entries(parsed)) {
    process.env[k] = v;
  }
  return parsed;
}

function writeFile(filePath, content) {
  const path = require('path');
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
}

/** tasks.md에서 코드 블록 내부를 제외한 실제 태스크만 카운트 */
function countTasks(content) {
  const lines = content.split('\n');
  let inCodeBlock = false;
  let done = 0;
  let pending = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (/^- \[x\]/i.test(line.trimStart())) done++;
    else if (/^- \[ \]/.test(line.trimStart())) pending++;
  }
  return { done, total: done + pending };
}

/** tasks.md에서 첫 번째 미완료 태스크의 텍스트를 반환. 없으면 null */
function getNextPendingTask(content) {
  const lines = content.split('\n');
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (/^- \[ \]/.test(line.trimStart())) {
      return line.trimStart().replace(/^- \[ \]\s*/, '');
    }
  }
  return null;
}

/** ANSI 이스케이프 코드를 제거한 문자열 반환 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x07]*\x07/g, '');
}

/** 터미널에서의 실제 표시 너비 (CJK 문자 = 2칸, ANSI = 0칸) */
function visualWidth(str) {
  const plain = stripAnsi(str);
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    // CJK 범위 (Hangul, CJK Unified Ideographs, Fullwidth Forms 등)
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||   // Hangul Jamo
      (cp >= 0x2E80 && cp <= 0x303E) ||   // CJK Radicals / Symbols
      (cp >= 0x3040 && cp <= 0x33BF) ||   // Hiragana, Katakana, CJK Compatibility
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Unified Extension A
      (cp >= 0x4E00 && cp <= 0xA4CF) ||   // CJK Unified / Yi
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
      (cp >= 0xFE30 && cp <= 0xFE6F) ||   // CJK Compatibility Forms
      (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth Forms
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||   // Fullwidth Signs
      (cp >= 0x20000 && cp <= 0x2FA1F)    // CJK Unified Extension B-F
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** 시각적 너비 기준으로 오른쪽 패딩 */
function padEndVisual(str, targetWidth) {
  const vw = visualWidth(str);
  const pad = Math.max(0, targetWidth - vw);
  return str + ' '.repeat(pad);
}

function progressBar(done, total, width) {
  const ratio = total > 0 ? done / total : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  if (ratio >= 1.0) {
    return `${C.green}${'█'.repeat(filled)}${C.reset}`;
  }
  return `${C.green}${'█'.repeat(filled)}${C.dim}${'░'.repeat(empty)}${C.reset}`;
}

module.exports = {
  ask,
  select,
  parseNotionDbId,
  parseEnvFile,
  loadEnvFileToProcessEnv,
  writeFile,
  countTasks,
  getNextPendingTask,
  stripAnsi,
  visualWidth,
  padEndVisual,
  progressBar,
};

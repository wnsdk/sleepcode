const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { C } = require('./constants');

const TASK_LINE_RE = /^- \[([ xX])\]\s+(.+?)\s*$/;
const DONE_LINE_RE = /^- \[x\]\s+(.+?)\s*$/i;
const NOTION_TAG_RE = /\s*<!--\s*notion:([a-f0-9-]+)\s*-->\s*$/i;
const DIFFICULTY_TAG_RE = /\s*<!--\s*difficulty:([1-5])\s*-->\s*$/i;

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
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
}

function normalizeTaskTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function sanitizeBranchName(branch) {
  const safe = String(branch || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  return safe || 'main';
}

function getCurrentBranchName(targetDir) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (branch && branch !== 'HEAD') return branch;
  } catch {}
  return 'main';
}

function getTaskDoneFilePath(targetDir, branchName) {
  const branch = sanitizeBranchName(branchName || getCurrentBranchName(targetDir));
  return path.join(targetDir, '.sleepcode', 'task_done', `${branch}.md`);
}

function listTaskDoneFiles(targetDir, preferredDoneFilePath = null) {
  const resolvedPreferredPath = preferredDoneFilePath || getTaskDoneFilePath(targetDir);
  const doneDir = path.join(targetDir, '.sleepcode', 'task_done');
  const doneFiles = [];
  const seen = new Set();

  if (fs.existsSync(doneDir)) {
    const entries = fs.readdirSync(doneDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => path.join(doneDir, entry.name))
      .sort((a, b) => a.localeCompare(b));

    for (const filePath of entries) {
      seen.add(filePath);
      doneFiles.push(filePath);
    }
  }

  if (resolvedPreferredPath && fs.existsSync(resolvedPreferredPath) && !seen.has(resolvedPreferredPath)) {
    doneFiles.push(resolvedPreferredPath);
  }

  return {
    doneFilePath: resolvedPreferredPath,
    doneFiles,
  };
}

function parseTaskBody(taskBody) {
  let src = String(taskBody || '').trim();
  if (!src) return null;
  let difficulty = null;

  const difficultyMatch = src.match(DIFFICULTY_TAG_RE);
  if (difficultyMatch) {
    difficulty = parseInt(difficultyMatch[1], 10);
    src = src.slice(0, difficultyMatch.index).trim();
  }

  const notionMatch = src.match(NOTION_TAG_RE);
  const notionId = notionMatch ? notionMatch[1].toLowerCase() : null;
  const title = notionMatch ? src.slice(0, notionMatch.index).trim() : src;
  if (!title) return null;
  return { title, notionId, difficulty };
}

function buildTaskKey(title, notionId) {
  if (notionId) return `notion:${String(notionId).toLowerCase()}`;
  return `title:${normalizeTaskTitle(title)}`;
}

function extractTaskItems(content) {
  const items = [];
  const lines = content.split('\n');
  let lineNo = 0;
  let inCodeBlock = false;

  for (const line of lines) {
    lineNo += 1;
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const trimmed = line.trimStart();
    const match = trimmed.match(TASK_LINE_RE);
    if (!match) continue;
    const parsed = parseTaskBody(match[2]);
    if (!parsed) continue;
    items.push({
      lineNo,
      checked: match[1].toLowerCase() === 'x',
      title: parsed.title,
      notionId: parsed.notionId,
      difficulty: parsed.difficulty,
      key: buildTaskKey(parsed.title, parsed.notionId),
      raw: trimmed,
    });
  }

  return items;
}

function readTaskDoneSet(targetDir, doneFilePath) {
  const { doneFilePath: donePath, doneFiles } = listTaskDoneFiles(targetDir, doneFilePath);
  const doneSet = new Set();

  if (doneFiles.length === 0) {
    return { doneFilePath: donePath, doneFiles, doneSet };
  }

  for (const filePath of doneFiles) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trimStart();
      const match = trimmed.match(DONE_LINE_RE);
      if (!match) continue;
      const parsed = parseTaskBody(match[1]);
      if (!parsed) continue;
      doneSet.add(buildTaskKey(parsed.title, parsed.notionId));
    }
  }

  return { doneFilePath: donePath, doneFiles, doneSet };
}

function buildEffectiveDoneSet(doneSet, baselineDoneSet = null, extraDoneSet = null) {
  const effectiveDoneSet = new Set();

  if (doneSet) {
    for (const key of doneSet) {
      if (baselineDoneSet && baselineDoneSet.has(key)) continue;
      effectiveDoneSet.add(key);
    }
  }

  if (extraDoneSet) {
    for (const key of extraDoneSet) {
      effectiveDoneSet.add(key);
    }
  }

  return effectiveDoneSet;
}

function readCurrentRunTaskDoneSet(targetDir, doneFilePath, baselineDoneSet = null, extraDoneSet = null) {
  const state = readTaskDoneSet(targetDir, doneFilePath);
  const currentRunDoneSet = buildEffectiveDoneSet(state.doneSet, baselineDoneSet, extraDoneSet);
  return {
    doneFilePath: state.doneFilePath,
    doneFiles: state.doneFiles,
    rawDoneSet: state.doneSet,
    allDoneSet: state.doneSet,
    currentRunDoneSet,
    doneSet: currentRunDoneSet,
  };
}

function ensureTaskDoneFile(doneFilePath) {
  if (fs.existsSync(doneFilePath)) return;
  fs.mkdirSync(path.dirname(doneFilePath), { recursive: true });
  fs.writeFileSync(doneFilePath, '# 완료 기록\n\n');
}

function appendTaskDone(targetDir, taskEntry, doneFilePath, dedupeSet = null) {
  if (!taskEntry || !taskEntry.title) return false;
  const resolvedDoneFilePath = doneFilePath || getTaskDoneFilePath(targetDir);
  if (dedupeSet && dedupeSet.has(taskEntry.key)) return false;
  if (!dedupeSet) {
    const state = readTaskDoneSet(targetDir, resolvedDoneFilePath);
    if (state.doneSet.has(taskEntry.key)) return false;
  }

  ensureTaskDoneFile(resolvedDoneFilePath);
  const notionTag = taskEntry.notionId ? ` <!-- notion:${taskEntry.notionId} -->` : '';
  fs.appendFileSync(resolvedDoneFilePath, `- [x] ${taskEntry.title}${notionTag}\n`);
  return true;
}

function buildTaskMetadataSuffix(taskEntry) {
  const suffixes = [];
  const notionId = String(taskEntry && taskEntry.notionId ? taskEntry.notionId : taskEntry && taskEntry.id ? taskEntry.id : '').trim();
  if (notionId) suffixes.push(`<!-- notion:${notionId} -->`);

  const difficulty = parseInt(taskEntry && taskEntry.difficulty, 10);
  if (difficulty >= 1 && difficulty <= 5) {
    suffixes.push(`<!-- difficulty:${difficulty} -->`);
  }

  return suffixes.length > 0 ? ` ${suffixes.join(' ')}` : '';
}

/** task_queue.md에서 코드 블록 내부를 제외한 실제 태스크만 카운트 */
function countTasks(content, doneSet = null) {
  const items = extractTaskItems(content);
  let done = 0;
  let pending = 0;
  for (const task of items) {
    if (task.checked || (doneSet && doneSet.has(task.key))) done++;
    else pending++;
  }
  return { done, total: done + pending };
}

/** task_queue.md에서 첫 번째 미완료 태스크의 텍스트를 반환. 없으면 null */
function getNextPendingTaskEntry(content, doneSet = null) {
  const items = extractTaskItems(content);
  for (const task of items) {
    if (task.checked) continue;
    if (doneSet && doneSet.has(task.key)) continue;
    return task;
  }
  return null;
}

function getNextPendingTask(content, doneSet = null) {
  const entry = getNextPendingTaskEntry(content, doneSet);
  return entry ? entry.title : null;
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
  normalizeTaskTitle,
  sanitizeBranchName,
  getCurrentBranchName,
  getTaskDoneFilePath,
  parseTaskBody,
  buildTaskKey,
  extractTaskItems,
  readTaskDoneSet,
  buildEffectiveDoneSet,
  readCurrentRunTaskDoneSet,
  appendTaskDone,
  buildTaskMetadataSuffix,
  countTasks,
  getNextPendingTaskEntry,
  getNextPendingTask,
  stripAnsi,
  visualWidth,
  padEndVisual,
  progressBar,
};

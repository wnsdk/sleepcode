/**
 * 태스크 제목 → git commit 메시지 생성.
 * AI(claude)를 통해 실제 변경 diff 기반으로 커밋 메시지를 생성한다.
 * AI 호출 실패 시 제목 정규화 방식으로 fallback.
 */

const { execSync, execFileSync } = require('child_process');

function normalizeCommitSubject(taskTitle) {
  let subject = String(taskTitle || '')
    .replace(/\s*<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!subject) return 'update project files';

  const prefixed = subject.match(/^([a-z]+(?:\([^)]+\))?):\s+(.+)$/i);
  if (prefixed) {
    subject = prefixed[2].trim();
  }

  subject = subject
    .replace(/^[`"'""'']+|[`"'""'']+$/g, '')
    .replace(/[.。!！?？]+$/g, '')
    .trim();

  const trailingPatterns = [
    /\s*(?:해줘|해주세요|해\s*주세요|부탁해(?:요)?|부탁합니다)$/u,
    /\s*(?:해주기|진행해줘|진행해주세요|반영해줘|반영해주세요)$/u,
    /\s*(?:되게 해줘|되도록 해줘|되게 해주세요|되도록 해주세요)$/u,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of trailingPatterns) {
      const next = subject.replace(pattern, '').trim();
      if (next && next !== subject) {
        subject = next;
        changed = true;
      }
    }
  }

  return subject || 'update project files';
}

function inferCommitPrefix(taskTitle, stagedFiles = []) {
  const title = String(taskTitle || '');
  const lowered = title.toLowerCase();
  const files = stagedFiles.map((filePath) => String(filePath || '').replace(/\\/g, '/').toLowerCase());
  const hasFile = (pattern) => files.some((filePath) => pattern.test(filePath));
  const allFilesMatch = (predicate) => files.length > 0 && files.every(predicate);

  const prefixed = title.match(/^([a-z]+(?:\([^)]+\))?):\s+(.+)$/i);
  if (prefixed) {
    return prefixed[1].toLowerCase();
  }

  if (
    /\b(readme|docs?)\b/i.test(title)
    || /문서|가이드|설명|주석/u.test(title)
    || allFilesMatch((filePath) => filePath.endsWith('.md') || filePath.startsWith('docs/') || filePath.startsWith('.sleepcode/docs/'))
  ) {
    return 'docs';
  }

  if (/\b(test|spec|jest|vitest|cypress|playwright)\b/i.test(title) || /테스트|검증|커버리지/u.test(title)) {
    return 'test';
  }

  if (/\b(fix|bug|hotfix|regression|crash|incident)\b/i.test(title) || /버그|오류|에러|실패|깨짐|충돌|문제/u.test(title)) {
    return 'fix';
  }

  if (/\b(refactor|cleanup|clean up)\b/i.test(title) || /리팩토링|정리/u.test(title)) {
    return 'refactor';
  }

  if (/\b(perf|performance|optimi[sz]e)\b/i.test(title) || /성능|최적화/u.test(title)) {
    return 'perf';
  }

  if (/\b(ci|workflow|github actions)\b/i.test(title) || hasFile(/(^|\/)\.github\/workflows\//)) {
    return 'ci';
  }

  if (/\b(lint|format|prettier|eslint|style)\b/i.test(title) || /포맷|스타일|오타/u.test(title)) {
    return 'style';
  }

  if (
    /\b(build|deploy|release|publish|package|version|dependency|dependencies|deps|npm|pnpm|yarn)\b/i.test(title)
    || /배포|릴리즈|퍼블리시|버전|의존성/u.test(title)
    || hasFile(/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/)
  ) {
    return 'chore';
  }

  if (
    /\b(config|setting|settings|env|dotenv|gitignore|gitattributes)\b/i.test(title)
    || /설정|환경변수|초기화/u.test(title)
  ) {
    return 'chore';
  }

  if (/\b(add|create|implement|support|introduce|enable|integrat(e|ion)|new)\b/i.test(lowered) || /추가|구현|생성|작성|도입|연동|지원|만들/u.test(title)) {
    return 'feat';
  }

  return 'feat';
}

function getStagedDiff(targetDir) {
  try {
    return execFileSync('git', ['diff', '--cached'], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  } catch {
    return '';
  }
}

const MAX_DIFF_CHARS = 8000;

function truncateDiff(diff) {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return diff.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)';
}

function generateCommitMessageWithAI(taskTitle, stagedFiles, targetDir) {
  const diff = getStagedDiff(targetDir);
  if (!diff.trim()) return null;

  const filesStr = stagedFiles.join('\n');
  const prompt = `You are a git commit message generator. Generate a concise conventional commit message for the following staged changes.

Task context (what was requested, for reference only): ${taskTitle}

Staged files:
${filesStr}

Git diff:
${truncateDiff(diff)}

Rules:
- Format: type(scope?): subject
- Types: feat, fix, refactor, docs, test, chore, style, perf, ci
- Subject: imperative mood, lowercase, max 72 chars, no trailing period
- Describe what was ACTUALLY changed in the code, not what was requested
- Output ONLY the single-line commit message, nothing else`;

  try {
    const result = execSync('claude -p --output-format text', {
      input: prompt,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf-8',
    }).trim();

    // Validate: must look like a conventional commit
    if (result && /^[a-z]+(\([^)]+\))?:\s+\S/.test(result)) {
      // Take only first line
      return result.split(/\r?\n/)[0].trim();
    }
  } catch {
    // AI unavailable or failed — fallback below
  }

  return null;
}

function buildTaskCommitMessage(taskEntry, stagedFiles = [], targetDir = null) {
  const taskTitle = taskEntry && taskEntry.title ? taskEntry.title : '';

  if (targetDir) {
    const aiMessage = generateCommitMessageWithAI(taskTitle, stagedFiles, targetDir);
    if (aiMessage) return aiMessage;
  }

  // Fallback: normalize task title
  const subject = normalizeCommitSubject(taskTitle);
  const prefix = inferCommitPrefix(subject, stagedFiles);
  return `${prefix}: ${subject}`;
}

module.exports = {
  buildTaskCommitMessage,
  inferCommitPrefix,
  normalizeCommitSubject,
};

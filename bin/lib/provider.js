const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { PROVIDERS } = require('./constants');
const { parseEnvFile } = require('./utils');
const { checkCommand } = require('./prerequisites');

function normalizeProvider(value, defaultValue = '') {
  const raw = (value || '').toString().trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === PROVIDERS.CLAUDE || raw === PROVIDERS.CODEX || raw === PROVIDERS.AUTO) {
    return raw;
  }
  return null;
}

function providerLabel(provider) {
  return provider === PROVIDERS.CODEX ? 'Codex' : 'Claude';
}

/**
 * 프로바이더 라벨을 OSC 8 하이퍼링크로 감싸서 마우스 호버 시 모델명을 보여준다.
 * @param {string} provider - 프로바이더명
 * @param {string} [model] - 구체적인 모델명 (예: claude-sonnet-4-6)
 * @returns {string} 터미널에서 호버 시 모델명이 보이는 라벨
 */
function providerLabelWithModel(provider, model) {
  const label = providerLabel(provider);
  if (!model) return label;
  // OSC 8 하이퍼링크: 호버 시 URL(모델명)이 터미널 하단에 표시됨
  return `\x1b]8;;model://${model}\x07${label}\x1b]8;;\x07`;
}

function otherProvider(provider) {
  return provider === PROVIDERS.CLAUDE ? PROVIDERS.CODEX : PROVIDERS.CLAUDE;
}

function isProviderAvailable(provider) {
  if (provider === PROVIDERS.CLAUDE) return !!checkCommand('claude --version');
  if (provider === PROVIDERS.CODEX) return !!checkCommand('codex --version');
  return false;
}

function resolveProviderPlan(targetDir, requestedProvider) {
  const envPath = path.join(targetDir, '.sleepcode', '.env');
  const envMap = parseEnvFile(envPath);
  const preferred = normalizeProvider(requestedProvider)
    || normalizeProvider(process.env.SLEEPCODE_PROVIDER || envMap.SLEEPCODE_PROVIDER)
    || PROVIDERS.CLAUDE;

  const available = {
    [PROVIDERS.CLAUDE]: isProviderAvailable(PROVIDERS.CLAUDE),
    [PROVIDERS.CODEX]: isProviderAvailable(PROVIDERS.CODEX),
  };

  const candidates = preferred === PROVIDERS.AUTO
    ? [PROVIDERS.CLAUDE, PROVIDERS.CODEX]
    : [preferred, otherProvider(preferred)];

  const selected = candidates.find((p) => available[p]);
  if (!selected) {
    throw new Error('Claude CLI or Codex CLI is required. Install at least one provider first.');
  }

  const fallback = candidates.find((p) => p !== selected && available[p]) || null;
  return {
    preferred,
    selected,
    fallback,
    requestedUnavailable: preferred !== PROVIDERS.AUTO && !available[preferred],
    available,
  };
}

function buildExecutionPrompt(targetDir, tasksPrompt, provider) {
  if (provider !== PROVIDERS.CODEX) return tasksPrompt;

  const scDir = path.join(targetDir, '.sleepcode');
  const baseRulesPath = path.join(scDir, 'scripts', 'base_rules.md');
  const rulesPath = path.join(scDir, 'rules.md');
  const sections = [];

  if (fs.existsSync(baseRulesPath)) sections.push(fs.readFileSync(baseRulesPath, 'utf-8'));
  if (fs.existsSync(rulesPath)) sections.push(fs.readFileSync(rulesPath, 'utf-8'));
  sections.push('# Task List\n\n' + tasksPrompt);

  return sections.join('\n\n---\n\n');
}

// 난이도별 Claude 모델 매핑
const DIFFICULTY_MODELS = {
  1: 'claude-haiku-4-5-20251001',   // 단순 작업 (오타 수정, 설정 변경 등)
  2: 'claude-sonnet-4-6',           // 쉬운 작업 (간단한 버그 수정, 작은 기능 추가)
  3: 'claude-sonnet-4-6',           // 보통 작업 (기능 구현, 리팩토링)
  4: 'claude-opus-4-6',             // 어려운 작업 (복잡한 기능, 아키텍처 변경)
  5: 'claude-opus-4-6',             // 매우 어려운 작업 (대규모 리팩토링, 설계)
};

const DIFFICULTY_LABELS = {
  1: '★☆☆☆☆',
  2: '★★☆☆☆',
  3: '★★★☆☆',
  4: '★★★★☆',
  5: '★★★★★',
};

/**
 * 태스크 내용을 분석하여 난이도(1-5)를 판단한다.
 * @param {string} taskContent - 태스크 텍스트
 * @param {string} targetDir - 프로젝트 디렉토리
 * @returns {{ difficulty: number, model: string, label: string }}
 */
function assessTaskDifficulty(taskContent, targetDir) {
  const prompt = `You are a task difficulty assessor. Rate the following software development task on a scale of 1-5:

1 = Trivial (typo fix, config change, simple text update)
2 = Easy (simple bug fix, small feature, adding a field)
3 = Medium (feature implementation, refactoring, API integration)
4 = Hard (complex feature, architecture change, multi-file refactor)
5 = Very Hard (large-scale redesign, complex algorithms, system-wide changes)

Task:
${taskContent}

Reply with ONLY a single number (1-5), nothing else.`;

  try {
    const result = execSync(
      'claude -p --output-format text --model claude-haiku-4-5-20251001',
      {
        input: prompt,
        cwd: targetDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }
    ).toString().trim();

    const num = parseInt(result, 10);
    const difficulty = (num >= 1 && num <= 5) ? num : 3;
    return {
      difficulty,
      model: DIFFICULTY_MODELS[difficulty],
      label: DIFFICULTY_LABELS[difficulty],
    };
  } catch {
    // 평가 실패 시 기본값 (보통 난이도)
    return {
      difficulty: 3,
      model: DIFFICULTY_MODELS[3],
      label: DIFFICULTY_LABELS[3],
    };
  }
}

function getProviderRunCommand(provider, continueMode, model) {
  if (provider === PROVIDERS.CODEX) {
    const args = continueMode
      ? ['exec', 'resume', '--last', '--json', '--dangerously-bypass-approvals-and-sandbox', '-']
      : ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-'];
    return { command: 'codex', args };
  }

  const args = [];
  if (continueMode) args.push('--continue');
  if (model) args.push('--model', model);
  args.push('-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose');
  return { command: 'claude', args };
}

function runPromptForTaskGeneration(provider, prompt, targetDir, env) {
  if (provider === PROVIDERS.CODEX) {
    const proc = spawnSync('codex', [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ], {
      input: prompt,
      cwd: targetDir,
      env,
      shell: true,
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
    });

    if (proc.error) throw proc.error;
    const stdout = proc.stdout || '';
    const stderr = proc.stderr || '';
    if (proc.status !== 0) {
      throw new Error((stderr || stdout || ('codex exit code: ' + proc.status)).trim());
    }

    let finalMessage = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'item.completed' && obj.item && obj.item.type === 'agent_message') {
          const text = (obj.item.text || '').trim();
          if (text) finalMessage = text;
        }
      } catch {}
    }

    if (!finalMessage) {
      throw new Error('Codex returned no final message for tasks generation.');
    }
    return finalMessage;
  }

  return execSync(
    'claude -p --output-format text',
    {
      input: prompt,
      cwd: targetDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000,
      maxBuffer: 1024 * 1024,
    }
  ).toString().trim();
}

module.exports = {
  normalizeProvider,
  providerLabel,
  providerLabelWithModel,
  otherProvider,
  isProviderAvailable,
  resolveProviderPlan,
  buildExecutionPrompt,
  getProviderRunCommand,
  runPromptForTaskGeneration,
  assessTaskDifficulty,
  DIFFICULTY_MODELS,
  DIFFICULTY_LABELS,
};

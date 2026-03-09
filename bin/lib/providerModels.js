const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PROVIDERS } = require('./constants');

// 난이도별 Claude 모델 매핑
const DIFFICULTY_MODELS = {
  1: 'claude-haiku-4-5-20251001',   // 단순 작업 (오타 수정, 설정 변경 등)
  2: 'claude-sonnet-4-6',           // 쉬운 작업 (간단한 버그 수정, 작은 기능 추가)
  3: 'claude-sonnet-4-6',           // 보통 작업 (기능 구현, 리팩토링)
  4: 'claude-opus-4-6',             // 어려운 작업 (복잡한 기능, 아키텍처 변경)
  5: 'claude-opus-4-6',             // 매우 어려운 작업 (대규모 리팩토링, 설계)
};

// 난이도별 Codex 모델 매핑
const DIFFICULTY_MODELS_CODEX = {
  1: ['gpt-5.1-codex-mini', 'gpt-5-codex-mini', 'gpt-5.2-codex', 'gpt-5.3-codex'],
  2: ['gpt-5.1-codex-mini', 'gpt-5-codex-mini', 'gpt-5.2-codex', 'gpt-5.3-codex'],
  3: ['gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.1-codex-max'],
  4: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.1-codex-max'],
  5: ['gpt-5.4', 'gpt-5.1-codex-max', 'gpt-5.3-codex'],
};

const DEFAULT_PROVIDER_MODELS = {
  [PROVIDERS.CLAUDE]: 'claude-sonnet-4-6',
  [PROVIDERS.CODEX]: 'o3',
};

const DIFFICULTY_LABELS = {
  1: '★☆☆☆☆',
  2: '★★☆☆☆',
  3: '★★★☆☆',
  4: '★★★★☆',
  5: '★★★★★',
};

const NOTION_MODEL_OPTION_COLORS = {
  [PROVIDERS.CLAUDE]: 'purple',
  [PROVIDERS.CODEX]: 'blue',
};

function normalizeDifficulty(value, fallback = 3) {
  const num = parseInt(value, 10);
  if (num >= 1 && num <= 5) return num;
  return fallback;
}

function collectUniqueModels(items) {
  const seen = new Set();
  const models = [];

  for (const item of items || []) {
    const values = Array.isArray(item) ? item : [item];
    for (const value of values) {
      const model = String(value || '').trim();
      if (!model || seen.has(model)) continue;
      seen.add(model);
      models.push(model);
    }
  }

  return models;
}

function buildNotionModelOptions() {
  const claudeModels = collectUniqueModels(Object.values(DIFFICULTY_MODELS));
  const codexModels = collectUniqueModels([
    DEFAULT_PROVIDER_MODELS[PROVIDERS.CODEX],
    ...Object.values(DIFFICULTY_MODELS_CODEX),
  ]);

  return [
    ...claudeModels.map((name) => ({ name, color: NOTION_MODEL_OPTION_COLORS[PROVIDERS.CLAUDE] })),
    ...codexModels.map((name) => ({ name, color: NOTION_MODEL_OPTION_COLORS[PROVIDERS.CODEX] })),
  ];
}

const NOTION_MODEL_OPTIONS = buildNotionModelOptions();

let _codexModelsCache = null;

function loadAvailableCodexModels() {
  try {
    const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    if (!fs.existsSync(cachePath)) return null;

    const stat = fs.statSync(cachePath);
    if (_codexModelsCache && _codexModelsCache.mtimeMs === stat.mtimeMs) {
      return _codexModelsCache.models;
    }

    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const models = new Set(
      (parsed.models || [])
        .map((m) => (m && m.slug ? String(m.slug) : ''))
        .filter(Boolean)
    );
    _codexModelsCache = { mtimeMs: stat.mtimeMs, models };
    return models;
  } catch {
    return null;
  }
}

function pickCodexModelByDifficulty(difficulty) {
  const candidates = DIFFICULTY_MODELS_CODEX[difficulty] || [];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const available = loadAvailableCodexModels();
  if (!available || available.size === 0) return candidates[0];

  return candidates.find((m) => available.has(m)) || null;
}

function resolveModelForDifficulty(difficulty, provider) {
  const normalizedDifficulty = normalizeDifficulty(difficulty, 3);
  if (provider === PROVIDERS.CODEX) {
    return pickCodexModelByDifficulty(normalizedDifficulty) || DEFAULT_PROVIDER_MODELS[PROVIDERS.CODEX];
  }
  return DIFFICULTY_MODELS[normalizedDifficulty] || DEFAULT_PROVIDER_MODELS[PROVIDERS.CLAUDE];
}

function buildDifficultyAssessment(difficulty, provider) {
  const normalizedDifficulty = normalizeDifficulty(difficulty, 3);
  return {
    difficulty: normalizedDifficulty,
    model: resolveModelForDifficulty(normalizedDifficulty, provider),
    label: DIFFICULTY_LABELS[normalizedDifficulty],
  };
}

function assessTaskDifficulty(taskContent, targetDir, provider, {
  spawnFn = spawn,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const prompt = `You are a task difficulty assessor. Rate the following software development task on a scale of 1-5:

1 = Trivial (typo fix, config change, simple text update)
2 = Easy (simple bug fix, small feature, adding a field)
3 = Medium (feature implementation, refactoring, API integration)
4 = Hard (complex feature, architecture change, multi-file refactor)
5 = Very Hard (large-scale redesign, complex algorithms, system-wide changes)

Task:
${taskContent}

Reply with ONLY a single number (1-5), nothing else.`;

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    let stdout = '';

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeoutFn(timeoutId);
      resolve(buildDifficultyAssessment(result, provider));
    };

    try {
      const proc = spawnFn(
        'claude',
        ['-p', '--output-format', 'text', '--model', 'claude-haiku-4-5-20251001'],
        {
          cwd: targetDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        }
      );

      timeoutId = setTimeoutFn(() => {
        try {
          proc.kill('SIGTERM');
        } catch {}
        finish(3);
      }, 30000);

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', () => {});

      proc.on('error', () => finish(3));
      proc.on('close', (code) => {
        if (code !== 0) {
          finish(3);
          return;
        }
        finish(stdout.trim());
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    } catch {
      finish(3);
    }
  });
}

module.exports = {
  assessTaskDifficulty,
  buildDifficultyAssessment,
  DEFAULT_PROVIDER_MODELS,
  DIFFICULTY_LABELS,
  DIFFICULTY_MODELS,
  DIFFICULTY_MODELS_CODEX,
  NOTION_MODEL_OPTIONS,
  normalizeDifficulty,
  resolveModelForDifficulty,
};

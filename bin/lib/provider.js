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

function getProviderRunCommand(provider, continueMode) {
  if (provider === PROVIDERS.CODEX) {
    const args = continueMode
      ? ['exec', 'resume', '--last', '--json', '--dangerously-bypass-approvals-and-sandbox', '-']
      : ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-'];
    return { command: 'codex', args };
  }

  const args = [];
  if (continueMode) args.push('--continue');
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
  otherProvider,
  isProviderAvailable,
  resolveProviderPlan,
  buildExecutionPrompt,
  getProviderRunCommand,
  runPromptForTaskGeneration,
};

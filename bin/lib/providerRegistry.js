const path = require('path');
const { PROVIDERS } = require('./constants');
const { parseEnvFile } = require('./utils');
const { checkCommand } = require('./prerequisites');
const { loadConfig } = require('./config');

let warnedRgForWindowsCodex = false;

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
 */
function providerLabelWithModel(provider, model) {
  const label = providerLabel(provider);
  if (!model) return label;
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

  const explicit = normalizeProvider(requestedProvider);
  const preferred = explicit
    || normalizeProvider(process.env.SLEEPCODE_PROVIDER || envMap.SLEEPCODE_PROVIDER)
    || PROVIDERS.CLAUDE;

  const available = {
    [PROVIDERS.CLAUDE]: isProviderAvailable(PROVIDERS.CLAUDE),
    [PROVIDERS.CODEX]: isProviderAvailable(PROVIDERS.CODEX),
  };

  let selected;
  let ratioSelected = false;

  if (!explicit && available[PROVIDERS.CLAUDE] && available[PROVIDERS.CODEX]) {
    const config = loadConfig(targetDir);
    const claudeRatio = (config && config.claudeRatio != null) ? config.claudeRatio : null;
    if (claudeRatio !== null) {
      selected = Math.random() < claudeRatio ? PROVIDERS.CLAUDE : PROVIDERS.CODEX;
      ratioSelected = true;
    }
  }

  if (!selected) {
    const candidates = preferred === PROVIDERS.AUTO
      ? [PROVIDERS.CLAUDE, PROVIDERS.CODEX]
      : [preferred, otherProvider(preferred)];
    selected = candidates.find((p) => available[p]);
  }

  if (!selected) {
    throw new Error('Claude CLI or Codex CLI is required. Install at least one provider first.');
  }

  const fallback = [PROVIDERS.CLAUDE, PROVIDERS.CODEX]
    .find((p) => p !== selected && available[p]) || null;

  if (!warnedRgForWindowsCodex && process.platform === 'win32' && selected === PROVIDERS.CODEX) {
    const rgVer = checkCommand('rg --version');
    if (!rgVer) {
      warnedRgForWindowsCodex = true;
      console.log('[권장] Windows + Codex 환경에서는 rg(ripgrep) 설치를 권장합니다.');
      console.log('       rg 실행이 불가하면 검색 시 PowerShell fallback으로 동작합니다.');
      console.log('       설치: winget install BurntSushi.ripgrep.MSVC');
    }
  }

  return {
    preferred,
    selected,
    fallback,
    requestedUnavailable: !!explicit && !available[explicit],
    ratioSelected,
    available,
  };
}

module.exports = {
  isProviderAvailable,
  normalizeProvider,
  otherProvider,
  providerLabel,
  providerLabelWithModel,
  resolveProviderPlan,
};

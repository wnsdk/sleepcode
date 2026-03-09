const { visualWidth } = require('./utils');

function clipVisualText(text, maxWidth) {
  const source = String(text || '');
  if (visualWidth(source) <= maxWidth) return source;

  let width = 0;
  let cut = 0;
  for (const ch of source) {
    const chWidth = visualWidth(ch);
    if (width + chWidth > maxWidth - 3) break;
    width += chWidth;
    cut += ch.length;
  }
  return source.slice(0, cut) + '...';
}

function formatElapsedSeconds(elapsedSeconds) {
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  if (elapsed >= 3600) {
    return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
  }
  if (elapsed >= 60) {
    return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  }
  return `${elapsed}s`;
}

function formatTokens(n) {
  const num = Math.floor(n || 0);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(num);
}

function getTokensByProvider(workerStates) {
  const byProvider = {};
  for (const worker of workerStates || []) {
    const provider = worker.provider || 'unknown';
    if (!byProvider[provider]) byProvider[provider] = { input: 0, output: 0 };
    byProvider[provider].input += (worker.totalInputTokens ?? worker.inputTokens) || 0;
    byProvider[provider].output += (worker.totalOutputTokens ?? worker.outputTokens) || 0;
  }
  return byProvider;
}

function formatProviderTokens(workerStates, providerLabelFn) {
  const byProvider = getTokensByProvider(workerStates);
  const entries = Object.entries(byProvider);
  if (entries.length === 0) return 'Cost 0';

  return 'Cost ' + entries
    .map(([provider, tokens]) => {
      const label = typeof providerLabelFn === 'function' ? providerLabelFn(provider) : provider;
      const total = tokens.input + tokens.output;
      return `${label} ${formatTokens(total)}`;
    })
    .join('  ');
}

module.exports = {
  clipVisualText,
  formatElapsedSeconds,
  formatTokens,
  getTokensByProvider,
  formatProviderTokens,
};

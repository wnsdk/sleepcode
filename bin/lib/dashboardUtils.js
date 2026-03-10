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

function getUsageByProvider(workerStates) {
  const byProvider = {};
  for (const worker of workerStates || []) {
    const provider = worker.provider || 'unknown';
    if (!byProvider[provider]) byProvider[provider] = { input: 0, output: 0, cost: 0 };
    byProvider[provider].input += (worker.totalInputTokens ?? worker.inputTokens) || 0;
    byProvider[provider].output += (worker.totalOutputTokens ?? worker.outputTokens) || 0;
    byProvider[provider].cost += (worker.totalCost ?? worker.cost) || 0;
  }
  return byProvider;
}

function formatUsd(value) {
  const num = Math.max(0, Number(value) || 0);
  if (num >= 10) return `$${num.toFixed(2)}`;
  if (num >= 1) return `$${num.toFixed(3)}`;
  return `$${num.toFixed(4)}`;
}

function formatProviderTokens(workerStates, providerLabelFn) {
  const byProvider = getUsageByProvider(workerStates);
  const entries = Object.entries(byProvider);
  if (entries.length === 0) return 'Cost 0';

  return 'Cost ' + entries
    .map(([provider, usage]) => {
      const label = typeof providerLabelFn === 'function' ? providerLabelFn(provider) : provider;
      const totalTokens = usage.input + usage.output;
      if (totalTokens > 0) {
        return `${label} ${formatTokens(totalTokens)}`;
      }
      if (usage.cost > 0) {
        return `${label} ${formatUsd(usage.cost)}`;
      }
      return `${label} 0`;
    })
    .join('  ');
}

/** Clip text starting from `offsetCols` visual columns, showing at most `maxCols` visual columns */
function clipVisualTextFrom(text, offsetCols, maxCols) {
  const source = String(text || '');
  // Skip `offsetCols` visual columns
  let skipped = 0;
  let startIdx = 0;
  for (const ch of source) {
    if (skipped >= offsetCols) break;
    const chWidth = visualWidth(ch);
    skipped += chWidth;
    startIdx += ch.length;
  }
  const remaining = source.slice(startIdx);
  // Clip to maxCols
  let width = 0;
  let cutIdx = 0;
  for (const ch of remaining) {
    const chWidth = visualWidth(ch);
    if (width + chWidth > maxCols) break;
    width += chWidth;
    cutIdx += ch.length;
  }
  return remaining.slice(0, cutIdx);
}

const WORKTREE_NAME_MAX_WIDTH = 17;
const NAME_SCROLL_CHAR_MS = 250;   // ms per visual column
const NAME_SCROLL_PAUSE_MS = 1500; // ms pause at each end

/** Compute how many visual columns to scroll the worktree name */
function getWorktreeNameScrollOffset(nameVisualWidth, maxWidth) {
  if (nameVisualWidth <= maxWidth) return 0;
  const scrollRange = nameVisualWidth - maxWidth;
  const cycleDuration = 2 * NAME_SCROLL_PAUSE_MS + scrollRange * NAME_SCROLL_CHAR_MS;
  const t = Date.now() % cycleDuration;
  if (t < NAME_SCROLL_PAUSE_MS) return 0;
  const scrollT = t - NAME_SCROLL_PAUSE_MS;
  if (scrollT >= scrollRange * NAME_SCROLL_CHAR_MS) return scrollRange;
  return Math.floor(scrollT / NAME_SCROLL_CHAR_MS);
}

module.exports = {
  clipVisualText,
  clipVisualTextFrom,
  formatElapsedSeconds,
  formatTokens,
  getUsageByProvider,
  formatProviderTokens,
  getWorktreeNameScrollOffset,
  WORKTREE_NAME_MAX_WIDTH,
};

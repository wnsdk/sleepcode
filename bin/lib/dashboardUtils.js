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

module.exports = {
  clipVisualText,
  formatElapsedSeconds,
};

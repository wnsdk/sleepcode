const fs = require('fs');
const path = require('path');
const { C } = require('./constants');
const { visualWidth } = require('./utils');
const { recordCost } = require('./configBudget');
const { syncWorkerTaskProgress } = require('./taskState');

function trimByWidth(text, width) {
  const src = (text || '').trim();
  if (!src) return '';
  if (visualWidth(src) <= width) return src;
  let tw = 0;
  let cut = 0;
  for (const ch of src) {
    const cw = visualWidth(ch);
    if (tw + cw > width - 3) break;
    tw += cw;
    cut += ch.length;
  }
  return src.slice(0, cut) + '...';
}

function processStreamEvent(ws, obj, onUpdate, pushLog) {
  const msgType = obj.type;

  const appendReport = (text) => {
    const body = (text || '').trim();
    if (!body) return;
    if (!ws.reportLines) ws.reportLines = [];
    ws.reportLines.push(body);
    pushLog(ws.name, `${C.dim}${trimByWidth(body, 132)}${C.reset}`);
    onUpdate();
  };

  if (msgType === 'assistant') {
    const contents = (obj.message && obj.message.content) || [];
    for (const c of contents) {
      if (c.type === 'text') {
        appendReport(c.text || '');
      } else if (c.type === 'tool_use') {
        const name = c.name || '?';
        const inp = c.input || {};

        if (name === 'TodoWrite') {
          const todos = inp.todos || [];
          const active = todos.find(t => t.status === 'in_progress');
          if (active) ws.currentTask = active.activeForm || active.content || '';
        }

        let detail = '';
        if (name === 'Read' || name === 'Write' || name === 'Edit') {
          const fp = inp.file_path || '';
          detail = fp.split(/[/\\]/).pop() || fp;
        } else if (name === 'Bash') {
          detail = trimByWidth(inp.command || '', 117);
        } else if (name === 'Glob' || name === 'Grep') {
          detail = inp.pattern || '';
        }

        const logMsg = detail
          ? `${C.cyan}[TOOL]${C.reset} ${name}: ${detail}`
          : `${C.cyan}[TOOL]${C.reset} ${name}`;
        pushLog(ws.name, logMsg);
        onUpdate();
      }
    }
    return;
  }

  if (msgType === 'result') {
    const cost = obj.cost_usd;
    if (cost != null) {
      ws.cost = cost;
      if (ws.targetDir) recordCost(ws.targetDir, cost, 'parallel', ws.name);
    }

    const tasksPath2 = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');
    if (fs.existsSync(tasksPath2)) {
      const content = fs.readFileSync(tasksPath2, 'utf-8');
      syncWorkerTaskProgress(ws, null, content);
    }

    const msg = typeof obj.message === 'string' ? obj.message : '';
    if (msg) {
      pushLog(ws.name, `${C.green}[DONE]${C.reset} ${trimByWidth(msg, 117)}`);
    }
    onUpdate();
    return;
  }

  if ((msgType === 'item.started' || msgType === 'item.completed') && obj.item) {
    const item = obj.item;

    if (item.type === 'agent_message') {
      appendReport(item.text || '');
      return;
    }

    if (item.type === 'command_execution') {
      const command = trimByWidth(item.command || '', 110);
      if (msgType === 'item.started') {
        pushLog(ws.name, `${C.cyan}[TOOL]${C.reset} Bash: ${command}`);
      } else {
        const exitCode = (typeof item.exit_code === 'number') ? item.exit_code : null;
        const tail = exitCode == null ? '' : ` (exit ${exitCode})`;
        pushLog(ws.name, `${C.cyan}[TOOL]${C.reset} Bash done${tail}: ${command}`);
      }
      onUpdate();
      return;
    }
  }

  if (msgType === 'turn.completed') {
    const usage = obj.usage || {};
    const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
    const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (inputTokens + outputTokens);
    if (totalTokens > 0) {
      pushLog(ws.name, `${C.dim}[TOKENS] in:${inputTokens} out:${outputTokens} total:${totalTokens}${C.reset}`);
      onUpdate();
    }
  }
}

function getTerminalResultMeta(obj) {
  if (!obj || obj.type !== 'result') return null;

  const subtype = String(obj.subtype || '').trim().toLowerCase();
  const stopReason = String(obj.stop_reason || '').trim().toLowerCase();
  const message = typeof obj.message === 'string'
    ? obj.message.trim()
    : typeof obj.result === 'string'
      ? obj.result.trim()
      : '';

  return {
    success: obj.is_error !== true && subtype !== 'error',
    subtype,
    stopReason,
    message,
  };
}

module.exports = {
  processStreamEvent,
  getTerminalResultMeta,
  trimByWidth,
};

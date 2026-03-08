const fs = require('fs');
const path = require('path');
const { C } = require('./constants');
const { visualWidth } = require('./utils');
const { recordCost } = require('./configBudget');
const { syncWorkerTaskProgress } = require('./taskState');

// 모델별 Cost 가중치 (Sonnet 기준 1.0 정규화)
// https://docs.anthropic.com/en/docs/about-claude/pricing
const CLAUDE_MODEL_WEIGHTS = {
  opus:   { input: 5 / 3, output: 25 / 15 },   // $5/$25 per MTok
  sonnet: { input: 1.0,   output: 1.0 },        // $3/$15 per MTok (기준)
  haiku:  { input: 1 / 3, output: 5 / 15 },     // $1/$5 per MTok
};

function getModelWeight(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus'))   return CLAUDE_MODEL_WEIGHTS.opus;
  if (m.includes('haiku'))  return CLAUDE_MODEL_WEIGHTS.haiku;
  return CLAUDE_MODEL_WEIGHTS.sonnet;
}

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

    // Claude stream-json: 각 assistant 메시지의 message.usage에서 실시간 토큰 집계
    // 캐시 가중치 + 모델 가중치를 적용하여 플랜 주간 한도 소모량에 비례하도록 계산
    const msgUsage = obj.message && obj.message.usage;
    if (msgUsage) {
      const mw = getModelWeight(ws.model);
      const input = ((msgUsage.input_tokens || 0) * 1.0
        + (msgUsage.cache_creation_input_tokens || 0) * 1.25
        + (msgUsage.cache_read_input_tokens || 0) * 0.1) * mw.input;
      const output = (msgUsage.output_tokens || 0) * mw.output;
      if (input > 0 || output > 0) {
        ws.inputTokens = (ws.inputTokens || 0) + input;
        ws.outputTokens = (ws.outputTokens || 0) + output;
        onUpdate();
      }
    }

    return;
  }

  if (msgType === 'result') {
    // Claude stream-json: result 이벤트의 usage로 최종 토큰 수 확정
    // 캐시 가중치 + 모델 가중치를 적용하여 플랜 주간 한도 소모량에 비례하도록 계산
    const finalUsage = obj.usage;
    if (finalUsage) {
      const mw = getModelWeight(ws.model);
      const input = ((finalUsage.input_tokens || 0) * 1.0
        + (finalUsage.cache_creation_input_tokens || 0) * 1.25
        + (finalUsage.cache_read_input_tokens || 0) * 0.1) * mw.input;
      const output = (finalUsage.output_tokens || 0) * mw.output;
      if (input > 0 || output > 0) {
        ws.inputTokens = input;
        ws.outputTokens = output;
      }
    }

    const cost = obj.cost_usd;
    if (cost != null) {
      ws.cost = cost;
      if (ws.targetDir) {
        recordCost(ws.targetDir, cost, 'parallel', ws.name, {
          provider: ws.provider,
          inputTokens: ws.inputTokens || 0,
          outputTokens: ws.outputTokens || 0,
        });
      }
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
      ws.inputTokens = (ws.inputTokens || 0) + inputTokens;
      ws.outputTokens = (ws.outputTokens || 0) + outputTokens;
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
  CLAUDE_MODEL_WEIGHTS,
  getModelWeight,
  processStreamEvent,
  getTerminalResultMeta,
  trimByWidth,
};

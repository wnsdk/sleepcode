const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { C, PROVIDERS } = require('./constants');
const { countTasks, getNextPendingTask, visualWidth } = require('./utils');
const { isProviderAvailable, resolveProviderPlan, providerLabel, otherProvider, getProviderRunCommand, buildExecutionPrompt, assessTaskDifficulty } = require('./provider');
const { recordCost } = require('./config');
const { syncClaudeMd } = require('./files');

function processStreamEvent(ws, obj, onUpdate, pushLog) {
  const msgType = obj.type;

  const trimByWidth = (text, width) => {
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
  };

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

    const tasksPath2 = path.join(ws.path, '.sleepcode', 'task_queue.md');
    if (fs.existsSync(tasksPath2)) {
      const content = fs.readFileSync(tasksPath2, 'utf-8');
      const tc = countTasks(content);
      ws.done = tc.done;
      ws.total = tc.total;
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

function spawnWorker(ws, py, onDone, onUpdate, pushLog, cliProvider) {
  const wtDir = ws.path;
  syncClaudeMd(wtDir);

  const tasksPath = path.join(wtDir, '.sleepcode', 'task_queue.md');

  const logStream = fs.createWriteStream(ws.logFile, { flags: 'a' });
  const logLine = (msg) => logStream.write(`[${new Date().toISOString()}] ${msg}\n`);

  const env = { ...process.env };
  delete env.CLAUDECODE;

  function finalize(code, errMsg) {
    logLine(`=== Worker ${ws.name} end (code: ${code}) ===`);
    if (errMsg) logLine(`ERROR: ${errMsg}`);
    logStream.end();

    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const tc = countTasks(content);
      ws.done = tc.done;
      ws.total = tc.total;
    }

    ws.status = (code === 0) ? 'done' : 'failed';
    ws.currentTask = errMsg || '';
    onUpdate();
    onDone();
  }

  /** 태스크 1개를 실행하는 내부 함수. 완료 후 다음 태스크가 있으면 재귀 호출. */
  function runNextTask() {
    const prompt = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';

    if (!prompt.trim()) {
      pushLog(ws.name, `${C.red}[ERROR] task prompt is empty (.sleepcode/task_queue.md).${C.reset}`);
      ws.status = 'failed';
      ws.currentTask = 'task prompt is empty';
      onUpdate();
      logStream.end();
      onDone();
      return;
    }

    // 미완료 태스크가 없으면 완료 처리
    const nextTask = getNextPendingTask(prompt);
    if (!nextTask) {
      finalize(0);
      return;
    }

    // 태스크마다 provider를 ratio에 따라 새로 선택
    try {
      const plan = resolveProviderPlan(ws.targetDir || wtDir, cliProvider);
      ws.provider = plan.selected;
      ws.fallbackProvider = plan.fallback;
      if (plan.ratioSelected) {
        pushLog(ws.name, `${C.dim}[비율 선택] ${providerLabel(plan.selected)}${C.reset}`);
      }
      if (plan.requestedUnavailable) {
        pushLog(ws.name, `${C.yellow}[PROVIDER] requested provider unavailable, switched to ${providerLabel(plan.selected)}${C.reset}`);
      }
    } catch (e) {
      pushLog(ws.name, `${C.red}[ERROR] ${e.message}${C.reset}`);
      ws.status = 'failed';
      ws.currentTask = e.message;
      onUpdate();
      logStream.end();
      onDone();
      return;
    }

    // 태스크마다 난이도 재평가
    try {
      const assessment = assessTaskDifficulty(nextTask, ws.targetDir || wtDir, ws.provider);
      ws.difficulty = assessment.difficulty;
      ws.difficultyLabel = assessment.label;
      ws.model = assessment.model;
      pushLog(ws.name, `${C.cyan}[DIFFICULTY]${C.reset} ${assessment.label} (${assessment.difficulty}/5) → ${assessment.model}`);
    } catch {
      ws.difficulty = 3;
      ws.difficultyLabel = '★★★☆☆';
      ws.model = ws.provider === PROVIDERS.CODEX ? 'o3' : 'claude-sonnet-4-6';
    }
    onUpdate();

    logLine(`=== Task start (provider: ${ws.provider}, model: ${ws.model || 'default'}, difficulty: ${ws.difficulty || 'N/A'}) task: ${nextTask} ===`);

    const promptsByProvider = {
      [PROVIDERS.CLAUDE]: prompt,
      [PROVIDERS.CODEX]: buildExecutionPrompt(wtDir, prompt, PROVIDERS.CODEX),
    };

    function runAttempt(provider, allowFallback) {
      ws.provider = provider;
      const invoke = getProviderRunCommand(provider, false, ws.model);
      const stdinPrompt = promptsByProvider[provider] || prompt;

      const proc = spawn(invoke.command, invoke.args, {
        cwd: wtDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      ws._proc = proc;
      proc.stdin.write(stdinPrompt);
      proc.stdin.end();

      let buffer = '';
      let sawEvents = false;

      proc.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          logStream.write(line + '\n');
          sawEvents = true;
          try {
            const obj = JSON.parse(line);
            processStreamEvent(ws, obj, onUpdate, pushLog);
          } catch {}
        }
      });

      proc.stderr.on('data', (data) => {
        logStream.write(`[STDERR] ${data.toString()}`);
      });

      proc.on('close', (code) => {
        if (buffer.trim()) {
          logStream.write(buffer + '\n');
          try {
            const obj = JSON.parse(buffer);
            processStreamEvent(ws, obj, onUpdate, pushLog);
            sawEvents = true;
          } catch {}
        }

        if (code !== 0 && allowFallback && ws.fallbackProvider && ws.fallbackProvider !== provider && !sawEvents) {
          const fromLabel = providerLabel(provider);
          const toLabel = providerLabel(ws.fallbackProvider);
          pushLog(ws.name, `${C.yellow}[FALLBACK]${C.reset} ${fromLabel} failed, retrying with ${toLabel}`);
          logLine(`FALLBACK: ${provider} -> ${ws.fallbackProvider}`);
          onUpdate();
          runAttempt(ws.fallbackProvider, false);
          return;
        }

        // 태스크 완료 여부 확인 후 다음 태스크로 이동
        if (fs.existsSync(tasksPath)) {
          const updatedContent = fs.readFileSync(tasksPath, 'utf-8');
          const tc = countTasks(updatedContent);
          ws.done = tc.done;
          ws.total = tc.total;
          onUpdate();

          // 미완료 태스크가 남아있으면 다음 태스크 실행 (provider 재선택)
          const remaining = getNextPendingTask(updatedContent);
          if (remaining && code === 0) {
            pushLog(ws.name, `${C.cyan}[NEXT]${C.reset} 다음 태스크로 이동`);
            runNextTask();
            return;
          }
        }

        finalize(code);
      });

      proc.on('error', (err) => {
        if (allowFallback && ws.fallbackProvider && ws.fallbackProvider !== provider) {
          const fromLabel = providerLabel(provider);
          const toLabel = providerLabel(ws.fallbackProvider);
          pushLog(ws.name, `${C.yellow}[FALLBACK]${C.reset} ${fromLabel} failed, retrying with ${toLabel}`);
          logLine(`FALLBACK_ERROR: ${err.message}`);
          onUpdate();
          runAttempt(ws.fallbackProvider, false);
          return;
        }
        finalize(1, err.message);
      });
    }

    runAttempt(ws.provider, true);
  }

  // 첫 번째 태스크 실행 시작
  runNextTask();
}

module.exports = {
  processStreamEvent,
  spawnWorker,
};

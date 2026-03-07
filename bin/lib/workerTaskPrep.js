const { C, PROVIDERS } = require('./constants');
const {
  resolveProviderPlan,
  providerLabel,
  assessTaskDifficulty,
  DEFAULT_PROVIDER_MODELS,
  buildExecutionPrompt,
} = require('./provider');
const { getHeadCommit, formatExecError } = require('./workerGitOps');

/**
 * 다음 태스크 실행 전에 provider, 난이도, 모델을 선택하고 프롬프트를 빌드한다.
 *
 * Returns { taskStartHead, promptsByProvider, taskPrompt } or null on failure.
 */
function prepareTaskExecution({
  ws,
  wtDir,
  nextTask,
  cliProvider,
  buildTaskPrompt,
  nextTaskEntry,
  pushLog,
  onUpdate,
}) {
  // provider 선택 (ratio 기반)
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
    return { error: e.message };
  }

  // 난이도 평가
  try {
    const assessment = assessTaskDifficulty(nextTask, ws.targetDir || wtDir, ws.provider);
    ws.difficulty = assessment.difficulty;
    ws.difficultyLabel = assessment.label;
    ws.model = assessment.model;
    pushLog(ws.name, `${C.cyan}[DIFFICULTY]${C.reset} ${assessment.label} (${assessment.difficulty}/5) → ${assessment.model}`);
  } catch {
    ws.difficulty = 3;
    ws.difficultyLabel = '★★★☆☆';
    ws.model = DEFAULT_PROVIDER_MODELS[ws.provider] || DEFAULT_PROVIDER_MODELS[PROVIDERS.CLAUDE];
  }
  onUpdate();

  // git HEAD 캡처
  let taskStartHead;
  try {
    taskStartHead = getHeadCommit(wtDir);
  } catch (e) {
    return { error: `git head unavailable: ${formatExecError(e)}` };
  }

  // 프롬프트 빌드
  const taskPrompt = buildTaskPrompt(nextTaskEntry);
  const promptsByProvider = {
    [PROVIDERS.CLAUDE]: taskPrompt,
    [PROVIDERS.CODEX]: buildExecutionPrompt(wtDir, taskPrompt, PROVIDERS.CODEX),
  };

  return { taskStartHead, promptsByProvider, taskPrompt };
}

module.exports = { prepareTaskExecution };

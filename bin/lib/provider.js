const {
  normalizeProvider,
  providerLabel,
  providerLabelWithModel,
  otherProvider,
  isProviderAvailable,
  resolveProviderPlan,
} = require('./providerRegistry');

const {
  assessTaskDifficulty,
  buildDifficultyAssessment,
  DEFAULT_PROVIDER_MODELS,
  DIFFICULTY_LABELS,
  DIFFICULTY_MODELS,
  DIFFICULTY_MODELS_CODEX,
  NOTION_MODEL_OPTIONS,
  normalizeDifficulty,
  resolveModelForDifficulty,
} = require('./providerModels');

const {
  buildExecutionPrompt,
  getProviderRunCommand,
  runPromptForTaskGeneration,
} = require('./providerExecution');

module.exports = {
  normalizeProvider,
  providerLabel,
  providerLabelWithModel,
  otherProvider,
  isProviderAvailable,
  resolveProviderPlan,
  buildExecutionPrompt,
  getProviderRunCommand,
  runPromptForTaskGeneration,
  assessTaskDifficulty,
  buildDifficultyAssessment,
  DIFFICULTY_MODELS,
  DIFFICULTY_MODELS_CODEX,
  DIFFICULTY_LABELS,
  DEFAULT_PROVIDER_MODELS,
  NOTION_MODEL_OPTIONS,
  normalizeDifficulty,
  resolveModelForDifficulty,
};

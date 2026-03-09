const OPENAI_SERVICE_TIERS = {
  FLEX: 'flex',
  PRIORITY: 'priority',
  STANDARD: 'standard',
};

const TOKENS_PER_MILLION = 1_000_000;
const GPT_5_4_LONG_CONTEXT_THRESHOLD = 272_000;

const STANDARD_MODEL_PRICES = {
  'gpt-5.4': {
    input: 2.5,
    cachedInput: 0.25,
    output: 15,
    longContext: {
      thresholdInputTokens: GPT_5_4_LONG_CONTEXT_THRESHOLD,
      input: 5,
      cachedInput: 0.5,
      output: 22.5,
    },
  },
  'gpt-5.4-pro': {
    input: 30,
    cachedInput: null,
    output: 180,
    longContext: {
      thresholdInputTokens: GPT_5_4_LONG_CONTEXT_THRESHOLD,
      input: 60,
      cachedInput: null,
      output: 270,
    },
  },
  'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'codex-mini-latest': { input: 1.5, cachedInput: 0.375, output: 6 },
  'o3': { input: 2, cachedInput: 0.5, output: 8 },
  'o3-mini': { input: 1.1, cachedInput: 0.55, output: 4.4 },
  'o4-mini': { input: 1.1, cachedInput: 0.275, output: 4.4 },
};

const FLEX_MODEL_PRICES = {
  'gpt-5.4': {
    input: 1.25,
    cachedInput: 0.125,
    output: 7.5,
    longContext: {
      thresholdInputTokens: GPT_5_4_LONG_CONTEXT_THRESHOLD,
      input: 2.5,
      cachedInput: 0.25,
      output: 11.25,
    },
  },
  'gpt-5.4-pro': { input: 15, cachedInput: null, output: 90 },
  'gpt-5.2': { input: 0.875, cachedInput: 0.0875, output: 7 },
  'gpt-5.1': { input: 0.625, cachedInput: 0.0625, output: 5 },
  'gpt-5': { input: 0.625, cachedInput: 0.0625, output: 5 },
  'gpt-5-mini': { input: 0.125, cachedInput: 0.0125, output: 1 },
  'o3': { input: 1, cachedInput: 0.25, output: 4 },
  'o4-mini': { input: 0.55, cachedInput: 0.138, output: 2.2 },
};

const PRIORITY_MODEL_PRICES = {
  'gpt-5.4': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.2': { input: 3.5, cachedInput: 0.35, output: 28 },
  'gpt-5.1': { input: 2.5, cachedInput: 0.25, output: 20 },
  'gpt-5': { input: 2.5, cachedInput: 0.25, output: 20 },
  'gpt-5-mini': { input: 0.45, cachedInput: 0.045, output: 3.6 },
  'gpt-5.3-codex': { input: 3.5, cachedInput: 0.35, output: 28 },
  'gpt-5.2-codex': { input: 3.5, cachedInput: 0.35, output: 28 },
  'gpt-5.1-codex-max': { input: 2.5, cachedInput: 0.25, output: 20 },
  'gpt-5.1-codex': { input: 2.5, cachedInput: 0.25, output: 20 },
  'gpt-5-codex': { input: 2.5, cachedInput: 0.25, output: 20 },
  'gpt-4.1': { input: 3.5, cachedInput: 0.875, output: 14 },
  'gpt-4.1-mini': { input: 0.7, cachedInput: 0.175, output: 2.8 },
  'gpt-4.1-nano': { input: 0.2, cachedInput: 0.05, output: 0.8 },
  'gpt-4o': { input: 4.25, cachedInput: 2.125, output: 17 },
  'gpt-4o-mini': { input: 0.25, cachedInput: 0.125, output: 1 },
  'o3': { input: 3.5, cachedInput: 0.875, output: 14 },
  'o4-mini': { input: 2, cachedInput: 0.5, output: 8 },
};

const MODEL_PRICES_BY_TIER = {
  [OPENAI_SERVICE_TIERS.STANDARD]: STANDARD_MODEL_PRICES,
  [OPENAI_SERVICE_TIERS.FLEX]: FLEX_MODEL_PRICES,
  [OPENAI_SERVICE_TIERS.PRIORITY]: PRIORITY_MODEL_PRICES,
};

const MODEL_ALIASES = {
  // Inference from OpenAI's deprecation note recommending gpt-5-codex-mini in place of codex-mini-latest.
  'gpt-5-codex-mini': 'codex-mini-latest',
};

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeServiceTier(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('priority')) return OPENAI_SERVICE_TIERS.PRIORITY;
  if (raw.includes('flex')) return OPENAI_SERVICE_TIERS.FLEX;
  return OPENAI_SERVICE_TIERS.STANDARD;
}

function extractOpenAIUsage(usage = {}) {
  const inputTokens = toNumber(
    usage.input_tokens != null ? usage.input_tokens : usage.prompt_tokens
  );
  const outputTokens = toNumber(
    usage.output_tokens != null ? usage.output_tokens : usage.completion_tokens
  );

  const cachedCandidates = [
    usage.cached_input_tokens,
    usage.input_cached_tokens,
    usage.prompt_cached_tokens,
    usage.input_tokens_details && usage.input_tokens_details.cached_tokens,
    usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens,
  ];
  const cachedInputTokens = Math.min(
    inputTokens,
    cachedCandidates.map(toNumber).find((num) => num > 0) || 0
  );

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
  };
}

function resolveModelAlias(model) {
  const normalized = String(model || '').trim().toLowerCase();
  return MODEL_ALIASES[normalized] || normalized;
}

function resolveModelPricing(model, serviceTier = OPENAI_SERVICE_TIERS.STANDARD, usage = {}) {
  const normalizedModel = resolveModelAlias(model);
  const tier = normalizeServiceTier(serviceTier);
  const priceTable = MODEL_PRICES_BY_TIER[tier] || MODEL_PRICES_BY_TIER[OPENAI_SERVICE_TIERS.STANDARD];

  const candidates = Object.keys(priceTable).sort((a, b) => b.length - a.length);
  const matchedModel = candidates.find((candidate) => (
    normalizedModel === candidate || normalizedModel.startsWith(`${candidate}-`)
  ));
  if (!matchedModel) return null;

  const spec = priceTable[matchedModel];
  const inputTokens = toNumber(
    usage.inputTokens != null
      ? usage.inputTokens
      : (usage.input_tokens != null ? usage.input_tokens : usage.prompt_tokens)
  );

  if (
    spec.longContext
    && inputTokens > toNumber(spec.longContext.thresholdInputTokens)
  ) {
    return {
      ...spec.longContext,
      matchedModel,
      serviceTier: tier,
    };
  }

  return {
    input: spec.input,
    cachedInput: spec.cachedInput,
    output: spec.output,
    matchedModel,
    serviceTier: tier,
  };
}

function calculateOpenAICostFromUsage(model, usage = {}, options = {}) {
  const extracted = extractOpenAIUsage(usage);
  const pricing = resolveModelPricing(model, options.serviceTier, extracted);
  if (!pricing) return null;

  const billedInputTokens = Math.max(0, extracted.inputTokens - extracted.cachedInputTokens);
  const cachedInputRate = pricing.cachedInput != null ? pricing.cachedInput : pricing.input;
  const cost = (
    billedInputTokens * pricing.input
    + extracted.cachedInputTokens * cachedInputRate
    + extracted.outputTokens * pricing.output
  ) / TOKENS_PER_MILLION;

  return {
    billedInputTokens,
    cachedInputTokens: extracted.cachedInputTokens,
    cost,
    inputTokens: extracted.inputTokens,
    matchedModel: pricing.matchedModel,
    outputTokens: extracted.outputTokens,
    rates: {
      input: pricing.input,
      cachedInput: cachedInputRate,
      output: pricing.output,
    },
    serviceTier: pricing.serviceTier,
  };
}

module.exports = {
  GPT_5_4_LONG_CONTEXT_THRESHOLD,
  OPENAI_SERVICE_TIERS,
  calculateOpenAICostFromUsage,
  extractOpenAIUsage,
  normalizeServiceTier,
  resolveModelAlias,
  resolveModelPricing,
};

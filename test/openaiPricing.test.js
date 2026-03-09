const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GPT_5_4_LONG_CONTEXT_THRESHOLD,
  OPENAI_SERVICE_TIERS,
  calculateOpenAICostFromUsage,
  extractOpenAIUsage,
  resolveModelAlias,
  resolveModelPricing,
} = require('../bin/lib/openaiPricing');

test('extractOpenAIUsage reads cached token details from usage payloads', () => {
  assert.deepEqual(
    extractOpenAIUsage({
      prompt_tokens: 1200,
      completion_tokens: 150,
      prompt_tokens_details: { cached_tokens: 200 },
    }),
    {
      inputTokens: 1200,
      cachedInputTokens: 200,
      outputTokens: 150,
    }
  );
});

test('calculateOpenAICostFromUsage prices codex models with cached input rates', () => {
  const result = calculateOpenAICostFromUsage('gpt-5.2-codex', {
    prompt_tokens: 1000,
    completion_tokens: 100,
    prompt_tokens_details: { cached_tokens: 200 },
  });

  const expected = ((800 * 1.75) + (200 * 0.175) + (100 * 14)) / 1_000_000;
  assert.ok(result);
  assert.equal(result.matchedModel, 'gpt-5.2-codex');
  assert.ok(Math.abs(result.cost - expected) < 1e-12);
});

test('calculateOpenAICostFromUsage applies gpt-5.4 long-context pricing', () => {
  const result = calculateOpenAICostFromUsage('gpt-5.4', {
    input_tokens: GPT_5_4_LONG_CONTEXT_THRESHOLD + 1,
    output_tokens: 1000,
  });

  const expected = (((GPT_5_4_LONG_CONTEXT_THRESHOLD + 1) * 5) + (1000 * 22.5)) / 1_000_000;
  assert.ok(result);
  assert.equal(result.rates.input, 5);
  assert.equal(result.rates.output, 22.5);
  assert.ok(Math.abs(result.cost - expected) < 1e-9);
});

test('resolveModelAlias maps gpt-5-codex-mini to codex-mini-latest pricing alias', () => {
  assert.equal(resolveModelAlias('gpt-5-codex-mini'), 'codex-mini-latest');

  const result = calculateOpenAICostFromUsage('gpt-5-codex-mini', {
    prompt_tokens: 1000,
    completion_tokens: 100,
  });

  const expected = ((1000 * 1.5) + (100 * 6)) / 1_000_000;
  assert.ok(result);
  assert.equal(result.matchedModel, 'codex-mini-latest');
  assert.ok(Math.abs(result.cost - expected) < 1e-12);
});

test('resolveModelPricing supports explicit priority tier selection', () => {
  const pricing = resolveModelPricing('gpt-5.3-codex', OPENAI_SERVICE_TIERS.PRIORITY, {
    inputTokens: 1000,
  });

  assert.deepEqual(pricing, {
    input: 3.5,
    cachedInput: 0.35,
    output: 28,
    matchedModel: 'gpt-5.3-codex',
    serviceTier: 'priority',
  });
});

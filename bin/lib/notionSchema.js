/**
 * Notion DB 스키마 정의, 동기화, 변경 요약.
 * EXPECTED_DB_PROPERTIES 기준으로 기존 DB 프로퍼티를 비교·보정한다.
 */

const { notionApiRequest, formatNotionId } = require('./notionApi');
const { NOTION_MODEL_OPTIONS } = require('./provider');

function buildModelSelectProperty() {
  return {
    select: {
      options: NOTION_MODEL_OPTIONS.map((option) => ({ ...option })),
    },
  };
}

// sleepcode가 기대하는 Notion DB 프로퍼티 정의
const EXPECTED_DB_PROPERTIES = {
  'Status': {
    select: {
      options: [
        { name: 'Idle', color: 'default' },
        { name: 'Pending', color: 'purple' },
        { name: 'Running', color: 'blue' },
        { name: 'Success', color: 'green' },
        { name: 'Failed', color: 'red' },
      ],
    },
  },
  'Run': { checkbox: {} },
  'Worker': { select: { options: [] } },
  'Priority': {
    number: { format: 'number' },
    description: 'Higher number = executed first',
  },
  'Difficulty': {
    select: {
      options: [
        { name: '1', color: 'gray' },
        { name: '2', color: 'green' },
        { name: '3', color: 'yellow' },
        { name: '4', color: 'orange' },
        { name: '5', color: 'red' },
      ],
    },
    description: 'Task difficulty override (1-5). When set, sleepcode uses this value before auto-assessment.',
  },
  'Model': buildModelSelectProperty(),
  'Cost': {
    number: { format: 'number_with_commas' },
    description: 'Weighted token cost (Sonnet=1x). Cache: creation×1.25, read×0.1. Model: Opus×1.67, Sonnet×1.0, Haiku×0.33. Codex: (billed_input*rate + cached_input*cached_rate + output*rate)/1,000,000 by model + tier',
  },
  'Completed At': { date: {} },
  'Commit': { rich_text: {} },
};

function normalizePropName(name) {
  return String(name || '').toLowerCase().trim();
}

function getExpectedType(config) {
  return Object.keys(config || {})[0] || '';
}

function optionKey(option) {
  return normalizePropName(option?.name || '');
}

function mergeSelectOptions(existingOptions, expectedOptions) {
  const merged = [];
  const seen = new Set();

  for (const opt of expectedOptions || []) {
    const key = optionKey(opt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ name: opt.name, color: opt.color || 'default' });
  }

  for (const opt of existingOptions || []) {
    const key = optionKey(opt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ name: opt.name, color: opt.color || 'default' });
  }

  return merged;
}

function optionsSignature(options) {
  return (options || [])
    .map((opt) => `${normalizePropName(opt?.name)}|${opt?.color || ''}`)
    .join('|');
}

function findExistingProperty(existingProps, name) {
  const target = normalizePropName(name);
  for (const propName of Object.keys(existingProps || {})) {
    if (normalizePropName(propName) === target) {
      return { name: propName, prop: existingProps[propName] };
    }
  }
  return null;
}

async function syncNotionDbSchema(apiKey, dbId) {
  const formattedId = formatNotionId(dbId);
  const db = await notionApiRequest('GET', `/databases/${formattedId}`, apiKey);
  const existingProps = db.properties || {};

  const missingProps = {};
  const updateProps = {};
  const updated = [];
  const skipped = [];

  for (const [name, config] of Object.entries(EXPECTED_DB_PROPERTIES)) {
    const existingEntry = findExistingProperty(existingProps, name);
    if (!existingEntry) {
      missingProps[name] = config;
      continue;
    }

    const existingProp = existingEntry.prop || {};
    const existingType = existingProp.type || '';
    const expectedType = getExpectedType(config);

    if (name === 'Status') {
      if (existingType === 'select') {
        const currentOptions = existingProp.select?.options || [];
        const nextOptions = mergeSelectOptions(currentOptions, config.select?.options || []);
        if (optionsSignature(currentOptions) !== optionsSignature(nextOptions)) {
          updateProps[existingEntry.name] = { select: { options: nextOptions } };
          updated.push(name);
        }
      } else if (existingType === 'status') {
        skipped.push(`${name}(status)`);
      } else {
        skipped.push(`${name}(${existingType || 'unknown'})`);
      }
      continue;
    }

    if (expectedType === existingType) {
      let needsUpdate = false;

      if (expectedType === 'select') {
        const expectedOptions = config.select?.options || [];
        if (expectedOptions.length > 0) {
          const currentOptions = existingProp.select?.options || [];
          const nextOptions = mergeSelectOptions(currentOptions, expectedOptions);
          if (optionsSignature(currentOptions) !== optionsSignature(nextOptions)) {
            updateProps[existingEntry.name] = { select: { options: nextOptions } };
            needsUpdate = true;
          }
        }
      }

      if (expectedType === 'number') {
        const expectedFormat = config.number?.format;
        const currentFormat = existingProp.number?.format;
        if (expectedFormat && expectedFormat !== currentFormat) {
          updateProps[existingEntry.name] = {
            ...(updateProps[existingEntry.name] || {}),
            number: { format: expectedFormat },
          };
          needsUpdate = true;
        }
      }

      if (config.description != null && config.description !== (existingProp.description || '')) {
        const typePayload = updateProps[existingEntry.name] || { [expectedType]: {} };
        updateProps[existingEntry.name] = {
          ...typePayload,
          description: config.description,
        };
        needsUpdate = true;
      }

      if (needsUpdate) updated.push(name);
      continue;
    }

    skipped.push(`${name}(${existingType || 'unknown'})`);
  }

  if (Object.keys(missingProps).length > 0 || Object.keys(updateProps).length > 0) {
    await notionApiRequest('PATCH', `/databases/${formattedId}`, apiKey, {
      properties: {
        ...missingProps,
        ...updateProps,
      },
    });
  }

  return {
    added: Object.keys(missingProps),
    updated,
    skipped,
  };
}

function summarizeSchemaChanges(schemaResult = {}) {
  const added = Array.isArray(schemaResult.added) ? schemaResult.added : [];
  const updated = Array.isArray(schemaResult.updated) ? schemaResult.updated : [];
  const skipped = Array.isArray(schemaResult.skipped) ? schemaResult.skipped : [];
  const parts = [];

  if (added.length > 0) parts.push(`추가: ${added.join(', ')}`);
  if (updated.length > 0) parts.push(`업데이트: ${updated.join(', ')}`);

  return {
    added,
    updated,
    skipped,
    parts,
    hasChanges: parts.length > 0,
  };
}

module.exports = {
  buildModelSelectProperty,
  EXPECTED_DB_PROPERTIES,
  syncNotionDbSchema,
  summarizeSchemaChanges,
};

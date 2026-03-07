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
  summarizeSchemaChanges,
};

/**
 * Notion API 속성 포맷터.
 * schema 객체를 받아 Notion API 호환 property 객체를 반환하는 순수 함수들.
 */

function buildStatusProps(schema, statusValue) {
  if (!schema || !schema.status_prop) return null;
  if (schema.status_type === 'status') {
    return { [schema.status_prop]: { status: { name: statusValue } } };
  }
  if (schema.status_type === 'select') {
    return { [schema.status_prop]: { select: { name: statusValue } } };
  }
  return null;
}

function buildCompletedAtProp(schema, date = new Date()) {
  if (!schema || !schema.completed_at_prop) return null;
  const offsetMinutes = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offsetMinutes * 60 * 1000);
  const offsetSign = offsetMinutes <= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
  const offsetMins = String(absoluteMinutes % 60).padStart(2, '0');
  const isoStr = `${localDate.toISOString().slice(0, 19)}${offsetSign}${offsetHours}:${offsetMins}`;
  return { [schema.completed_at_prop]: { date: { start: isoStr } } };
}

function buildModelProp(schema, modelName) {
  if (!schema || !schema.model_prop || !modelName) return null;
  if (schema.model_type === 'select') {
    return { [schema.model_prop]: { select: { name: modelName } } };
  }
  return { [schema.model_prop]: { rich_text: [{ text: { content: modelName } }] } };
}

module.exports = {
  buildCompletedAtProp,
  buildModelProp,
  buildStatusProps,
};

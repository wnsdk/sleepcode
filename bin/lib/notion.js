/**
 * Notion DB 생성 및 검증.
 * HTTP 트랜스포트는 notionApi.js, 스키마 동기화는 notionSchema.js에 위임.
 */

const { C } = require('./constants');
const { notionApiRequest, formatNotionId } = require('./notionApi');
const { buildModelSelectProperty, EXPECTED_DB_PROPERTIES, syncNotionDbSchema } = require('./notionSchema');

/**
 * 입력된 Notion ID가 실제 DB인지 검증.
 * 페이지 URL이면 해당 페이지 안의 DB를 자동 탐색.
 * @returns {Promise<string>} 유효한 DB ID
 */
async function validateNotionDbId(apiKey, rawId) {
  if (!rawId) return '';

  const formattedId = formatNotionId(rawId);
  let dbError = null;

  // 1. DB로 직접 조회 시도
  try {
    await notionApiRequest('GET', `/databases/${formattedId}`, apiKey);
    return rawId; // DB ID가 맞음
  } catch (e) {
    dbError = e;
  }

  // 2. 페이지로 조회 시도
  try {
    const page = await notionApiRequest('GET', `/pages/${formattedId}`, apiKey);
    if (page && page.object === 'page') {
      // 페이지 내 자식 DB 검색
      try {
        const blocks = await notionApiRequest('GET', `/blocks/${formattedId}/children?page_size=100`, apiKey);
        if (blocks && blocks.results) {
          const childDb = blocks.results.find(b => b.type === 'child_database');
          if (childDb) {
            return childDb.id.replace(/-/g, '');
          }
        }
      } catch {}

      // 자식 DB가 없으면 에러
      throw new Error(
        `입력한 URL은 Notion 페이지입니다 (DB가 아닙니다).\n` +
        `  해당 페이지 안에 데이터베이스가 없습니다.\n` +
        `  Notion 데이터베이스의 URL 또는 ID를 입력해주세요.\n` +
        `  ${C.dim}(DB URL 예: https://www.notion.so/workspace/abc123...?v=...)${C.reset}`
      );
    }
  } catch (e) {
    if (e.message.includes('Notion 페이지입니다')) throw e;
  }

  // 실제 API 오류 메시지를 포함하여 원인 파악이 가능하도록 함
  const apiMsg = dbError ? dbError.message : '';
  if (apiMsg.includes('401') || apiMsg.includes('Unauthorized') || apiMsg.includes('unauthorized')) {
    throw new Error(
      `Notion API Key가 유효하지 않습니다.\n` +
      `  API Key를 다시 확인해주세요.\n` +
      `  ${C.dim}(발급: https://www.notion.so/my-integrations)${C.reset}`
    );
  }

  throw new Error(
    `Notion 데이터베이스에 접근할 수 없습니다.\n` +
    `  다음 사항을 확인해주세요:\n` +
    `  1. Notion 데이터베이스 페이지에서 ··· → 연결 → 통합(Integration)을 추가했는지 확인\n` +
    `  2. 데이터베이스 URL 또는 ID가 올바른지 확인\n` +
    `  ${C.dim}(입력한 ID: ${rawId})${C.reset}`
  );
}

async function createNotionDb(apiKey, parentPageId, dbTitle) {
  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: dbTitle } }],
    properties: {
      'Task': { title: {} },
      ...EXPECTED_DB_PROPERTIES,
    },
  };

  const result = await notionApiRequest('POST', '/databases', apiKey, body);
  return result.id.replace(/-/g, '');
}

module.exports = {
  notionApiRequest,
  validateNotionDbId,
  createNotionDb,
  EXPECTED_DB_PROPERTIES,
  syncNotionDbSchema,
};

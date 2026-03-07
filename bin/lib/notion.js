const { C } = require('./constants');

function notionApiRequest(method, endpoint, apiKey, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: `/v1${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(`Notion API 오류 (${res.statusCode}): ${json.message || body}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Notion API 응답 파싱 오류: ${body}`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`네트워크 오류: ${e.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

/**
 * 입력된 Notion ID가 실제 DB인지 검증.
 * 페이지 URL이면 해당 페이지 안의 DB를 자동 탐색.
 * @returns {Promise<string>} 유효한 DB ID
 */
async function validateNotionDbId(apiKey, rawId) {
  if (!rawId) return '';

  // 32자리 hex → 대시 포함 UUID 형식으로 변환 (Notion API 호환성)
  let formattedId = rawId;
  if (/^[a-f0-9]{32}$/.test(rawId)) {
    formattedId = `${rawId.slice(0,8)}-${rawId.slice(8,12)}-${rawId.slice(12,16)}-${rawId.slice(16,20)}-${rawId.slice(20)}`;
  }

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
      'Priority': { number: { format: 'number' } },
      'Log': { rich_text: {} },
      'Model': { rich_text: {} },
      'Cost': { number: { format: 'number' } },
      'Completed At': { date: {} },
    },
  };

  const result = await notionApiRequest('POST', '/databases', apiKey, body);
  return result.id.replace(/-/g, '');
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
  'Priority': { number: { format: 'number' } },
  'Log': { rich_text: {} },
  'Model': { rich_text: {} },
  'Cost': { number: { format: 'number' } },
  'Completed At': { date: {} },
};

async function syncNotionDbSchema(apiKey, dbId) {
  // DB 스키마 조회
  let formattedId = dbId;
  if (/^[a-f0-9]{32}$/.test(dbId)) {
    formattedId = `${dbId.slice(0,8)}-${dbId.slice(8,12)}-${dbId.slice(12,16)}-${dbId.slice(16,20)}-${dbId.slice(20)}`;
  }
  const db = await notionApiRequest('GET', `/databases/${formattedId}`, apiKey);
  const existingProps = db.properties || {};
  const existingNames = new Set(Object.keys(existingProps).map(n => n.toLowerCase().trim()));

  // 누락된 프로퍼티 찾기
  const missingProps = {};
  for (const [name, config] of Object.entries(EXPECTED_DB_PROPERTIES)) {
    if (!existingNames.has(name.toLowerCase().trim())) {
      missingProps[name] = config;
    }
  }

  if (Object.keys(missingProps).length === 0) {
    return [];
  }

  // 누락된 프로퍼티 추가
  await notionApiRequest('PATCH', `/databases/${formattedId}`, apiKey, {
    properties: missingProps,
  });

  return Object.keys(missingProps);
}

async function searchNotionPages(apiKey, query) {
  const body = {
    query: query || '',
    filter: { value: 'page', property: 'object' },
    page_size: 10,
  };
  const result = await notionApiRequest('POST', '/search', apiKey, body);
  return (result.results || []).map((p) => ({
    id: p.id,
    title: (p.properties?.title?.title || p.properties?.Name?.title || [])
      .map((t) => t.plain_text).join('') || '(제목 없음)',
  }));
}

module.exports = {
  notionApiRequest,
  validateNotionDbId,
  createNotionDb,
  EXPECTED_DB_PROPERTIES,
  syncNotionDbSchema,
  searchNotionPages,
};

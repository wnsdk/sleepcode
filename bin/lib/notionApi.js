/**
 * Notion REST API HTTP 트랜스포트.
 * 다른 Notion 모듈이 공유하는 저수준 요청 함수.
 */

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

function formatNotionId(rawId) {
  if (/^[a-f0-9]{32}$/.test(rawId)) {
    return `${rawId.slice(0,8)}-${rawId.slice(8,12)}-${rawId.slice(12,16)}-${rawId.slice(16,20)}-${rawId.slice(20)}`;
  }
  return rawId;
}

module.exports = {
  notionApiRequest,
  formatNotionId,
};

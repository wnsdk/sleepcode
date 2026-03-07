const path = require('path');

const { C } = require('./constants');
const { validateNotionDbId, syncNotionDbSchema } = require('./notion');
const { summarizeSchemaChanges } = require('./notionSchema');
const { parseEnvFile, parseNotionDbId } = require('./utils');

function resolveNotionUpdateArgs(targetDir, cliArgs = {}) {
  const envPath = path.join(targetDir, '.sleepcode', '.env');
  const envMap = parseEnvFile(envPath);

  return {
    notionKey: cliArgs.notionKey || envMap.NOTION_API_KEY || '',
    notionDbRaw: cliArgs.notionDb || envMap.NOTION_DB_ID || '',
  };
}

async function runNotionUpdate(targetDir, cliArgs) {
  const { notionKey, notionDbRaw } = resolveNotionUpdateArgs(targetDir, cliArgs);

  if (!notionKey) {
    console.error(`${C.red}Notion API Key가 필요합니다. --notion-key 옵션 또는 .sleepcode/.env의 NOTION_API_KEY를 설정해주세요.${C.reset}`);
    process.exit(1);
  }

  if (!notionDbRaw) {
    console.error(`${C.red}Notion DB ID/URL이 필요합니다. --notion-db 옵션 또는 .sleepcode/.env의 NOTION_DB_ID를 설정해주세요.${C.reset}`);
    process.exit(1);
  }

  const rawId = parseNotionDbId(notionDbRaw) || notionDbRaw;
  console.log(`${C.dim}Notion DB 스키마 업데이트 중...${C.reset}`);

  try {
    const notionDbId = await validateNotionDbId(notionKey, rawId);
    const schemaResult = await syncNotionDbSchema(notionKey, notionDbId);
    const summary = summarizeSchemaChanges(schemaResult);

    if (summary.hasChanges) {
      console.log(`${C.green}✓${C.reset} Notion DB 스키마 반영 완료 (${summary.parts.join(' / ')})`);
    } else {
      console.log(`${C.green}✓${C.reset} Notion DB 스키마가 이미 최신 버전입니다.`);
    }

    if (summary.skipped.length > 0) {
      console.log(`${C.yellow}⚠${C.reset} 스킵된 컬럼: ${summary.skipped.join(', ')}`);
    }
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}`);
    process.exit(1);
  }
}

module.exports = {
  resolveNotionUpdateArgs,
  runNotionUpdate,
};

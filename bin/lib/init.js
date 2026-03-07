const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { C, PROJECT_TYPES, PROVIDERS, SLEEPCODE_BADGE } = require('./constants');
const { generateFiles, printResult } = require('./files');
const { createNotionDb, syncNotionDbSchema, validateNotionDbId } = require('./notion');
const { summarizeSchemaChanges } = require('./notionSchema');
const { checkPrerequisites } = require('./prerequisites');
const { saveConfig } = require('./config');
const { ask, parseNotionDbId, select } = require('./utils');

function parseClaudeRatio(value) {
  if (value == null || value === '') return null;
  const pct = parseInt(value, 10);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) return null;
  return pct / 100;
}

function buildConfigToSave({ weeklyBudget = 0, budgetThreshold = 90, claudeRatio = null } = {}) {
  const configToSave = {};
  if (weeklyBudget > 0) {
    configToSave.weeklyBudget = weeklyBudget;
    configToSave.budgetThreshold = budgetThreshold;
  }
  if (claudeRatio !== null) {
    configToSave.claudeRatio = claudeRatio;
  }
  return configToSave;
}

function printBanner() {
  console.log(`
    ${SLEEPCODE_BADGE}
    ${C.dim}AI codes while you sleep${C.reset}
`);
}

function printSchemaSyncSummary(schemaResult, { latestMessage = '' } = {}) {
  const summary = summarizeSchemaChanges(schemaResult);

  if (summary.hasChanges) {
    console.log(`${C.green}✓${C.reset} Notion DB 스키마 반영 (${summary.parts.join(' / ')})`);
  } else if (latestMessage) {
    console.log(`${C.green}✓${C.reset} ${latestMessage}`);
  }

  if (summary.skipped.length > 0) {
    console.log(`${C.yellow}⚠${C.reset} 스킵된 컬럼: ${summary.skipped.join(', ')}`);
  }
}

function getProjectTypeConfigOrExit(typeKey) {
  if (!PROJECT_TYPES[typeKey]) {
    console.error(`${C.red}알 수 없는 타입: ${typeKey}${C.reset}`);
    console.error(`사용 가능: ${Object.keys(PROJECT_TYPES).join(', ')}`);
    process.exit(1);
  }

  return PROJECT_TYPES[typeKey];
}

async function syncExistingNotionDb(notionKey, rawId, { showAutoDetectMessage = false } = {}) {
  console.log(`${C.dim}Notion DB 확인 중...${C.reset}`);
  const notionDbId = await validateNotionDbId(notionKey, rawId);

  if (showAutoDetectMessage) {
    if (notionDbId !== rawId) {
      console.log(`${C.green}✓${C.reset} 페이지 내 DB를 자동 감지했습니다.`);
    } else {
      console.log(`${C.green}✓${C.reset} Notion DB 확인 완료`);
    }
  }

  const schemaResult = await syncNotionDbSchema(notionKey, notionDbId);
  printSchemaSyncSummary(schemaResult);
  return notionDbId;
}

async function createNotionDbWithLogs(notionKey, parentPageId, dbName) {
  console.log(`${C.dim}Notion DB 생성 중...${C.reset}`);
  const notionDbId = await createNotionDb(notionKey, parentPageId, dbName);
  console.log(`${C.green}✓${C.reset} Notion DB 생성 완료 (ID: ${notionDbId})`);
  return notionDbId;
}

function saveOptionalConfig(targetDir, options, { verbose = false } = {}) {
  const configToSave = buildConfigToSave(options);
  if (Object.keys(configToSave).length === 0) return configToSave;

  saveConfig(targetDir, configToSave);

  if (verbose && options.weeklyBudget > 0) {
    console.log(`  ${C.green}✓${C.reset} .sleepcode/config.json       ${C.dim}← 주간 예산: $${options.weeklyBudget} (${options.budgetThreshold}%)${C.reset}`);
  }
  if (verbose && options.claudeRatio !== null) {
    console.log(`  ${C.green}✓${C.reset} .sleepcode/config.json       ${C.dim}← 비율: Claude ${Math.round(options.claudeRatio * 100)}% / Codex ${Math.round((1 - options.claudeRatio) * 100)}%${C.reset}`);
  }

  return configToSave;
}

function generateProjectFiles(targetDir, generationOptions, configOptions, { verboseConfig = false } = {}) {
  generateFiles(targetDir, generationOptions);
  saveOptionalConfig(targetDir, configOptions, { verbose: verboseConfig });
  printResult(generationOptions.notionDbId);
}

async function runNonInteractiveInit(targetDir, cliArgs, providerArg) {
  await checkPrerequisites(null);

  const typeConfig = getProjectTypeConfigOrExit(cliArgs.type);

  if (fs.existsSync(path.join(targetDir, '.sleepcode')) && !cliArgs.force) {
    console.error(`${C.red}.sleepcode/ 폴더가 이미 존재합니다. --force 로 덮어쓰세요.${C.reset}`);
    process.exit(1);
  }

  const projectName = cliArgs.name || path.basename(targetDir);
  const role = cliArgs.role || `${projectName} 서비스 개발`;
  const figmaKey = cliArgs.figmaKey || '';
  const figmaFileNames = cliArgs.figmaFileNames || '';
  const notionKey = cliArgs.notionKey || '';
  const notionPages = cliArgs.notionPages || '';
  const notionFilter = cliArgs.notionFilter || '';

  if (!notionKey) {
    console.error(`${C.red}--notion-key <KEY> 는 필수입니다.${C.reset}`);
    process.exit(1);
  }

  if (!cliArgs.notionDb) {
    console.error(`${C.red}--notion-db <ID|URL|create> 는 필수입니다.${C.reset}`);
    process.exit(1);
  }

  let notionDbId = '';
  if (cliArgs.notionDb === 'create') {
    const parentPageId = parseNotionDbId(cliArgs.notionParent || '');
    if (!parentPageId) {
      console.error(`${C.red}--notion-parent <페이지 URL 또는 ID> 를 지정해주세요.${C.reset}`);
      process.exit(1);
    }

    try {
      notionDbId = await createNotionDbWithLogs(
        notionKey,
        parentPageId,
        cliArgs.notionDbName || `${projectName} - sleepcode tasks`
      );
    } catch (e) {
      console.error(`${C.red}Notion DB 생성 실패: ${e.message}${C.reset}`);
      process.exit(1);
    }
  } else {
    try {
      notionDbId = await syncExistingNotionDb(notionKey, parseNotionDbId(cliArgs.notionDb || ''));
    } catch (e) {
      console.error(`${C.red}${e.message}${C.reset}`);
      process.exit(1);
    }
  }

  console.log(`${C.dim}타입: ${typeConfig.label}${C.reset}`);
  console.log(`${C.dim}이름: ${projectName}${C.reset}`);
  console.log(`${C.dim}역할: ${role}${C.reset}`);
  console.log(`${C.dim}태스크: Notion DB${C.reset}`);

  generateProjectFiles(
    targetDir,
    {
      typeKey: cliArgs.type,
      projectName,
      role,
      buildCmd: typeConfig.buildCmd,
      testCmd: typeConfig.testCmd,
      lintCmd: typeConfig.lintCmd,
      figmaKey,
      figmaFileNames,
      notionKey,
      notionPages,
      notionDbId,
      notionFilter,
      provider: providerArg || PROVIDERS.CLAUDE,
    },
    {
      weeklyBudget: parseFloat(cliArgs.budget) || 0,
      budgetThreshold: parseInt(cliArgs.threshold, 10) || 90,
      claudeRatio: parseClaudeRatio(cliArgs.claudeRatio),
    }
  );
}

async function runInteractiveInit(targetDir, providerArg) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    await checkPrerequisites(rl);

    if (fs.existsSync(path.join(targetDir, '.sleepcode'))) {
      console.log(`${C.yellow}⚠ .sleepcode/ 폴더가 이미 존재합니다.${C.reset}`);
      const overwrite = await ask(rl, '덮어쓸까요? (y/N)', 'N');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('취소됨.');
        rl.close();
        return;
      }
    }

    const typeOptions = Object.entries(PROJECT_TYPES).map(([key, val]) => ({
      key,
      label: val.label,
    }));
    const selectedType = await select(rl, '프로젝트 타입', typeOptions);
    const typeKey = selectedType.key;
    const typeConfig = PROJECT_TYPES[typeKey];

    const projectName = await ask(rl, '프로젝트 이름', path.basename(targetDir));
    const role = await ask(rl, 'AI 역할 설명', `${projectName} 서비스 개발`);

    let buildCmd = typeConfig.buildCmd;
    let testCmd = typeConfig.testCmd;
    let lintCmd = typeConfig.lintCmd;

    if (typeKey === 'custom') {
      buildCmd = await ask(rl, '빌드 커맨드 (없으면 Enter)', '');
      testCmd = await ask(rl, '테스트 커맨드 (없으면 Enter)', '');
      lintCmd = await ask(rl, '린트 커맨드 (없으면 Enter)', '');
    } else {
      console.log(`${C.dim}  빌드: ${buildCmd || '(없음)'}${C.reset}`);
      console.log(`${C.dim}  테스트: ${testCmd || '(없음)'}${C.reset}`);
      console.log(`${C.dim}  린트: ${lintCmd || '(없음)'}${C.reset}`);
    }

    let figmaKey = '';
    let figmaFileNames = '';
    const useFigma = await ask(rl, 'Figma 디자인을 참고하나요? (y/N)', 'N');
    if (useFigma.toLowerCase() === 'y') {
      figmaKey = await ask(rl, 'Figma API Key', '');
      figmaFileNames = await ask(rl, '참고할 Figma 파일명 (예: 홈화면, 로그인)', '');
    }

    const notionKey = await ask(rl, 'Notion API Key', '');
    if (!notionKey) {
      console.error(`\n${C.red}Notion API Key는 필수입니다.${C.reset}`);
      console.log(`${C.dim}Notion 통합에서 API Key를 발급받으세요: https://www.notion.so/my-integrations${C.reset}`);
      process.exit(1);
    }

    let notionDbId = '';
    const taskSource = await select(rl, '할 일(Task) 관리 방식', [
      { key: 'notion', label: 'Notion DB (기존 Notion 데이터베이스 연결)' },
      { key: 'notion-create', label: 'Notion DB 새로 만들기 (자동 생성)' },
    ]);

    if (taskSource.key === 'notion') {
      const rawId = parseNotionDbId(await ask(rl, '할 일을 저장해 둔 Notion DB (URL 또는 ID)', ''));
      if (!rawId) {
        console.error(`${C.red}유효한 Notion DB URL 또는 ID를 입력해주세요.${C.reset}`);
        process.exit(1);
      }

      try {
        notionDbId = await syncExistingNotionDb(notionKey, rawId, { showAutoDetectMessage: true });
      } catch (e) {
        console.error(`${C.red}${e.message}${C.reset}`);
        process.exit(1);
      }
    } else {
      const parentPageId = parseNotionDbId(await ask(rl, 'DB를 생성할 Notion 페이지 (URL 또는 ID)', ''));
      if (!parentPageId) {
        console.error(`${C.red}유효한 Notion 페이지 URL 또는 ID를 입력해주세요.${C.reset}`);
        process.exit(1);
      }

      console.log('');
      try {
        notionDbId = await createNotionDbWithLogs(
          notionKey,
          parentPageId,
          await ask(rl, 'DB 이름', `${projectName} - sleepcode tasks`)
        );
      } catch (e) {
        console.error(`${C.red}Notion DB 생성 실패: ${e.message}${C.reset}`);
        process.exit(1);
      }
    }

    const notionPages = await ask(rl, '참고할 Notion 페이지명 (없으면 Enter)', '');

    let weeklyBudget = 0;
    let budgetThreshold = 90;
    const useBudget = await ask(rl, '주간 비용 한도를 설정할까요? (y/N)', 'N');
    if (useBudget.toLowerCase() === 'y') {
      weeklyBudget = parseFloat(await ask(rl, '주간 최대 비용 (USD)', '50')) || 50;
      budgetThreshold = parseInt(await ask(rl, '사용량 임계값 (%)', '90'), 10) || 90;
    }

    let claudeRatio = null;
    const useRatio = await ask(rl, 'Claude와 Codex 비율을 설정할까요? (y/N)', 'N');
    if (useRatio.toLowerCase() === 'y') {
      const pct = parseInt(
        await ask(rl, 'Claude 비율 (0-100, 예: 30은 Claude 30% / Codex 70%)', '50'),
        10
      );
      claudeRatio = Math.max(0, Math.min(100, Number.isNaN(pct) ? 50 : pct)) / 100;
      console.log(`  ${C.dim}→ Claude ${Math.round(claudeRatio * 100)}% / Codex ${Math.round((1 - claudeRatio) * 100)}%${C.reset}`);
    }

    rl.close();

    generateProjectFiles(
      targetDir,
      {
        typeKey,
        projectName,
        role,
        buildCmd,
        testCmd,
        lintCmd,
        figmaKey,
        figmaFileNames,
        notionKey,
        notionPages,
        notionDbId,
        notionFilter: '',
        provider: providerArg || PROVIDERS.CLAUDE,
      },
      {
        weeklyBudget,
        budgetThreshold,
        claudeRatio,
      },
      { verboseConfig: true }
    );
  } catch (e) {
    console.error(`${C.red}오류: ${e.message}${C.reset}`);
    rl.close();
    process.exit(1);
  }
}

async function runInit(targetDir, cliArgs, providerArg) {
  printBanner();

  if (cliArgs.type) {
    await runNonInteractiveInit(targetDir, cliArgs, providerArg);
    return;
  }

  await runInteractiveInit(targetDir, providerArg);
}

module.exports = {
  buildConfigToSave,
  parseClaudeRatio,
  runInit,
};

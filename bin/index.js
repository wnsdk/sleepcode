#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const { C, SLEEPCODE_BADGE, PROVIDERS, PROJECT_TYPES } = require('./lib/constants');
const { ask, select, parseNotionDbId } = require('./lib/utils');
const { checkPrerequisites } = require('./lib/prerequisites');
const { normalizeProvider } = require('./lib/provider');
const { validateNotionDbId, createNotionDb, syncNotionDbSchema } = require('./lib/notion');
const { generateFiles, printResult } = require('./lib/files');
const { saveConfig } = require('./lib/config');
const { showUsage } = require('./lib/config');
const { showHelp, showVersion, parseArgs } = require('./lib/cli');
const { runWorker } = require('./lib/run');
const { runParallel } = require('./lib/parallel');

// ─── 메인 ───
async function main() {
  const targetDir = process.cwd();
  const cliArgs = parseArgs();
  const providerArg = normalizeProvider(cliArgs.provider, '');

  if (cliArgs.provider && !providerArg) {
    console.error(`${C.red}--provider 값은 claude, codex, auto 중 하나여야 합니다.${C.reset}`);
    process.exit(1);
  }

  // 서브커맨드 처리
  const firstArg = process.argv[2];
  if (firstArg === 'help') {
    showHelp();
    return;
  }
  if (firstArg === 'version') {
    showVersion();
    return;
  }
  if (firstArg === 'run') {
    const cont = !!cliArgs.continue;
    runWorker(cont, providerArg);
    return;
  }
  if (firstArg === 'parallel') {
    const subArgs = process.argv.slice(3);
    runParallel(subArgs, providerArg);
    return;
  }
  if (firstArg === 'usage') {
    showUsage();
    return;
  }
  if (firstArg === 'notion-update') {
    const { parseNotionDbId } = require('./lib/utils');
    const { validateNotionDbId, syncNotionDbSchema } = require('./lib/notion');
    const dotenv = require('path').join(targetDir, '.sleepcode', '.env');
    let notionKey = cliArgs.notionKey || '';
    let notionDbRaw = cliArgs.notionDb || '';
    if (!notionKey || !notionDbRaw) {
      if (fs.existsSync(dotenv)) {
        const lines = fs.readFileSync(dotenv, 'utf-8').split('\n');
        for (const line of lines) {
          const m = line.match(/^([^=]+)=(.*)$/);
          if (!m) continue;
          const [, k, v] = m;
          if (!notionKey && k.trim() === 'NOTION_API_KEY') notionKey = v.trim();
          if (!notionDbRaw && k.trim() === 'NOTION_DB_ID') notionDbRaw = v.trim();
        }
      }
    }
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
      const addedCols = await syncNotionDbSchema(notionKey, notionDbId);
      if (addedCols.length > 0) {
        console.log(`${C.green}✓${C.reset} 누락된 컬럼 추가 완료: ${addedCols.join(', ')}`);
      } else {
        console.log(`${C.green}✓${C.reset} Notion DB 스키마가 이미 최신 버전입니다.`);
      }
    } catch (e) {
      console.error(`${C.red}${e.message}${C.reset}`);
      process.exit(1);
    }
    return;
  }

  console.log(`
    ${SLEEPCODE_BADGE}
    ${C.dim}AI codes while you sleep${C.reset}
`);

  // 비대화형 모드: --type 이 있으면 인터랙티브 스킵
  if (cliArgs.type) {
    // 비대화형: 사전 준비 체크 (자동 설치 제안 없음)
    await checkPrerequisites(null);

    const typeKey = cliArgs.type;
    if (!PROJECT_TYPES[typeKey]) {
      console.error(`${C.red}알 수 없는 타입: ${typeKey}${C.reset}`);
      console.error(`사용 가능: ${Object.keys(PROJECT_TYPES).join(', ')}`);
      process.exit(1);
    }

    if (fs.existsSync(path.join(targetDir, '.sleepcode')) && !cliArgs.force) {
      console.error(`${C.red}.sleepcode/ 폴더가 이미 존재합니다. --force 로 덮어쓰세요.${C.reset}`);
      process.exit(1);
    }

    const typeConfig = PROJECT_TYPES[typeKey];
    const projectName = cliArgs.name || path.basename(targetDir);
    const role = cliArgs.role || `${projectName} 서비스 개발`;
    const figmaKey = cliArgs.figmaKey || '';
    const figmaFileNames = cliArgs.figmaFileNames || '';
    const notionKey = cliArgs.notionKey || '';
    if (!notionKey) {
      console.error(`${C.red}--notion-key <KEY> 는 필수입니다.${C.reset}`);
      process.exit(1);
    }
    if (!cliArgs.notionDb) {
      console.error(`${C.red}--notion-db <ID|URL|create> 는 필수입니다.${C.reset}`);
      process.exit(1);
    }
    const notionPages = cliArgs.notionPages || '';
    let notionDbId = '';
    if (cliArgs.notionDb === 'create') {
      // 새 Notion DB 생성 모드
      if (!notionKey) {
        console.error(`${C.red}Notion DB 생성에는 --notion-key 가 필요합니다.${C.reset}`);
        process.exit(1);
      }
      const parentPageId = parseNotionDbId(cliArgs.notionParent || '');
      if (!parentPageId) {
        console.error(`${C.red}--notion-parent <페이지 URL 또는 ID> 를 지정해주세요.${C.reset}`);
        process.exit(1);
      }
      const dbName = cliArgs.notionDbName || `${projectName} - sleepcode tasks`;
      console.log(`${C.dim}Notion DB 생성 중...${C.reset}`);
      try {
        notionDbId = await createNotionDb(notionKey, parentPageId, dbName);
        console.log(`${C.green}✓${C.reset} Notion DB 생성 완료 (ID: ${notionDbId})`);
      } catch (e) {
        console.error(`${C.red}Notion DB 생성 실패: ${e.message}${C.reset}`);
        process.exit(1);
      }
    } else {
      const rawId = parseNotionDbId(cliArgs.notionDb || '');
      console.log(`${C.dim}Notion DB 확인 중...${C.reset}`);
      try {
        notionDbId = await validateNotionDbId(notionKey, rawId);
        const addedCols = await syncNotionDbSchema(notionKey, notionDbId);
        if (addedCols.length > 0) {
          console.log(`${C.green}✓${C.reset} 누락된 컬럼 자동 추가: ${addedCols.join(', ')}`);
        }
      } catch (e) {
        console.error(`${C.red}${e.message}${C.reset}`);
        process.exit(1);
      }
    }
    const notionFilter = cliArgs.notionFilter || '';
    console.log(`${C.dim}타입: ${typeConfig.label}${C.reset}`);
    console.log(`${C.dim}이름: ${projectName}${C.reset}`);
    console.log(`${C.dim}역할: ${role}${C.reset}`);
    console.log(`${C.dim}태스크: Notion DB${C.reset}`);

    generateFiles(targetDir, {
      typeKey,
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
    });

    const weeklyBudget = parseFloat(cliArgs.budget) || 0;
    const budgetThreshold = parseInt(cliArgs.threshold, 10) || 90;
    let claudeRatio = null;
    if (cliArgs.claudeRatio != null) {
      const pct = parseInt(cliArgs.claudeRatio, 10);
      if (!isNaN(pct) && pct >= 0 && pct <= 100) {
        claudeRatio = pct / 100;
      }
    }
    const configToSave = {};
    if (weeklyBudget > 0) { configToSave.weeklyBudget = weeklyBudget; configToSave.budgetThreshold = budgetThreshold; }
    if (claudeRatio !== null) configToSave.claudeRatio = claudeRatio;
    if (Object.keys(configToSave).length > 0) saveConfig(targetDir, configToSave);

    printResult(notionDbId);
    return;
  }

  // 인터랙티브 모드
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // 인터랙티브: 사전 준비 체크 (자동 설치 제안 포함)
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

    // Figma 연동
    let figmaKey = '';
    let figmaFileNames = '';
    const useFigma = await ask(rl, 'Figma 디자인을 참고하나요? (y/N)', 'N');
    if (useFigma.toLowerCase() === 'y') {
      figmaKey = await ask(rl, 'Figma API Key', '');
      figmaFileNames = await ask(rl, '참고할 Figma 파일명 (예: 홈화면, 로그인)', '');
    }

    // Notion 연동 (필수)
    let notionKey = '';
    let notionPages = '';
    let notionDbId = '';
    let notionFilter = '';
    notionKey = await ask(rl, 'Notion API Key', '');
    if (!notionKey) {
      console.error(`\n${C.red}Notion API Key는 필수입니다.${C.reset}`);
      console.log(`${C.dim}Notion 통합에서 API Key를 발급받으세요: https://www.notion.so/my-integrations${C.reset}`);
      process.exit(1);
    }

    // Notion DB 선택 (필수)
    const taskSource = await select(rl, '할 일(Task) 관리 방식', [
      { key: 'notion', label: 'Notion DB (기존 Notion 데이터베이스 연결)' },
      { key: 'notion-create', label: 'Notion DB 새로 만들기 (자동 생성)' },
    ]);

    if (taskSource.key === 'notion') {
      const dbInput = await ask(rl, '할 일을 저장해 둔 Notion DB (URL 또는 ID)', '');
      const rawId = parseNotionDbId(dbInput);
      if (!rawId) {
        console.error(`${C.red}유효한 Notion DB URL 또는 ID를 입력해주세요.${C.reset}`);
        process.exit(1);
      }
      console.log(`${C.dim}Notion DB 확인 중...${C.reset}`);
      try {
        notionDbId = await validateNotionDbId(notionKey, rawId);
        if (notionDbId !== rawId) {
          console.log(`${C.green}✓${C.reset} 페이지 내 DB를 자동 감지했습니다.`);
        } else {
          console.log(`${C.green}✓${C.reset} Notion DB 확인 완료`);
        }
        const addedCols = await syncNotionDbSchema(notionKey, notionDbId);
        if (addedCols.length > 0) {
          console.log(`${C.green}✓${C.reset} 누락된 컬럼 자동 추가: ${addedCols.join(', ')}`);
        }
      } catch (e) {
        console.error(`${C.red}${e.message}${C.reset}`);
        process.exit(1);
      }
    } else if (taskSource.key === 'notion-create') {
      const parentInput = await ask(rl, 'DB를 생성할 Notion 페이지 (URL 또는 ID)', '');
      const parentPageId = parseNotionDbId(parentInput);
      if (!parentPageId) {
        console.error(`${C.red}유효한 Notion 페이지 URL 또는 ID를 입력해주세요.${C.reset}`);
        process.exit(1);
      }
      const dbName = await ask(rl, 'DB 이름', `${projectName} - sleepcode tasks`);
      console.log(`\n${C.dim}Notion DB 생성 중...${C.reset}`);
      try {
        notionDbId = await createNotionDb(notionKey, parentPageId, dbName);
        console.log(`${C.green}✓${C.reset} Notion DB 생성 완료 (ID: ${notionDbId})`);
      } catch (e) {
        console.error(`${C.red}Notion DB 생성 실패: ${e.message}${C.reset}`);
        process.exit(1);
      }
    }

    notionPages = await ask(rl, '참고할 Notion 페이지명 (없으면 Enter)', '');

    // 주간 예산 설정
    let weeklyBudget = 0;
    let budgetThreshold = 90;
    const useBudget = await ask(rl, '주간 비용 한도를 설정할까요? (y/N)', 'N');
    if (useBudget.toLowerCase() === 'y') {
      const budgetStr = await ask(rl, '주간 최대 비용 (USD)', '50');
      weeklyBudget = parseFloat(budgetStr) || 50;
      const thresholdStr = await ask(rl, '사용량 임계값 (%)', '90');
      budgetThreshold = parseInt(thresholdStr, 10) || 90;
    }

    // Claude / Codex 비율 설정
    let claudeRatio = null;
    const useRatio = await ask(rl, 'Claude와 Codex 비율을 설정할까요? (y/N)', 'N');
    if (useRatio.toLowerCase() === 'y') {
      const ratioStr = await ask(rl, 'Claude 비율 (0-100, 예: 30은 Claude 30% / Codex 70%)', '50');
      const pct = parseInt(ratioStr, 10);
      claudeRatio = Math.max(0, Math.min(100, isNaN(pct) ? 50 : pct)) / 100;
      console.log(`  ${C.dim}→ Claude ${Math.round(claudeRatio * 100)}% / Codex ${Math.round((1 - claudeRatio) * 100)}%${C.reset}`);
    }

    rl.close();

    generateFiles(targetDir, {
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
      notionFilter,
      provider: providerArg || PROVIDERS.CLAUDE,
    });

    const configToSave = {};
    if (weeklyBudget > 0) {
      configToSave.weeklyBudget = weeklyBudget;
      configToSave.budgetThreshold = budgetThreshold;
    }
    if (claudeRatio !== null) configToSave.claudeRatio = claudeRatio;
    if (Object.keys(configToSave).length > 0) {
      saveConfig(targetDir, configToSave);
      if (weeklyBudget > 0) {
        console.log(`  ${C.green}✓${C.reset} .sleepcode/config.json       ${C.dim}← 주간 예산: $${weeklyBudget} (${budgetThreshold}%)${C.reset}`);
      }
      if (claudeRatio !== null) {
        console.log(`  ${C.green}✓${C.reset} .sleepcode/config.json       ${C.dim}← 비율: Claude ${Math.round(claudeRatio * 100)}% / Codex ${Math.round((1 - claudeRatio) * 100)}%${C.reset}`);
      }
    }

    printResult(notionDbId);
  } catch (e) {
    console.error(`${C.red}오류: ${e.message}${C.reset}`);
    rl.close();
    process.exit(1);
  }
}

main();

const fs = require('fs');
const path = require('path');
const { C, TEMPLATES_DIR, IS_WIN, PROVIDERS } = require('./constants');
const { writeFile } = require('./utils');
const { ensureRuntimeDirs } = require('./runtimePaths');

function ensureSleepcodeGitignoreContent(content = '') {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  const nextLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === '# sleepcode workspace'
      || trimmed === '.sleepcode/'
      || trimmed === '.sleepcode/*'
      || trimmed === '!.sleepcode/task_done/'
      || trimmed === '!.sleepcode/task_done/**'
    ) {
      continue;
    }
    nextLines.push(line);
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
    nextLines.pop();
  }

  if (nextLines.length > 0) nextLines.push('');
  nextLines.push('# sleepcode workspace');
  nextLines.push('.sleepcode/*');
  nextLines.push('!.sleepcode/task_done/');
  nextLines.push('!.sleepcode/task_done/**');
  nextLines.push('');

  return nextLines.join('\n');
}

function buildClaudeMdContent(targetDir) {
  const scDir = path.join(targetDir, '.sleepcode');
  const baseRulesPath = path.join(scDir, 'scripts', 'base_rules.md');
  const rulesPath = path.join(scDir, 'rules.md');

  const parts = [];
  if (fs.existsSync(baseRulesPath)) parts.push(fs.readFileSync(baseRulesPath, 'utf-8'));
  if (fs.existsSync(rulesPath)) parts.push(fs.readFileSync(rulesPath, 'utf-8'));

  if (parts.length === 0) return '';

  let content = parts.join('\n\n---\n\n');
  // API 키가 CLAUDE.md에 노출되지 않도록 마스킹
  content = content.replace(/API Key: `[^`]+`/g, 'API Key는 .sleepcode/.env 참조');
  content = content.replace(/\(API Key: [^)]+\)/g, '(API Key는 .sleepcode/.env 참조)');
  return content;
}

/**
 * CLAUDE.md 동기화: base_rules.md + rules.md → 프로젝트 루트 CLAUDE.md
 * Claude CLI가 CLAUDE.md를 시스템 프롬프트로 자동 로드하며, 프롬프트 캐싱 적용됨.
 * -p 프롬프트에는 task_queue.md만 전달하여 토큰 절약.
 */
function syncClaudeMd(targetDir) {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  const content = buildClaudeMdContent(targetDir);
  if (content) {
    fs.writeFileSync(claudeMdPath, content);
  }
}

function generateFiles(targetDir, { typeKey, projectName, role, buildCmd, testCmd, lintCmd, figmaKey, figmaFileNames, notionKey, notionPages, notionDbId, notionFilter, provider = PROVIDERS.CLAUDE }) {
  const scDir = path.join(targetDir, '.sleepcode');
  const claudeDir = path.join(targetDir, '.claude');
  fs.mkdirSync(path.join(scDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(scDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(scDir, 'task_done'), { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  ensureRuntimeDirs(targetDir);

  // 스크립트 파일 → scripts/ 하위로 복사 (OS별 분기)
  const scriptFiles = IS_WIN
    ? ['ai_worker.ps1', 'encoding_bootstrap.ps1']
    : ['ai_worker.sh'];
  const allScriptFiles = [...scriptFiles, 'log_filter.py'];
  if (notionDbId) allScriptFiles.push('notion_sync.py');

  for (const file of allScriptFiles) {
    const src = path.join(TEMPLATES_DIR, 'common', file);
    const dest = path.join(scDir, 'scripts', file);
    if (fs.existsSync(src)) {
      let content = fs.readFileSync(src, 'utf-8');
      // Shell/Python 스크립트는 반드시 LF 줄바꿈 (Windows에서도)
      if (file.endsWith('.sh') || file.endsWith('.py')) {
        content = content.replace(/\r\n/g, '\n');
      }
      // PowerShell은 UTF-8 BOM 필요 (한글 깨짐 방지)
      if (file.endsWith('.ps1')) content = '\uFEFF' + content;
      fs.writeFileSync(dest, content);
    }
  }

  // base_rules.md → scripts/ 하위로 복사 (Figma/Notion 섹션 조건부 처리)
  const baseRulesSrc = path.join(TEMPLATES_DIR, 'common', 'base_rules.md');
  if (fs.existsSync(baseRulesSrc)) {
    let baseRules = fs.readFileSync(baseRulesSrc, 'utf-8');

    // Figma 섹션
    if (figmaKey) {
      let figmaSection = `## Figma\n\n- **프론트엔드 디자인**: Figma MCP 도구로 직접 조회 가능 (API Key: \`${figmaKey}\`)`;
      if (figmaFileNames) {
        figmaSection += `\n- **참고 파일**: ${figmaFileNames}`;
      }
      baseRules = baseRules.replace('{{FIGMA_SECTION}}', figmaSection);
    } else {
      baseRules = baseRules.replace('\n{{FIGMA_SECTION}}\n', '');
    }

    // Notion 섹션 (API 키는 .env에서 관리, CLAUDE.md에 노출하지 않음)
    if (notionKey) {
      let notionSection = `\n## Notion\n\n- **기획/문서**: Notion MCP 도구로 직접 조회 가능 (API Key는 .sleepcode/.env 참조)`;
      if (notionPages) {
        notionSection += `\n- **참고 페이지**: ${notionPages}`;
      }
      baseRules = baseRules.replace('{{NOTION_SECTION}}', notionSection);
    } else {
      baseRules = baseRules.replace('\n{{NOTION_SECTION}}\n', '');
    }

    fs.writeFileSync(path.join(scDir, 'scripts', 'base_rules.md'), baseRules);
  }

  // README.md → .sleepcode/ 루트에 복사
  const readmeSrc = path.join(TEMPLATES_DIR, 'common', 'README.md');
  if (fs.existsSync(readmeSrc)) {
    fs.writeFileSync(path.join(scDir, 'README.md'), fs.readFileSync(readmeSrc, 'utf-8'));
  }

  // 실행 권한 (Unix만)
  if (!IS_WIN) {
    fs.chmodSync(path.join(scDir, 'scripts', 'ai_worker.sh'), 0o755);
    fs.chmodSync(path.join(scDir, 'scripts', 'log_filter.py'), 0o755);
    if (notionDbId) fs.chmodSync(path.join(scDir, 'scripts', 'notion_sync.py'), 0o755);
  }

  // docs/.gitkeep
  writeFile(path.join(scDir, 'docs', '.gitkeep'), '');
  writeFile(path.join(scDir, 'task_done', '.gitkeep'), '');
  writeFile(path.join(scDir, 'task_done', 'main.md'), '# 완료 기록\n\n');

  // task_queue.md는 backlog(읽기 전용)로 Notion에서 동적으로 생성됨

  // rules.md
  const rulesTemplate = path.join(TEMPLATES_DIR, 'rules', `${typeKey}.md`);
  if (fs.existsSync(rulesTemplate)) {
    let rules = fs.readFileSync(rulesTemplate, 'utf-8');
    rules = rules.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
    rules = rules.replace(/\{\{ROLE\}\}/g, role);
    rules = rules.replace(/\{\{BUILD_CMD\}\}/g, buildCmd);
    rules = rules.replace(/\{\{TEST_CMD\}\}/g, testCmd);
    rules = rules.replace(/\{\{LINT_CMD\}\}/g, lintCmd);
    writeFile(path.join(scDir, 'rules.md'), rules);
  }

  // settings.local.json
  const settingsTemplate = path.join(TEMPLATES_DIR, 'settings', `${typeKey}.json`);
  if (fs.existsSync(settingsTemplate)) {
    const content = fs.readFileSync(settingsTemplate, 'utf-8');
    fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), content);
  }

  // .sleepcode/.env (API 키 등 민감 정보)
  const envLines = [];
  if (figmaKey) envLines.push(`FIGMA_API_KEY=${figmaKey}`);
  if (notionKey) envLines.push(`NOTION_API_KEY=${notionKey}`);
  if (notionDbId) envLines.push(`NOTION_DB_ID=${notionDbId}`);
  if (notionFilter) envLines.push(`NOTION_FILTER=${notionFilter}`);
  if (provider) envLines.push(`SLEEPCODE_PROVIDER=${provider}`);
  if (envLines.length > 0) {
    writeFile(path.join(scDir, '.env'), envLines.join('\n') + '\n');
  }

  // .gitignore — 런타임/민감 정보는 무시하고 task_done 로그는 추적
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    fs.writeFileSync(gitignorePath, ensureSleepcodeGitignoreContent(gitignore));
  } else {
    fs.writeFileSync(gitignorePath, ensureSleepcodeGitignoreContent(''));
  }

  // .gitattributes — 병렬 브랜치 머지 시 task_queue/task_done 충돌 완화
  const gitattributesPath = path.join(targetDir, '.gitattributes');
  const mergeRules = [
    '.sleepcode/task_queue.md -text merge=union',
    '.sleepcode/task_done/*.md -text merge=union',
  ];
  if (fs.existsSync(gitattributesPath)) {
    let attrs = fs.readFileSync(gitattributesPath, 'utf-8');
    const missing = mergeRules.filter(rule => !attrs.includes(rule));
    if (missing.length > 0) {
      if (!attrs.endsWith('\n')) attrs += '\n';
      attrs += '\n# sleepcode merge rules\n' + missing.join('\n') + '\n';
      fs.writeFileSync(gitattributesPath, attrs);
    }
  } else {
    fs.writeFileSync(
      gitattributesPath,
      '# sleepcode merge rules\n' + mergeRules.join('\n') + '\n'
    );
  }

  // CLAUDE.md 생성 (base_rules + rules → 프로젝트 루트 CLAUDE.md)
  syncClaudeMd(targetDir);
}

function printResult(notionDbId) {
  const workerScript = IS_WIN ? 'ai_worker.ps1' : 'ai_worker.sh';

  console.log(`\n${C.bold}파일 생성 완료:${C.reset}\n`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/rules.md          ${C.dim}← 수정하세요${C.reset}`);
  if (notionDbId) {
    console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/notion_sync.py`);
  }
  console.log(`  ${C.green}✓${C.reset} .sleepcode/docs/             ${C.dim}← 참고자료 파일 추가${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/base_rules.md`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/${workerScript}`);
  if (IS_WIN) {
    console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/encoding_bootstrap.ps1`);
  }
  console.log(`  ${C.green}✓${C.reset} .sleepcode/scripts/log_filter.py`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/task_done/main.md   ${C.dim}← 완료 로그(append-only)${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/runtime/           ${C.dim}← 실행 산출물 (logs, worktrees 등)${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} .sleepcode/README.md`);
  console.log(`  ${C.green}✓${C.reset} .claude/settings.local.json`);
  console.log(`  ${C.green}✓${C.reset} CLAUDE.md                    ${C.dim}← 프롬프트 캐싱 (자동 생성)${C.reset}`);

  const taskStep = `${C.bold}3.${C.reset} Notion DB에 할 일을 작성해두세요 (실행 시 자동 동기화)`;

  console.log(`
${C.bold}${C.green}완료!${C.reset} 다음 단계:

  ${C.bold}1.${C.reset} .sleepcode/rules.md 를 프로젝트에 맞게 수정
  ${C.bold}2.${C.reset} 참고 자료 추가:
     ${C.dim}• .sleepcode/docs/ 에 기획서, 스크린샷 등 파일 추가${C.reset}
  ${taskStep}
  ${C.bold}4.${C.reset} 실행:
     ${C.cyan}npx sleepcode run${C.reset}          ${C.dim}# 1회 실행${C.reset}
`);
}

module.exports = {
  buildClaudeMdContent,
  ensureSleepcodeGitignoreContent,
  syncClaudeMd,
  generateFiles,
  printResult,
};

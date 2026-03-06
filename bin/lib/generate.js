const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { C } = require('./constants');
const { resolveProviderPlan, providerLabel, runPromptForTaskGeneration } = require('./provider');
const { loadSources, fetchSourceContents } = require('./sources');

function generateTasks(cliProvider) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  let providerPlan;
  try {
    providerPlan = resolveProviderPlan(targetDir, cliProvider);
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}`);
    process.exit(1);
  }
  if (providerPlan.requestedUnavailable) {
    console.log(`${C.yellow}요청한 provider를 찾지 못해 ${providerLabel(providerPlan.selected)}로 전환합니다.${C.reset}`);
  }

  // sources.json 상태 표시
  const sources = loadSources(targetDir);
  if (sources) {
    const n = (sources.notion || []).length;
    const f = (sources.figma || []).length;
    const u = (sources.urls || []).length;
    const total = n + f + u;
    if (total > 0) {
      console.log(`${C.dim}참고자료: Notion ${n}개, Figma ${f}개, URL ${u}개 (sources.json)${C.reset}`);
    }
  }

  console.log(`${C.cyan}태스크 자동 생성 중...${C.reset}\n`);

  // 참고 자료 수집
  const parts = [];

  // 1. base_rules.md (프로젝트 공통 규칙 — 역할 파악용)
  const baseRulesPath = path.join(scDir, 'scripts', 'base_rules.md');
  if (fs.existsSync(baseRulesPath)) {
    parts.push(fs.readFileSync(baseRulesPath, 'utf-8'));
  }

  // 2. rules.md (프로젝트별 역할/작업방식)
  const rulesPath = path.join(scDir, 'rules.md');
  if (fs.existsSync(rulesPath)) {
    parts.push(fs.readFileSync(rulesPath, 'utf-8'));
  }

  // 3. docs/ 디렉토리 파일 목록 + 내용
  const docsDir = path.join(scDir, 'docs');
  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).filter(f => f !== '.gitkeep');
    for (const file of files) {
      const filePath = path.join(docsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.size < 100000) {
        // 텍스트 파일만 읽기 (이미지 등은 파일명만)
        const ext = path.extname(file).toLowerCase();
        if (['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.html'].includes(ext)) {
          parts.push(`--- docs/${file} ---\n${fs.readFileSync(filePath, 'utf-8')}`);
        } else {
          parts.push(`--- docs/${file} --- (파일 존재, 내용은 직접 참고)`);
        }
      }
    }
  }

  // 4. 현재 프로젝트 구조 (이미 구현된 것 파악용)
  try {
    const tree = execSync('git ls-files', { cwd: targetDir, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 })
      .toString().trim();
    if (tree) {
      parts.push(`--- 현재 프로젝트 파일 목록 (이미 구현됨) ---\n${tree}`);
    }
  } catch {
    // git이 없거나 실패하면 무시
  }

  // 5. sources.json (참고자료 URL)
  const sourceContents = fetchSourceContents(targetDir);
  if (sourceContents) {
    parts.push(sourceContents);
  }

  // 6. 기존 tasks.md (있으면 참고)
  const tasksPath = path.join(scDir, 'tasks.md');
  if (fs.existsSync(tasksPath)) {
    const existing = fs.readFileSync(tasksPath, 'utf-8');
    if (existing.includes('[ ]') || existing.includes('[x]')) {
      parts.push(`--- 기존 tasks.md ---\n${existing}`);
    }
  }

  // 프롬프트 구성
  const context = parts.join('\n\n---\n\n');
  const prompt = `${context}

---

위 프로젝트 정보와 참고 자료를 바탕으로 .sleepcode/tasks.md 파일을 생성해주세요.

규칙:
- 마크다운 체크리스트 형식으로 작성: \`- [ ] 태스크 내용\`
- 구체적이고 실행 가능한 단위로 태스크를 나눌 것
- 태스크 순서는 의존성을 고려하여 배치
- Figma 디자인 URL이 있으면 Figma MCP 도구로 디자인을 조회하여 UI 구현 태스크 포함
- Notion 페이지 URL이 있으면 Notion MCP 도구로 페이지를 조회하여 기획 내용을 반영
- 참고 URL이 있으면 WebFetch 도구로 내용을 가져와 반영
- docs/ 폴더의 참고 자료를 반영
- **이미 프로젝트에 구현되어 있는 기능은 태스크에 포함하지 않는다**
- 현재 프로젝트 파일 목록을 분석하여 아직 구현되지 않은 것만 태스크로 작성
- 첫 줄은 \`# 작업 목록\` 으로 시작
- 태스크 목록 앞에 간단한 안내 문구 포함

tasks.md 내용만 출력하세요. 다른 설명은 하지 마세요.`;

  // claude 중첩 세션 방지: CLAUDECODE 환경변수 제거
  const env = { ...process.env };
  delete env.CLAUDECODE;

  try {
    let result;
    try {
      result = runPromptForTaskGeneration(providerPlan.selected, prompt, targetDir, env);
    } catch (primaryError) {
      if (providerPlan.fallback) {
        console.log(`${C.yellow}${providerLabel(providerPlan.selected)} 실패, ${providerLabel(providerPlan.fallback)}로 재시도합니다.${C.reset}`);
        result = runPromptForTaskGeneration(providerPlan.fallback, prompt, targetDir, env);
      } else {
        throw primaryError;
      }
    }

    // tasks.md에 저장
    fs.writeFileSync(tasksPath, result + '\n');
    console.log(`${C.green}✓${C.reset} .sleepcode/tasks.md 생성 완료\n`);
    console.log(`${C.dim}${result}${C.reset}\n`);
    console.log(`필요하면 tasks.md를 직접 수정한 뒤 실행하세요:`);
    console.log(`  ${C.cyan}npx sleepcode run${C.reset}          ${C.dim}# 1회 실행${C.reset}`);
    console.log(`  ${C.cyan}npx sleepcode run --loop${C.reset}   ${C.dim}# 무한 루프${C.reset}`);
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.error(`${C.red}태스크 생성 실패:${C.reset}`);
    if (stderr) console.error(stderr);
    else console.error(e.message);
    process.exit(1);
  }
}

module.exports = {
  generateTasks,
};

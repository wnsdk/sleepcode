const fs = require('fs');
const path = require('path');
const { C } = require('./constants');

function loadSources(targetDir) {
  const sourcesPath = path.join(targetDir, '.sleepcode', 'sources.json');
  if (!fs.existsSync(sourcesPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
  } catch {
    return null;
  }
}

function createDefaultSources(targetDir) {
  const sourcesPath = path.join(targetDir, '.sleepcode', 'sources.json');
  const defaultSources = {
    "$schema": "참고자료 URL 관리 파일 — generate 명령에서 자동으로 읽어 tasks.md 생성에 활용됩니다.",
    notion: [],
    figma: [],
    urls: [],
  };
  fs.mkdirSync(path.dirname(sourcesPath), { recursive: true });
  fs.writeFileSync(sourcesPath, JSON.stringify(defaultSources, null, 2) + '\n');
  return defaultSources;
}

function fetchSourceContents(targetDir) {
  const sources = loadSources(targetDir);
  if (!sources) return '';

  const parts = [];

  // Notion 페이지 내용 가져오기 (claude CLI로 MCP 호출)
  if (sources.notion && sources.notion.length > 0) {
    parts.push('--- 참고 Notion 페이지 ---');
    for (const entry of sources.notion) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const label = (typeof entry === 'object' && entry.label) ? entry.label : url;
      if (!url) continue;
      parts.push(`\n[Notion: ${label}]\nURL: ${url}\n(AI가 Notion MCP 도구로 이 페이지를 직접 조회하여 참고하세요)`);
    }
  }

  // Figma 파일 참고
  if (sources.figma && sources.figma.length > 0) {
    parts.push('\n--- 참고 Figma 디자인 ---');
    for (const entry of sources.figma) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const label = (typeof entry === 'object' && entry.label) ? entry.label : url;
      if (!url) continue;
      parts.push(`\n[Figma: ${label}]\nURL: ${url}\n(AI가 Figma MCP 도구로 이 디자인을 직접 조회하여 참고하세요)`);
    }
  }

  // 일반 URL 참고
  if (sources.urls && sources.urls.length > 0) {
    parts.push('\n--- 참고 URL ---');
    for (const entry of sources.urls) {
      const url = typeof entry === 'string' ? entry : entry.url;
      const label = (typeof entry === 'object' && entry.label) ? entry.label : url;
      if (!url) continue;
      parts.push(`\n[참고: ${label}]\nURL: ${url}`);
    }
  }

  return parts.join('\n');
}

function showSources() {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  const sourcesPath = path.join(scDir, 'sources.json');
  let sources = loadSources(targetDir);

  if (!sources) {
    sources = createDefaultSources(targetDir);
    console.log(`${C.green}✓${C.reset} .sleepcode/sources.json 생성됨\n`);
  }

  const notionCount = (sources.notion || []).length;
  const figmaCount = (sources.figma || []).length;
  const urlCount = (sources.urls || []).length;
  const total = notionCount + figmaCount + urlCount;

  console.log(`\n${C.bold}참고자료 현황${C.reset} — ${sourcesPath}\n`);

  if (total === 0) {
    console.log(`  ${C.dim}(등록된 참고자료가 없습니다)${C.reset}\n`);
  } else {
    if (notionCount > 0) {
      console.log(`  ${C.cyan}Notion${C.reset} (${notionCount}개):`);
      for (const entry of sources.notion) {
        const url = typeof entry === 'string' ? entry : entry.url;
        const label = (typeof entry === 'object' && entry.label) ? entry.label : '';
        console.log(`    ${label ? `${label}: ` : ''}${C.dim}${url}${C.reset}`);
      }
    }
    if (figmaCount > 0) {
      console.log(`  ${C.magenta}Figma${C.reset} (${figmaCount}개):`);
      for (const entry of sources.figma) {
        const url = typeof entry === 'string' ? entry : entry.url;
        const label = (typeof entry === 'object' && entry.label) ? entry.label : '';
        console.log(`    ${label ? `${label}: ` : ''}${C.dim}${url}${C.reset}`);
      }
    }
    if (urlCount > 0) {
      console.log(`  ${C.green}URL${C.reset} (${urlCount}개):`);
      for (const entry of sources.urls) {
        const url = typeof entry === 'string' ? entry : entry.url;
        const label = (typeof entry === 'object' && entry.label) ? entry.label : '';
        console.log(`    ${label ? `${label}: ` : ''}${C.dim}${url}${C.reset}`);
      }
    }
  }

  console.log(`
${C.bold}사용법:${C.reset}

  ${C.dim}sources.json을 직접 편집하여 참고자료를 추가하세요:${C.reset}

  ${C.cyan}${sourcesPath}${C.reset}

  ${C.dim}예시:${C.reset}
  {
    "notion": [
      { "url": "https://www.notion.so/...", "label": "기획서" },
      { "url": "https://www.notion.so/...", "label": "API 명세" }
    ],
    "figma": [
      { "url": "https://www.figma.com/file/...", "label": "홈 화면" }
    ],
    "urls": [
      { "url": "https://api-docs.example.com", "label": "외부 API 문서" }
    ]
  }

  ${C.dim}등록 후:${C.reset}
  ${C.cyan}npx sleepcode generate${C.reset}   ${C.dim}# sources.json + docs/ 기반으로 tasks.md 자동 생성${C.reset}
`);
}

module.exports = {
  loadSources,
  createDefaultSources,
  fetchSourceContents,
  showSources,
};

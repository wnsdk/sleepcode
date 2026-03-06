const path = require('path');

// ─── 색상 ───
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  bgMagenta: '\x1b[45m',
  brightWhite: '\x1b[97m',
};

/** 브랜치/워커명에 대해 고유한 색상 코드를 반환 */
const BRANCH_COLORS = [
  '\x1b[36m',   // cyan
  '\x1b[33m',   // yellow
  '\x1b[35m',   // magenta
  '\x1b[32m',   // green
  '\x1b[34m',   // blue
  '\x1b[91m',   // bright red
  '\x1b[96m',   // bright cyan
  '\x1b[93m',   // bright yellow
  '\x1b[95m',   // bright magenta
  '\x1b[92m',   // bright green
];
const _branchColorCache = {};
function branchColor(name) {
  if (!name || name === 'SYSTEM') return C.dim;
  if (_branchColorCache[name]) return _branchColorCache[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const color = BRANCH_COLORS[Math.abs(hash) % BRANCH_COLORS.length];
  _branchColorCache[name] = color;
  return color;
}

// sleepcode 뱃지 (pill 형태: 반블록 + 마젠타 배경 + 흰색 볼드)
const SLEEPCODE_BADGE = `${C.magenta}▐${C.bgMagenta}${C.brightWhite}${C.bold} sleepcode ${C.reset}${C.magenta}▌${C.reset}`;

/** Notion DB 링크 (OSC 8 터미널 하이퍼링크) — DB ID가 없으면 빈 문자열 */
function notionLink(dbId) {
  if (!dbId) return '';
  const url = `https://notion.so/${dbId.replace(/-/g, '')}`;
  return `  \x1b]8;;${url}\x07${C.dim}[Notion]${C.reset}\x1b]8;;\x07`;
}

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');
const IS_WIN = process.platform === 'win32';

// Windows에서 Python 서브프로세스 한글 깨짐 방지
if (IS_WIN) {
  process.env.PYTHONUTF8 = '1';
  process.env.PYTHONIOENCODING = 'utf-8';
}

const PROVIDERS = {
  CLAUDE: 'claude',
  CODEX: 'codex',
  AUTO: 'auto',
};

// ─── 프로젝트 타입 정의 ───
const PROJECT_TYPES = {
  'spring-boot': {
    label: 'Spring Boot (Kotlin/Java)',
    buildCmd: './gradlew build -x test --no-daemon',
    testCmd: './gradlew test --no-daemon',
    lintCmd: '',
  },
  'react-native': {
    label: 'React Native (TypeScript)',
    buildCmd: '',
    testCmd: '',
    lintCmd: 'npx tsc --noEmit',
  },
  nextjs: {
    label: 'Next.js (TypeScript)',
    buildCmd: 'npm run build',
    testCmd: 'npm test',
    lintCmd: 'npx next lint',
  },
  godot: {
    label: 'Godot 4 (GDScript)',
    buildCmd: 'godot --headless --check-only --script res://project.godot 2>&1 || true',
    testCmd: '',
    lintCmd: '',
  },
  custom: {
    label: 'Custom (직접 설정)',
    buildCmd: '',
    testCmd: '',
    lintCmd: '',
  },
};

module.exports = {
  C,
  BRANCH_COLORS,
  branchColor,
  SLEEPCODE_BADGE,
  notionLink,
  TEMPLATES_DIR,
  IS_WIN,
  PROVIDERS,
  PROJECT_TYPES,
};

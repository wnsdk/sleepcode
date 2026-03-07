# AI 템플릿 규칙

## 목적

Vite + React (JavaScript/TypeScript) 기반 프론트엔드 템플릿을 생성하는 가이드.

역할: {{ROLE}}

---

## 템플릿 실행 규칙

- {{BUILD_CMD}}를 통해 Vite 빌드가 정상 종료되는지 확인한다.
- {{LINT_CMD}}를 실행하여 ESLint/Prettier 혹은 설정된 린터가 모두 통과하는지 점검한다.
- {{TEST_CMD}}를 실행해 유닛 테스트 혹은 smoke 테스트가 실패하지 않도록 한다.
- FIR 단계에서는 `npm install`/`yarn install`로 의존성을 업데이트하고 `node_modules` 제거 없이 캐시를 유지한다.
- `src/` 또는 주요 디렉터리에 진입할 때 상대 경로 대신 `@/` alias를 적극 활용하여 유지보수성을 높인다.

---

## 핵심 체크포인트

- React 컴포넌트는 React Hooks 규칙을 지키며 가능한 한 작은 단위로 나눈다.
- `vite.config.js`/`.ts`에서 필요한 플러그 (예: `@vitejs/plugin-react`, alias)가 정의되어 있어야 한다.
- `index.html`이나 entry point에서 글로벌 상태/스타일이 명확히 구성되어 있어야 한다.
- TypeScript 사용 시 strict 옵션을 유지하고 `any` 사용을 최소화한다.
- `src/assets`, `src/components`, `src/hooks` 등 관례적인 폴더 구조를 따른다.

---

## 추가 고려사항

- 개발 서버에서 HMR이 정상 동작하는지 확인하고, Vite의 모듈 캐시가 필요한 경우 `optimizeDeps`를 설정한다.
- `package.json` scripts에 `dev`, `build`, `preview`, `lint`, `test` 등이 목적에 맞게 준비되어 있어야 한다.
- 환경 변수는 `.env*` 파일과 `import.meta.env`를 통해 안전하게 처리한다.
- 디자인 시스템이나 UI 라이브러리(예: Radix UI, MUI)를 사용하는 경우 테마/스타일 통합 지침을 남긴다.
- Lighthouse 등 기본 성능/접근성 점검을 위해 폴더에 간단한 체크리스트를 첨부할 수 있다.

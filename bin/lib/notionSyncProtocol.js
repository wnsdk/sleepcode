/**
 * Python-JS 인터페이스 계약.
 * Python notion_sync.py와 JS notionSyncBridge.js가 공유하는 상수.
 * 커맨드명, 타임아웃, 스키마 속성 키를 한 곳에 정의한다.
 */

// Python CLI 커맨드 정의
const SYNC_COMMANDS = {
  POLL: { name: 'poll', timeoutMs: 30000 },
  UPDATE_PAGE: { name: 'update-page', timeoutMs: 15000 },
  APPEND_CONTENT: { name: 'append-content', timeoutMs: 60000 },
};

// Python poll 응답에서 반환하는 스키마 속성 키
const SCHEMA_KEYS = {
  TITLE_PROP: 'title_prop',
  STATUS_PROP: 'status_prop',
  STATUS_TYPE: 'status_type',
  WORKER_PROP: 'worker_prop',
  RUN_PROP: 'run_prop',
  PRIORITY_PROP: 'priority_prop',
  LOG_PROP: 'log_prop',
  MODEL_PROP: 'model_prop',
  MODEL_TYPE: 'model_type',
  COST_PROP: 'cost_prop',
  TOKENS_PROP: 'tokens_prop',
  COMPLETED_AT_PROP: 'completed_at_prop',
};

// Python 스크립트 상대 경로
const SYNC_SCRIPT_REL_PATH = '.sleepcode/scripts/notion_sync.py';
const SYNC_TEMPLATE_REL_PATH = 'common/notion_sync.py';

module.exports = {
  SCHEMA_KEYS,
  SYNC_COMMANDS,
  SYNC_SCRIPT_REL_PATH,
  SYNC_TEMPLATE_REL_PATH,
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isRuntimeOnlyStatusLine,
  parseParallelTasks,
} = require('../bin/lib/parallelWorktrees');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('isRuntimeOnlyStatusLine filters runtime-only git status entries', () => {
  assert.equal(isRuntimeOnlyStatusLine('?? .sleepcode/runtime/logs/worker.log'), true);
  assert.equal(isRuntimeOnlyStatusLine(' M src/app.js'), false);
});

test('parseParallelTasks extracts worker sections and remaining counts', () => {
  withTempDir('sleepcode-parallel-', (dir) => {
    const tasksPath = path.join(dir, 'task_queue.md');
    fs.writeFileSync(
      tasksPath,
      [
        '# 작업 목록',
        '',
        '## @worker feature-auth',
        '- [ ] 로그인 화면 구현',
        '- [x] 회원가입 API 연동',
        '',
        '## @worker bugfix',
        '- [ ] 버그 수정',
        '',
      ].join('\n')
    );

    assert.deepEqual(parseParallelTasks(tasksPath), [
      {
        name: 'feature-auth',
        tasks: '# 작업 목록\n\n## @worker feature-auth\n- [ ] 로그인 화면 구현\n- [x] 회원가입 API 연동\n',
        remaining: 1,
      },
      {
        name: 'bugfix',
        tasks: '# 작업 목록\n\n## @worker bugfix\n- [ ] 버그 수정\n',
        remaining: 1,
      },
    ]);
  });
});

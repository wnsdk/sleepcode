const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildTaskKey } = require('../bin/lib/utils');
const {
  getPersistedTaskProgress,
  syncWorkerTaskProgress,
} = require('../bin/lib/taskState');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('getPersistedTaskProgress counts persisted done logs', () => {
  withTempDir('sleepcode-taskstate-', (dir) => {
    const tasksPath = path.join(dir, '.sleepcode', 'task_queue.md');
    const doneFilePath = path.join(dir, '.sleepcode', 'task_done', 'main.md');

    fs.mkdirSync(path.dirname(doneFilePath), { recursive: true });
    fs.writeFileSync(
      tasksPath,
      [
        '# 작업 목록',
        '',
        '- [ ] 로그인 화면 구현',
        '- [ ] 결제 API 연결',
        '',
      ].join('\n')
    );
    fs.writeFileSync(doneFilePath, '# 완료 기록\n\n- [x] 로그인 화면 구현\n');

    const progress = getPersistedTaskProgress(dir, tasksPath, doneFilePath);

    assert.equal(progress.counts.done, 1);
    assert.equal(progress.counts.total, 2);
  });
});

test('syncWorkerTaskProgress counts only current-run completions beyond the baseline', () => {
  withTempDir('sleepcode-taskstate-', (dir) => {
    const tasksPath = path.join(dir, '.sleepcode', 'task_queue.md');
    const doneFilePath = path.join(dir, '.sleepcode', 'task_done', 'main.md');

    fs.mkdirSync(path.dirname(doneFilePath), { recursive: true });
    fs.writeFileSync(
      tasksPath,
      [
        '# 작업 목록',
        '',
        '- [ ] 로그인 화면 구현',
        '- [ ] 결제 API 연결',
        '',
      ].join('\n')
    );
    fs.writeFileSync(doneFilePath, '# 완료 기록\n\n- [x] 로그인 화면 구현\n');

    const ws = {
      path: dir,
      tasksPath,
      doneFilePath,
      completedTaskKeys: new Set([buildTaskKey('결제 API 연결', null)]),
    };

    syncWorkerTaskProgress(ws);

    assert.equal(ws.done, 1);
    assert.equal(ws.total, 2);
  });
});

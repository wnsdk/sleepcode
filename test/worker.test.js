const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildTaskKey } = require('../bin/lib/utils');
const { buildTaskCommitMessage, _internals } = require('../bin/lib/worker');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function createRepo(dir) {
  git(dir, ['init']);
  git(dir, ['config', 'user.name', 'SleepCode Test']);
  git(dir, ['config', 'user.email', 'sleepcode@example.com']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  git(dir, ['add', '--', 'README.md']);
  git(dir, ['commit', '-m', 'chore: init']);
}

test('buildTaskCommitMessage normalizes polite Korean task titles', () => {
  const taskEntry = { title: '리팩토링 정리해줘' };
  assert.equal(buildTaskCommitMessage(taskEntry), 'refactor: 리팩토링 정리');
});

test('commitTaskNow includes task_done entries in the same commit', () => {
  withTempDir('sleepcode-worker-', (dir) => {
    createRepo(dir);

    const filePath = path.join(dir, 'src.txt');
    fs.writeFileSync(filePath, 'hello\n');
    git(dir, ['add', '--', 'src.txt']);
    git(dir, ['commit', '-m', 'feat: add src']);

    fs.writeFileSync(filePath, 'hello world\n');

    const startHead = git(dir, ['rev-parse', 'HEAD']);
    const doneFilePath = path.join(dir, '.sleepcode', 'task_done', 'feature.md');
    const taskEntry = {
      title: '리팩토링 정리',
      key: buildTaskKey('리팩토링 정리', null),
    };

    const result = _internals.commitTaskNow(dir, taskEntry, startHead, {
      doneFilePath,
      dedupeSet: new Set(),
    });

    assert.equal(result.committed, true);
    const changedFiles = git(dir, ['show', '--name-only', '--format=', 'HEAD']);
    assert.match(changedFiles, /src\.txt/);
    assert.match(changedFiles, /\.sleepcode\/task_done\/feature\.md/);

    const doneContent = git(dir, ['show', 'HEAD:.sleepcode/task_done/feature.md']);
    assert.match(doneContent, /- \[x\] 리팩토링 정리/);
  });
});

test('commitTaskNow rolls back task_done changes when staging the done file fails', () => {
  withTempDir('sleepcode-worker-', (dir) => {
    createRepo(dir);

    const filePath = path.join(dir, 'src.txt');
    fs.writeFileSync(filePath, 'draft\n');

    const startHead = git(dir, ['rev-parse', 'HEAD']);
    const outsideDoneFilePath = path.join(path.dirname(dir), 'sleepcode-outside-done.md');
    const taskEntry = {
      title: '외부 파일 테스트',
      key: buildTaskKey('외부 파일 테스트', null),
    };

    const result = _internals.commitTaskNow(dir, taskEntry, startHead, {
      doneFilePath: outsideDoneFilePath,
      dedupeSet: new Set(),
    });

    assert.equal(result.committed, false);
    assert.equal(result.reason, 'task_done_stage_failed');
    assert.equal(fs.existsSync(outsideDoneFilePath), false);
    const status = git(dir, ['status', '--short']);
    assert.doesNotMatch(status, /sleepcode-outside-done\.md/);
  });
});

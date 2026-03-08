const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildTaskKey,
  countTasks,
  extractTaskItems,
  readTaskDoneSet,
  readCurrentRunTaskDoneSet,
} = require('../bin/lib/utils');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('extractTaskItems ignores code blocks and parses notion tags', () => {
  const content = [
    '# 작업 목록',
    '',
    '- [ ] 첫 번째 태스크',
    '```md',
    '- [ ] 코드블록 안 태스크',
    '```',
    '- [x] 두 번째 태스크 <!-- notion:ABCDEF12-3456-7890-abcd-ef1234567890 -->',
    '',
  ].join('\n');

  const items = extractTaskItems(content);

  assert.deepEqual(
    items.map(({ title, checked, notionId }) => ({ title, checked, notionId })),
    [
      { title: '첫 번째 태스크', checked: false, notionId: null },
      { title: '두 번째 태스크', checked: true, notionId: 'abcdef12-3456-7890-abcd-ef1234567890' },
    ]
  );
});

test('countTasks treats doneSet entries as completed work', () => {
  const content = [
    '# 작업 목록',
    '',
    '- [ ] 이미 끝난 일',
    '- [ ] 남은 일',
    '',
  ].join('\n');

  const doneSet = new Set([buildTaskKey('이미 끝난 일', null)]);

  assert.deepEqual(countTasks(content, doneSet), { done: 1, total: 2 });
});

test('readCurrentRunTaskDoneSet excludes baseline entries and includes runtime additions', () => {
  withTempDir('sleepcode-utils-', (dir) => {
    const doneFilePath = path.join(dir, '.sleepcode', 'task_done', 'main.md');
    fs.mkdirSync(path.dirname(doneFilePath), { recursive: true });
    fs.writeFileSync(
      doneFilePath,
      [
        '# 완료 기록',
        '',
        '- [x] 예전 완료 태스크',
        '- [x] 이번 런 완료 <!-- notion:12345678-1234-1234-1234-1234567890ab -->',
        '',
      ].join('\n')
    );

    const baseline = new Set([buildTaskKey('예전 완료 태스크', null)]);
    const runtimeOnly = new Set([buildTaskKey('메모리 완료 태스크', null)]);
    const state = readCurrentRunTaskDoneSet(dir, doneFilePath, baseline, runtimeOnly);

    assert.deepEqual(
      [...state.doneSet].sort(),
      [
        buildTaskKey('이번 런 완료', '12345678-1234-1234-1234-1234567890ab'),
        buildTaskKey('메모리 완료 태스크', null),
      ].sort()
    );
    assert.deepEqual(
      [...state.allDoneSet].sort(),
      [
        buildTaskKey('예전 완료 태스크', null),
        buildTaskKey('이번 런 완료', '12345678-1234-1234-1234-1234567890ab'),
      ].sort()
    );
  });
});

test('readTaskDoneSet aggregates merged branch logs across task_done files', () => {
  withTempDir('sleepcode-utils-', (dir) => {
    const doneDir = path.join(dir, '.sleepcode', 'task_done');
    const featureDoneFilePath = path.join(doneDir, 'sleepcode_feature-a.md');
    const targetDoneFilePath = path.join(doneDir, 'sleepcode_feature-b.md');

    fs.mkdirSync(doneDir, { recursive: true });
    fs.writeFileSync(path.join(doneDir, 'main.md'), '# 완료 기록\n\n- [x] 메인 완료 태스크\n');
    fs.writeFileSync(featureDoneFilePath, '# 완료 기록\n\n- [x] 워커 완료 태스크\n');

    const state = readTaskDoneSet(dir, targetDoneFilePath);

    assert.equal(state.doneFilePath, targetDoneFilePath);
    assert.deepEqual(
      [...state.doneSet].sort(),
      [
        buildTaskKey('메인 완료 태스크', null),
        buildTaskKey('워커 완료 태스크', null),
      ].sort()
    );
  });
});

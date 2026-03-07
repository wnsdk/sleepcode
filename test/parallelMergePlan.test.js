const test = require('node:test');
const assert = require('node:assert/strict');

const {
  doesBranchExist,
  hasBranchDiff,
  planParallelMerges,
  runParallelMergePlan,
} = require('../bin/lib/parallelMergePlan');

test('doesBranchExist returns true only when git verification succeeds', () => {
  const seen = [];
  const exists = doesBranchExist('C:\\workspace\\sleepcode', 'sleepcode/feature-a', (command) => {
    seen.push(command);
    return Buffer.from('');
  });
  const missing = doesBranchExist('C:\\workspace\\sleepcode', 'sleepcode/missing', (command) => {
    seen.push(command);
    throw new Error('missing');
  });

  assert.equal(exists, true);
  assert.equal(missing, false);
  assert.match(seen[0], /git rev-parse --verify "sleepcode\/feature-a"/);
});

test('hasBranchDiff returns true only when the branch has commits ahead of the current branch', () => {
  const withDiff = hasBranchDiff('C:\\workspace\\sleepcode', 'main', 'sleepcode/feature-a', () => Buffer.from('abc123 task'));
  const withoutDiff = hasBranchDiff('C:\\workspace\\sleepcode', 'main', 'sleepcode/feature-b', () => Buffer.from(''));
  const failed = hasBranchDiff('C:\\workspace\\sleepcode', 'main', 'sleepcode/feature-c', () => {
    throw new Error('git failed');
  });

  assert.equal(withDiff, true);
  assert.equal(withoutDiff, false);
  assert.equal(failed, false);
});

test('planParallelMerges classifies current, missing, unchanged, and mergeable branches', () => {
  const commands = [];
  const plan = planParallelMerges({
    targetDir: 'C:\\workspace\\sleepcode',
    currentBranch: 'main',
    workers: [
      { name: 'main' },
      { name: 'feature-missing' },
      { name: 'feature-no-change' },
      { name: 'feature-ready' },
      { name: 'custom', branch: 'feature/custom-branch' },
    ],
    execSyncFn: (command) => {
      commands.push(command);
      if (command.includes('feature-missing')) throw new Error('missing');
      if (command.includes('feature-no-change') && command.includes('git log')) return Buffer.from('');
      return Buffer.from('abc123 task');
    },
  });

  assert.deepEqual(plan, [
    { action: 'skip', branch: 'sleepcode/main', name: 'main', reason: 'current_branch' },
    { action: 'skip', branch: 'sleepcode/feature-missing', name: 'feature-missing', reason: 'missing_branch' },
    { action: 'skip', branch: 'sleepcode/feature-no-change', name: 'feature-no-change', reason: 'no_changes' },
    { action: 'merge', branch: 'sleepcode/feature-ready', name: 'feature-ready' },
    { action: 'merge', branch: 'feature/custom-branch', name: 'custom' },
  ]);
  assert.ok(commands.some((command) => command.includes('git rev-parse --verify "sleepcode/feature-ready"')));
  assert.ok(commands.some((command) => command.includes('git log "main..sleepcode/feature-ready" --oneline')));
});

test('runParallelMergePlan preserves skipped items and delegates merge attempts', () => {
  const mergeCalls = [];
  const results = runParallelMergePlan({
    targetDir: 'C:\\workspace\\sleepcode',
    currentBranch: 'main',
    mergePlan: [
      { action: 'skip', branch: 'sleepcode/main', name: 'main', reason: 'current_branch' },
      { action: 'merge', branch: 'sleepcode/feature-a', name: 'feature-a' },
      { action: 'merge', branch: 'sleepcode/feature-b', name: 'feature-b' },
    ],
    cliProvider: 'codex',
    attemptMergeBranchFn: (...args) => {
      mergeCalls.push(args);
      return args[2].endsWith('feature-a')
        ? { status: 'merged', autoResolved: false }
        : { status: 'conflicted', reason: 'merge_failed' };
    },
  });

  assert.deepEqual(results, [
    { action: 'skip', branch: 'sleepcode/main', name: 'main', reason: 'current_branch', status: 'skipped' },
    { action: 'merge', branch: 'sleepcode/feature-a', name: 'feature-a', status: 'merged', autoResolved: false },
    { action: 'merge', branch: 'sleepcode/feature-b', name: 'feature-b', status: 'conflicted', reason: 'merge_failed' },
  ]);
  assert.deepEqual(mergeCalls, [
    ['C:\\workspace\\sleepcode', 'main', 'sleepcode/feature-a', 'codex'],
    ['C:\\workspace\\sleepcode', 'main', 'sleepcode/feature-b', 'codex'],
  ]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { PROVIDERS } = require('../bin/lib/constants');
const {
  assessTaskDifficulty,
} = require('../bin/lib/providerModels');

function createSpawnDouble({ exitCode = 0, stdoutText = '4\n' } = {}) {
  return () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = {
      written: '',
      write(chunk) {
        this.written += chunk;
      },
      end() {},
    };
    proc.kill = () => {
      proc.killed = true;
    };

    process.nextTick(() => {
      if (stdoutText) proc.stdout.emit('data', stdoutText);
      proc.emit('close', exitCode);
    });

    return proc;
  };
}

test('assessTaskDifficulty resolves asynchronously from claude output', async () => {
  const assessment = await assessTaskDifficulty('복잡한 작업', '/tmp/sleepcode', PROVIDERS.CLAUDE, {
    spawnFn: createSpawnDouble({ exitCode: 0, stdoutText: '4\n' }),
  });

  assert.equal(assessment.difficulty, 4);
  assert.equal(assessment.label, '★★★★☆');
  assert.equal(assessment.model, 'claude-opus-4-6');
});

test('assessTaskDifficulty falls back to medium on subprocess failure', async () => {
  const assessment = await assessTaskDifficulty('간단한 작업', '/tmp/sleepcode', PROVIDERS.CODEX, {
    spawnFn: createSpawnDouble({ exitCode: 1, stdoutText: '' }),
  });

  assert.equal(assessment.difficulty, 3);
  assert.equal(assessment.label, '★★★☆☆');
});

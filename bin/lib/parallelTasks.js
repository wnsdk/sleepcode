const fs = require('fs');

const { countTasks, extractTaskItems } = require('./utils');

const MAIN_WORKER_NAME = 'main';

function parseParallelTasks(tasksPath) {
  if (!fs.existsSync(tasksPath)) return null;
  const content = fs.readFileSync(tasksPath, 'utf-8');
  const lines = content.split('\n');

  const workers = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## @worker\s+(\S+)/);
    if (match) {
      current = { name: match[1], lines: [line] };
      workers.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (workers.length === 0) return null;

  return workers.map((worker) => {
    const joined = worker.lines.join('\n');
    const counts = countTasks(joined);
    return {
      name: worker.name,
      tasks: `# 작업 목록\n\n${joined}`,
      remaining: counts.total - counts.done,
    };
  });
}

function parseTaskQueueWorkers(tasksPath) {
  const workerSections = parseParallelTasks(tasksPath);
  if (workerSections) return workerSections;
  if (!fs.existsSync(tasksPath)) return null;

  const content = fs.readFileSync(tasksPath, 'utf-8');
  const items = extractTaskItems(content);
  if (items.length === 0) return null;

  const counts = countTasks(content);
  const lines = [`## @worker ${MAIN_WORKER_NAME}`];
  for (const task of items) {
    const notionTag = task.notionId ? ` <!-- notion:${task.notionId} -->` : '';
    lines.push(`- [${task.checked ? 'x' : ' '}] ${task.title}${notionTag}`);
  }
  lines.push('');

  return [{
    name: MAIN_WORKER_NAME,
    tasks: `# 작업 목록\n\n${lines.join('\n')}`,
    remaining: counts.total - counts.done,
  }];
}

module.exports = {
  MAIN_WORKER_NAME,
  parseParallelTasks,
  parseTaskQueueWorkers,
};

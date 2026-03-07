const fs = require('fs');
const path = require('path');

const {
  countTasks,
  readTaskDoneSet,
  readCurrentRunTaskDoneSet,
} = require('./utils');

function resolveWorkerTargetDir(ws, targetDir = null) {
  return targetDir || ws.path;
}

function resolveWorkerTasksPath(ws, targetDir = null) {
  const resolvedTargetDir = resolveWorkerTargetDir(ws, targetDir);
  return ws.tasksPath || path.join(resolvedTargetDir, '.sleepcode', 'task_queue.md');
}

function ensureWorkerDoneTracking(ws, targetDir = null) {
  const resolvedTargetDir = resolveWorkerTargetDir(ws, targetDir);
  const initialState = readTaskDoneSet(resolvedTargetDir, ws.doneFilePath);
  ws.doneFilePath = initialState.doneFilePath;
  if (!ws.initialDoneKeys) ws.initialDoneKeys = new Set(initialState.doneSet);
  if (!ws.completedTaskKeys) ws.completedTaskKeys = new Set();
}

function getWorkerDoneState(ws, targetDir = null) {
  const resolvedTargetDir = resolveWorkerTargetDir(ws, targetDir);
  ensureWorkerDoneTracking(ws, resolvedTargetDir);
  return readCurrentRunTaskDoneSet(
    resolvedTargetDir,
    ws.doneFilePath,
    ws.initialDoneKeys,
    ws.completedTaskKeys
  );
}

function getWorkerTaskProgress(ws, targetDir = null, content = null) {
  const tasksPath = resolveWorkerTasksPath(ws, targetDir);
  const resolvedContent = content != null
    ? content
    : (fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '');
  const doneState = getWorkerDoneState(ws, targetDir);
  const counts = countTasks(resolvedContent, doneState.doneSet);
  return {
    tasksPath,
    content: resolvedContent,
    doneState,
    counts,
  };
}

function getPersistedTaskProgress(targetDir, tasksPath, doneFilePath = null, content = null) {
  const resolvedTasksPath = tasksPath || path.join(targetDir, '.sleepcode', 'task_queue.md');
  const resolvedContent = content != null
    ? content
    : (fs.existsSync(resolvedTasksPath) ? fs.readFileSync(resolvedTasksPath, 'utf-8') : '');
  const doneState = readTaskDoneSet(targetDir, doneFilePath);
  const counts = countTasks(resolvedContent, doneState.doneSet);
  return {
    tasksPath: resolvedTasksPath,
    content: resolvedContent,
    doneState,
    counts,
  };
}

function syncWorkerTaskProgress(ws, targetDir = null, content = null) {
  const progress = getWorkerTaskProgress(ws, targetDir, content);
  ws.done = progress.counts.done;
  ws.total = progress.counts.total;
  return progress;
}

module.exports = {
  resolveWorkerTasksPath,
  ensureWorkerDoneTracking,
  getWorkerDoneState,
  getWorkerTaskProgress,
  getPersistedTaskProgress,
  syncWorkerTaskProgress,
};

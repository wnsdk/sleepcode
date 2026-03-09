const { C } = require('./constants');
const {
  handleTaskCompletedEvent,
  handleTaskStartedEvent,
  syncNextPendingTaskStatus,
} = require('./runNotionEvents');

function createRunNotionBindings({
  notionSync,
  getCurrentSchema,
  getCurrentNotionTasks,
  getNotionCompletedIds,
  notionInProgressIds,
  getWorkerDoneState,
  flushRender,
  pushLog,
  handleTaskCompletedEventFn = handleTaskCompletedEvent,
  handleTaskStartedEventFn = handleTaskStartedEvent,
  syncNextPendingTaskStatusFn = syncNextPendingTaskStatus,
}) {
  const poll = () => notionSync.poll();
  const updatePage = (pageId, props) => {
    const ok = notionSync.updatePage(pageId, props);
    if (!ok && typeof pushLog === 'function') {
      const error = (
        notionSync && typeof notionSync.getLastUpdateError === 'function'
          ? String(notionSync.getLastUpdateError() || '').trim()
          : ''
      );
      let propsDetail = '';
      try { propsDetail = JSON.stringify(props); } catch {}
      pushLog(`${C.yellow}⚠${C.reset} [Notion] 페이지 업데이트 실패: ${pageId}`);
      if (propsDetail) {
        pushLog(`${C.dim}  props: ${propsDetail}${C.reset}`);
      }
      if (error) {
        pushLog(`${C.dim}  error: ${error}${C.reset}`);
      }
    }
    return ok;
  };
  const appendContent = (pageId, text) => notionSync.appendContent(pageId, text);
  const getUpdateError = () => (
    notionSync && typeof notionSync.getLastUpdateError === 'function'
      ? notionSync.getLastUpdateError()
      : ''
  );

  return {
    appendContent,
    handleTaskCompleted(payload) {
      handleTaskCompletedEventFn({
        payload,
        schema: getCurrentSchema(),
        notionCompletedIds: getNotionCompletedIds(),
        appendContent,
        updatePage,
        getUpdateError,
        pushLog,
      });
    },
    handleTaskStarted(payload) {
      handleTaskStartedEventFn({
        payload,
        schema: getCurrentSchema(),
        updatePage,
        getUpdateError,
        pushLog,
      });
    },
    handleTaskUiUpdated() {
      flushRender();
    },
    poll,
    updateNextTaskStatus(workerPaths) {
      syncNextPendingTaskStatusFn({
        schema: getCurrentSchema(),
        tasks: getCurrentNotionTasks(),
        workerPaths,
        notionInProgressIds,
        updatePage,
        getWorkerDoneState,
      });
    },
    updatePage,
  };
}

module.exports = {
  createRunNotionBindings,
};

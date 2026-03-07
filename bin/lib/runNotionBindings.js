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
  const updatePage = (pageId, props) => notionSync.updatePage(pageId, props);
  const appendContent = (pageId, text) => notionSync.appendContent(pageId, text);

  return {
    appendContent,
    handleTaskCompleted(payload) {
      handleTaskCompletedEventFn({
        payload,
        schema: getCurrentSchema(),
        notionCompletedIds: getNotionCompletedIds(),
        updatePage,
        pushLog,
      });
    },
    handleTaskStarted(payload) {
      handleTaskStartedEventFn({
        payload,
        schema: getCurrentSchema(),
        updatePage,
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

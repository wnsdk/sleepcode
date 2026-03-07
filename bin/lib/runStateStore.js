function createRunStateStore() {
  const state = {
    currentNotionTasks: [],
    currentSchema: null,
    currentWorkerStates: [],
    execStartTime: null,
    executingTaskIds: new Set(),
    isExecuting: false,
    lastPollTime: null,
    notionCompletedIds: new Set(),
    notionInProgressIds: new Set(),
    pollInfo: { total: 0, pending: 0 },
    pollingController: null,
    watchPhase: 'waiting',
  };

  return {
    applyIdleState(idleState) {
      state.isExecuting = idleState.isExecuting;
      state.executingTaskIds = idleState.executingTaskIds;
      state.currentSchema = idleState.currentSchema;
      state.currentNotionTasks = idleState.currentNotionTasks;
      state.notionCompletedIds = idleState.notionCompletedIds;
      state.currentWorkerStates = idleState.currentWorkerStates;
      state.execStartTime = idleState.execStartTime;
    },
    applyRunState(nextState) {
      state.isExecuting = nextState.isExecuting;
      state.execStartTime = nextState.execStartTime;
      state.currentSchema = nextState.currentSchema;
      state.currentNotionTasks = nextState.currentNotionTasks;
      state.executingTaskIds = nextState.executingTaskIds;
    },
    getCurrentNotionTasks() {
      return state.currentNotionTasks;
    },
    getCurrentSchema() {
      return state.currentSchema;
    },
    getCurrentWorkerStates() {
      return state.currentWorkerStates;
    },
    getExecStartTime() {
      return state.execStartTime;
    },
    getExecutingTaskIds() {
      return state.executingTaskIds;
    },
    getIsExecuting() {
      return state.isExecuting;
    },
    getLastPollTime() {
      return state.lastPollTime;
    },
    getNotionCompletedIds() {
      return state.notionCompletedIds;
    },
    getNotionInProgressIds() {
      return state.notionInProgressIds;
    },
    getPollInfo() {
      return state.pollInfo;
    },
    getPollingController() {
      return state.pollingController;
    },
    getWatchPhase() {
      return state.watchPhase;
    },
    setCurrentWorkerStates(workerStates) {
      state.currentWorkerStates = workerStates;
    },
    setLastPollTime(value) {
      state.lastPollTime = value;
    },
    setPollInfo(value) {
      state.pollInfo = value;
    },
    setPollingController(value) {
      state.pollingController = value;
    },
    setWatchPhase(value) {
      state.watchPhase = value;
    },
  };
}

module.exports = {
  createRunStateStore,
};

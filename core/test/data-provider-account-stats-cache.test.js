const test = require('node:test');
const assert = require('node:assert/strict');

const statsService = require('../src/services/stats');
const { createDataProvider } = require('../src/runtime/data-provider');

function createProvider(accounts, workers = {}) {
  return createDataProvider({
    workers,
    globalLogs: [],
    accountLogs: [],
    store: {},
    getAccounts: () => ({ accounts }),
    callWorkerApi: async () => ({}),
    buildDefaultStatus: () => ({}),
    normalizeStatusForPanel: value => value,
    filterLogs: () => [],
    nextConfigRevision: () => 1,
    broadcastConfigToWorkers: () => {},
    startWorker: () => {},
    stopWorker: () => {},
    restartWorker: () => {},
    getResourceStatus: () => ({}),
    scheduleAutoCodeRefresh: () => {},
    refreshAccountCode: () => {},
  });
}

test('getAccounts reuses persisted stats for repeated account list reads', () => {
  const originalLoadPersistedStats = statsService.loadPersistedStats;
  let loadCalls = 0;

  statsService.loadPersistedStats = (accountId) => {
    loadCalls += 1;
    assert.equal(accountId, 'a1');
    return {
      profile: { level: 12, name: 'Alice' },
      dailyGifts: { gifts: [{ key: 'vip', doneToday: true }] },
    };
  };

  try {
    const provider = createProvider([{ id: 'a1', name: 'A1' }]);
    const first = provider.getAccounts();
    const second = provider.getAccounts();

    assert.equal(loadCalls, 1);
    assert.equal(first.accounts[0].level, 12);
    assert.equal(first.accounts[0].nick, 'Alice');
    assert.equal(first.accounts[0].tasks.length, 1);
    assert.equal(second.accounts[0].level, 12);
    assert.equal(second.accounts[0].tasks.length, 1);
  } finally {
    statsService.loadPersistedStats = originalLoadPersistedStats;
  }
});

test('getAccounts prefers live worker status without reading persisted stats', () => {
  const originalLoadPersistedStats = statsService.loadPersistedStats;
  let loadCalls = 0;

  statsService.loadPersistedStats = () => {
    loadCalls += 1;
    return null;
  };

  try {
    const accounts = [{ id: 'a1', name: 'A1' }];
    const workers = {
      a1: {
        status: {
          status: { level: 33, name: 'Live Alice' },
          dailyGifts: { gifts: [] },
        },
      },
    };
    const provider = createProvider(accounts, workers);
    const result = provider.getAccounts();

    assert.equal(loadCalls, 0);
    assert.equal(result.accounts[0].level, 33);
    assert.equal(result.accounts[0].nick, 'Live Alice');
  } finally {
    statsService.loadPersistedStats = originalLoadPersistedStats;
  }
});

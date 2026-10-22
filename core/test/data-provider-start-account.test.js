const test = require('node:test');
const assert = require('node:assert/strict');

const { createDataProvider } = require('../src/runtime/data-provider');

function createProvider(account, { refreshAccountCode, startWorker, restartWorker, workers = {} }) {
  return createDataProvider({
    workers,
    globalLogs: [],
    accountLogs: [],
    store: {},
    getAccounts: () => ({ accounts: [account] }),
    filterLogs: logs => logs,
    refreshAccountCode,
    startWorker,
    stopWorker: () => {},
    restartWorker: restartWorker || (() => {}),
  });
}

test('startAccount refreshes a WeChat code first and then starts the worker with it', async () => {
  const account = {
    id: 'wx-1',
    name: '微信账号',
    platform: 'wx',
    loginBuffer: 'buffer',
    code: 'old-code',
  };
  const calls = [];
  const provider = createProvider(account, {
    refreshAccountCode: async (id, reason) => {
      calls.push(['refresh', id, reason]);
      account.code = 'new-code';
      return true;
    },
    startWorker: (next) => calls.push(['start', next.code]),
  });

  assert.equal(await provider.startAccount('wx-1'), true);
  assert.deepEqual(calls, [
    ['refresh', 'wx-1', 'manual_start'],
    ['start', 'new-code'],
  ]);
});

test('startAccount still starts the worker when the code refresh fails', async () => {
  const account = {
    id: 'wx-2',
    name: '微信账号',
    platform: 'wx',
    loginBuffer: 'buffer',
    code: 'old-code',
  };
  const calls = [];
  const provider = createProvider(account, {
    refreshAccountCode: async () => false,
    startWorker: (next) => calls.push(['start', next.code]),
  });

  assert.equal(await provider.startAccount('wx-2'), true);
  assert.deepEqual(calls, [['start', 'old-code']]);
});

test('startAccount skips the code exchange when the request already supplied a fresh code', async () => {
  const account = {
    id: 'wx-3',
    name: '微信账号',
    platform: 'wx',
    loginBuffer: 'buffer',
    code: 'fresh-code',
  };
  const calls = [];
  const provider = createProvider(account, {
    refreshAccountCode: async () => calls.push(['refresh']),
    startWorker: (next) => calls.push(['start', next.code]),
  });

  assert.equal(await provider.startAccount('wx-3', { skipCodeRefresh: true }), true);
  assert.deepEqual(calls, [['start', 'fresh-code']]);
});

test('startAccount restarts a running account after refreshing its code', async () => {
  const account = {
    id: 'wx-4',
    name: '微信账号',
    platform: 'wx',
    loginBuffer: 'buffer',
    code: 'old-code',
  };
  const calls = [];
  const provider = createProvider(account, {
    workers: { 'wx-4': { process: {} } },
    refreshAccountCode: async () => {
      calls.push(['refresh']);
      account.code = 'new-code';
      return true;
    },
    startWorker: () => calls.push(['start']),
    restartWorker: (next) => calls.push(['restart', next.code]),
  });

  assert.equal(await provider.startAccount('wx-4', { restart: true, freshCredentials: true }), true);
  assert.deepEqual(calls, [['refresh'], ['restart', 'new-code']]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-auto-code-refresh-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');
const { createAutoCodeRefreshService } = require('../src/runtime/auto-code-refresh');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('default account config keeps WeChat Code auto refresh disabled', () => {
  assert.equal(store.getDefaultAccountConfig().autoCodeRefresh.enabled, false);
});

test('disabled config does not schedule periodic Code refresh for WeChat accounts', () => {
  const logs = [];
  const account = { id: 'wx-1', name: 'WeChat account', platform: 'wx', wxid: 'wxid_test' };
  const service = createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: () => ({ enabled: false, intervalMinutes: 60 }),
    },
    getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
    log: (...args) => logs.push(args),
    addAccountLog: () => {},
  });

  service.scheduleAccount('wx-1');

  assert.deepEqual(logs, []);
});

test('QQ accounts are skipped by Code refresh and relogin recovery', async () => {
  const logs = [];
  let updateCalls = 0;
  const account = { id: 'qq-1', name: 'QQ account', platform: 'qq', code: '123' };
  const service = createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: () => ({ enabled: true, intervalMinutes: 60 }),
    },
    getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: () => {
      updateCalls += 1;
    },
    resolveWorkerControls: () => ({}),
    log: (...args) => logs.push(args),
    addAccountLog: (...args) => logs.push(args),
  });

  assert.equal(await service.refreshAccountCode('qq-1', 'ws_400'), false);
  assert.equal(service.scheduleRelogin('qq-1', 'ws_400_refresh_failed'), false);
  service.scheduleAccount('qq-1');

  assert.equal(updateCalls, 0);
  assert.deepEqual(logs, []);
});

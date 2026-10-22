const test = require('node:test');
const assert = require('node:assert/strict');

const { registerAdminAccountRoutes } = require('../src/controllers/admin-account-routes');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createAccounts(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `acc-${index + 1}`,
    name: `账号${index + 1}`,
    username: 'user-1',
    platform: 'wx',
    wxid: `wxid-${index + 1}`,
  }));
}

function registerRoutes({ accounts, refreshAccountCode }) {
  const routes = new Map();
  const app = {
    get: (path, handler) => routes.set(`GET ${path}`, handler),
    post: (path, handler) => routes.set(`POST ${path}`, handler),
    delete: (path, handler) => routes.set(`DELETE ${path}`, handler),
  };

  registerAdminAccountRoutes({
    app,
    provider: {
      refreshAccountCode,
      getLogs: () => [],
      getAccountLogs: () => [],
      clearLogs: () => ({}),
    },
    getIo: () => null,
    addOrUpdateAccount: () => {},
    deleteAccount: () => {},
    findAccountByRef: () => null,
    getAccountsForUser: () => accounts,
    getAccountIdFromRequest: () => '',
    resolveAccountReference: ref => ref,
    canAccessAccount: () => true,
    getAccessibleAccountIdsFromRequest: () => [],
    userStore: {},
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
    store: {},
    updateRuntimeConfig: () => {},
  });

  return routes.get('POST /api/accounts/refresh-wx-codes');
}

test('bulk Code refresh runs with bounded concurrency and keeps result order', async () => {
  const accounts = createAccounts(6);
  let active = 0;
  let maxActive = 0;
  const handler = registerRoutes({
    accounts,
    refreshAccountCode: async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active -= 1;
      return { ok: true, id };
    },
  });

  const res = createRes();
  await handler({ currentUser: { username: 'user-1' } }, res);

  assert.equal(maxActive, 3);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.total, 6);
  assert.equal(res.body.data.success, 6);
  assert.equal(res.body.data.failed, 0);
  assert.deepEqual(res.body.data.results.map(item => item.accountId), accounts.map(item => item.id));
});

test('bulk Code refresh reports individual failures without rejecting the batch', async () => {
  const accounts = createAccounts(4);
  const handler = registerRoutes({
    accounts,
    refreshAccountCode: async (id) => {
      if (id === 'acc-2') throw new Error('微信链路超时');
      if (id === 'acc-4') return { ok: false };
      return { ok: true };
    },
  });

  const res = createRes();
  await handler({ currentUser: { username: 'user-1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, false);
  assert.deepEqual(
    res.body.data.results.map(item => ({ id: item.accountId, ok: item.ok, error: item.error })),
    [
      { id: 'acc-1', ok: true, error: '' },
      { id: 'acc-2', ok: false, error: '微信链路超时' },
      { id: 'acc-3', ok: true, error: '' },
      { id: 'acc-4', ok: false, error: '刷新失败' },
    ],
  );
});

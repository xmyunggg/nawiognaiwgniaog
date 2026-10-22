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

function registerRoutes({ accountId = 'account-1', canAccess = () => true, clearLogs } = {}) {
  const routes = new Map();
  const app = {
    get: (path, handler) => routes.set(`GET ${path}`, handler),
    post: (path, handler) => routes.set(`POST ${path}`, handler),
    delete: (path, handler) => routes.set(`DELETE ${path}`, handler),
  };
  const provider = {
    clearLogs: clearLogs || (() => ({
      cleared: 1,
      clearedRuntimeLogs: 1,
      clearedAccountLogs: 0,
      accountId,
    })),
    getLogs: () => [],
    getAccountLogs: () => [],
  };

  registerAdminAccountRoutes({
    app,
    provider,
    getIo: () => null,
    addOrUpdateAccount: () => {},
    deleteAccount: () => {},
    findAccountByRef: () => null,
    getAccountsForUser: () => [],
    getAccountIdFromRequest: () => accountId,
    resolveAccountReference: ref => ref,
    canAccessAccount: canAccess,
    getAccessibleAccountIdsFromRequest: () => [accountId],
    userStore: {},
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
    store: {},
    updateRuntimeConfig: () => {},
  });

  return routes;
}

test('DELETE /api/logs clears the account and returns its id', () => {
  const clearCalls = [];
  const routes = registerRoutes({
    clearLogs: (ref) => {
      clearCalls.push(ref);
      return {
        cleared: 1,
        clearedRuntimeLogs: 1,
        clearedAccountLogs: 0,
        accountId: ref,
      };
    },
  });
  const handler = routes.get('DELETE /api/logs');
  assert.equal(typeof handler, 'function');

  const res = createRes();
  handler({}, res);

  assert.deepEqual(clearCalls, ['account-1']);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    data: {
      cleared: 1,
      clearedRuntimeLogs: 1,
      clearedAccountLogs: 0,
      accountId: 'account-1',
    },
    targetAccountId: 'account-1',
  });
});

test('DELETE /api/logs rejects accounts without permission', () => {
  const routes = registerRoutes({ canAccess: () => false });
  const handler = routes.get('DELETE /api/logs');

  const res = createRes();
  handler({}, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { ok: false, error: '无权访问此账号' });
});

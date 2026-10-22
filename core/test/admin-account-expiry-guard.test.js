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

function registerPostAccounts({ isUserExpired, addOrUpdateAccount = () => {} }) {
  const routes = new Map();
  const app = {
    get: (path, handler) => routes.set(`GET ${path}`, handler),
    post: (path, handler) => routes.set(`POST ${path}`, handler),
    delete: (path, handler) => routes.set(`DELETE ${path}`, handler),
  };

  registerAdminAccountRoutes({
    app,
    provider: {},
    getIo: () => null,
    addOrUpdateAccount,
    deleteAccount: () => {},
    findAccountByRef: () => null,
    getAccountsForUser: () => [],
    getAccountIdFromRequest: () => '',
    resolveAccountReference: ref => ref,
    canAccessAccount: () => true,
    getAccessibleAccountIdsFromRequest: () => [],
    userStore: { isUserExpired },
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
    store: {},
    updateRuntimeConfig: () => {},
  });

  return routes.get('POST /api/accounts');
}

test('expired users cannot add accounts', async () => {
  let saved = 0;
  const handler = registerPostAccounts({
    isUserExpired: username => username === 'user-1',
    addOrUpdateAccount: () => { saved += 1; },
  });
  const res = createRes();

  await handler({
    currentUser: { username: 'user-1', role: 'user' },
    body: { name: '新账号', code: 'abc', platform: 'qq' },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.expired, true);
  assert.match(res.body.error, /到期/);
  assert.equal(saved, 0);
});

test('expired users cannot update accounts', async () => {
  let saved = 0;
  const handler = registerPostAccounts({
    isUserExpired: username => username === 'user-1',
    addOrUpdateAccount: () => { saved += 1; },
  });
  const res = createRes();

  await handler({
    currentUser: { username: 'user-1', role: 'user' },
    body: { id: '1', name: '新备注', code: 'abc', platform: 'qq' },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.expired, true);
  assert.equal(saved, 0);
});

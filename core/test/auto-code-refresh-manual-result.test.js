const test = require('node:test');
const assert = require('node:assert/strict');

const { registerAdminSettingsRoutes } = require('../src/controllers/admin-settings-routes');

function createApp() {
  const routes = new Map();
  const register = method => (path, handler) => routes.set(`${method} ${path}`, handler);
  return {
    routes,
    app: {
      get: register('GET'),
      post: register('POST'),
      put: register('PUT'),
      delete: register('DELETE'),
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runManualRefresh(refreshAccountCode) {
  const { app, routes } = createApp();
  registerAdminSettingsRoutes({
    app,
    provider: { refreshAccountCode },
    store: {},
    logger: { info() {}, warn() {}, error() {} },
    getAccountIdFromRequest: () => '1',
    canAccessAccount: () => true,
    requireDangerConfirmation: () => true,
  });
  const handler = routes.get('POST /api/settings/auto-code-refresh/run');
  assert.equal(typeof handler, 'function');
  const res = createResponse();
  await handler({
    body: {},
    currentUser: { username: 'admin' },
    headers: { 'x-account-id': '1' },
  }, res);
  return res;
}

test('manual Code refresh reports failure when provider returns ok=false', async () => {
  const res = await runManualRefresh(async () => ({ ok: false }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /Code 刷新失败/);
});

test('manual Code refresh reports success only when provider returns ok=true', async () => {
  const res = await runManualRefresh(async () => ({ ok: true }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.ok, true);
});

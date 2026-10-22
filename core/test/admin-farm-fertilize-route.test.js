const test = require('node:test');
const assert = require('node:assert/strict');

const { registerAdminFarmOperationRoutes } = require('../src/controllers/admin-farm-operation-routes');

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

function registerRoutes({ fertilizeLand, fertilizeAll } = {}) {
  const routes = new Map();
  const app = {
    get: (path, handler) => routes.set(`GET ${path}`, handler),
    post: (path, handler) => routes.set(`POST ${path}`, handler),
    delete: (path, handler) => routes.set(`DELETE ${path}`, handler),
  };
  const provider = {
    doFarmOp: async () => ({}),
    fertilizeLand: fertilizeLand || (async () => ({})),
    fertilizeAll: fertilizeAll || (async () => ({})),
    removePlant: async () => ({}),
    removeAllPlants: async () => ({}),
    plant: async () => ({}),
  };

  registerAdminFarmOperationRoutes({
    app,
    provider,
    getAccountIdFromRequest: () => 'account-1',
    canAccessAccount: () => true,
    sendProviderError: (res, error) => res.status(500).json({ ok: false, error: error.message }),
  });

  assert.equal(typeof routes.get('POST /api/land/fertilize'), 'function');
  assert.equal(typeof routes.get('POST /api/land/fertilize-all'), 'function');
  return routes;
}

function getFertilizeLandHandler(options) {
  return registerRoutes(options).get('POST /api/land/fertilize');
}

function getFertilizeAllHandler(options) {
  return registerRoutes(options).get('POST /api/land/fertilize-all');
}

test('POST /api/land/fertilize forwards the selected fertilizer type', async () => {
  const calls = [];
  const handler = getFertilizeLandHandler({
    fertilizeLand: async (...args) => {
      calls.push(args);
      return { success: true, count: 1, fertilizerType: args[2] };
    },
  });

  const res = createRes();
  await handler({ body: { landId: 7, fertilizerType: 'normal' } }, res);

  assert.deepEqual(calls, [['account-1', 7, 'normal']]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    data: { success: true, count: 1, fertilizerType: 'normal' },
  });
});

test('POST /api/land/fertilize accepts the type alias and organic selection', async () => {
  const calls = [];
  const handler = getFertilizeLandHandler({
    fertilizeLand: async (...args) => {
      calls.push(args);
      return { success: true, count: 1, fertilizerType: args[2] };
    },
  });

  const res = createRes();
  await handler({ body: { landId: 9, type: 'organic' } }, res);

  assert.deepEqual(calls, [['account-1', 9, 'organic']]);
  assert.deepEqual(res.body, {
    ok: true,
    data: { success: true, count: 1, fertilizerType: 'organic' },
  });
});

test('POST /api/land/fertilize defaults to organic for old clients and unknown values', async () => {
  const calls = [];
  const handler = getFertilizeLandHandler({
    fertilizeLand: async (...args) => {
      calls.push(args);
      return { success: false, count: 0, fertilizerType: args[2] };
    },
  });

  const resWithoutType = createRes();
  await handler({ body: { landId: 11 } }, resWithoutType);
  const resUnknownType = createRes();
  await handler({ body: { landId: 12, fertilizerType: 'magic' } }, resUnknownType);

  assert.deepEqual(calls, [
    ['account-1', 11, 'organic'],
    ['account-1', 12, 'organic'],
  ]);
});

test('POST /api/land/fertilize rejects a missing land id before calling the provider', async () => {
  const calls = [];
  const handler = getFertilizeLandHandler({
    fertilizeLand: async (...args) => {
      calls.push(args);
      return {};
    },
  });

  const res = createRes();
  await handler({ body: { fertilizerType: 'normal' } }, res);

  assert.deepEqual(calls, []);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, error: '缺少土地ID' });
});

test('POST /api/land/fertilize-all forwards the selected fertilizer type', async () => {
  const calls = [];
  const handler = getFertilizeAllHandler({
    fertilizeAll: async (...args) => {
      calls.push(args);
      return { success: true, count: 3, total: 3, fertilizerType: args[1] };
    },
  });

  const res = createRes();
  await handler({ body: { fertilizerType: 'organic' } }, res);

  assert.deepEqual(calls, [['account-1', 'organic']]);
  assert.deepEqual(res.body, {
    ok: true,
    data: { success: true, count: 3, total: 3, fertilizerType: 'organic' },
  });
});

test('POST /api/land/fertilize-all defaults to normal and accepts the type alias', async () => {
  const calls = [];
  const handler = getFertilizeAllHandler({
    fertilizeAll: async (...args) => {
      calls.push(args);
      return { success: true, count: 1, total: 1, fertilizerType: args[1] };
    },
  });

  const resDefault = createRes();
  await handler({ body: {} }, resDefault);
  const resAlias = createRes();
  await handler({ body: { type: 'normal' } }, resAlias);

  assert.deepEqual(calls, [
    ['account-1', 'normal'],
    ['account-1', 'normal'],
  ]);
});

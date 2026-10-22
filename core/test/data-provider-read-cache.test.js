const test = require('node:test');
const assert = require('node:assert/strict');

const { createDataProvider } = require('../src/runtime/data-provider');

function createHarness({ ttlMs = 15000 } = {}) {
  const calls = [];
  const accounts = [{ id: 'a1' }, { id: 'a2' }];
  const provider = createDataProvider({
    workers: {},
    globalLogs: [],
    accountLogs: [],
    store: {},
    getAccounts: () => ({ accounts }),
    callWorkerApi: async (accountId, method, ...args) => {
      calls.push({ accountId, method, args });
      return { accountId, method, args };
    },
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
    illustratedCacheTtlMs: ttlMs,
  });
  return { provider, calls };
}

test('图鉴列表在缓存窗口内重复请求只回源一次', async () => {
  const { provider, calls } = createHarness();
  const illustratedCalls = () => calls.filter(call => call.method === 'getIllustratedList');

  const first = await provider.getIllustratedList('a1', false, 1);
  const second = await provider.getIllustratedList('a1', false, 1);

  assert.equal(illustratedCalls().length, 1);
  assert.deepEqual(illustratedCalls()[0].args, [false, 1]);
  assert.equal(first, second, '命中缓存时应返回同一份结果');
});

test('refresh=true 绕过缓存回源并刷新缓存内容', async () => {
  const { provider, calls } = createHarness();
  const illustratedCalls = () => calls.filter(call => call.method === 'getIllustratedList');

  await provider.getIllustratedList('a1', false, 1);
  const forced = await provider.getIllustratedList('a1', true, 1);

  assert.equal(illustratedCalls().length, 2);
  assert.deepEqual(illustratedCalls()[1].args, [true, 1]);

  // 强制刷新写入的新结果应被后续普通请求复用。
  const cached = await provider.getIllustratedList('a1', false, 1);
  assert.equal(illustratedCalls().length, 2);
  assert.equal(cached, forced);
});

test('不同图鉴分类与不同账号不共享缓存', async () => {
  const { provider, calls } = createHarness();
  const illustratedCalls = () => calls.filter(call => call.method === 'getIllustratedList');

  await provider.getIllustratedList('a1', false, 1);
  await provider.getIllustratedList('a1', false, 2);
  await provider.getIllustratedList('a2', false, 1);

  assert.equal(illustratedCalls().length, 3);
  assert.deepEqual(
    illustratedCalls().map(call => `${call.accountId}:${call.args[1]}`),
    ['a1:1', 'a1:2', 'a2:1']
  );
});

test('购买后调用 invalidateIllustratedCache 可丢弃该账号的全部图鉴缓存', async () => {
  const { provider, calls } = createHarness();
  const illustratedCalls = () => calls.filter(call => call.method === 'getIllustratedList');

  await provider.getIllustratedList('a1', false, 1);
  await provider.getIllustratedList('a1', false, 2);
  assert.equal(illustratedCalls().length, 2);

  assert.equal(provider.invalidateIllustratedCache('a1'), 2);

  await provider.getIllustratedList('a1', false, 1);
  await provider.getIllustratedList('a1', false, 2);
  assert.equal(illustratedCalls().length, 4);
});

test('缓存 TTL 为 0 时每次都回源', async () => {
  const { provider, calls } = createHarness({ ttlMs: 0 });
  const illustratedCalls = () => calls.filter(call => call.method === 'getIllustratedList');

  await provider.getIllustratedList('a1', false, 1);
  await provider.getIllustratedList('a1', false, 1);

  assert.equal(illustratedCalls().length, 2);
});

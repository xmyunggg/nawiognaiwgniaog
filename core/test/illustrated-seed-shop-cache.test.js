const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearSeedShopCache,
  getSeedShopGoodsMap,
} = require('../src/controllers/admin-illustrated-helpers');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createProvider({ failTimes = 0 } = {}) {
  let remainingFailures = failTimes;
  const calls = [];
  return {
    calls,
    getShopInfo: async (accountId, shopId) => {
      calls.push({ accountId, shopId });
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error('gateway busy');
      }
      return {
        goods_list: [
          { id: 15, item_id: 20002, price: 2, unlocked: true },
          { id: 16, item_id: 20003, price: 4, unlocked: true },
        ],
      };
    },
  };
}

test('种子商店映射在缓存窗口内复用，减少一次 GetShopInfo', async t => {
  clearSeedShopCache();
  t.after(() => clearSeedShopCache());

  const provider = createProvider();
  const first = await getSeedShopGoodsMap({
    provider,
    accountId: 'a1',
    adminLogger: silentLogger,
  });
  const second = await getSeedShopGoodsMap({
    provider,
    accountId: 'a1',
    adminLogger: silentLogger,
  });

  assert.equal(provider.calls.length, 1);
  assert.equal(first, second);
  assert.equal(first.get(20002).goodsId, 15);
});

test('force=true 或 clearSeedShopCache 后重新回源', async t => {
  clearSeedShopCache();
  t.after(() => clearSeedShopCache());

  const provider = createProvider();
  await getSeedShopGoodsMap({ provider, accountId: 'a1', adminLogger: silentLogger });

  await getSeedShopGoodsMap({
    provider,
    accountId: 'a1',
    adminLogger: silentLogger,
    force: true,
  });
  assert.equal(provider.calls.length, 2);

  clearSeedShopCache('a1');
  await getSeedShopGoodsMap({ provider, accountId: 'a1', adminLogger: silentLogger });
  assert.equal(provider.calls.length, 3);
});

test('不同账号的种子商店映射互不影响', async t => {
  clearSeedShopCache();
  t.after(() => clearSeedShopCache());

  const provider = createProvider();
  await getSeedShopGoodsMap({ provider, accountId: 'a1', adminLogger: silentLogger });
  await getSeedShopGoodsMap({ provider, accountId: 'a2', adminLogger: silentLogger });

  assert.deepEqual(
    provider.calls.map(call => call.accountId),
    ['a1', 'a2']
  );
});

test('获取失败时不写入缓存，下一次请求会重试', async t => {
  clearSeedShopCache();
  t.after(() => clearSeedShopCache());

  const provider = createProvider({ failTimes: 1 });
  const failed = await getSeedShopGoodsMap({
    provider,
    accountId: 'a1',
    adminLogger: silentLogger,
    tolerateFailure: true,
  });
  assert.equal(failed.size, 0);

  const retried = await getSeedShopGoodsMap({
    provider,
    accountId: 'a1',
    adminLogger: silentLogger,
  });
  assert.equal(provider.calls.length, 2);
  assert.equal(retried.get(20002).goodsId, 15);
});

test('TTL 为 0 时不缓存', async t => {
  clearSeedShopCache();
  t.after(() => clearSeedShopCache());

  const provider = createProvider();
  await getSeedShopGoodsMap({
    provider,
    accountId: 'a1',
    adminLogger: silentLogger,
    ttlMs: 0,
  });
  await getSeedShopGoodsMap({
    provider,
    accountId: 'a1',
    adminLogger: silentLogger,
    ttlMs: 0,
  });

  assert.equal(provider.calls.length, 2);
});

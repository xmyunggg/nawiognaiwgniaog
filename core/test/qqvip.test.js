const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');

const {
  getAvailableVipTypes,
  getVipRewardLabels,
  isNotVipError,
  isAlreadyClaimedError,
} = require('../src/services/qqvip');

let proto;

test.before(async () => {
  const root = new protobuf.Root();
  await root.load([
    path.join(__dirname, '../src/proto/corepb.proto'),
    path.join(__dirname, '../src/proto/qqvippb.proto'),
  ], { keepCase: true });
  proto = {
    status: root.lookupType('gamepb.qqvippb.GetQQVipRewardsStatusReply'),
    claimRequest: root.lookupType('gamepb.qqvippb.ClaimQQVipRewardsRequest'),
    claimReply: root.lookupType('gamepb.qqvippb.ClaimQQVipRewardsReply'),
  };
});

test('VIP status reads enabled reward types from reward_statuses', () => {
  const status = proto.status.decode(proto.status.encode(proto.status.create({
    is_qq_vip: true,
    can_claim: true,
    rewards_can_claim: true,
    reward_statuses: [
      { type: 1, is_enable: true, reward_type: 5 },
      { type: 2, is_enable: true, reward_type: 6 },
      { type: 2, is_enable: false, reward_type: 7 },
    ],
  })).finish());

  assert.deepEqual(getAvailableVipTypes(status), [5, 6]);
});

test('VIP status respects daily and seasonal claim flags', () => {
  const status = proto.status.decode(proto.status.encode(proto.status.create({
    is_qq_vip: true,
    can_claim: false,
    rewards_can_claim: true,
    reward_statuses: [
      { type: 1, is_enable: true, reward_type: 5 },
      { type: 2, is_enable: true, reward_type: 6 },
    ],
  })).finish());

  assert.deepEqual(getAvailableVipTypes(status), [6]);
});

test('non-members never expose claimable reward types even when the bool is omitted', () => {
  const status = proto.status.decode(proto.status.encode(proto.status.create({
    is_qq_vip: false,
    can_claim: true,
    rewards_can_claim: true,
    reward_statuses: [{ type: 1, is_enable: true, reward_type: 5 }],
  })).finish());

  assert.deepEqual(getAvailableVipTypes(status), []);
  assert.deepEqual(getAvailableVipTypes({
    can_claim: true,
    rewards_can_claim: true,
    reward_statuses: [{ type: 1, is_enable: true, reward_type: 5 }],
  }), []);
});

test('VIP reward types use readable log labels', () => {
  assert.deepEqual(getVipRewardLabels([5]), ['VIP奖励']);
  assert.deepEqual(getVipRewardLabels([6]), ['SVIP奖励']);
  assert.deepEqual(getVipRewardLabels([5, 6]), ['VIP奖励', 'SVIP奖励']);
});

test('non-VIP errors are recognized by code and readable message', () => {
  assert.equal(isNotVipError(new Error(
    'gamepb.qqvippb.QQVipService.RefreshVipInfo 错误: code=1021001 非QQ会员'
  )), true);
  assert.equal(isNotVipError(new Error('当前账号非 QQ 会员')), true);
  assert.equal(isNotVipError(new Error('code=500 服务异常')), false);
});

test('already-claimed detection does not accept ambiguous messages', () => {
  assert.equal(isAlreadyClaimedError(new Error('错误: code=1021002 今日已领取')), true);
  assert.equal(isAlreadyClaimedError(new Error('今日已领取')), true);
  assert.equal(isAlreadyClaimedError(new Error('无法确认是否已领取')), false);
});

test('SVIP-only claim matches the captured packed request', () => {
  const payload = proto.claimRequest.encode(
    proto.claimRequest.create({ reward_types: [6] })
  ).finish();

  assert.equal(payload.toString('hex'), '0a0106');
});

test('VIP and SVIP claim matches the captured packed request', () => {
  const payload = proto.claimRequest.encode(
    proto.claimRequest.create({ reward_types: [5, 6] })
  ).finish();

  assert.equal(payload.toString('hex'), '0a020506');
});

test('VIP rewards decode items from response field 3', () => {
  const encoded = proto.claimReply.encode(proto.claimReply.create({
    items: [{ id: 80011, count: 10 }],
  })).finish();
  const reply = proto.claimReply.decode(encoded);

  assert.equal(encoded[0], 0x1A);
  assert.equal(Number(reply.items[0].id), 80011);
  assert.equal(Number(reply.items[0].count), 10);
});

function mockModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports };
}

function createHarness(t, options = {}) {
  const calls = [];
  const logs = [];
  const status = options.status || {
    is_qq_vip: true,
    can_claim: true,
    rewards_can_claim: true,
    reward_statuses: [{ type: 1, is_enable: true, reward_type: 5 }],
  };
  const servicePath = require.resolve('../src/services/qqvip');
  const networkPath = require.resolve('../src/utils/network');
  const protoPath = require.resolve('../src/utils/proto');
  const utilsPath = require.resolve('../src/utils/utils');
  const configPath = require.resolve('../src/config/gameConfig');
  const paths = [networkPath, protoPath, utilsPath, configPath];
  const previous = new Map(paths.map(file => [file, require.cache[file]]));
  const previousService = require.cache[servicePath];
  const reply = decoded => ({
    create: value => value,
    encode: value => ({ finish: () => value }),
    decode: () => decoded,
  });

  require.cache[networkPath] = mockModule(networkPath, {
    sendMsgAsync: async (_service, method, body) => {
      calls.push({ method, body });
      if (method === 'GetQQVipRewardsStatus' && options.statusError) throw options.statusError;
      if (method === 'ClaimQQVipRewards' && options.claimError) throw options.claimError;
      return { body: Buffer.alloc(0) };
    },
  });
  require.cache[protoPath] = mockModule(protoPath, {
    types: {
      RefreshVipInfoRequest: reply(),
      RefreshVipInfoReply: reply(),
      GetQQVipRewardsStatusRequest: reply(),
      GetQQVipRewardsStatusReply: reply(status),
      ClaimQQVipRewardsRequest: reply(),
      ClaimQQVipRewardsReply: reply({ items: [{ id: 1901, count: 1 }] }),
    },
  });
  require.cache[utilsPath] = mockModule(utilsPath, {
    log: (...args) => logs.push(args),
    toNum: value => Number(value) || 0,
  });
  require.cache[configPath] = mockModule(configPath, {
    getItemById: () => ({ name: '会员礼物' }),
  });

  delete require.cache[servicePath];
  t.after(() => {
    delete require.cache[servicePath];
    if (previousService) require.cache[servicePath] = previousService;
    for (const [file, cached] of previous) {
      if (cached) require.cache[file] = cached;
      else delete require.cache[file];
    }
  });

  return {
    service: require(servicePath),
    calls,
    logs,
    status,
    options,
  };
}

test('daily claim does not depend on the optional membership refresh RPC', async (t) => {
  const h = createHarness(t);

  assert.equal(await h.service.performDailyVipGift(true), true);
  assert.deepEqual(h.calls.map(call => call.method), [
    'GetQQVipRewardsStatus',
    'ClaimQQVipRewards',
  ]);
  assert.deepEqual(h.calls[1].body.reward_types, [5]);
  const state = h.service.getVipDailyState();
  assert.equal(state.result, 'ok');
  assert.equal(state.doneToday, true);
  assert.equal(state.isVip, true);
  assert.equal(state.lastError, '');
});

test('a failed status read preserves unknown membership and does not mark the day complete', async (t) => {
  const h = createHarness(t, { statusError: new Error('status offline') });

  assert.equal(await h.service.performDailyVipGift(), false);
  const state = h.service.getVipDailyState();
  assert.equal(state.result, 'error');
  assert.equal(state.doneToday, false);
  assert.equal(state.isVip, null);
  assert.equal(state.hasGift, null);
  assert.match(state.lastError, /status offline/);
});

test('a failed claim can be retried and reports the error', async (t) => {
  const h = createHarness(t, { claimError: new Error('claim failed') });

  assert.equal(await h.service.performDailyVipGift(), false);
  const state = h.service.getVipDailyState();
  assert.equal(state.result, 'error');
  assert.equal(state.doneToday, false);
  assert.match(state.lastError, /claim failed/);
});

test('non-members do not claim and are not reported as completed', async (t) => {
  const h = createHarness(t, {
    status: {
      is_qq_vip: false,
      can_claim: true,
      reward_statuses: [{ type: 1, is_enable: true, reward_type: 5 }],
    },
  });

  assert.equal(await h.service.performDailyVipGift(), false);
  assert.deepEqual(h.calls.map(call => call.method), ['GetQQVipRewardsStatus']);
  const state = h.service.getVipDailyState();
  assert.equal(state.result, 'none');
  assert.equal(state.doneToday, false);
  assert.equal(state.isVip, false);
  assert.equal(state.hasGift, false);

  // 同一天不会因为非会员而反复查询，但也不会标记为已完成。
  assert.equal(await h.service.performDailyVipGift(), false);
  assert.equal(h.calls.length, 1);
});

test('a status reply without is_qq_vip is treated as a non-member', async (t) => {
  const h = createHarness(t, {
    status: {
      can_claim: false,
      rewards_can_claim: false,
      reward_statuses: [{ type: 1, is_enable: true, reward_type: 5 }],
    },
  });

  assert.equal(await h.service.performDailyVipGift(), false);
  assert.deepEqual(h.calls.map(call => call.method), ['GetQQVipRewardsStatus']);
  const state = h.service.getVipDailyState();
  assert.equal(state.result, 'none');
  assert.equal(state.doneToday, false);
  assert.equal(state.isVip, false);
  assert.equal(state.hasGift, false);
  assert.equal(state.canClaim, false);
  assert.equal(state.lastError, '');
});

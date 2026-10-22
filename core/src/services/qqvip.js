/**
 * QQ会员服务 - 每日自动领取VIP礼包
 *
 * 功能：
 * - 查询每日VIP礼包状态
 * - 自动领取每日VIP礼包
 */
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum } = require('../utils/utils');
const { getItemById } = require('../config/gameConfig');

const DAILY_KEY = 'vip_daily_gift';

// 两次检查最小间隔：10分钟
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

// 每日状态追踪
let doneDateKey = '';
let nonVipDateKey = '';
let lastCheckAt = 0;
let lastClaimAt = 0;
let lastResult = '';
let lastError = '';
let lastIsVip = null;
let lastHasGift = null;
let lastCanClaim = null;

// ---- 日期工具 ----

function getDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function markDoneToday() {
  doneDateKey = getDateKey();
}

function isDoneToday() {
  return doneDateKey === getDateKey();
}

function isNonMemberToday() {
  return nonVipDateKey === getDateKey();
}

// ---- 奖励摘要 ----
// 1001→金币, 1002→经验, 500→点券

function getRewardSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const parts = [];
  for (const item of list) {
    const id = toNum(item.id);
    const count = toNum(item.count);
    if (count <= 0) continue;
    if (id === 1001 || id === 500001) {
      parts.push(`金币${count}`);
    } else if (id === 1002 || id === 500002) {
      parts.push(`经验${count}`);
    } else if (id === 500) {
      parts.push(`点券${count}`);
    } else {
      const info = getItemById(id);
      const name = info && info.name ? String(info.name) : `物品#${id}`;
      parts.push(`${name}x${count}`);
    }
  }
  return parts.join('/');
}

/**
 * 判断是否"已领取"错误。
 * 只接受明确码或“今日已领取”，避免把“无法确认是否已领取”误判为成功。
 */
function isAlreadyClaimedError(err) {
  const msg = String(err && err.message || '');
  return msg.includes('code=1021002') || msg.includes('今日已领取');
}

/**
 * 判断当前账号是否不具备 QQ 会员资格
 */
function isNotVipError(err) {
  const msg = String(err && err.message || '');
  return msg.includes('code=1021001') || msg.includes('非QQ会员') || msg.includes('非 QQ 会员');
}

function recordFailure(stage, error) {
  const message = `${stage}失败: ${String(error && error.message || error).slice(0, 500)}`;
  log('会员', message, {
    module: 'task', event: DAILY_KEY, result: 'error', stage,
    code: toNum(error && error.code)
  });
  return message;
}

function markNonMember() {
  // 非会员只记录当天无需再查，不能标记为“今日已完成”。
  nonVipDateKey = getDateKey();
  lastResult = 'none';
  lastError = '';
  lastIsVip = false;
  lastHasGift = false;
  lastCanClaim = false;
  log('会员', '非QQ会员，跳过会员礼包', {
    module: 'task', event: DAILY_KEY, result: 'none', reason: 'not_qq_vip'
  });
}

// ---- RPC 调用 ----

async function refreshVipInfo() {
  const request = types.RefreshVipInfoRequest.encode(
    types.RefreshVipInfoRequest.create({})
  ).finish();
  const { body } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'RefreshVipInfo', request);
  return types.RefreshVipInfoReply.decode(body);
}

async function getDailyGiftStatus() {
  const request = types.GetQQVipRewardsStatusRequest.encode(
    types.GetQQVipRewardsStatusRequest.create({})
  ).finish();
  const { body } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'GetQQVipRewardsStatus', request);
  return types.GetQQVipRewardsStatusReply.decode(body);
}

function getRewardStatuses(status) {
  return Array.isArray(status && status.reward_statuses) ? status.reward_statuses : [];
}

/**
 * 根据服务端状态返回本次可领取的礼包类型。
 * 每日礼包看 can_claim，其它礼包看 rewards_can_claim；非会员永远不可领取。
 */
function getAvailableVipTypes(status) {
  // proto3 未下发 bool 时默认就是 false，不能把缺失字段当成“会员资格未知”。
  if (!status || status.is_qq_vip !== true) return [];
  const rewardStatuses = getRewardStatuses(status);
  const result = [];
  for (const item of rewardStatuses) {
    if (!item || item.is_enable !== true) continue;
    const rewardType = toNum(item.reward_type);
    if (rewardType <= 0) continue;
    const claimable = toNum(item.type) === 1
      ? status.can_claim === true
      : status.rewards_can_claim === true;
    if (claimable && !result.includes(rewardType)) result.push(rewardType);
  }
  return result;
}

function getVipRewardLabels(vipTypes) {
  const labels = {
    1: 'VIP奖励',
    2: 'SVIP奖励',
    5: 'VIP奖励',
    6: 'SVIP奖励'
  };
  return (Array.isArray(vipTypes) ? vipTypes : [])
    .map(vipType => labels[toNum(vipType)])
    .filter(Boolean);
}

async function claimDailyGift(rewardTypes) {
  const request = types.ClaimQQVipRewardsRequest.encode(
    types.ClaimQQVipRewardsRequest.create({ reward_types: rewardTypes })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.qqvippb.QQVipService',
    'ClaimQQVipRewards',
    request
  );
  return types.ClaimQQVipRewardsReply.decode(body);
}

// ---- 主逻辑 ----

/**
 * 执行每日VIP礼包领取
 * @param {boolean} force - 强制检查
 */
async function performDailyVipGift(force = false) {
  const now = Date.now();

  if (!force && isDoneToday()) return false;
  if (!force && isNonMemberToday()) return false;
  if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS) return false;

  lastCheckAt = now;
  // 强制重查不能被之前的“已完成”标记挡住，也不能继续展示上一次的失败。
  if (force) {
    doneDateKey = '';
    nonVipDateKey = '';
  }
  lastError = '';
  lastIsVip = null;
  lastHasGift = null;
  lastCanClaim = null;

  let status;
  try {
    // 正常每日检查直接查询资格，避免 RefreshVipInfo 单独失败时挡住可领取礼包。
    status = await getDailyGiftStatus();
  } catch (err) {
    if (isNotVipError(err)) {
      markNonMember();
    } else {
      lastResult = 'error';
      lastError = recordFailure('查询会员资格', err);
    }
    return false;
  }

  // GetQQVipRewardsStatusReply 的 is_qq_vip 是 proto3 bool；字段缺失即 false。
  // 不能把缺失字段当成 null，否则非会员会走到“无可领取礼包”并显示今日已完成。
  lastIsVip = status?.is_qq_vip === true;
  if (!lastIsVip) {
    markNonMember();
    return false;
  }
  nonVipDateKey = '';

  const rewardStatuses = getRewardStatuses(status);
  const rewardTypes = getAvailableVipTypes(status);
  const mallCanClaim = status && status.mall_free_can_claim === true;
  const alreadyClaimed = status && status.claimed_today === true;
  lastHasGift = rewardStatuses.some(item => item && item.is_enable === true) || mallCanClaim;
  lastCanClaim = rewardTypes.length > 0 || mallCanClaim;

  if (rewardTypes.length === 0) {
    markDoneToday();
    lastResult = alreadyClaimed ? 'ok' : 'none';
    lastCanClaim = false;
    if (alreadyClaimed) {
      lastClaimAt = Date.now();
      log('会员', '今日会员礼包已领取', { module: 'task', event: DAILY_KEY, result: 'ok' });
    } else {
      log('会员', '今日暂无可领取会员礼包', { module: 'task', event: DAILY_KEY, result: 'none' });
    }
    return false;
  }

  try {
    const reply = await claimDailyGift(rewardTypes);
    const items = Array.isArray(reply && reply.items) ? reply.items : [];
    const summary = getRewardSummary(items);
    const vipRewards = getVipRewardLabels(rewardTypes);
    const rewardLabel = vipRewards.join('、') || '会员礼包';

    log('会员',
      summary ? `${rewardLabel}领取成功 → ${summary}` : `${rewardLabel}领取成功`,
      {
        module: 'task',
        event: DAILY_KEY,
        result: 'ok',
        count: items.length,
        rewardTypes,
        vipRewards
      }
    );

    lastClaimAt = Date.now();
    lastCanClaim = false;
    markDoneToday();
    lastResult = 'ok';
    return true;
  } catch (err) {
    if (isNotVipError(err)) {
      markNonMember();
      return false;
    }
    if (isAlreadyClaimedError(err)) {
      lastClaimAt = Date.now();
      lastCanClaim = false;
      markDoneToday();
      lastResult = 'ok';
      log('会员', '今日会员礼包已领取', { module: 'task', event: DAILY_KEY, result: 'ok' });
      return false;
    }

    lastResult = 'error';
    lastError = recordFailure('领取会员礼包', err);
    return false;
  }
}

module.exports = {
  performDailyVipGift,
  refreshVipInfo,
  getDailyGiftStatus,
  getAvailableVipTypes,
  getVipRewardLabels,
  isNotVipError,
  isAlreadyClaimedError,
  getVipDailyState: () => ({
    key: DAILY_KEY,
    doneToday: isDoneToday(),
    lastCheckAt,
    lastClaimAt,
    result: lastResult,
    lastError,
    isVip: lastIsVip,
    hasGift: lastHasGift,
    canClaim: lastCanClaim,
  }),
};

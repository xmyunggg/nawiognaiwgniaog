const { getItemById, getItemImageById, getPlantByFruitId } = require('../config/gameConfig');
const { types } = require('../utils/proto');
const { sendMsgAsync } = require('../utils/network');
const { toNum, logWarn } = require('../utils/utils');

async function getCareerInfo(gid) {
  const numericGid = toNum(gid);
  if (!numericGid) throw new Error('缺少有效的角色 GID');

  const payload = types.CareerInfoGetRequest.encode(
    types.CareerInfoGetRequest.create({ gid: numericGid }),
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.careerpb.CareerService',
    'CareerInfoGet',
    payload,
  );
  const reply = types.CareerInfoGetReply.decode(body);

  const items = (reply.harvest_items || []).map((item) => {
    const fruitId = toNum(item.fruit_id);
    const config = getItemById(fruitId);
    const plant = getPlantByFruitId(fruitId);
    return {
      seedId: fruitId,
      fruitId,
      name: config?.name || plant?.name || `果实${fruitId}`,
      image: getItemImageById(fruitId),
      harvestCount: toNum(item.harvest_count),
    };
  });

  const totalHarvestCount = toNum(reply.total_harvest_count);
  const totalStealCount = toNum(reply.total_steal_count);

  return {
    items,
    // 兼容旧字段名；前端生涯收偷统计与收偷比使用 harvest/steal。
    harvest: totalHarvestCount,
    steal: totalStealCount,
    totalHarvestCount,
    totalStealCount,
    name: String(reply.name || ''),
    avatar: String(reply.avatar_url || ''),
    level: toNum(reply.level),
    exp: toNum(reply.exp),
    gid: toNum(reply.gid) || numericGid,
    platform: toNum(reply.platform),
    openId: String(reply.open_id || ''),
  };
}

/**
 * 生涯统计是辅助信息：好友生涯查询失败时返回 null，不阻塞土地读取。
 */
async function getCareerInfoOrNull(gid, propagateErrors = false) {
  try {
    return await getCareerInfo(gid);
  } catch (error) {
    if (propagateErrors) throw error;
    logWarn('生涯', `查询失败: ${error && error.message ? error.message : error}`);
    return null;
  }
}

module.exports = { getCareerInfo, getCareerInfoOrNull };

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { PlantPhase } = require('../config/config');
const { toNum, toTimeSec, getServerTimeSec, log, logWarn, randomDelay } = require('../utils/utils');
const { getAutomation } = require('../models/store');
const { recordOperation } = require('./stats');
const {
  getAllLands,
  fertilize,
  isSkippableFertilizeLandError,
  NORMAL_FERTILIZER_ID,
  ORGANIC_FERTILIZER_ID
} = require('./farm-api');
const { getCurrentPhase } = require('./farm-land-analyzer');

/** 单次有机肥循环最多请求次数，避免库存很大时长时间占用连接 */
const MAX_ORGANIC_FERTILIZE_OPERATIONS = 240;
/** 每块地单次最多循环约 20 轮 */
const MAX_ORGANIC_FERTILIZE_ROUNDS = 20;

// ─── 常量 ───

/** 全部可施肥土地类型 */
const ALL_FERTILIZER_LAND_TYPES = ['purple', 'gold', 'black', 'red', 'normal'];

/** 土地类型中文标签 */
const FERTILIZER_LAND_TYPE_LABELS = {
  purple: '紫土地',
  gold: '金土地',
  black: '黑土地',
  red: '红土地',
  normal: '普通土地'
};

// ─── 辅助函数 ───

function isTransientNetworkError(err) {
  const msg = String(err && err.message || '');
  if (!msg) return false;
  return [
    '连接未打开', '请求超时', '请求已中断',
    '连接关闭', '发送失败', '请求队列已满'
  ].some(pattern => msg.includes(pattern));
}

/**
 * 读取本季普通（无机）肥剩余可施次数。
 * proto3 下 0 不落盘，因此字段缺失或 <=0 都表示本季普通肥已施过。
 */
function getLeftInorcFertTimes(plant) {
  if (!plant || !Object.hasOwn(plant, 'left_inorc_fert_times')) return null;
  return toNum(plant.left_inorc_fert_times);
}

function canApplyNormalFertilizer(plant) {
  return (getLeftInorcFertTimes(plant) || 0) > 0;
}

/**
 * 有机化肥循环施肥（逐块施肥直到失败）
 * @param {number[]} landIds - 地块 ID 列表
 * @returns {number} 成功施肥次数
 */
async function fertilizeOrganicLoop(landIds) {
  const ids = (Array.isArray(landIds) ? landIds : []).filter(Boolean);
  if (ids.length === 0) return 0;

  let successCount = 0;
  let index = 0;
  const operationLimit = Math.min(
    MAX_ORGANIC_FERTILIZE_OPERATIONS,
    ids.length * MAX_ORGANIC_FERTILIZE_ROUNDS
  );

  while (successCount < operationLimit && ids.length > 0) {
    const landId = ids[index % ids.length];
    try {
      const payload = types.FertilizeRequest.encode(types.FertilizeRequest.create({
        land_ids: [toNum(landId)],
        fertilizer_id: toNum(ORGANIC_FERTILIZER_ID)
      })).finish();
      await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', payload);
      successCount++;
      index = (index + 1) % ids.length;
    } catch (err) {
      // 某一块当前不能施肥时跳过该地，不能让整批有机肥提前结束。
      if (isSkippableFertilizeLandError(err)) {
        log('施肥', `第 ${landId} 块地当前不能施有机肥，已跳过`, {
          module: 'farm', event: '施肥', result: 'skip', landId
        });
        ids.splice(index % ids.length, 1);
        if (ids.length === 0) break;
        index %= ids.length;
      } else {
        break;
      }
    }
    await randomDelay(200, 300);
  }
  return successCount;
}

/**
 * 从地块列表获取可施有机肥的目标。
 * left_inorc_fert_times 表示本季普通肥剩余次数，不是有机肥次数，
 * 因此这里不能用它判断有机肥是否还能施。
 * @param {Array} lands - 地块数据列表
 * @returns {number[]} 可施有机肥的地块 ID
 */
function getOrganicFertilizerTargetsFromLands(lands) {
  const list = Array.isArray(lands) ? lands : [];
  const targets = [];
  for (const land of list) {
    if (!land || !land.unlocked) continue;
    const landId = toNum(land.id);
    if (!landId) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(plant.phases, false, '', plant.id);
    if (!currentPhase) continue;
    if (currentPhase.phase === PlantPhase.DEAD) continue;

    targets.push(landId);
  }
  return targets;
}

/**
 * 从地块列表获取本季仍可施普通肥的目标。
 * @param {Array} lands - 地块数据列表
 * @returns {number[]} 可施普通肥的地块 ID
 */
function getNormalFertilizerTargetsFromLands(lands) {
  const list = Array.isArray(lands) ? lands : [];
  const targets = [];
  for (const land of list) {
    if (!land || !land.unlocked) continue;
    const landId = toNum(land.id);
    if (!landId) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(plant.phases, false, '', plant.id);
    if (!currentPhase) continue;
    if (currentPhase.phase === PlantPhase.DEAD) continue;
    if (currentPhase.phase === PlantPhase.MATURE) continue;
    if (!canApplyNormalFertilizer(plant)) continue;

    targets.push(landId);
  }
  return targets;
}

/**
 * 按普通肥剩余次数过滤目标；快照中不存在的空地/从属地块仍保留，
 * 避免因为土地接口暂时不完整而漏施。
 */
function filterLandIdsForNormalFertilizer(landIds, lands) {
  const ids = (Array.isArray(landIds) ? landIds : []).map(toNum).filter(Boolean);
  if (ids.length === 0) return [];
  const list = Array.isArray(lands) ? lands : [];
  if (list.length === 0) return [...ids];

  const applyable = new Set(getNormalFertilizerTargetsFromLands(list));
  const knownPlanted = new Set();
  for (const land of list) {
    const landId = toNum(land && land.id);
    if (!landId) continue;
    const plant = land.plant;
    if (plant && Array.isArray(plant.phases) && plant.phases.length > 0) {
      knownPlanted.add(landId);
    }
  }
  return ids.filter(id => applyable.has(id) || !knownPlanted.has(id));
}

/**
 * 获取即将成熟的地块（用于智能施肥）
 * @param {Array} lands - 地块数据
 * @param {number} thresholdSec - 距成熟时间阈值（秒），默认 3600（1小时）
 */
function getFastMatureLands(lands, thresholdSec = 3600) {
  const list = Array.isArray(lands) ? lands : [];
  const result = [];
  const serverTime = getServerTimeSec();
  const threshold = Math.max(0, toNum(thresholdSec) || 3600);

  for (const land of list) {
    if (!land || !land.unlocked) continue;
    const landId = toNum(land.id);
    if (!landId) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(plant.phases, false, '', plant.id);
    if (!currentPhase) continue;
    if (currentPhase.phase === PlantPhase.DEAD) continue;
    if (currentPhase.phase === PlantPhase.MATURE) continue;

    // 查找成熟阶段
    const maturePhase = plant.phases
      .filter(p => p && toTimeSec(p.begin_time) > 0)
      .sort((left, right) => toTimeSec(right.begin_time) - toTimeSec(left.begin_time))[0];
    if (!maturePhase) continue;

    const matureTime = toTimeSec(maturePhase.begin_time);
    if (matureTime <= 0) continue;

    const remaining = matureTime - serverTime;
    if (remaining <= threshold && remaining >= 0) {
      // left_inorc_fert_times 只限制普通肥，不能阻止快成熟作物施有机肥。
      result.push(landId);
    }
  }
  return result;
}

/**
 * 获取处于成熟前最后一个生长阶段的地块（用于最终阶段施肥）
 * @param {Array} lands - 地块数据
 * @param {object} options - { organicOnly }
 * @returns {number[]} 最终阶段地块 ID
 */
function getFinalStageLands(lands, options = {}) {
  const list = Array.isArray(lands) ? lands : [];
  const result = [];
  const organicOnly = !!options.organicOnly;

  for (const land of list) {
    if (!land || !land.unlocked) continue;
    const landId = toNum(land.id);
    if (!landId) continue;

    const plant = land.plant;
    if (!plant || !Array.isArray(plant.phases) || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(plant.phases, false, '', plant.id);
    if (!currentPhase) continue;

    const currentPhaseValue = toNum(currentPhase.phase);
    if (currentPhaseValue === PlantPhase.DEAD) continue;
    if (currentPhaseValue === PlantPhase.MATURE) continue;

    const orderedPhases = plant.phases
      .map((phase, index) => ({
        phase,
        index,
        beginTime: toTimeSec(phase && phase.begin_time)
      }))
      .filter(item => item.beginTime > 0)
      .sort((a, b) => (a.beginTime - b.beginTime) || (a.index - b.index));

    // 多数作物成熟阶段 phase=6，但部分作物会返回 phase=2 + phase_id=19。
    // 服务端 phases 以当前阶段开头、以成熟阶段结尾，找不到显式成熟标记时使用最后一项。
    let matureIndex = orderedPhases.findIndex(
      item => toNum(item.phase && item.phase.phase) === PlantPhase.MATURE
    );
    if (matureIndex < 0) matureIndex = orderedPhases.length - 1;
    if (matureIndex <= 0) continue;

    // getCurrentPhase 返回的是副本，不能用对象引用和原始阶段比较。
    // 服务端 phases[0] 就是当前阶段，优先按原始引用匹配。
    const currentRawPhase = plant.phases[0];
    let currentIndex = orderedPhases.findIndex(item => item.phase === currentRawPhase);
    if (currentIndex < 0) {
      const currentBeginTime = toTimeSec(currentRawPhase && currentRawPhase.begin_time);
      currentIndex = orderedPhases.findIndex(item => item.beginTime === currentBeginTime);
    }
    if (currentIndex !== matureIndex - 1) continue;

    // 普通肥受本季剩余次数限制；有机肥不受该字段限制。
    if (!organicOnly && !canApplyNormalFertilizer(plant)) continue;

    result.push(landId);
  }

  return result;
}

/** 根据等级获取土地类型 */
function getLandTypeByLevel(level) {
  const lv = toNum(level);
  if (lv === 5) return 'purple';   // 紫土地
  if (lv === 4) return 'gold';     // 金土地
  if (lv === 3) return 'black';    // 黑土地
  if (lv === 2) return 'red';      // 红土地
  return 'normal';
}

/** 标准化施肥土地类型列表 */
function normalizeFertilizerLandTypes(types) {
  const input = Array.isArray(types) ? types : ALL_FERTILIZER_LAND_TYPES;
  const result = [];
  for (const t of input) {
    const normalized = String(t || '').trim().toLowerCase();
    if (!ALL_FERTILIZER_LAND_TYPES.includes(normalized)) continue;
    if (result.includes(normalized)) continue;
    result.push(normalized);
  }
  return result;
}

/** 按土地类型过滤地块 ID */
function filterLandIdsByTypes(landIds, landTypeMap, allowedTypes) {
  const ids = Array.isArray(landIds) ? landIds : [];
  const typeSet = new Set(normalizeFertilizerLandTypes(allowedTypes));
  if (typeSet.size === 0) return [];
  if (typeSet.size === ALL_FERTILIZER_LAND_TYPES.length) return [...ids];

  const result = [];
  for (const landId of ids) {
    const landType = String(landTypeMap.get(landId) || '');
    if (!landType) continue;
    if (typeSet.has(landType)) result.push(landId);
  }
  return result;
}

/** 格式化土地类型为中文标签 */
function formatFertilizerLandTypes(types) {
  return normalizeFertilizerLandTypes(types).map(t => FERTILIZER_LAND_TYPE_LABELS[t] || t);
}

// ─── 核心施肥逻辑 ───

/**
 * 根据配置执行施肥
 * @param {number[]} explicitLandIds - 指定地块 ID（空数组则自动获取）
 * @param {object} options - { reason, skipNormal }
 * @returns {{ normal: number, organic: number }}
 */
async function runFertilizerByConfig(explicitLandIds = [], options = {}) {
  const automation = getAutomation() || {};
  const mode = automation.fertilizer || 'none';
  const reason = String(options.reason || '').trim().toLowerCase() === 'multi_season' ? 'multi_season' : 'normal';
  const label = reason === 'multi_season' ? '多季补肥' : '常规施肥';
  const eventLabel = reason === 'multi_season' ? '多季节施肥' : '常规施肥';
  const landTypes = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
  const landTypeLabels = formatFertilizerLandTypes(landTypes);

  if (reason === 'multi_season' && mode === 'final_normal') {
    log('施肥', '多季补肥：当前策略为最终阶段普通肥，跳过本轮多季补肥', {
      module: 'farm', event: eventLabel, result: 'skip', reason, type: 'normal'
    });
    return { normal: 0, organic: 0 };
  }

  const explicitIds = [...new Set(
    (Array.isArray(explicitLandIds) ? explicitLandIds : [])
      .map(id => toNum(id))
      .filter(Boolean)
  )];

  // 没有选中土地类型 → 跳过
  if (landTypes.length === 0) {
    log('施肥', `${label}：未勾选施肥范围，跳过本轮施肥`, {
      module: 'farm', event: eventLabel, result: 'skip', reason, scope: 'none'
    });
    return { normal: 0, organic: 0 };
  }

  const { skipNormal = false } = options;

  // 没有指定地块且非有机模式 → 空返回
  if (explicitIds.length === 0 &&
      mode !== 'organic' && mode !== 'both' &&
      mode !== 'smart' && mode !== 'smart_only' && mode !== 'smart_normal' &&
      mode !== 'final_normal' && mode !== 'final_organic') {
    return { normal: 0, organic: 0 };
  }

  // 获取全农场土地信息构建类型映射
  let allLands = [];
  const landTypeMap = new Map();
  try {
    const landsReply = await getAllLands();
    allLands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
    for (const land of allLands) {
      if (!land) continue;
      const landId = toNum(land.id);
      if (!landId) continue;
      landTypeMap.set(landId, getLandTypeByLevel(land.level));
    }
  } catch (err) {
    if (!isTransientNetworkError(err)) {
      logWarn('施肥', `${label}：获取土地信息失败，按已知地块继续: ${err.message}`, {
        module: 'farm', event: eventLabel, result: 'error', reason
      });
    }
  }

  const isAllTypes = landTypes.length === ALL_FERTILIZER_LAND_TYPES.length;

  if (landTypeMap.size === 0 && !isAllTypes) {
    logWarn('施肥', `${label}：无法确认土地类型，已跳过本轮施肥`, {
      module: 'farm', event: eventLabel, result: 'skip', reason, landTypes
    });
    return { normal: 0, organic: 0 };
  }

  const willApplyNormal = !skipNormal
    && (mode === 'normal' || mode === 'both' || mode === 'smart');

  let targetIds = explicitIds;
  if (landTypeMap.size > 0) {
    targetIds = filterLandIdsByTypes(explicitIds, landTypeMap, landTypes);
  }
  if (willApplyNormal && allLands.length > 0 && targetIds.length > 0) {
    const filtered = filterLandIdsForNormalFertilizer(targetIds, allLands);
    if (filtered.length !== targetIds.length) {
      log('施肥', `${label}：按普通肥剩余次数筛掉 ${targetIds.length - filtered.length} 块（还可施 ${filtered.length} 块）`, {
        module: 'farm', event: eventLabel, result: 'skip', reason,
        type: 'normal', count: filtered.length, skipped: targetIds.length - filtered.length
      });
    }
    targetIds = filtered;
  }

  let normalCount = 0;
  let organicCount = 0;

  // 普通化肥
  if (willApplyNormal && targetIds.length > 0) {
    normalCount = await fertilize(targetIds, NORMAL_FERTILIZER_ID);
    if (normalCount > 0) {
      log('施肥', `${label}：已为 ${normalCount}/${targetIds.length} 块地施普通化肥（范围: ${landTypeLabels.join('、')}）`, {
        module: 'farm', event: eventLabel, result: 'ok', reason, type: 'normal',
        count: normalCount, landTypes
      });
      recordOperation('fertilize', normalCount);
    }
  }

  // 有机化肥
  if (mode === 'organic' || mode === 'both') {
    let organicTargets = explicitIds;
    if (allLands.length > 0) {
      organicTargets = getOrganicFertilizerTargetsFromLands(allLands);
    }
    if (reason === 'multi_season' && explicitIds.length > 0) {
      const explicitIdSet = new Set(explicitIds);
      organicTargets = organicTargets.filter(id => explicitIdSet.has(id));
    }
    if (landTypeMap.size > 0) {
      organicTargets = filterLandIdsByTypes(organicTargets, landTypeMap, landTypes);
    }
    organicCount = await fertilizeOrganicLoop(organicTargets);
    if (organicCount > 0) {
      log('施肥', `${label}：有机化肥循环施肥完成，共施 ${organicCount} 次（范围: ${landTypeLabels.join('、')}）`, {
        module: 'farm', event: eventLabel, result: 'ok', reason, type: 'organic',
        count: organicCount, landTypes
      });
      recordOperation('fertilize', organicCount);
    }
  } else if (mode === 'smart' || mode === 'smart_only' || mode === 'smart_normal' ||
      mode === 'final_normal' || mode === 'final_organic') {
    // 智能/最终阶段施肥：寻找目标作物施肥
    let targetFertilizerLands = [];
    const isFinalStageMode = mode === 'final_normal' || mode === 'final_organic';
    const explicitIdSet = new Set(explicitIds);

    if (isFinalStageMode) {
      targetFertilizerLands = getFinalStageLands(allLands, { organicOnly: mode === 'final_organic' });
      if (explicitIdSet.size > 0) {
        targetFertilizerLands = targetFertilizerLands.filter(id => explicitIdSet.has(id));
      }
    } else {
      const smartSeconds = toNum(automation.fertilizer_smart_seconds) || 3600;

      try {
        const landsReply = await getAllLands();
        targetFertilizerLands = getFastMatureLands(landsReply && landsReply.lands, smartSeconds);
      } catch (err) {
        if (!isTransientNetworkError(err)) {
          logWarn('施肥', `获取全农场地块失败: ${err.message}`);
        }
      }
    }

    if (landTypeMap.size > 0) {
      targetFertilizerLands = filterLandIdsByTypes(targetFertilizerLands, landTypeMap, landTypes);
    }

    const useOrganic = mode === 'smart' || mode === 'smart_only' || mode === 'final_organic';
    if (!useOrganic && allLands.length > 0 && targetFertilizerLands.length > 0) {
      const filtered = filterLandIdsForNormalFertilizer(targetFertilizerLands, allLands);
      if (filtered.length !== targetFertilizerLands.length) {
        log('施肥', `${label}：按普通肥剩余次数筛掉 ${targetFertilizerLands.length - filtered.length} 块（还可施 ${filtered.length} 块）`, {
          module: 'farm', event: eventLabel, result: 'skip', reason,
          type: 'normal', count: filtered.length,
          skipped: targetFertilizerLands.length - filtered.length
        });
      }
      targetFertilizerLands = filtered;
    }

    if (targetFertilizerLands.length > 0) {
      const typeLabel = useOrganic ? '有机' : '普通';
      const fertId = useOrganic ? ORGANIC_FERTILIZER_ID : NORMAL_FERTILIZER_ID;
      const modeLabel = isFinalStageMode ? '最终阶段' : '快成熟';

      if (useOrganic) {
        organicCount = await fertilizeOrganicLoop(targetFertilizerLands);
      } else {
        normalCount = await fertilize(targetFertilizerLands, fertId);
      }

      const totalCount = useOrganic ? organicCount : normalCount;
      if (totalCount > 0) {
        log('施肥', `${typeLabel}化肥${modeLabel}施肥完成，共施 ${totalCount} 次（范围: ${landTypeLabels.join('、')}）`, {
          module: 'farm', event: '施肥', result: 'ok',
          type: useOrganic ? 'organic' : 'normal', count: totalCount
        });
        recordOperation('fertilize', totalCount);
      }
    }
  }

  return { normal: normalCount, organic: organicCount };
}

module.exports = {
  ALL_FERTILIZER_LAND_TYPES,
  FERTILIZER_LAND_TYPE_LABELS,
  getLeftInorcFertTimes,
  canApplyNormalFertilizer,
  getOrganicFertilizerTargetsFromLands,
  getNormalFertilizerTargetsFromLands,
  filterLandIdsForNormalFertilizer,
  getFastMatureLands,
  getFinalStageLands,
  runFertilizerByConfig
};

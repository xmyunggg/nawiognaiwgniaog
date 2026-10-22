const num = value => Number(value?.toString?.() ?? value) || 0;

function buildHarvestEvents(lands, nowSec) {
  const events = [];
  const seen = new Set();

  for (const land of Array.isArray(lands) ? lands : []) {
    const id = num(land?.id);
    if (!id || seen.has(id) || !land?.unlocked)
      continue;
    seen.add(id);

    if (land.status !== 'growing' && land.status !== 'harvestable')
      continue;
    if (land.occupiedByMaster || (num(land.masterLandId) && num(land.masterLandId) !== id))
      continue;

    const exp = num(land.harvestExp);
    if (exp <= 0)
      continue;

    const matureAt = num(land.harvestAt);
    if (land.status !== 'harvestable' && matureAt <= 0)
      continue;

    const at = land.status === 'harvestable' ? nowSec : Math.max(matureAt, nowSec);
    events.push({ landId: id, at, exp });
  }

  return events.sort((a, b) => a.at - b.at || a.landId - b.landId);
}

function calculateLevelForecast(options) {
  const nowSec = num(options?.nowSec);
  const remainingExp = Math.max(0, num(options?.remainingExp));
  const base = {
    generatedAt: nowSec * 1000,
    remainingExp,
    scheduledExp: 0,
    plotCount: 0,
    readyExp: 0,
    estimatedAt: null,
    source: 'unavailable',
    automatic: !!options?.autoHarvest && !options?.quiet,
  };

  if (!options?.connected || remainingExp <= 0)
    return base;

  const events = buildHarvestEvents(options.lands || [], nowSec);
  base.scheduledExp = events.reduce((sum, event) => sum + event.exp, 0);
  base.plotCount = events.length;
  base.readyExp = events
    .filter(event => event.at <= nowSec)
    .reduce((sum, event) => sum + event.exp, 0);

  let total = 0;
  for (const event of events) {
    total += event.exp;
    if (total >= remainingExp) {
      return {
        ...base,
        source: event.at <= nowSec ? 'ready' : 'planted',
        estimatedAt: event.at * 1000,
      };
    }
  }

  // 已排期的收获经验不足时，只有开启自动收获才继续用工时均速估算。
  const rate = Math.max(0, num(options?.historyRate));
  if (rate <= 0 || !base.automatic)
    return base;

  const startAt = events.length ? events.at(-1).at : nowSec;
  const estimatedAt = (startAt + Math.ceil((remainingExp - total) / rate * 3600)) * 1000;
  return { ...base, source: events.length ? 'mixed' : 'history', estimatedAt };
}

module.exports = {
  buildHarvestEvents,
  calculateLevelForecast,
};

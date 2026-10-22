const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHarvestEvents, calculateLevelForecast } = require('../src/services/level-forecast');

const NOW = 1_700_000_000;

function land(overrides) {
  return {
    id: 1,
    unlocked: true,
    status: 'growing',
    harvestAt: NOW + 600,
    harvestExp: 100,
    ...overrides,
  };
}

test('buildHarvestEvents keeps one event per planted footprint and sorts by time', () => {
  const events = buildHarvestEvents([
    land({ id: 2, harvestAt: NOW + 900 }),
    land({ id: 1, status: 'harvestable', harvestAt: NOW - 60 }),
    land({ id: 3, status: 'empty', harvestExp: 0 }),
    land({ id: 4, harvestAt: 0 }),
    land({ id: 2, harvestAt: NOW + 900 }),
  ], NOW);

  assert.deepEqual(events, [
    { landId: 1, at: NOW, exp: 100 },
    { landId: 2, at: NOW + 900, exp: 100 },
  ]);
});

test('calculateLevelForecast reports ready when current harvests are enough', () => {
  const forecast = calculateLevelForecast({
    lands: [land({ id: 1, status: 'harvestable' })],
    nowSec: NOW,
    remainingExp: 100,
    connected: true,
    autoHarvest: true,
  });

  assert.equal(forecast.source, 'ready');
  assert.equal(forecast.estimatedAt, NOW * 1000);
  assert.equal(forecast.scheduledExp, 100);
});

test('calculateLevelForecast reports planted time when scheduled harvest is enough', () => {
  const forecast = calculateLevelForecast({
    lands: [land({ harvestExp: 300 })],
    nowSec: NOW,
    remainingExp: 200,
    connected: true,
    autoHarvest: true,
  });

  assert.equal(forecast.source, 'planted');
  assert.equal(forecast.estimatedAt, (NOW + 600) * 1000);
});

test('calculateLevelForecast only uses history rate when automatic harvest is enabled', () => {
  const base = {
    lands: [land({ harvestExp: 100 })],
    nowSec: NOW,
    remainingExp: 300,
    historyRate: 600,
    connected: true,
  };

  const manual = calculateLevelForecast({ ...base, autoHarvest: false });
  assert.equal(manual.source, 'unavailable');
  assert.equal(manual.estimatedAt, null);

  const automatic = calculateLevelForecast({ ...base, autoHarvest: true });
  assert.equal(automatic.source, 'mixed');
  assert.equal(automatic.estimatedAt, (NOW + 600 + 1200) * 1000);
});

test('calculateLevelForecast returns unavailable when disconnected or level is complete', () => {
  assert.equal(calculateLevelForecast({
    lands: [land()],
    nowSec: NOW,
    remainingExp: 100,
    connected: false,
  }).source, 'unavailable');
  assert.equal(calculateLevelForecast({
    lands: [land()],
    nowSec: NOW,
    remainingExp: 0,
    connected: true,
  }).source, 'unavailable');
});

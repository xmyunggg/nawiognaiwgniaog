const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-stats-ops-'));
process.env.FARM_DATA_DIR = tmpDir;

const stats = require('../src/services/stats');
const { OPERATION_KEYS } = require('../src/runtime/runtime-engine');

test('新增动作（放虫/放草/土地升级/等级提升）可累计并持久化', () => {
  stats.initStatsWithPersistence('ops-account', 1000, 100, 0);

  stats.recordOperation('putBug', 2);
  stats.recordOperation('putWeed', 1);
  stats.recordOperation('helpWater', 3);
  stats.recordOperation('helpWeed', 4);
  stats.recordOperation('helpBug', 5);
  stats.recordOperation('upgrade', 1);
  stats.recordOperation('levelUp', 1);

  const snapshot = stats.getStats(
    { level: 12, name: 'tester' },
    { gold: 1000, exp: 100 },
    false,
    {}
  );

  assert.equal(snapshot.operations.putBug, 2);
  assert.equal(snapshot.operations.putWeed, 1);
  assert.equal(snapshot.operations.helpWater, 3);
  assert.equal(snapshot.operations.helpWeed, 4);
  assert.equal(snapshot.operations.helpBug, 5);
  assert.equal(snapshot.operations.upgrade, 1);
  assert.equal(snapshot.operations.levelUp, 1);

  stats.saveStats();
  const filePath = path.join(tmpDir, 'stats', 'ops-account.json');
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.operations.putBug, 2);
  assert.equal(persisted.operations.putWeed, 1);
  assert.equal(persisted.operations.upgrade, 1);
  assert.equal(persisted.operations.levelUp, 1);
});

test('未知动作类型不会污染统计', () => {
  stats.initStatsWithPersistence('ops-unknown', 0, 0, 0);
  stats.recordOperation('not-an-action', 9);

  const snapshot = stats.getStats({}, {}, false, {});
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.operations, 'not-an-action'), false);
});

test('运行时操作键包含放虫/放草/黄金虫与等级提升，离线也不会丢项', () => {
  for (const key of ['putBug', 'putWeed', 'goldenBugClear', 'goldenBugPut', 'upgrade', 'levelUp', 'tongQiGift']) {
    assert.equal(OPERATION_KEYS.includes(key), true, `缺少操作键: ${key}`);
  }
});

test('好友捣乱按放虫/放草计数，不再混入自家除草除虫', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/friend-visit.js'), 'utf8');
  assert.match(source, /recordOperation\('putBug'/);
  assert.match(source, /recordOperation\('putWeed'/);
  assert.doesNotMatch(source, /recordOperation\('bug'/);
  assert.doesNotMatch(source, /recordOperation\('weed'/);
});

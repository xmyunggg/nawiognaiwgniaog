const test = require('node:test');
const assert = require('node:assert/strict');

const { collectBadCandidates } = require('../src/services/friend-orchestrator');

test('bad candidates include friends with growing crops', () => {
  const friends = [
    {
      gid: 1001,
      name: 'growing crop',
      level: 30,
      plant: { dry_num: 0, weed_num: 0, insect_num: 0 },
    },
    {
      gid: 1002,
      name: 'crop with issues',
      level: 40,
      plant: { dry_num: 1, weed_num: 2, insect_num: 1 },
    },
  ];

  const candidates = collectBadCandidates(friends, 999, new Set());
  assert.deepEqual(candidates.map(item => item.gid), [1002, 1001]);
});

test('bad candidates skip empty farms, self, blacklist and duplicates', () => {
  const friends = [
    { gid: 1001, name: 'empty farm', level: 50, plant: null },
    { gid: 2002, name: 'self', level: 99, plant: { dry_num: 0 } },
    { gid: 3003, name: 'blacklisted', level: 80, plant: { dry_num: 0 } },
    { gid: 4004, name: 'valid', level: 20, plant: { dry_num: 0, weed_num: 0 } },
    { gid: 4004, name: 'duplicate', level: 21, plant: { dry_num: 0, weed_num: 0 } },
  ];

  const candidates = collectBadCandidates(friends, 2002, new Set([3003]));
  assert.deepEqual(candidates.map(item => item.gid), [4004]);
});

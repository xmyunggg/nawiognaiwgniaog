const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getLeftInorcFertTimes,
  canApplyNormalFertilizer,
  getOrganicFertilizerTargetsFromLands,
  getNormalFertilizerTargetsFromLands,
  filterLandIdsForNormalFertilizer,
  getFastMatureLands,
  getFinalStageLands,
} = require('../src/services/farm-fertilizer');

const nowSec = () => Math.floor(Date.now() / 1000);

function land(id, plant, extra = {}) {
  return {
    id,
    unlocked: true,
    level: 1,
    ...extra,
    plant,
  };
}

function growingPlant(overrides = {}) {
  return {
    id: 1,
    season: 1,
    left_inorc_fert_times: 1,
    phases: [{ phase: 2, begin_time: nowSec() - 60 }],
    ...overrides,
  };
}

function finalStagePlant(leftInorcFertTimes) {
  const now = nowSec();
  const plant = {
    id: 1,
    season: 1,
    phases: [
      { phase: 2, begin_time: now - 60 },
      { phase: 6, begin_time: now + 120 },
    ],
  };
  if (leftInorcFertTimes !== null) plant.left_inorc_fert_times = leftInorcFertTimes;
  return plant;
}

test('left_inorc_fert_times is the normal-fertilizer remaining count for this season', () => {
  assert.equal(getLeftInorcFertTimes({ left_inorc_fert_times: 0 }), 0);
  assert.equal(getLeftInorcFertTimes({ left_inorc_fert_times: 2 }), 2);
  assert.equal(getLeftInorcFertTimes({}), null);
  assert.equal(canApplyNormalFertilizer({ left_inorc_fert_times: 0 }), false);
  assert.equal(canApplyNormalFertilizer({ left_inorc_fert_times: 1 }), true);
  assert.equal(canApplyNormalFertilizer({}), false);
});

test('organic fertilizer targets are not blocked by exhausted normal-fertilizer limits', () => {
  const lands = [
    land(1, growingPlant({ left_inorc_fert_times: 0 })),
    land(2, growingPlant({ left_inorc_fert_times: 0 })),
  ];

  assert.deepEqual(getOrganicFertilizerTargetsFromLands(lands), [1, 2]);
});

test('fast-mature organic targets include lands whose normal-fertilizer limit is exhausted', () => {
  const now = nowSec();
  const lands = [
    land(1, {
      id: 1,
      left_inorc_fert_times: 0,
      phases: [
        { phase: 2, begin_time: now - 60 },
        { phase: 6, begin_time: now + 120 },
      ],
    }),
    land(2, {
      id: 1,
      left_inorc_fert_times: 0,
      phases: [
        { phase: 2, begin_time: now - 60 },
        { phase: 6, begin_time: now + 900 },
      ],
    }),
  ];

  assert.deepEqual(getFastMatureLands(lands, 300), [1]);
});

test('normal fertilizer targets require a remaining normal-fertilizer count and a growing crop', () => {
  const now = nowSec();
  const lands = [
    land(1, growingPlant({ left_inorc_fert_times: 1 })),
    land(2, growingPlant({ left_inorc_fert_times: 0 })),
    land(3, {
      id: 1,
      left_inorc_fert_times: 1,
      phases: [{ phase: 6, begin_time: now - 10 }],
    }),
    land(4, null),
    land(5, growingPlant({ left_inorc_fert_times: 1 }), { unlocked: false }),
  ];

  assert.deepEqual(getNormalFertilizerTargetsFromLands(lands), [1]);
});

test('filterLandIdsForNormalFertilizer drops exhausted known crops but keeps unknown lands', () => {
  const lands = [
    land(1, growingPlant({ left_inorc_fert_times: 1 })),
    land(2, growingPlant({ left_inorc_fert_times: 0 })),
    { id: 3, unlocked: true },
  ];

  assert.deepEqual(filterLandIdsForNormalFertilizer([1, 2, 3, 99], lands), [1, 3, 99]);
  assert.deepEqual(filterLandIdsForNormalFertilizer([1, 2], []), [1, 2]);
});

test('final-stage organic targets do not read the normal-fertilizer remaining count', () => {
  const lands = [land(1, finalStagePlant(0))];

  assert.deepEqual(getFinalStageLands(lands, { organicOnly: true }), [1]);
});

test('final-stage normal targets are limited by the normal-fertilizer remaining count', () => {
  const lands = [
    land(1, finalStagePlant(0)),
    land(2, finalStagePlant(1)),
    land(3, finalStagePlant(null)),
  ];

  assert.deepEqual(getFinalStageLands(lands, { organicOnly: false }), [2]);
});

test('final-stage targets support crops whose mature phase is phase 2 with phase_id 19', () => {
  const now = nowSec();
  const lands = [
    land(1, {
      id: 1,
      left_inorc_fert_times: 1,
      phases: [
        { phase: 2, begin_time: now - 60 },
        { phase: 2, phase_id: 19, begin_time: now + 120 },
      ],
    }),
  ];

  assert.deepEqual(getFinalStageLands(lands, { organicOnly: false }), [1]);
});

test('final-stage targets only include the phase immediately before maturity', () => {
  const now = nowSec();
  const lands = [
    land(1, {
      id: 1,
      left_inorc_fert_times: 1,
      phases: [
        { phase: 2, begin_time: now - 90 },
        { phase: 3, begin_time: now + 60 },
        { phase: 6, begin_time: now + 180 },
      ],
    }),
    land(2, {
      id: 1,
      left_inorc_fert_times: 1,
      phases: [
        { phase: 3, begin_time: now - 60 },
        { phase: 6, begin_time: now + 120 },
      ],
    }),
  ];

  assert.deepEqual(getFinalStageLands(lands, { organicOnly: false }), [2]);
});

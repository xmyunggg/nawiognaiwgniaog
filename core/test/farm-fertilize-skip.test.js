const test = require('node:test');
const assert = require('node:assert/strict');

function mockModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports };
}

const servicePath = require.resolve('../src/services/farm-api');
const networkPath = require.resolve('../src/utils/network');
const protoPath = require.resolve('../src/utils/proto');
const utilsPath = require.resolve('../src/utils/utils');

test('skippable per-land fertilize errors are recognized by field or message', () => {
  const {
    getGatewayErrorCode,
    isSkippableFertilizeLandError,
  } = require('../src/services/farm-api');

  assert.equal(getGatewayErrorCode({ code: 1001024 }), 1001024);
  assert.equal(getGatewayErrorCode(new Error('PlantService.Fertilize 错误: code=1001025 之前阶段已使用该化肥')), 1001025);
  assert.equal(isSkippableFertilizeLandError({ code: 1001024 }), true);
  assert.equal(isSkippableFertilizeLandError({ errorCode: 1001025 }), true);
  assert.equal(isSkippableFertilizeLandError(new Error('code=1000019 化肥不足')), false);
  assert.equal(isSkippableFertilizeLandError(new Error('network down')), false);
});

test('fertilize skips skippable lands and continues, then stops on other errors', async () => {
  const previous = new Map([networkPath, protoPath, utilsPath].map(path => [path, require.cache[path]]));
  const sentLands = [];

  require.cache[networkPath] = mockModule(networkPath, {
    sendMsgAsync: async () => {
      const landId = sentLands[sentLands.length - 1];
      if (landId === 2) throw new Error('PlantService.Fertilize 错误: code=1001025 之前阶段已使用该化肥');
      if (landId === 4) throw new Error('PlantService.Fertilize 错误: code=1000019 化肥不足');
      return { body: Buffer.alloc(0) };
    },
    getUserState: () => ({ gid: 1 }),
  });
  require.cache[protoPath] = mockModule(protoPath, {
    types: {
      FertilizeRequest: {
        create: value => {
          sentLands.push(Number(value.land_ids[0]));
          return value;
        },
        encode: () => ({ finish: () => Buffer.alloc(0) }),
      },
    },
    waitForProtoReady: async () => {},
  });
  require.cache[utilsPath] = mockModule(utilsPath, {
    toLong: value => value,
    toNum: value => Number(value) || 0,
    sleep: async () => {},
    log: () => {},
  });

  delete require.cache[servicePath];
  try {
    const { fertilize } = require('../src/services/farm-api');
    const count = await fertilize([1, 2, 3, 4, 5], 1011);

    assert.equal(count, 2);
    assert.deepEqual(sentLands, [1, 2, 3, 4]);
  } finally {
    delete require.cache[servicePath];
    for (const [path, cached] of previous) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  }
});

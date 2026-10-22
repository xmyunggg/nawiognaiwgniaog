const test = require('node:test');
const assert = require('node:assert/strict');

const wxLoginAdapter = require('../src/services/wx-login-adapter');
const { createAutoCodeRefreshService } = require('../src/runtime/auto-code-refresh');

function createAccount(overrides = {}) {
  return {
    id: 'acc-1',
    name: '测试号',
    platform: 'wx',
    wxid: 'wxid-1',
    loginBuffer: 'login-buffer',
    ...overrides,
  };
}

function createHarness({ running = false, account = createAccount(), getFarmCode } = {}) {
  const calls = [];
  const updated = [];
  const service = createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: () => ({ enabled: true, intervalMinutes: 60 }),
    },
    getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: (next) => {
      updated.push(next);
      Object.assign(account, next);
    },
    resolveWorkerControls: () => ({
      restartWorker: (next) => calls.push(['restart', String(next.id)]),
    }),
    isAccountRunning: () => running,
    log: () => {},
    addAccountLog: (...args) => calls.push(['accountLog', ...args]),
  });

  const originalGetFarmCode = wxLoginAdapter.getFarmCode;
  const originalKeepalive = wxLoginAdapter.keepWxCredentialAlive;
  const farmCodeCalls = [];
  const keepaliveCalls = [];

  wxLoginAdapter.getFarmCode = async (...args) => {
    farmCodeCalls.push(args);
    if (getFarmCode) return getFarmCode(...args);
    return { Success: true, Data: { code: `code-${farmCodeCalls.length}` } };
  };
  wxLoginAdapter.keepWxCredentialAlive = async (...args) => {
    keepaliveCalls.push(args);
    return { Success: true };
  };

  return {
    service,
    calls,
    updated,
    farmCodeCalls,
    keepaliveCalls,
    restore() {
      wxLoginAdapter.getFarmCode = originalGetFarmCode;
      wxLoginAdapter.keepWxCredentialAlive = originalKeepalive;
    },
  };
}

test('manual Code refresh for a stopped account updates the code without starting the worker', async () => {
  const harness = createHarness({ running: false });
  try {
    const ok = await harness.service.refreshAccountCode('acc-1', 'manual');

    assert.equal(ok, true);
    assert.equal(harness.farmCodeCalls.length, 1);
    assert.equal(harness.updated.length, 1);
    assert.equal(harness.updated[0].code, 'code-1');
    assert.deepEqual(harness.calls.filter(([type]) => type === 'restart'), []);
  } finally {
    harness.restore();
  }
});

test('manual Code refresh restarts a running account so the new code takes effect', async () => {
  const harness = createHarness({ running: true });
  try {
    const ok = await harness.service.refreshAccountCode('acc-1', 'manual');

    assert.equal(ok, true);
    assert.deepEqual(harness.calls.filter(([type]) => type === 'restart'), [['restart', 'acc-1']]);
  } finally {
    harness.restore();
  }
});

test('manual_start never restarts because startAccount starts the worker explicitly', async () => {
  const harness = createHarness({ running: true });
  try {
    const ok = await harness.service.refreshAccountCode('acc-1', 'manual_start');

    assert.equal(ok, true);
    assert.deepEqual(harness.calls.filter(([type]) => type === 'restart'), []);
  } finally {
    harness.restore();
  }
});

test('recovery refresh still restarts an offline account', async () => {
  const harness = createHarness({ running: false });
  try {
    const ok = await harness.service.refreshAccountCode('acc-1', 'ws_400');

    assert.equal(ok, true);
    assert.deepEqual(harness.calls.filter(([type]) => type === 'restart'), [['restart', 'acc-1']]);
  } finally {
    harness.restore();
  }
});

test('concurrent refreshes for the same account share one code request', async () => {
  const harness = createHarness({
    running: false,
    getFarmCode: async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return { Success: true, Data: { code: 'shared-code' } };
    },
  });
  try {
    const [first, second] = await Promise.all([
      harness.service.refreshAccountCode('acc-1', 'manual'),
      harness.service.refreshAccountCode('acc-1', 'timer'),
    ]);

    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(harness.farmCodeCalls.length, 1);
    assert.equal(harness.updated.length, 1);
  } finally {
    harness.restore();
  }
});

test('a recent credential keepalive is reused by the next Code refresh', async () => {
  const harness = createHarness({
    account: createAccount({ refreshtoken: 'refresh-token' }),
  });
  try {
    assert.equal(await harness.service.refreshAccountCode('acc-1', 'manual'), true);
    assert.equal(await harness.service.refreshAccountCode('acc-1', 'manual'), true);

    assert.equal(harness.farmCodeCalls.length, 2);
    assert.equal(harness.keepaliveCalls.length, 1);
  } finally {
    harness.restore();
  }
});

test('fresh scan credentials skip the extra keepalive round trip', async () => {
  const harness = createHarness({
    account: createAccount({ refreshtoken: 'refresh-token' }),
  });
  try {
    assert.equal(await harness.service.refreshAccountCode('acc-1', 'manual_start', {
      skipKeepalive: true,
    }), true);

    assert.equal(harness.farmCodeCalls.length, 1);
    assert.equal(harness.keepaliveCalls.length, 0);
  } finally {
    harness.restore();
  }
});

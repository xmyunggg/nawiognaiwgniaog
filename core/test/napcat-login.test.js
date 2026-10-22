const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const STORE_PATH = require.resolve('../src/models/store');
const SERVICE_PATH = require.resolve('../src/services/napcat-login');

function json(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

/**
 * 注入假的 store，避免测试读到 core/data/store.json 里的真实 NapCat 配置。
 * 测试结束后恢复原缓存。
 */
function loadServiceWithSettings(settings) {
  const savedStore = require.cache[STORE_PATH];
  const savedService = require.cache[SERVICE_PATH];
  require.cache[STORE_PATH] = {
    id: STORE_PATH,
    filename: STORE_PATH,
    loaded: true,
    exports: { getLoginSettings: () => ({ ...settings }) },
  };
  delete require.cache[SERVICE_PATH];
  const service = require(SERVICE_PATH);
  return {
    service,
    restore() {
      delete require.cache[SERVICE_PATH];
      if (savedStore) require.cache[STORE_PATH] = savedStore;
      else delete require.cache[STORE_PATH];
      if (savedService) require.cache[SERVICE_PATH] = savedService;
    },
  };
}

test('未配置 NapCat 时不可用', (t) => {
  const { service, restore } = loadServiceWithSettings({
    qqQrLogin: true, napCatEndpoint: '', napCatSignature: '',
  });
  t.after(restore);
  assert.equal(service.isConfigured(), false);
});

test('后台关闭 QQ 扫码后不可用（即使填了地址）', (t) => {
  const { service, restore } = loadServiceWithSettings({
    qqQrLogin: false, napCatEndpoint: 'http://napcat.test', napCatSignature: 'sig',
  });
  t.after(restore);
  assert.equal(service.isConfigured(), false);
});

test('QQ 扫码全流程：取二维码 → 轮询 → 取 Code，且校验签名头', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let polls = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/api/qq/login/qrcode') {
      return json({ ok: true, task: { id: 'remote-1', status: 'waiting_scan', qrImage: QR, expiresAt: Date.now() + 120000 } });
    }
    if (pathname === '/api/qq/login/status') {
      polls += 1;
      return json({
        ok: true,
        task: {
          id: 'remote-1',
          status: polls > 1 ? 'confirmed' : 'scanned',
          qrImage: QR,
          expiresAt: Date.now() + 120000,
        },
      });
    }
    if (pathname === '/api/qq/miniapp/code')
      return json({ ok: true, code: 'farm-code', uin: '12345', nickname: '测试昵称' });

    if (pathname === '/api/qq/logout') return json({ ok: true });
    return json({ ok: false, code: 'UNKNOWN' }, 404);
  };

  const { service, restore } = loadServiceWithSettings({
    qqQrLogin: true, napCatEndpoint: 'http://napcat.test', napCatSignature: 'test-signature',
  });
  t.after(() => { globalThis.fetch = originalFetch; restore(); });

  const task = await service.create('alice');
  assert.equal(task.status, 'waiting_scan');
  assert.equal(task.qrImage, QR);
  assert.equal(calls[0].headers['X-API-Signature'], 'test-signature');

  await assert.rejects(() => service.status(task.taskId, 'bob'), /不存在或已过期/);

  assert.equal((await service.status(task.taskId, 'alice')).status, 'scanned');
  assert.equal((await service.status(task.taskId, 'alice')).status, 'confirmed');

  assert.deepEqual(
    await service.code(task.taskId, 'alice'),
    { code: 'farm-code', uin: '12345', nickname: '测试昵称' },
  );

  // 取完 Code 后本地任务应释放
  await assert.rejects(() => service.status(task.taskId, 'alice'), /不存在或已过期/);
});

test('未确认扫码时拒绝取 Code', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({
    ok: true,
    task: { id: 'r2', status: 'waiting_scan', qrImage: QR, expiresAt: Date.now() + 60000 },
  });

  const { service, restore } = loadServiceWithSettings({
    qqQrLogin: true, napCatEndpoint: 'http://napcat.test', napCatSignature: 'sig',
  });
  t.after(() => { globalThis.fetch = originalFetch; restore(); });

  const task = await service.create('alice');
  await assert.rejects(() => service.code(task.taskId, 'alice'), /请先完成 QQ 扫码确认/);
  await service.cancel(task.taskId, 'alice');
});

test('签名错误时给出可读提示', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ ok: false, code: 'INVALID_SIGNATURE' });

  const { service, restore } = loadServiceWithSettings({
    qqQrLogin: true, napCatEndpoint: 'http://napcat.test', napCatSignature: 'bad',
  });
  t.after(() => { globalThis.fetch = originalFetch; restore(); });

  await assert.rejects(() => service.create('alice'), /签名无效/);
});

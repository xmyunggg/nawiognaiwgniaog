const crypto = require('node:crypto');

// QQ 小程序（农场）AppID
const APP_ID = '1112386029';
const TTL_MS = Math.max(30000, Number(process.env.NAPCAT_LOGIN_TTL_MS) || 120000);
const REQUEST_TIMEOUT_MS = 30000;

/**
 * 本地任务表：把前端拿到的本地 taskId 映射到 NapCat 返回的远端 taskId。
 * NapCat（liyangpengs/qq-farm-bot）的接口是 /api/qq/login/qrcode 这一套。
 */
const tasks = new Map();
let activeTaskId = '';

function trimUrl(value) { return String(value || '').trim().replace(/\/+$/, ''); }

/** 后台「系统配置 → 登录设置」里保存的 NapCat 参数；未配置时回落到环境变量 */
function storedSettings() {
  try {
    const store = require('../models/store');
    return typeof store.getLoginSettings === 'function' ? store.getLoginSettings() : null;
  } catch { return null; }
}

function config() {
  const stored = storedSettings() || {};
  // 后台配置优先；未填时回落到环境变量（Docker 部署）
  return {
    endpoint: trimUrl(stored.napCatEndpoint || process.env.NAPCAT_ENDPOINT || ''),
    signature: String(stored.napCatSignature || process.env.NAPCAT_SIGNATURE || '').trim(),
    enabledByAdmin: stored.qqQrLogin,
  };
}

function isConfigured() {
  const cfg = config();
  if (!cfg.endpoint || !cfg.signature) return false;
  // 后台显式关了 QQ 扫码就不允许再走环境变量兜底
  return cfg.enabledByAdmin !== false;
}

/** 兼容旧调用：本实现不缓存 WebUI 凭证，这里留空实现 */
function resetCredential() {}

function napCatErrorMessage(payload) {
  const code = String(payload?.code || '').trim().toUpperCase();
  switch (code) {
    case 'SIGNATURE_REQUIRED':
      return 'NapCat 接口签名缺失，请检查「登录设置」中的接口签名';
    case 'INVALID_SIGNATURE':
      return 'NapCat 接口签名无效，请检查「登录设置」中的接口签名';
    case 'WORKFLOW_BUSY':
      return 'NapCat 登录流程繁忙，请稍后重试';
    case 'LOGIN_REQUIRED':
      return 'QQ 登录尚未确认，请先完成扫码确认';
    case 'LOGOUT_REQUIRED':
      return '上一个 QQ 登录尚未注销，请稍后重试';
    case 'TASK_EXPIRED':
      return 'QQ 登录任务已过期，请重新获取二维码';
    default:
      return code ? `NapCat 接口返回失败（${code}）` : 'NapCat 接口请求失败';
  }
}

async function requestNapCat(path, body = {}, { requireOk = true } = {}) {
  const cfg = config();
  if (!cfg.endpoint || !cfg.signature)
    throw new Error('请先在「系统配置 → 登录设置」中配置 NapCat 接口地址和接口签名');

  let response;
  try {
    response = await fetch(`${cfg.endpoint}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Signature': cfg.signature,
      },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || /timeout/i.test(error?.message || ''))
      throw new Error('NapCat 接口请求超时，请检查服务状态');
    throw new Error(`无法连接 NapCat 接口，请检查地址和服务状态：${error.message}`);
  }

  if (!response.ok)
    throw new Error(`NapCat 接口返回 HTTP ${response.status}`);

  let payload;
  try { payload = await response.json(); } catch { throw new Error('NapCat 接口返回了无法解析的内容'); }

  if (requireOk && (!payload || typeof payload !== 'object' || payload.ok !== true))
    throw new Error(napCatErrorMessage(payload));
  return payload;
}

function normalizeRemoteTask(raw) {
  const task = raw?.task && typeof raw.task === 'object' ? raw.task : {};
  const remoteId = String(task.id || '').trim();
  if (!remoteId) throw new Error('NapCat 返回的登录任务无效');
  const qrImage = String(task.qrImage || '').trim();
  if (!qrImage) throw new Error('NapCat 未返回登录二维码');
  const expiresAt = Number(task.expiresAt);
  return {
    remoteId,
    status: String(task.status || 'waiting_scan').trim(),
    qrImage,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : Date.now() + TTL_MS,
  };
}

function taskPublic(task) {
  return {
    taskId: task.id,
    status: task.status,
    qrImage: task.qrImage || '',
    expiresAt: task.expiresAt,
    error: task.error || '',
  };
}

function ownedTask(id, owner) {
  const task = tasks.get(String(id || ''));
  if (!task || task.owner !== owner) throw new Error('登录任务不存在或已过期');
  return task;
}

function release(task) {
  if (task.timer) clearTimeout(task.timer);
  tasks.delete(task.id);
  if (activeTaskId === task.id) activeTaskId = '';
}

async function create(owner, { refresh = false } = {}) {
  if (!isConfigured()) throw new Error('QQ 扫码登录未配置或已在后台关闭');

  const current = tasks.get(activeTaskId);
  if (current) {
    if (current.owner !== owner && current.expiresAt > Date.now())
      throw new Error('已有 QQ 扫码任务正在进行，请稍后再试');
    if (current.expiresAt > Date.now() && !refresh && current.owner === owner)
      return taskPublic(current);
    release(current);
  }

  const remote = normalizeRemoteTask(await requestNapCat('/api/qq/login/qrcode', {}));
  const task = {
    id: crypto.randomBytes(18).toString('hex'),
    remoteId: remote.remoteId,
    owner,
    status: remote.status,
    qrImage: remote.qrImage,
    expiresAt: remote.expiresAt,
  };
  task.timer = setTimeout(() => { release(task); }, Math.max(1000, task.expiresAt - Date.now()));
  task.timer.unref?.();
  tasks.set(task.id, task);
  activeTaskId = task.id;
  return taskPublic(task);
}

async function status(id, owner) {
  const task = ownedTask(id, owner);
  if (task.expiresAt <= Date.now()) {
    release(task);
    throw new Error('登录任务已过期');
  }

  const payload = await requestNapCat('/api/qq/login/status', {
    taskId: task.remoteId,
    refresh: false,
  });

  const remote = payload?.task && typeof payload.task === 'object' ? payload.task : {};
  const nextStatus = String(remote.status || '').trim();
  if (nextStatus) task.status = nextStatus;
  if (remote.qrImage) task.qrImage = String(remote.qrImage);
  const expiresAt = Number(remote.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt > 0) task.expiresAt = expiresAt;
  return taskPublic(task);
}

async function code(id, owner) {
  const task = ownedTask(id, owner);
  if (task.result) return task.result;
  if (task.status !== 'confirmed') throw new Error('请先完成 QQ 扫码确认');

  if (!task.codePromise) {
    task.codePromise = (async () => {
      const payload = await requestNapCat('/api/qq/miniapp/code', {
        taskId: task.remoteId,
        appId: APP_ID,
      });
      const authCode = String(payload?.code || '').trim();
      if (!authCode) throw new Error('NapCat 未返回小程序授权 Code');
      task.result = {
        code: authCode,
        uin: String(payload?.uin || '').trim(),
        nickname: typeof payload?.nickname === 'string' ? payload.nickname.trim() : '',
      };
      release(task);
      return task.result;
    })().catch((error) => {
      task.codePromise = null;
      task.error = error.message;
      throw error;
    });
  }
  return task.codePromise;
}

async function cancel(id, owner) {
  const task = tasks.get(String(id || ''));
  if (!task) return;
  if (task.owner !== owner) throw new Error('无权取消此登录任务');
  try {
    await requestNapCat('/api/qq/logout', { taskId: task.remoteId }, { requireOk: false });
  } catch {
    // 注销失败不阻塞前端，本地任务仍要释放
  }
  release(task);
}

module.exports = { APP_ID, isConfigured, create, status, code, cancel, resetCredential };

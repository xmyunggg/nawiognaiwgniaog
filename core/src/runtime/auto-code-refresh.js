const { createScheduler } = require('../services/scheduler');
const wxLoginAdapter = require('../services/wx-login-adapter');

function createAutoCodeRefreshService(deps) {
  const {
    store,
    getAccounts,
    addOrUpdateAccount,
    resolveWorkerControls,
    isAccountRunning,
    log,
    addAccountLog,
  } = deps;

  const scheduler = createScheduler('auto_code_refresh');
  const recoveryState = new Map();
  const MAX_DAILY_RECOVERIES = 8;
  const MAX_CONSECUTIVE_FAILURES = 3;

  // 同一账号的并发刷新（手动 + 定时 + 批量 + 重登补偿）合并成一次，
  // 避免重复走 MMTLS 取 Code 和重复重启 Worker。
  const inFlightRefreshes = new Map();
  // 刚续期过的凭证在短时间内无需再次续期，减少一次额外的微信网络往返。
  const lastKeepaliveAt = new Map();
  const KEEPALIVE_REUSE_MS = 5 * 60 * 1000;

  function getRecoveryState(accountId) {
    const date = new Date().toISOString().slice(0, 10);
    const current = recoveryState.get(String(accountId));
    if (!current || current.date !== date) {
      const fresh = { date, attempts: 0, failures: 0 };
      recoveryState.set(String(accountId), fresh);
      return fresh;
    }
    return current;
  }

  function isRecoveryReason(reason) {
    return ['ws_400', 'kickout:', 'ws_reconnect_failed:', 'refresh_failed']
      .some(prefix => String(reason || '').includes(prefix));
  }

  function getTaskName(accountId) {
    return `refresh_${  String(accountId || '')}`;
  }

  function getKeepaliveTaskName(accountId) {
    return `wx_keepalive_${String(accountId || '')}`;
  }

  function findAccount(accountId) {
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    return accounts.find(acc => String(acc.id) === String(accountId));
  }

  function isWxAccount(account) {
    return String(account && account.platform || '').toLowerCase() === 'wx';
  }

  function normalizeConfig(accountId) {
    const cfg = store.getAutoCodeRefresh ? store.getAutoCodeRefresh(accountId) : null;
    return {
      enabled: cfg && cfg.enabled === true,
      intervalMinutes: Math.max(1, Math.min(1440, Number(cfg && cfg.intervalMinutes) || 60)),
    };
  }

  async function requestFarmCode(account, options = {}) {
    const wxid = String(account && account.wxid || '').trim();
    if (!wxid) throw new Error('账号缺少 wxid，无法自动刷新 Code');

    if (!account.loginBuffer) throw new Error('账号缺少应用宝登录凭据，请重新扫码登录');
    // 刚扫码得到的 token 本身就是新鲜的，跳过续期直接换 Code，少一次微信往返。
    if (account.refreshtoken && options.skipKeepalive !== true) {
      const key = String(account.id || '');
      const last = Number(lastKeepaliveAt.get(key) || 0);
      if (Date.now() - last >= KEEPALIVE_REUSE_MS) {
        const keepalive = await wxLoginAdapter.keepWxCredentialAlive(account);
        if (!keepalive.Success) throw new Error(keepalive.Message || '微信凭证续期失败');
        lastKeepaliveAt.set(key, Date.now());
      }
    }
    const local = await wxLoginAdapter.getFarmCode(wxid, { accountId: account.id });
    if (local.Success && local.Data && local.Data.code) return String(local.Data.code);
    throw new Error(local.Message || '进程内获取 Code 失败');
  }

  function refreshAccountCode(accountId, reason = 'timer', options = {}) {
    const key = String(accountId || '');
    if (!key) return Promise.resolve(false);

    const pending = inFlightRefreshes.get(key);
    if (pending) return pending;

    const task = performCodeRefresh(accountId, reason, options).finally(() => {
      if (inFlightRefreshes.get(key) === task) inFlightRefreshes.delete(key);
    });
    inFlightRefreshes.set(key, task);
    return task;
  }

  async function performCodeRefresh(accountId, reason = 'timer', options = {}) {
    const account = findAccount(accountId);
    // Code 自动刷新只适用于微信扫码账号。QQ 账号在 ws_400 等恢复路径中也会被
    // 调用到这里，必须直接跳过，不能产生“缺少 wxid”的失败日志或重登任务。
    if (!isWxAccount(account)) return false;

    const recovery = isRecoveryReason(reason) ? getRecoveryState(accountId) : null;
    if (recovery && (recovery.attempts >= MAX_DAILY_RECOVERIES
      || recovery.failures >= MAX_CONSECUTIVE_FAILURES)) {
      addAccountLog('auto_relogin_blocked', '自动重登已熔断，请检查网络或重新扫码',
        account.id, account.name, { reason, ...recovery });
      return false;
    }
    if (recovery) recovery.attempts += 1;

    try {
      const code = await requestFarmCode(account, options);
      const nextAccount = { ...account, code };
      addOrUpdateAccount(nextAccount);

      // 手动/定时刷新只更新 Code：账号未运行时不要顺手把它启动，否则“刷新全部
      // 微信 Code”会逐个拉起已停止的账号，导致明显的卡顿和资源占用。
      // manual_start 由 startAccount 在刷新完成后显式启动；恢复类原因仍需要
      // 重启（或拉起）Worker 才能重新登录。
      const controls = typeof resolveWorkerControls === 'function' ? (resolveWorkerControls() || {}) : {};
      const restartForRecovery = isRecoveryReason(reason);
      const restartRunningAccount = reason !== 'manual_start'
        && (typeof isAccountRunning === 'function' ? isAccountRunning(account.id) : true);
      const shouldRestart = restartForRecovery || restartRunningAccount;
      const restarted = shouldRestart && typeof controls.restartWorker === 'function';
      if (restarted) controls.restartWorker(nextAccount);

      addAccountLog('auto_code_refresh',
        `自动刷新 Code 成功${restarted ? '，已重启账号' : ''}: ${account.name}`,
        account.id, account.name, { reason });
      log('系统', `自动刷新 Code 成功: ${account.name}${restarted ? '（已重启）' : '（仅更新 Code）'}`, {
        accountId: String(account.id),
        accountName: account.name,
      });
      if (recovery) recovery.failures = 0;
      return true;
    } catch (err) {
      if (recovery) recovery.failures += 1;
      addAccountLog('auto_code_refresh_failed', `自动刷新 Code 失败: ${err.message}`,
        account.id, account.name, { reason });
      log('错误', `自动刷新 Code 失败: ${account.name} - ${err.message}`, {
        accountId: String(account.id),
        accountName: account.name,
      });
      return false;
    }
  }

  function scheduleAccount(accountId) {
    const cfg = normalizeConfig(accountId);
    const taskName = getTaskName(accountId);
    scheduler.clear(taskName);
    scheduler.clear(getKeepaliveTaskName(accountId));

    const account = findAccount(accountId);
    // Code refresh and credential keepalive only apply to WeChat scan-login accounts.
    // All accounts are passed through rescheduleAll(), so QQ accounts must exit quietly.
    if (!isWxAccount(account)) return;

    if (!String(account.wxid || '').trim()) {
      log('系统', '自动刷新 Code 未启动: 账号缺少 wxid', {
        accountId: String(accountId),
        accountName: account.name || '',
      });
      return;
    }

    if (account.loginBuffer && account.refreshtoken) {
      scheduler.setIntervalTask(getKeepaliveTaskName(accountId), 30 * 60000, async () => {
        const latest = findAccount(accountId);
        if (!latest) return;
        const result = await wxLoginAdapter.keepWxCredentialAlive(latest);
        if (result.Success) {
          lastKeepaliveAt.set(String(accountId), Date.now());
        } else {
          log('错误', `微信凭证保活失败: ${latest.name} - ${result.Message || '未知错误'}`, {
            accountId: String(accountId), accountName: latest.name,
          });
        }
      }, { preventOverlap: true });
    }

    if (!cfg.enabled) return;

    scheduler.setIntervalTask(taskName, cfg.intervalMinutes * 60000, () => {
      refreshAccountCode(accountId, 'timer');
    }, { preventOverlap: true });

    log('系统', `自动刷新 Code 已启用: ${  account.name  }，间隔 ${  cfg.intervalMinutes  } 分钟`, {
      accountId: String(accountId),
      accountName: account.name,
    });
  }

  function rescheduleAll() {
    scheduler.clearAll();
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    for (const account of accounts) {
      scheduleAccount(account.id);
    }
  }

  function stopAccount(accountId) {
    scheduler.clear(getTaskName(accountId));
    scheduler.clear(getKeepaliveTaskName(accountId));
    scheduler.clear(`relogin_${String(accountId || '')}`);
  }

  function scheduleRelogin(accountId, reason = 'offline') {
    const cfg = normalizeConfig(accountId);
    if (!cfg.enabled) return false;
    const account = findAccount(accountId);
    if (!isWxAccount(account) || !String(account.wxid || '').trim() || !account.loginBuffer) return false;
    const recovery = getRecoveryState(accountId);
    if (recovery.attempts >= MAX_DAILY_RECOVERIES
      || recovery.failures >= MAX_CONSECUTIVE_FAILURES) {
      addAccountLog('auto_relogin_blocked', '自动重登次数已达上限，请检查网络或重新扫码',
        account.id, account.name, { reason, ...recovery });
      return false;
    }
    const taskName = `relogin_${String(accountId || '')}`;
    scheduler.clear(taskName);
    scheduler.setTimeoutTask(taskName, cfg.intervalMinutes * 60000, () => {
      refreshAccountCode(accountId, reason);
    });
    log('系统', `账号 ${account.name} 将在 ${cfg.intervalMinutes} 分钟后自动刷新凭证并重登`, {
      accountId: String(accountId), accountName: account.name, reason,
    });
    return true;
  }

  return {
    refreshAccountCode,
    scheduleAccount,
    rescheduleAll,
    stopAccount,
    scheduleRelogin,
  };
}

module.exports = { createAutoCodeRefreshService };

const process = require('node:process');
const fs = require('node:fs');
const path = require('node:path');

const {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
} = require('./src/controllers/admin');
const { createRuntimeEngine } = require('./src/runtime/runtime-engine');
const { createModuleLogger } = require('./src/services/logger');
const { getDataDir } = require('./src/config/runtime-paths');

const mainLogger = createModuleLogger('main');
const isWorkerProcess = process.env.FARM_WORKER === '1';

// 启动时保留一份非空账号数据的快照，误删/误清空后可直接从 data/backups 恢复。
function backupAccountDataOnStartup() {
    try {
        const dataDir = getDataDir();
        const accountsFile = path.join(dataDir, 'accounts.json');
        if (!fs.existsSync(accountsFile)) return;
        const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8')).accounts;
        if (!Array.isArray(accounts) || accounts.length === 0) return;

        const backupDir = path.join(dataDir, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(accountsFile, path.join(backupDir, 'accounts.startup.json'));
        const storeFile = path.join(dataDir, 'store.json');
        if (fs.existsSync(storeFile)) {
            fs.copyFileSync(storeFile, path.join(backupDir, 'store.startup.json'));
        }
    } catch (err) {
        mainLogger.warn('启动账号数据备份失败', {
            error: err && err.message ? err.message : String(err),
        });
    }
}

async function bootstrap() {
    if (isWorkerProcess) {
        require('./src/core/worker');
        return;
    }

    // 抓包服务子命令：qq-farm-bot --capture（或 FARM_CAPTURE_SERVER=1）
    if (process.argv.includes('--capture') || process.env.FARM_CAPTURE_SERVER === '1') {
        const { startCaptureServer } = require('./src/capture/index');
        const { resolveAdvertiseAddresses } = require('./src/capture/ip-utils');
        const { config, stop, log } = await startCaptureServer();
        const advertise = resolveAdvertiseAddresses(config);
        log.info(`抓包服务已启动，API: http://${config.apiHost}:${config.apiPort}`);
        log.info(`对外代理地址: ${advertise.addresses.length
            ? advertise.addresses.map(item => `${item.address} (${item.kind})`).join(', ')
            : '未检测到可用地址'}`);
        const shutdown = (signal) => {
            log.info(`收到 ${signal}，正在关闭抓包服务...`);
            void stop().then(() => process.exit(0));
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        return;
    }

    backupAccountDataOnStartup();

    const runtimeEngine = createRuntimeEngine({
        processRef: process,
        mainEntryPath: __filename,
        startAdminServer,
        onStatusSync: (accountId, status) => {
            emitRealtimeStatus(accountId, status);
        },
        onLog: (entry, accountId) => {
            if (accountId && entry) {
                entry.accountId = accountId;
            }
            emitRealtimeLog(entry);
        },
        onAccountLog: (entry) => {
            emitRealtimeAccountLog(entry);
        },
    });

    runtimeEngine.start({
        startAdminServer: true,
        // 服务重启后自动恢复已保存的账号，避免面板显示在线状态却一直没有 Worker 运行。
        autoStartAccounts: true,
    }).catch((err) => {
        mainLogger.error('runtime bootstrap failed', {
            error: err && err.message ? err.message : String(err),
        });
    });
}

bootstrap().catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
});

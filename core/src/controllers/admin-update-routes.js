const crypto = require('node:crypto');
const process = require('node:process');
const updateService = require('../services/update-service');

const JOB_TTL_MS = 60 * 60 * 1000;
const ACTIVE_JOB_STATUSES = new Set(['queued', 'checking', 'downloading', 'restarting']);

function registerAdminUpdateRoutes({
    app,
    store,
    provider,
    logger,
    requireAdminRole,
    requireDangerConfirmation
}) {
    const jobs = new Map();

    function pruneJobs() {
        const now = Date.now();
        for (const [id, job] of jobs.entries()) {
            if (ACTIVE_JOB_STATUSES.has(job.status)) continue;
            if (now - Number(job.finishedAt || job.startedAt || 0) > JOB_TTL_MS) jobs.delete(id);
        }
    }

    function serializeJob(job) {
        if (!job) return null;
        return {
            id: job.id,
            status: job.status,
            version: job.version,
            progress: Math.max(0, Math.min(100, Number(job.progress) || 0)),
            receivedBytes: Number(job.receivedBytes) || 0,
            totalBytes: Number(job.totalBytes) || 0,
            message: job.message || '',
            error: job.error || '',
            startedAt: job.startedAt || 0,
            finishedAt: job.finishedAt || 0
        };
    }

    function findActiveJob() {
        for (const job of jobs.values()) {
            if (ACTIVE_JOB_STATUSES.has(job.status)) return job;
        }
        return null;
    }

    async function runUpdateJob(job, manifestUrl) {
        try {
            job.status = 'checking';
            const manifest = await updateService.fetchManifest(manifestUrl);
            if (manifest.version !== job.version) {
                throw new Error(`更新清单版本已变化（${manifest.version}），请重新检查更新`);
            }
            const runtime = updateService.getRuntimeInfo();
            if (updateService.compareVersions(manifest.version, runtime.version) <= 0) {
                throw new Error('当前已是最新版本');
            }
            const asset = updateService.selectAsset(manifest, runtime);
            if (!asset) throw new Error(updateService.buildMissingAssetMessage(runtime));

            job.status = 'downloading';
            job.totalBytes = asset.size || 0;
            job.progress = 0;
            const prepared = await updateService.prepareUpdate({
                manifest,
                asset,
                runtime,
                onProgress: (received, total) => {
                    job.receivedBytes = received;
                    if (total > 0) job.totalBytes = total;
                    job.progress = job.totalBytes > 0
                        ? Math.min(99, Math.floor((received * 100) / job.totalBytes))
                        : 0;
                }
            });

            job.progress = 100;
            job.status = 'restarting';
            job.message = '更新包已准备完成，服务即将重启';
            updateService.writeUpdateState({
                status: 'applying',
                fromVersion: runtime.version,
                toVersion: manifest.version,
                mode: prepared.mode,
                at: Date.now()
            });
            logger.warn('在线更新已准备，即将重启服务', {
                fromVersion: runtime.version,
                toVersion: manifest.version,
                mode: prepared.mode,
                files: prepared.files || 1
            });

            setTimeout(() => {
                try {
                    updateService.launchUpdater(prepared.scriptPath);
                } catch (error) {
                    job.status = 'error';
                    job.error = `启动更新脚本失败: ${error.message}`;
                    job.finishedAt = Date.now();
                    logger.error('启动更新脚本失败', { error: error.message });
                    return;
                }
                setTimeout(async () => {
                    try {
                        if (provider && typeof provider.shutdown === 'function') {
                            await provider.shutdown();
                        }
                    } catch (error) {
                        logger.error('更新重启前停止账号失败', { error: error.message });
                    }
                    process.exit(0);
                }, 2000);
            }, 800);
        } catch (error) {
            job.status = 'error';
            job.error = error && error.message ? error.message : String(error);
            job.finishedAt = Date.now();
            logger.error('在线更新失败', {
                version: job.version,
                error: job.error
            });
        }
    }

    app.get('/api/admin/update', requireAdminRole, (req, res) => {
        pruneJobs();
        res.json({
            ok: true,
            data: {
                config: store.getUpdateConfig(),
                runtime: updateService.getRuntimeInfo(),
                lastUpdate: updateService.readUpdateState(),
                jobs: [...jobs.values()].map(serializeJob)
            }
        });
    });

    app.post('/api/admin/update/config', requireAdminRole, (req, res) => {
        if (!requireDangerConfirmation(req, res, 'UPDATE_UPDATE_CONFIG')) return;
        try {
            const saved = store.setUpdateConfig({ manifestUrl: req.body ? req.body.manifestUrl : '' });
            logger.warn('在线更新清单地址已更新', { manifestUrl: saved.manifestUrl });
            res.json({ ok: true, data: saved });
        } catch (error) {
            res.status(400).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/update/check', requireAdminRole, async (req, res) => {
        try {
            const config = store.getUpdateConfig();
            if (!config.manifestUrl) {
                return res.status(400).json({ ok: false, error: '请先配置更新清单地址' });
            }
            const manifest = await updateService.fetchManifest(config.manifestUrl);
            const runtime = updateService.getRuntimeInfo();
            const asset = updateService.selectAsset(manifest, runtime);
            const hasUpdate = updateService.compareVersions(manifest.version, runtime.version) > 0;
            return res.json({
                ok: true,
                data: {
                    currentVersion: runtime.version,
                    runtime,
                    hasUpdate,
                    latestVersion: manifest.version,
                    notes: manifest.notes,
                    publishedAt: manifest.publishedAt,
                    asset: asset
                        ? {
                            type: asset.type,
                            platform: asset.platform,
                            arch: asset.arch,
                            size: asset.size,
                            sha256: asset.sha256
                        }
                        : null,
                    assetError: hasUpdate && !asset
                        ? updateService.buildMissingAssetMessage(runtime)
                        : ''
                }
            });
        } catch (error) {
            return res.status(502).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/admin/update/apply', requireAdminRole, (req, res) => {
        if (!requireDangerConfirmation(req, res, 'APPLY_UPDATE')) return;
        const runtime = updateService.getRuntimeInfo();
        if (runtime.docker) {
            return res.status(400).json({
                ok: false,
                error: 'Docker 容器部署请更新镜像后重建容器，暂不支持在线替换'
            });
        }
        const version = String(req.body && req.body.version ? req.body.version : '').trim();
        if (!version) {
            return res.status(400).json({ ok: false, error: '缺少目标版本号' });
        }
        pruneJobs();
        const active = findActiveJob();
        if (active) {
            return res.status(409).json({ ok: false, error: '已有更新任务正在执行，请稍后再试' });
        }
        const config = store.getUpdateConfig();
        if (!config.manifestUrl) {
            return res.status(400).json({ ok: false, error: '请先配置更新清单地址' });
        }

        const job = {
            id: crypto.randomBytes(8).toString('hex'),
            status: 'queued',
            version,
            progress: 0,
            receivedBytes: 0,
            totalBytes: 0,
            message: '正在准备更新...',
            error: '',
            startedAt: Date.now(),
            finishedAt: 0
        };
        jobs.set(job.id, job);
        logger.warn('收到在线更新请求', { version, operator: req.currentUser && req.currentUser.username });
        // 下载和校验放到后台任务，避免大文件下载被 HTTP 超时中断
        res.json({ ok: true, data: serializeJob(job) });
        void runUpdateJob(job, config.manifestUrl);
    });

    app.get('/api/admin/update/job/:id', requireAdminRole, (req, res) => {
        pruneJobs();
        const job = jobs.get(String(req.params.id || ''));
        if (!job) return res.status(404).json({ ok: false, error: '更新任务不存在或已过期' });
        return res.json({ ok: true, data: serializeJob(job) });
    });
}

module.exports = { registerAdminUpdateRoutes };

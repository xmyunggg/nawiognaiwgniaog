const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { getDataDir } = require('../config/runtime-paths');

const MANIFEST_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ASSETS = 32;

const VERSION_RE = /^v?\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const HTTP_URL_RE = /^https?:\/\//i;

const CRC32_TABLE = (() => {    const table = new Int32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value;
    }
    return table;
})();

/** 获取可用的 fetch 实现（优先 Node 内置 fetch） */
function getFetch() {
    if (typeof globalThis.fetch === 'function') return globalThis.fetch;
    return require('node-fetch');
}

/** 获取当前程序版本 */
function getCurrentVersion() {
    try {
        return String(require('../../package.json').version || '').trim();
    } catch {
        return '';
    }
}

/** 是否运行在 Docker 容器内 */
function isDockerRuntime() {
    if (process.env.FARM_DOCKER === '1') return true;
    try {
        if (fs.existsSync('/.dockerenv')) return true;
    } catch { }
    try {
        if (fs.existsSync('/proc/1/cgroup')) {
            const content = fs.readFileSync('/proc/1/cgroup', 'utf8');
            if (/docker|containerd|kubepods/i.test(content)) return true;
        }
    } catch { }
    return false;
}

/** 源码模式下的仓库根目录 */
function getSourceRoot() {
    return path.resolve(__dirname, '../../..');
}

/** 获取当前运行环境信息 */
function getRuntimeInfo() {
    const packaged = !!process.pkg;
    const docker = isDockerRuntime();
    return {
        version: getCurrentVersion(),
        platform: process.platform,
        arch: process.arch,
        packaged,
        docker,
        applyMode: packaged ? 'executable' : 'archive',
        supportsApply: !docker,
        execPath: process.execPath,
        appRoot: packaged ? path.dirname(process.execPath) : getSourceRoot()
    };
}

/** 解析版本号数字段 */
function parseVersionParts(value) {
    return String(value || '')
        .trim()
        .replace(/^v/i, '')
        .split(/[+-]/)[0]
        .split('.')
        .map(part => {
            const number = Number.parseInt(part, 10);
            return Number.isFinite(number) ? number : 0;
        });
}

/** 比较版本号，left 更新时返回正数 */
function compareVersions(left, right) {
    const a = parseVersionParts(left);
    const b = parseVersionParts(right);
    const width = Math.max(a.length, b.length);
    for (let index = 0; index < width; index += 1) {
        const delta = (a[index] || 0) - (b[index] || 0);
        if (delta !== 0) return delta;
    }
    return 0;
}

function normalizePlatform(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === '*') return '';
    if (['win', 'windows', 'win32'].includes(text)) return 'win32';
    if (['mac', 'macos', 'darwin', 'osx'].includes(text)) return 'darwin';
    if (['linux', 'linux-x64'].includes(text)) return 'linux';
    return text;
}

function normalizeArch(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === '*') return '';
    if (['x86_64', 'amd64', 'x64', 'x86-64'].includes(text)) return 'x64';
    if (['aarch64', 'arm64', 'arm64-v8a'].includes(text)) return 'arm64';
    return text;
}

function normalizeAssetType(value, url) {
    const type = String(value || '').trim().toLowerCase();
    if (type === 'zip' || type === 'archive') return 'zip';
    if (type === 'exe' || type === 'binary' || type === 'executable') return 'binary';
    if (type) throw new Error(`不支持的更新包类型: ${value}`);
    let pathname = '';
    try {
        pathname = new URL(url).pathname.toLowerCase();
    } catch { }
    if (pathname.endsWith('.zip')) return 'zip';
    return 'binary';
}

/** 从资源键名推断平台/架构，例如 win32-x64 */
function parseAssetKey(key) {
    const text = String(key || '').toLowerCase();
    if (!text) return { platform: '', arch: '' };
    let platform = '';
    if (/win|windows/.test(text)) platform = 'win32';
    else if (/darwin|macos|osx|mac/.test(text)) platform = 'darwin';
    else if (/linux/.test(text)) platform = 'linux';
    let arch = '';
    if (/arm64|aarch64/.test(text)) arch = 'arm64';
    else if (/x64|x86_64|amd64/.test(text)) arch = 'x64';
    return { platform, arch };
}

function normalizeAsset(item, fallbackKey) {
    if (!item || typeof item !== 'object') return null;
    const url = String(item.url || '').trim();
    if (!HTTP_URL_RE.test(url)) throw new Error('更新资源地址必须是 http(s) 链接');
    const sha256 = String(item.sha256 || '').trim().toLowerCase();
    if (!SHA256_RE.test(sha256)) throw new Error('更新资源缺少有效的 sha256 校验值');
    const declaredSize = Number(item.size);
    if (declaredSize && (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_ASSET_BYTES)) {
        throw new Error('更新资源大小超出允许范围');
    }
    const fallback = parseAssetKey(fallbackKey);
    return {
        name: String(item.name || fallbackKey || '').trim(),
        url,
        sha256,
        size: declaredSize > 0 ? Math.floor(declaredSize) : 0,
        platform: normalizePlatform(item.platform || fallback.platform),
        arch: normalizeArch(item.arch || fallback.arch),
        type: normalizeAssetType(item.type, url)
    };
}

/** 规范化更新清单 */
function normalizeManifest(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('更新清单不是有效的 JSON 对象');
    }
    const version = String(raw.version || '').trim();
    if (!VERSION_RE.test(version)) throw new Error('更新清单缺少有效的 version');
    const notes = raw.notes === undefined || raw.notes === null
        ? ''
        : String(raw.notes).slice(0, 20000);
    const publishedAt = raw.publishedAt ? String(raw.publishedAt).slice(0, 64) : '';

    const assets = [];
    const rawAssets = raw.assets;
    if (Array.isArray(rawAssets)) {
        for (const item of rawAssets) {
            if (assets.length >= MAX_ASSETS) throw new Error('更新清单资源数量过多');
            const asset = normalizeAsset(item, '');
            if (asset) assets.push(asset);
        }
    } else if (rawAssets && typeof rawAssets === 'object') {
        for (const [key, item] of Object.entries(rawAssets)) {
            if (assets.length >= MAX_ASSETS) throw new Error('更新清单资源数量过多');
            const asset = normalizeAsset(item, key);
            if (asset) assets.push(asset);
        }
    } else if (raw.url) {
        const asset = normalizeAsset(raw, '');
        if (asset) assets.push(asset);
    }

    if (!assets.length) throw new Error('更新清单未提供下载资源');
    return { version, notes, publishedAt, assets };
}

/** 根据运行环境选择更新资源 */
function selectAsset(manifest, runtime) {
    if (!manifest || !Array.isArray(manifest.assets) || !runtime) return null;
    const desiredType = runtime.packaged ? 'binary' : 'zip';
    const typed = manifest.assets.filter(asset => asset.type === desiredType);
    const exact = typed.find(asset => asset.platform === runtime.platform && asset.arch === runtime.arch);
    if (exact) return exact;
    const platformOnly = typed.find(asset => asset.platform === runtime.platform && !asset.arch);
    if (platformOnly) return platformOnly;
    const generic = typed.find(asset => !asset.platform && !asset.arch);
    if (generic) return generic;
    const archOnly = typed.find(asset => !asset.platform && asset.arch === runtime.arch);
    return archOnly || null;
}

/** 生成资源缺失提示 */
function buildMissingAssetMessage(runtime) {
    const typeLabel = runtime.packaged ? '可执行文件（binary）' : '源码压缩包（zip）';
    return `更新清单中没有适用于 ${runtime.platform}-${runtime.arch} 的${typeLabel}更新包`;
}

/** 简单 CRC32 校验 */
function crc32(buffer) {
    let value = -1;
    for (let index = 0; index < buffer.length; index += 1) {
        value = CRC32_TABLE[(value ^ buffer[index]) & 0xFF] ^ (value >>> 8);
    }
    return (value ^ -1) >>> 0;
}

function findZipEnd(buffer) {
    const minOffset = Math.max(0, buffer.length - 22 - 0xFFFF);
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054B50) return offset;
    }
    return -1;
}

function normalizeArchiveEntryName(rawName) {
    const source = String(rawName || '').replace(/\\/g, '/');
    if (!source || source.includes('\0')) return null;
    if (source.startsWith('/') || /^[a-zA-Z]:/.test(source)) return null;
    const isDir = source.endsWith('/');
    const name = isDir ? source.slice(0, -1) : source;
    const parts = name.split('/');
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) return null;
    return { name: parts.join('/'), isDir };
}

/** 仅允许覆盖程序代码与前端构建产物，绝不写入 data / node_modules */
function isAllowedArchiveEntry(name) {
    const value = String(name || '').toLowerCase();
    if (value.includes('node_modules')) return false;
    if (value === 'core/client.js' || value === 'core/capture-server.js' || value === 'core/package.json') return true;
    return value.startsWith('core/src/') || value.startsWith('core/scripts/') || value.startsWith('web/dist/');
}

/**
 * 解压更新 ZIP（仅支持 store/deflate，不支持加密与 ZIP64）
 * @returns {string[]} 已写入文件的相对路径
 */
function extractZip(zipPath, destinationRoot) {
    const buffer = fs.readFileSync(zipPath);
    const endOffset = findZipEnd(buffer);
    if (endOffset < 0) throw new Error('更新包不是有效的 ZIP 文件');

    const totalEntries = buffer.readUInt16LE(endOffset + 10);
    const directorySize = buffer.readUInt32LE(endOffset + 12);
    const directoryOffset = buffer.readUInt32LE(endOffset + 16);
    if (totalEntries === 0xFFFF || directorySize === 0xFFFFFFFF || directoryOffset === 0xFFFFFFFF) {
        throw new Error('不支持 ZIP64 格式的更新包');
    }
    if (directoryOffset + directorySize > buffer.length) throw new Error('更新包 ZIP 结构损坏');

    const rootPath = path.resolve(destinationRoot);
    const rootPrefix = `${rootPath}${path.sep}`;
    const extractedFiles = [];
    let extractedBytes = 0;
    let offset = directoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014B50) {
            throw new Error('更新包 ZIP 目录结构损坏');
        }
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const expectedCrc = buffer.readUInt32LE(offset + 16);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const nameEnd = offset + 46 + nameLength;
        if (nameEnd > buffer.length) throw new Error('更新包 ZIP 目录结构损坏');
        const rawName = buffer.toString('utf8', offset + 46, nameEnd);
        offset = nameEnd + extraLength + commentLength;

        if (flags & 0x1) throw new Error('不支持加密的 ZIP 更新包');
        const entry = normalizeArchiveEntryName(rawName);
        if (!entry) throw new Error(`更新包包含非法路径: ${rawName}`);
        if (!isAllowedArchiveEntry(entry.name)) continue;

        const destination = path.resolve(rootPath, entry.name);
        if (!destination.startsWith(rootPrefix)) throw new Error(`更新包路径越界: ${entry.name}`);
        if (entry.isDir) {
            fs.mkdirSync(destination, { recursive: true });
            continue;
        }

        if (method !== 0 && method !== 8) throw new Error(`不支持的 ZIP 压缩方式: ${method}`);
        if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
            throw new Error('不支持 ZIP64 格式的更新包');
        }
        if (uncompressedSize > MAX_EXTRACTED_BYTES) throw new Error(`更新包文件过大: ${entry.name}`);
        if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034B50) {
            throw new Error(`更新包文件头损坏: ${entry.name}`);
        }
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        if (dataOffset + compressedSize > buffer.length) throw new Error(`更新包文件数据损坏: ${entry.name}`);

        const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
        let content;
        if (method === 0) {
            content = Buffer.from(compressed);
        } else {
            content = zlib.inflateRawSync(compressed, {
                maxOutputLength: Math.max(uncompressedSize, 1)
            });
        }
        if (content.length !== uncompressedSize) throw new Error(`更新包文件大小校验失败: ${entry.name}`);
        if (crc32(content) !== expectedCrc) throw new Error(`更新包文件校验失败: ${entry.name}`);

        extractedBytes += content.length;
        if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('更新包解压后体积超出限制');

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content, { mode: 0o644 });
        extractedFiles.push(entry.name);
    }

    if (!extractedFiles.length) throw new Error('更新包中没有可应用的文件');
    return extractedFiles;
}

/** 获取更新工作目录 */
function getUpdatesDir() {
    const dir = path.join(getDataDir(), 'updates');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getUpdateStateFile() {
    return path.join(getUpdatesDir(), 'last-update.json');
}

function readUpdateState() {
    try {
        const data = JSON.parse(fs.readFileSync(getUpdateStateFile(), 'utf8'));
        if (!data || typeof data !== 'object') return null;
        if (data.status === 'applying' && data.toVersion) {
            const currentVersion = getCurrentVersion();
            if (currentVersion && compareVersions(currentVersion, data.toVersion) >= 0) {
                return { ...data, status: 'success' };
            }
        }
        return data;
    } catch {
        return null;
    }
}

function writeUpdateState(update) {
    try {
        fs.mkdirSync(getUpdatesDir(), { recursive: true });
        fs.writeFileSync(getUpdateStateFile(), JSON.stringify(update || {}, null, 2), 'utf8');
    } catch { }
}

/** 拉取并规范化远端更新清单 */
async function fetchManifest(url) {
    if (!HTTP_URL_RE.test(String(url || ''))) throw new Error('更新清单地址必须是 http(s) 链接');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
    try {
        const fetchImpl = getFetch();
        const response = await fetchImpl(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'user-agent': 'qq-farm-bot-updater/1.0',
                'cache-control': 'no-cache'
            }
        });
        if (!response.ok) throw new Error(`获取更新清单失败: HTTP ${response.status}`);
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('更新清单内容过大');
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('更新清单不是有效的 JSON');
        }
        return normalizeManifest(data);
    } catch (error) {
        if (error && error.name === 'AbortError') throw new Error('获取更新清单超时');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/** 下载更新包并校验 SHA256 */
async function downloadAssetToFile(asset, filePath, options = {}) {
    const maxBytes = Math.min(
        Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_ASSET_BYTES,
        MAX_ASSET_BYTES
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || DOWNLOAD_TIMEOUT_MS);
    let response = null;

    try {
        const fetchImpl = getFetch();
        response = await fetchImpl(asset.url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'user-agent': 'qq-farm-bot-updater/1.0',
                'accept': 'application/octet-stream'
            }
        });
        if (!response.ok) throw new Error(`下载更新包失败: HTTP ${response.status}`);

        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > maxBytes) throw new Error('更新包超过允许的大小');

        const hash = crypto.createHash('sha256');
        let received = 0;
        const output = fs.createWriteStream(filePath, { mode: 0o600 });

        try {
            for await (const chunk of response.body) {
                received += chunk.length;
                if (received > maxBytes) throw new Error('更新包超过允许的大小');
                hash.update(chunk);
                if (!output.write(chunk)) {
                    await new Promise((resolve, reject) => {
                        output.once('drain', resolve);
                        output.once('error', reject);
                    });
                }
                if (typeof options.onProgress === 'function') {
                    options.onProgress(received, asset.size || declaredLength || 0);
                }
            }
            await new Promise((resolve, reject) => {
                output.end(error => (error ? reject(error) : resolve()));
            });
        } catch (error) {
            output.destroy();
            throw error;
        }

        const sha256 = hash.digest('hex');
        if (sha256 !== asset.sha256) throw new Error('更新包校验失败（SHA256 不一致）');
        if (asset.size && received !== asset.size) throw new Error('更新包大小与更新清单不一致');
        return { size: received, sha256 };
    } catch (error) {
        try { fs.rmSync(filePath, { force: true }); } catch { }
        if (error && error.name === 'AbortError') throw new Error('下载更新包超时');
        throw error;
    } finally {
        clearTimeout(timer);
        if (response && response.body) {
            if (typeof response.body.destroy === 'function') {
                try { response.body.destroy(); } catch { }
            } else if (typeof response.body.cancel === 'function') {
                try { void response.body.cancel(); } catch { }
            }
        }
    }
}

function psQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function shQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildWindowsBinaryScript({ pid, target, source, backup }) {
    return [
        '$ErrorActionPreference = "Continue"',
        `$pidToWait = ${Number(pid)}`,
        `$target = ${psQuote(target)}`,
        `$source = ${psQuote(source)}`,
        `$backup = ${psQuote(backup)}`,
        'for ($i = 0; $i -lt 240; $i++) {',
        '  if (-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) { break }',
        '  Start-Sleep -Milliseconds 500',
        '}',
        'Start-Sleep -Milliseconds 800',
        'for ($i = 0; $i -lt 60; $i++) {',
        '  try {',
        '    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup -Force }',
        '    Move-Item -LiteralPath $source -Destination $target -Force',
        '    break',
        '  } catch { Start-Sleep -Seconds 1 }',
        '}',
        'if (Test-Path -LiteralPath $target) {',
        '  try { Start-Process -FilePath $target -WorkingDirectory (Split-Path -LiteralPath $target -Parent) } catch {}',
        '}',
        'try { Remove-Item -LiteralPath $PSCommandPath -Force } catch {}'
    ].join('\r\n');
}

function buildUnixBinaryScript({ pid, target, source, backup }) {
    return [
        '#!/bin/sh',
        `pid=${Number(pid)}`,
        'i=0',
        'while kill -0 "$pid" 2>/dev/null; do',
        '  i=$((i+1))',
        '  [ "$i" -ge 240 ] && break',
        '  sleep 0.5',
        'done',
        'sleep 1',
        `cp -f -- ${shQuote(target)} ${shQuote(backup)} 2>/dev/null || true`,
        `mv -f -- ${shQuote(source)} ${shQuote(target)} || cp -f -- ${shQuote(source)} ${shQuote(target)}`,
        `chmod +x -- ${shQuote(target)} 2>/dev/null || true`,
        `cd ${shQuote(path.dirname(target))} || exit 0`,
        `nohup ${shQuote(target)} >/dev/null 2>&1 &`,
        'rm -f -- "$0"'
    ].join('\n');
}

function buildWindowsArchiveScript({ pid, sourceRoot, appRoot, backupRoot, workDir, listFile, nodePath, entryPath }) {
    return [
        '$ErrorActionPreference = "Continue"',
        `$pidToWait = ${Number(pid)}`,
        `$sourceRoot = ${psQuote(sourceRoot)}`,
        `$appRoot = ${psQuote(appRoot)}`,
        `$backupRoot = ${psQuote(backupRoot)}`,
        'for ($i = 0; $i -lt 240; $i++) {',
        '  if (-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) { break }',
        '  Start-Sleep -Milliseconds 500',
        '}',
        'Start-Sleep -Milliseconds 800',
        `$files = Get-Content -LiteralPath ${psQuote(listFile)} -Raw | ConvertFrom-Json`,
        'foreach ($rel in $files) {',
        '  $relPath = $rel -replace \'/\', \'\\\'',
        '  $src = [IO.Path]::Combine($sourceRoot, $relPath)',
        '  $dst = [IO.Path]::Combine($appRoot, $relPath)',
        '  if (-not (Test-Path -LiteralPath $src)) { continue }',
        '  $dstDir = [IO.Path]::GetDirectoryName($dst)',
        '  if ($dstDir) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }',
        '  if (Test-Path -LiteralPath $dst) {',
        '    $bak = [IO.Path]::Combine($backupRoot, $relPath)',
        '    $bakDir = [IO.Path]::GetDirectoryName($bak)',
        '    if ($bakDir) { New-Item -ItemType Directory -Force -Path $bakDir | Out-Null }',
        '    Copy-Item -LiteralPath $dst -Destination $bak -Force',
        '  }',
        '  Copy-Item -LiteralPath $src -Destination $dst -Force',
        '}',
        `$entry = ${psQuote(entryPath)}`,
        `$entryArg = '"' + $entry + '"'`,
        `try { Start-Process -FilePath ${psQuote(nodePath)} -ArgumentList $entryArg -WorkingDirectory ${psQuote(appRoot)} } catch {}`,
        'try { Remove-Item -LiteralPath $PSCommandPath -Force } catch {}'
    ].join('\r\n');
}

function buildUnixArchiveScript({ pid, sourceRoot, appRoot, backupRoot, listFile, nodePath, entryPath }) {
    return [
        '#!/bin/sh',
        `pid=${Number(pid)}`,
        'i=0',
        'while kill -0 "$pid" 2>/dev/null; do',
        '  i=$((i+1))',
        '  [ "$i" -ge 240 ] && break',
        '  sleep 0.5',
        'done',
        'sleep 1',
        `while IFS= read -r rel; do`,
        `  src=${shQuote(sourceRoot)}"/$rel"`,
        `  dst=${shQuote(appRoot)}"/$rel"`,
        '  [ -f "$src" ] || continue',
        '  mkdir -p "$(dirname "$dst")"',
        '  if [ -f "$dst" ]; then',
        `    bak=${shQuote(backupRoot)}"/$rel"`,
        '    mkdir -p "$(dirname "$bak")"',
        '    cp -f -- "$dst" "$bak" 2>/dev/null || true',
        '  fi',
        '  cp -f -- "$src" "$dst"',
        `done < ${shQuote(listFile)}`,
        `cd ${shQuote(appRoot)} || exit 0`,
        `nohup ${shQuote(nodePath)} ${shQuote(entryPath)} >/dev/null 2>&1 &`,
        'rm -f -- "$0"'
    ].join('\n');
}

/** 准备更新（下载、校验、解压、生成替换脚本），不会立刻重启 */
async function prepareUpdate({ manifest, asset, runtime, onProgress }) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const versionLabel = String(manifest.version).replace(/[^\w.-]/g, '_');
    const workDir = path.join(getUpdatesDir(), `${stamp}-${versionLabel}`);
    fs.mkdirSync(workDir, { recursive: true });

    if (runtime.packaged) {
        if (asset.type !== 'binary') throw new Error('可执行文件部署只能应用 binary 类型的更新包');
        const target = runtime.execPath;
        const source = path.join(workDir, `${path.basename(target)}.new`);
        await downloadAssetToFile(asset, source, { onProgress });
        if (fs.statSync(source).size < 1024) throw new Error('更新包内容异常（可执行文件过小）');
        const backup = `${target}.bak-${stamp}`;
        const scriptPath = path.join(workDir, process.platform === 'win32' ? 'apply-update.ps1' : 'apply-update.sh');
        const script = process.platform === 'win32'
            ? buildWindowsBinaryScript({ pid: process.pid, target, source, backup })
            : buildUnixBinaryScript({ pid: process.pid, target, source, backup });
        fs.writeFileSync(scriptPath, script, process.platform === 'win32'
            ? 'utf8'
            : { encoding: 'utf8', mode: 0o755 });
        return { mode: 'executable', workDir, scriptPath, target, backup, version: manifest.version };
    }

    if (asset.type !== 'zip') throw new Error('源码部署只能应用 zip 类型的更新包');
    const zipPath = path.join(workDir, 'update.zip');
    await downloadAssetToFile(asset, zipPath, { onProgress });
    const extractDir = path.join(workDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    const files = extractZip(zipPath, extractDir);

    const appRoot = runtime.appRoot;
    const backupRoot = path.join(workDir, 'backup');
    const listFile = path.join(workDir, 'files.json');
    fs.writeFileSync(listFile, JSON.stringify(files, null, 2), 'utf8');
    const entryPath = path.resolve(process.argv[1] || path.join(appRoot, 'core/client.js'));
    const scriptPath = path.join(workDir, process.platform === 'win32' ? 'apply-update.ps1' : 'apply-update.sh');
    const script = process.platform === 'win32'
        ? buildWindowsArchiveScript({
            pid: process.pid,
            sourceRoot: extractDir,
            appRoot,
            backupRoot,
            workDir,
            listFile,
            nodePath: process.execPath,
            entryPath
        })
        : buildUnixArchiveScript({
            pid: process.pid,
            sourceRoot: extractDir,
            appRoot,
            backupRoot,
            listFile,
            nodePath: process.execPath,
            entryPath
        });
    fs.writeFileSync(scriptPath, script, process.platform === 'win32'
        ? 'utf8'
        : { encoding: 'utf8', mode: 0o755 });
    return { mode: 'archive', workDir, scriptPath, files: files.length, version: manifest.version };
}

/** 在独立进程中启动更新脚本，确保主进程退出后仍能完成替换 */
function launchUpdater(scriptPath) {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const candidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const powershell = fs.existsSync(candidate) ? candidate : 'powershell.exe';
        const child = spawn(powershell, [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath
        ], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
        return;
    }
    const child = spawn('/bin/sh', [scriptPath], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

module.exports = {
    MAX_ASSET_BYTES,
    getCurrentVersion,
    getRuntimeInfo,
    isDockerRuntime,
    compareVersions,
    normalizeManifest,
    selectAsset,
    buildMissingAssetMessage,
    fetchManifest,
    downloadAssetToFile,
    extractZip,
    crc32,
    isAllowedArchiveEntry,
    normalizeArchiveEntryName,
    getUpdatesDir,
    readUpdateState,
    writeUpdateState,
    prepareUpdate,
    launchUpdater,
    // 供测试使用
    parseVersionParts,
    normalizeAssetType
};

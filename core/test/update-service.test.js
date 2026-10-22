const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const {
    compareVersions,
    normalizeManifest,
    selectAsset,
    crc32,
    extractZip,
    normalizeArchiveEntryName,
    isAllowedArchiveEntry
} = require('../src/services/update-service');

function buildZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const data = Buffer.from(entry.data || '');
        const method = entry.method === 0 ? 0 : 8;
        const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
        const checksum = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const localRecord = Buffer.concat([local, name, compressed]);
        localParts.push(localRecord);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014B50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(Buffer.concat([central, name]));

        offset += localRecord.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...localParts, centralDirectory, end]);
}

test('compareVersions 按数字段比较', () => {
    assert.equal(compareVersions('2.8.1', '2.8.0'), 1);
    assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
    assert.equal(compareVersions('v2.8.0', '2.8'), 0);
    assert.equal(compareVersions('2.8.0', '2.8.0.1'), -1);
});

test('normalizeManifest 规范化资源并推断类型', () => {
    const manifest = normalizeManifest({
        version: '2.9.0',
        notes: '修复若干问题',
        publishedAt: '2026-10-19T00:00:00Z',
        assets: [
            {
                type: 'exe',
                url: 'https://example.com/app.exe',
                sha256: 'A'.repeat(64),
                platform: 'windows',
                arch: 'x86_64',
                size: 1024
            },
            {
                url: 'https://example.com/source.zip',
                sha256: 'b'.repeat(64)
            }
        ]
    });

    assert.equal(manifest.version, '2.9.0');
    assert.equal(manifest.assets.length, 2);
    assert.equal(manifest.assets[0].type, 'binary');
    assert.equal(manifest.assets[0].platform, 'win32');
    assert.equal(manifest.assets[0].arch, 'x64');
    assert.equal(manifest.assets[0].sha256, 'a'.repeat(64));
    assert.equal(manifest.assets[1].type, 'zip');
});

test('normalizeManifest 支持对象形式的资源表与顶层 url', () => {
    const mapped = normalizeManifest({
        version: '2.9.1',
        assets: {
            'win32-x64': {
                url: 'https://example.com/app.exe',
                sha256: 'c'.repeat(64)
            }
        }
    });
    assert.equal(mapped.assets[0].platform, 'win32');
    assert.equal(mapped.assets[0].arch, 'x64');
    assert.equal(mapped.assets[0].type, 'binary');

    const single = normalizeManifest({
        version: '2.9.2',
        url: 'https://example.com/source.zip',
        sha256: 'd'.repeat(64)
    });
    assert.equal(single.assets[0].type, 'zip');
});

test('normalizeManifest 拒绝非法清单', () => {
    assert.throws(() => normalizeManifest(null), /有效的 JSON 对象/);
    assert.throws(() => normalizeManifest({ version: 'x' }), /version/);
    assert.throws(() => normalizeManifest({ version: '2.9.0' }), /下载资源/);
    assert.throws(() => normalizeManifest({
        version: '2.9.0',
        assets: [{ url: 'file:///tmp/app.exe', sha256: 'a'.repeat(64) }]
    }), /http/);
    assert.throws(() => normalizeManifest({
        version: '2.9.0',
        assets: [{ url: 'https://example.com/app.exe' }]
    }), /sha256/);
});

test('selectAsset 根据运行环境选择匹配资源', () => {
    const manifest = normalizeManifest({
        version: '2.9.0',
        assets: [
            { type: 'binary', platform: 'win32', arch: 'x64', url: 'https://example.com/app.exe', sha256: 'a'.repeat(64) },
            { type: 'zip', url: 'https://example.com/source.zip', sha256: 'b'.repeat(64) }
        ]
    });

    const packaged = selectAsset(manifest, { packaged: true, platform: 'win32', arch: 'x64' });
    assert.equal(packaged.url, 'https://example.com/app.exe');

    const source = selectAsset(manifest, { packaged: false, platform: 'linux', arch: 'arm64' });
    assert.equal(source.url, 'https://example.com/source.zip');

    const binaryOnly = normalizeManifest({
        version: '2.9.0',
        assets: [
            { type: 'binary', platform: 'win32', arch: 'x64', url: 'https://example.com/app.exe', sha256: 'a'.repeat(64) }
        ]
    });
    assert.equal(selectAsset(binaryOnly, { packaged: false, platform: 'linux', arch: 'arm64' }), null);
});

test('归档路径校验拒绝路径穿越与非法文件名', () => {
    assert.equal(normalizeArchiveEntryName('core/src/a.js').name, 'core/src/a.js');
    assert.equal(normalizeArchiveEntryName('core/src/').isDir, true);
    assert.equal(normalizeArchiveEntryName('../core/src/a.js'), null);
    assert.equal(normalizeArchiveEntryName('core/../../a.js'), null);
    assert.equal(normalizeArchiveEntryName('/core/src/a.js'), null);
    assert.equal(normalizeArchiveEntryName('C:\\core\\src\\a.js'), null);
    assert.equal(normalizeArchiveEntryName('core//src/a.js'), null);

    assert.equal(isAllowedArchiveEntry('core/src/a.js'), true);
    assert.equal(isAllowedArchiveEntry('core/client.js'), true);
    assert.equal(isAllowedArchiveEntry('web/dist/index.html'), true);
    assert.equal(isAllowedArchiveEntry('core/data/store.json'), false);
    assert.equal(isAllowedArchiveEntry('node_modules/foo/index.js'), false);
    assert.equal(isAllowedArchiveEntry('README.md'), false);
});

test('extractZip 解压允许的文件并跳过无关文件', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-update-test-'));
    try {
        const zipPath = path.join(workDir, 'update.zip');
        fs.writeFileSync(zipPath, buildZip([
            { name: 'core/src/new-file.js', data: 'module.exports = 1;\n' },
            { name: 'web/dist/assets/app.js', data: 'console.log(1);\n', method: 0 },
            { name: 'README.md', data: 'ignored' },
            { name: 'core/data/store.json', data: '{}' }
        ]));

        const outputDir = path.join(workDir, 'out');
        const files = extractZip(zipPath, outputDir);

        assert.deepEqual(files, ['core/src/new-file.js', 'web/dist/assets/app.js']);
        assert.equal(fs.readFileSync(path.join(outputDir, 'core/src/new-file.js'), 'utf8'), 'module.exports = 1;\n');
        assert.equal(fs.existsSync(path.join(outputDir, 'README.md')), false);
        assert.equal(fs.existsSync(path.join(outputDir, 'core/data/store.json')), false);
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
});

test('extractZip 拒绝含路径穿越的压缩包', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-update-test-'));
    try {
        const zipPath = path.join(workDir, 'bad.zip');
        fs.writeFileSync(zipPath, buildZip([
            { name: '../escape.js', data: 'bad' }
        ]));
        assert.throws(() => extractZip(zipPath, path.join(workDir, 'out')), /非法路径/);
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
});

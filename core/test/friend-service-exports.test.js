const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const friendService = require('../src/services/friend');

// worker.js 通过解构方式从 friend 服务取用好友相关能力。
// 若 friend.js 漏掉某个再导出，worker 只会在定时任务运行时报
// "xxx is not a function"，因此这里静态比对导入与导出清单。
function readWorkerFriendImports() {
  const workerPath = path.join(__dirname, '..', 'src', 'core', 'worker.js');
  const source = fs.readFileSync(workerPath, 'utf8');
  const match = source.match(/const\s*\{([^}]*)\}\s*=\s*require\('\.\.\/services\/friend'\)/);
  assert.ok(match, 'worker.js 应仍从 services/friend 解构导入');
  return match[1]
    .split(',')
    .map(item => item.trim().split(':')[0].trim())
    .filter(Boolean);
}

test('worker 从 friend 服务导入的每个能力都已被导出', () => {
  const imported = readWorkerFriendImports();
  assert.ok(imported.length > 0);

  const missing = imported.filter(name => typeof friendService[name] === 'undefined');
  assert.deepEqual(missing, []);
});

test('isCheckingFriendsRunning 作为状态查询可被 worker 调用', () => {
  assert.equal(typeof friendService.isCheckingFriendsRunning, 'function');
  assert.equal(typeof friendService.isCheckingFriendsRunning(), 'boolean');
});

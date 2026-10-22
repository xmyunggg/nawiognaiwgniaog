const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-user-expiry-'));
process.env.FARM_DATA_DIR = dataDir;

const userStore = require('../src/models/user-store');

function writeUsers(users) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify({ users }, null, 2));
}

test('isUserExpired uses the latest persisted card expiry', () => {
  const now = Date.now();
  writeUsers([
    { username: 'expired', role: 'user', card: { expiresAt: now - 1000 } },
    { username: 'active', role: 'user', card: { expiresAt: now + 60_000 } },
    { username: 'permanent', role: 'user', card: { expiresAt: null } },
    { username: 'boss', role: 'admin', card: { expiresAt: now - 1000 } },
    { username: 'partner', role: 'agent', card: { expiresAt: now - 1000 } },
  ]);

  assert.equal(userStore.isUserExpired('expired', now), true);
  assert.equal(userStore.isUserExpired('active', now), false);
  assert.equal(userStore.isUserExpired('permanent', now), false);
  assert.equal(userStore.isUserExpired('boss', now), false);
  assert.equal(userStore.isUserExpired('partner', now), false);
  assert.equal(userStore.isUserExpired('missing', now), false);
});

test('renewing a user immediately clears the expired state', () => {
  const now = Date.now();
  writeUsers([
    { username: 'user-1', role: 'user', card: { expiresAt: now - 1000 } },
  ]);
  assert.equal(userStore.isUserExpired('user-1', now), true);

  writeUsers([
    { username: 'user-1', role: 'user', card: { expiresAt: now + 86_400_000 } },
  ]);
  assert.equal(userStore.isUserExpired('user-1', now), false);
});

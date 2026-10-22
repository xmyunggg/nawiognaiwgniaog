const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-delete-backup-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('deleteAccount writes a recoverable backup before removal', () => {
  const created = store.addOrUpdateAccount({
    name: 'backup-test',
    platform: 'qq',
    username: 'admin',
  });
  const account = created.accounts.find(item => item.name === 'backup-test');
  assert.ok(account && account.id);

  store.deleteAccount(account.id);

  const backupDir = path.join(dataDir, 'backups', 'deleted-accounts');
  const files = fs.readdirSync(backupDir);
  assert.equal(files.length, 1);

  const backup = JSON.parse(fs.readFileSync(path.join(backupDir, files[0]), 'utf8'));
  assert.equal(String(backup.account.id), String(account.id));
  assert.equal(backup.account.name, 'backup-test');
  assert.ok(backup.deletedAt);
});

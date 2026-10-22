const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-force-password-'));
process.env.FARM_DATA_DIR = dataDir;

const { validatePasswordStrength } = require('../src/models/user-store');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('force password change rejects default and weak passwords', () => {
  assert.equal(validatePasswordStrength('admin').valid, false);
  assert.equal(validatePasswordStrength('123456').valid, false);
  assert.equal(validatePasswordStrength('abcdef').valid, false);
  assert.equal(validatePasswordStrength('abc123').valid, false);
});

test('force password change accepts passwords with at least two character types', () => {
  assert.equal(validatePasswordStrength('FarmBot2026').valid, true);
  assert.equal(validatePasswordStrength('farm-bot-2026').valid, true);
  assert.equal(validatePasswordStrength('A'.repeat(129)).valid, false);
});

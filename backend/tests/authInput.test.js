const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAuthEmail } = require('../controllers/authController');

test('normalizes email consistently for registration and login', () => {
  assert.equal(normalizeAuthEmail('  Vinit.Example@Example.COM  '), 'vinit.example@example.com');
});

test('rejects missing and non-string email input as empty', () => {
  assert.equal(normalizeAuthEmail(undefined), '');
  assert.equal(normalizeAuthEmail(null), '');
  assert.equal(normalizeAuthEmail({ email: 'a@example.com' }), '');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createLoginLimiters } = require('../middleware/rateLimiter');

let server;
let baseUrl;
let virtualNow = 0;

function createClockStore() {
  const hits = new Map();
  return {
    init() {},
    increment(key) {
      const current = hits.get(key);
      if (!current || current.resetAt <= virtualNow) {
        const fresh = { totalHits: 1, resetAt: virtualNow + 60_000 };
        hits.set(key, fresh);
        return { totalHits: fresh.totalHits, resetTime: new Date(fresh.resetAt) };
      }
      current.totalHits += 1;
      return { totalHits: current.totalHits, resetTime: new Date(current.resetAt) };
    },
    decrement(key) {
      const current = hits.get(key);
      if (current) current.totalHits = Math.max(0, current.totalHits - 1);
    },
    resetKey(key) { hits.delete(key); },
  };
}

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', createLoginLimiters({ windowMs: 60_000, ipMax: 100, accountMax: 2 }), (req, res) => {
    if (req.body.password === 'valid-test-password') return res.status(200).json({ ok: true });
    return res.status(401).json({ error: 'Invalid credentials' });
  });
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function login(email, password) {
  return fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

test('limiter returns 429 at the configured account threshold and resets at the window boundary', async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', createLoginLimiters({
    windowMs: 60_000,
    ipMax: 100,
    accountMax: 2,
    ipStore: createClockStore(),
    accountStore: createClockStore(),
  }), (req, res) => res.status(401).json({ error: 'Invalid credentials' }));
  const isolatedServer = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const isolatedUrl = `http://127.0.0.1:${isolatedServer.address().port}/login`;
  const request = () => fetch(isolatedUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'clock@example.invalid', password: 'wrong' }),
  });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request()).status, 401);
    assert.equal((await request()).status, 429);
    virtualNow += 60_001;
    assert.equal((await request()).status, 401);
  } finally {
    await new Promise((resolve, reject) => isolatedServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('IP-level backstop limits failures spread across different account names', async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', createLoginLimiters({
    windowMs: 60_000, ipMax: 2, accountMax: 100,
    ipStore: createClockStore(), accountStore: createClockStore(),
  }), (_req, res) => res.status(401).json({ error: 'Invalid credentials' }));
  const isolatedServer = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const isolatedUrl = `http://127.0.0.1:${isolatedServer.address().port}/login`;
  const request = (email) => fetch(isolatedUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wrong' }),
  });
  try {
    assert.equal((await request('first@example.invalid')).status, 401);
    assert.equal((await request('second@example.invalid')).status, 401);
    assert.equal((await request('third@example.invalid')).status, 429);
  } finally {
    await new Promise((resolve, reject) => isolatedServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('failed attempts are limited per account without blocking another account on the same IP', async () => {
  assert.equal((await login('one@example.invalid', 'bad')).status, 401);
  assert.equal((await login('ONE@example.invalid', 'bad')).status, 401);
  assert.equal((await login('one@example.invalid', 'bad')).status, 429);
  assert.equal((await login('two@example.invalid', 'valid-test-password')).status, 200);
});

test('successful logins do not consume the account failure allowance', async () => {
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await login('success@example.invalid', 'valid-test-password')).status, 200);
  }
  assert.equal((await login('success@example.invalid', 'bad')).status, 401);
});

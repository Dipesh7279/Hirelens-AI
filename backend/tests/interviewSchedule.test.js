const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFutureSchedule } = require('../routes/interviewRoutes');

test('accepts only valid future interview schedule timestamps', () => {
  assert.equal(parseFutureSchedule(undefined), null);
  assert.equal(parseFutureSchedule('not-a-date'), null);
  assert.equal(parseFutureSchedule('2000-01-01T00:00:00.000Z'), null);
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(parseFutureSchedule(future).toISOString(), future);
});

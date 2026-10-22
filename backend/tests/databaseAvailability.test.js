const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const requireDatabase = require('../middleware/requireDatabase');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('returns a safe service-unavailable response when MongoDB is disconnected', () => {
  const previousState = mongoose.connection.readyState;
  mongoose.connection.readyState = 0;
  const response = createResponse();
  let continued = false;

  try {
    requireDatabase({}, response, () => {
      continued = true;
    });
  } finally {
    mongoose.connection.readyState = previousState;
  }

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    code: 'DATABASE_UNAVAILABLE',
    error: 'The database is unavailable. Check the database connection and try again.',
  });
  assert.equal(continued, false);
});

test('continues to the route when MongoDB is connected', () => {
  const previousState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  const response = createResponse();
  let continued = false;

  try {
    requireDatabase({}, response, () => {
      continued = true;
    });
  } finally {
    mongoose.connection.readyState = previousState;
  }

  assert.equal(continued, true);
  assert.equal(response.body, undefined);
});

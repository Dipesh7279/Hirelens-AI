const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const connectDB = require('../config/db');

test('database startup fails clearly without silently switching to local persistent storage', async () => {
  const originalUri = process.env.MONGO_URI;
  const originalConnect = mongoose.connect;
  delete process.env.MONGO_URI;
  await assert.rejects(connectDB(), /MONGO_URI is required/);

  process.env.MONGO_URI = 'mongodb://fake.invalid/test-only';
  mongoose.connect = async () => { throw new Error('private driver details'); };
  try {
    await assert.rejects(connectDB(), (error) => {
      assert.match(error.message, /server startup aborted/);
      assert.doesNotMatch(error.message, /private driver details|fake\.invalid/);
      assert.match(error.cause.message, /private driver details/);
      return true;
    });
  } finally {
    mongoose.connect = originalConnect;
    if (originalUri === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = originalUri;
  }
});

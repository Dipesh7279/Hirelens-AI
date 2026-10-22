const test = require('node:test');
const assert = require('node:assert/strict');
const errorHandler = require('../middleware/errorHandler');

test('does not log or return raw internal errors', () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    errorHandler(new Error('private resume text and provider response'), { method: 'POST', baseUrl: '/api/resume' }, response, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Internal server error' });
  assert.doesNotMatch(logs.join(' '), /private resume text|provider response/);
});

test('maps Multer file-size errors to 413', () => {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }), { method: 'POST', baseUrl: '/api/resume' }, response, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(response.statusCode, 413);
});

test('maps unsupported resume upload types to 400 rather than an internal server error', () => {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(Object.assign(new Error('Only PDF or DOCX files are allowed'), { code: 'UNSUPPORTED_RESUME_TYPE' }), { method: 'POST', baseUrl: '/api/resume' }, response, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Only PDF or DOCX files are allowed');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'auth-test-only-secret';

const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const authController = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

function makeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookies: {},
    cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
    clearCookie(name) { delete this.cookies[name]; return this; },
  };
}

async function callController(handler, body) {
  const res = makeResponse();
  let error;
  await handler(
    { body, headers: { 'user-agent': 'auth-integration-test' }, ip: '127.0.0.1' },
    res,
    (nextError) => { error = nextError; }
  );
  if (error) throw error;
  return res;
}

test('register then login accepts the same password and normalized email, rejects wrong password', async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);

  const password = 'Isolated-Test-Password-123';
  const missingRegistrationFields = await callController(authController.register, {
    name: '', email: 'bad-email', password: 'short',
  });
  assert.equal(missingRegistrationFields.statusCode, 400);

  const registration = await callController(authController.register, {
    name: 'Test Candidate',
    email: '  AUTH-TEST@example.invalid  ',
    password,
  });
  assert.equal(registration.statusCode, 201);

  const persistedUser = await User.findOne({ email: 'auth-test@example.invalid' }).select('+password');
  assert.ok(persistedUser);
  assert.notEqual(persistedUser.password, password);
  assert.equal(await persistedUser.comparePassword(password), true);

  const duplicate = await callController(authController.register, {
    name: 'Duplicate Test', email: 'AUTH-TEST@example.invalid', password,
  });
  assert.equal(duplicate.statusCode, 409);

  const restrictedRole = await callController(authController.register, {
    name: 'Test Admin Attempt',
    email: 'admin-attempt@example.invalid',
    password,
    role: 'admin',
  });
  assert.equal(restrictedRole.statusCode, 201);
  assert.equal(restrictedRole.body.user.role, 'candidate');

  const login = await callController(authController.login, {
    email: 'auth-test@example.invalid',
    password,
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.user.email, 'auth-test@example.invalid');
  assert.equal(Object.hasOwn(login.body.user, 'password'), false);
  const accessClaims = jwt.verify(login.body.accessToken, process.env.JWT_ACCESS_SECRET);
  assert.ok(accessClaims.exp > accessClaims.iat);

  // requireAuth attaches the verified token claims to the request.
  const protectedRequest = { headers: { authorization: `Bearer ${login.body.accessToken}` } };
  let passedAuth = false;
  requireAuth(protectedRequest, makeResponse(), () => { passedAuth = true; });
  assert.equal(passedAuth, true);
  const meResponse = makeResponse();
  let meError;
  await authController.me({ user: protectedRequest.user }, meResponse, (error) => { meError = error; });
  if (meError) throw meError;
  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.body.user.email, 'auth-test@example.invalid');
  assert.equal(Object.hasOwn(meResponse.body.user, 'password'), false);
  let denied = false;
  const deniedResponse = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  requireRole('admin')({ user: protectedRequest.user }, deniedResponse, () => { denied = true; });
  assert.equal(denied, false);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(login.cookies.refreshToken.options.httpOnly, true);
  assert.equal(login.cookies.refreshToken.options.sameSite, 'strict');
  assert.equal(login.cookies.refreshToken.options.path, '/api/auth');

  const firstRefreshCookie = login.cookies.refreshToken.value;
  const rotated = makeResponse();
  let refreshError;
  await authController.refresh(
    { cookies: { refreshToken: firstRefreshCookie }, headers: { 'user-agent': 'auth-integration-test' }, ip: '127.0.0.1' },
    rotated,
    (error) => { refreshError = error; }
  );
  if (refreshError) throw refreshError;
  assert.equal(rotated.statusCode, 200);
  const oldTokenRecord = await RefreshToken.findOne({ tokenHash: require('../utils/tokenUtils').hashToken(firstRefreshCookie) });
  assert.equal(oldTokenRecord.revoked, true);

  const logoutResponse = makeResponse();
  let logoutError;
  await authController.logout(
    { cookies: { refreshToken: rotated.cookies.refreshToken.value } },
    logoutResponse,
    (error) => { logoutError = error; }
  );
  if (logoutError) throw logoutError;
  assert.equal(logoutResponse.statusCode, 200);
  const loggedOutToken = await RefreshToken.findOne({ tokenHash: require('../utils/tokenUtils').hashToken(rotated.cookies.refreshToken.value) });
  assert.equal(loggedOutToken.revoked, true);

  const reused = makeResponse();
  let reuseError;
  await authController.refresh(
    { cookies: { refreshToken: firstRefreshCookie }, headers: { 'user-agent': 'auth-integration-test' }, ip: '127.0.0.1' },
    reused,
    (error) => { reuseError = error; }
  );
  if (reuseError) throw reuseError;
  assert.equal(reused.statusCode, 401);
  const family = await RefreshToken.find({ family: oldTokenRecord.family });
  assert.ok(family.every((token) => token.revoked));

  const wrongPassword = await callController(authController.login, {
    email: 'AUTH-TEST@example.invalid',
    password: 'Different-Password-123',
  });
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(wrongPassword.body.error, 'Invalid credentials');

  const unknownEmail = await callController(authController.login, {
    email: 'unknown@example.invalid', password,
  });
  assert.equal(unknownEmail.statusCode, 401);
  assert.deepEqual(unknownEmail.body, wrongPassword.body);

  const missingFields = await callController(authController.login, { email: '  ', password: '' });
  assert.equal(missingFields.statusCode, 400);

  const inactive = await User.create({
    name: 'Inactive Test', email: 'inactive@example.invalid', password, isActive: false,
  });
  assert.ok(inactive);
  const inactiveLogin = await callController(authController.login, { email: inactive.email, password });
  assert.equal(inactiveLogin.statusCode, 401);
  assert.deepEqual(inactiveLogin.body, wrongPassword.body);
});

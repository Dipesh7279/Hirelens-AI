const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = path.resolve(__dirname, '../../frontend/src');
const read = (relativePath) => fs.readFileSync(path.join(frontend, relativePath), 'utf8');

test('frontend auth requests use backend field names and cookie/token contract', () => {
  const context = read('context/AuthContext.jsx');
  const client = read('api/axiosInstance.js');
  const loginPage = read('pages/Login.jsx');
  const registerPage = read('pages/Register.jsx');

  assert.match(context, /api\.post\('\/auth\/login',\s*\{\s*email,\s*password\s*\}\)/);
  assert.match(context, /api\.post\('\/auth\/register',\s*\{\s*name,\s*email,\s*password,\s*role\s*\}\)/);
  assert.match(context, /setAccessToken\(data\.accessToken\)/);
  assert.match(client, /withCredentials:\s*true/);
  assert.match(client, /Authorization\s*=\s*`Bearer \$\{accessToken\}`/);
  assert.match(loginPage, /err\.response\?\.data\?\.error/);
  assert.match(registerPage, /err\.response\?\.data\?\.error/);
});

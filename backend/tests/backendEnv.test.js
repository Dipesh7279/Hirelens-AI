const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getBackendEnvPath, loadBackendEnv } = require('../config/backendEnv');

test('resolves backend .env from the backend directory, not the launch working directory', () => {
  assert.equal(getBackendEnvPath(), path.resolve(__dirname, '../.env'));
});

test('loads a supplied isolated test env file without depending on process.cwd()', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hirelens-env-test-'));
  const envFile = path.join(directory, 'backend-env.fixture');
  const variable = `HIRELENS_ENV_TEST_${process.pid}`;
  fs.writeFileSync(envFile, `${variable}=isolated-test-value\n`, 'utf8');
  delete process.env[variable];
  t.after(() => {
    delete process.env[variable];
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const result = loadBackendEnv(envFile);
  assert.equal(result.parsed[variable], 'isolated-test-value');
  assert.equal(process.env[variable], 'isolated-test-value');
});

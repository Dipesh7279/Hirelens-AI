const path = require('path');
const dotenv = require('dotenv');

function getBackendEnvPath() {
  return path.resolve(__dirname, '../.env');
}

function loadBackendEnv(envPath = getBackendEnvPath()) {
  return dotenv.config({ path: envPath });
}

module.exports = { getBackendEnvPath, loadBackendEnv };

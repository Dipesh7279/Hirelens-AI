const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = path.resolve(__dirname, '../../frontend/src/pages/AI_analysis.jsx');
const source = fs.readFileSync(frontend, 'utf8');

test('GitHub UI consumes the API contract and presents public evidence as advisory only', () => {
  assert.match(source, /`\/ai\/github\/\$\{encodeURIComponent\(username\.trim\(\)\)\}\/analyze`/);
  assert.match(source, /githubData\.analysisLimits\?\.commitWindowDays/);
  assert.match(source, /repo\.recentCommitCountCapped/);
  assert.match(source, /repo\.ownerLogin/);
  assert.match(source, /repo\.isFork/);
  assert.match(source, /repo\.languages/);
  assert.match(source, /safeGitHubUrl\(repo\.repositoryUrl\)/);
  assert.match(source, /repository-wide, not attributed to this person/);
  assert.match(source, /does not prove identity, authorship, skill, or work ownership/);
  assert.match(source, /status === 429/);
  assert.match(source, /No public repositories were found/);
});

test('GitHub skill matches link back only to repositories with direct language evidence', () => {
  assert.match(source, /Object\.hasOwn\(repo\.languages \|\| \{\}, match\.githubSkill\)/);
  assert.match(source, /No direct repository-language evidence for this match/);
  assert.match(source, /safeGitHubUrl\(value\)/);
  assert.match(source, /url\.protocol === "https:" && url\.hostname === "github\.com"/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'github-route-isolated-test-secret';

const aiRoutes = require('../routes/AI_routes');
const errorHandler = require('../middleware/errorHandler');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const ScoreRecord = require('../models/ScoreRecord');

let mongo;
let server;
let baseUrl;
let fetchCalls;
let aiStatus;
const originalFetch = global.fetch;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), CandidateProfile.init(), Job.init(), JobApplication.init(), ScoreRecord.init()]);
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRoutes);
  app.use(errorHandler);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/ai`;
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return {
      ok: aiStatus === 200,
      status: aiStatus,
      json: async () => aiStatus === 200 ? ({
        username: 'public-candidate',
        skills: ['Python', 'TypeScript'],
        repositories: [{
          name: 'sample-project', description: 'Public demo repo',
          repositoryUrl: 'https://github.com/public-candidate/sample-project',
          ownerLogin: 'public-candidate', languages: { Python: 88.5 },
          activityWindowDays: 90, recentCommitCount: 2, recentCommitCountCapped: false,
          hasRecentCommit: true, lastCommit: '2026-10-20T12:00:00Z', isFork: true,
          forkedFrom: 'https://github.com/upstream/sample-project', forksCount: 3,
        }],
        analysisLimits: {
          publicRepositoriesOnly: true, repositoryLimit: 10, repositoriesTruncated: false,
          commitWindowDays: 90, commitSampleLimit: 100,
          commitActivityScope: 'Repository-wide; not individual user attribution.',
        },
        advisoryNotice: 'Public metadata is advisory only.',
      }) : ({ detail: aiStatus === 429 ? 'GitHub public API rate limit reached; try again later' : 'GitHub user was not found' }),
    };
  };
});

test.after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await mongo?.stop();
});

async function makeUser(role, suffix) {
  return User.create({
    name: `Test ${role}`,
    email: `${role}-${suffix}@example.invalid`,
    password: 'Disposable-Test-Password-123',
    role,
  });
}

function auth(user) {
  const token = jwt.sign({ sub: String(user._id), role: user.role }, process.env.JWT_ACCESS_SECRET);
  return { Authorization: `Bearer ${token}` };
}

async function save(user, candidateId, body = { username: 'public-candidate' }) {
  return originalFetch(`${baseUrl}/github/save/${candidateId}`, {
    method: 'POST',
    headers: { ...auth(user), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.beforeEach(async () => {
  await Promise.all([User.deleteMany({}), CandidateProfile.deleteMany({}), Job.deleteMany({}), JobApplication.deleteMany({}), ScoreRecord.deleteMany({})]);
  fetchCalls = [];
  aiStatus = 200;
});

test('does not create a profile for a candidate ID with no existing profile', async () => {
  const recruiter = await makeUser('recruiter', 'no-profile');
  const candidate = await makeUser('candidate', 'no-profile');
  const response = await save(recruiter, candidate._id);

  assert.equal(response.status, 404);
  assert.equal(await CandidateProfile.countDocuments({ candidateId: candidate._id }), 0);
  assert.equal(fetchCalls.length, 0);
});

test('denies a recruiter without an existing profile relationship', async () => {
  const owner = await makeUser('recruiter', 'owner');
  const stranger = await makeUser('recruiter', 'stranger');
  const candidate = await makeUser('candidate', 'owned');
  await CandidateProfile.create({ candidateId: candidate._id, uploadedBy: owner._id });

  const response = await save(stranger, candidate._id);
  assert.equal(response.status, 403);
  assert.equal(fetchCalls.length, 0);
});

test('allows a recruiter to save analysis for a candidate who applied to the recruiter\'s job', async () => {
  const recruiter = await makeUser('recruiter', 'applicant-owner');
  const otherRecruiter = await makeUser('recruiter', 'job-owner');
  const candidate = await makeUser('candidate', 'applicant');
  const job = await Job.create({ recruiterId: recruiter._id, title: 'Test role', description: 'Synthetic test job' });
  await JobApplication.create({ candidateId: candidate._id, jobId: job._id });
  await CandidateProfile.create({ candidateId: candidate._id, uploadedBy: otherRecruiter._id });

  const response = await save(recruiter, candidate._id);
  assert.equal(response.status, 200);
  assert.equal(fetchCalls.length, 1);
});

test('owner saves canonical server analysis and ignores client-supplied skills and score', async () => {
  const recruiter = await makeUser('recruiter', 'save-owner');
  const candidate = await makeUser('candidate', 'save-owner');
  await CandidateProfile.create({ candidateId: candidate._id, uploadedBy: recruiter._id });

  const response = await save(recruiter, candidate._id, {
    username: 'public-candidate',
    skills: ['ForgedSkill'],
    githubVerificationScore: 100,
    repositories: [{ name: 'forged-repository', repositoryUrl: 'https://attacker.example' }],
  });
  assert.equal(response.status, 200);
  const profile = await CandidateProfile.findOne({ candidateId: candidate._id });
  assert.equal(profile.github.username, 'public-candidate');
  assert.deepEqual(profile.github.skills, ['Python', 'TypeScript']);
  assert.equal(profile.github.verificationScore, undefined);
  assert.equal(profile.github.repositories[0].name, 'sample-project');
  assert.equal(profile.github.repositories[0].ownerLogin, 'public-candidate');
  assert.equal(profile.github.repositories[0].recentCommitCount, 2);
  assert.equal(profile.github.repositories[0].languages.get('Python'), 88.5);
  assert.equal(profile.github.repositories[0].forkedFrom, 'https://github.com/upstream/sample-project');
  assert.equal(profile.github.analysisLimits.commitWindowDays, 90);
  assert.equal(String(profile.github.analyzedBy), String(recruiter._id));
  assert.ok(profile.github.analyzedAt instanceof Date);
  assert.match(profile.github.advisoryNotice, /advisory/);
  assert.equal(fetchCalls.length, 1);
});

test('GitHub analysis route preserves 404 and rate-limit responses for the UI', async () => {
  const recruiter = await makeUser('recruiter', 'api-errors');
  const headers = auth(recruiter);
  aiStatus = 429;
  const limited = await originalFetch(`${baseUrl}/github/public-candidate/analyze`, { headers });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /rate limit/i);

  aiStatus = 404;
  const missing = await originalFetch(`${baseUrl}/github/missing-user/analyze`, { headers });
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /not found/i);
});

test('rejects malformed candidate IDs and invalid GitHub usernames', async () => {
  const recruiter = await makeUser('recruiter', 'invalid');
  const badIdResponse = await save(recruiter, 'not-an-object-id');
  assert.equal(badIdResponse.status, 400);

  const candidate = await makeUser('candidate', 'invalid');
  await CandidateProfile.create({ candidateId: candidate._id, uploadedBy: recruiter._id });
  const badNameResponse = await save(recruiter, candidate._id, { username: '../admin' });
  assert.equal(badNameResponse.status, 400);
  assert.equal(fetchCalls.length, 0);
});

test('saving GitHub analysis never modifies candidate hiring scores or creates/modifies ScoreRecord', async () => {
  const recruiter = await makeUser('recruiter', 'score-isolation');
  const candidate = await makeUser('candidate', 'score-isolation');
  const job = await Job.create({ recruiterId: recruiter._id, title: 'Engineer', description: 'Test job' });
  await CandidateProfile.create({ candidateId: candidate._id, uploadedBy: recruiter._id });

  // Pre-existing score record for candidate
  const initialScore = await ScoreRecord.create({
    candidateId: candidate._id,
    jobId: job._id,
    weightedScore: 78.5,
    breakdown: {
      resumeQuality: 80,
      githubVerification: 0,
      skillMatch: 75,
      experienceRelevance: 80,
    },
    weights: {
      resumeQuality: 0.3,
      githubVerification: 0.2,
      skillMatch: 0.3,
      experienceRelevance: 0.2,
    },
    explanation: 'Initial score generated prior to public GitHub analysis',
    biasAuditStatus: 'not_performed',
  });

  const response = await save(recruiter, candidate._id, {
    username: 'public-candidate',
    weightedScore: 99,
    githubVerificationScore: 95,
  });

  assert.equal(response.status, 200);

  // ScoreRecord count must remain strictly 1
  assert.equal(await ScoreRecord.countDocuments({ candidateId: candidate._id }), 1);

  // ScoreRecord values must remain completely untouched
  const currentScore = await ScoreRecord.findById(initialScore._id);
  assert.equal(currentScore.weightedScore, 78.5);
  assert.equal(currentScore.breakdown.githubVerification, 0);
  assert.equal(currentScore.explanation, 'Initial score generated prior to public GitHub analysis');

  // CandidateProfile must not have any score fields injected
  const profile = await CandidateProfile.findOne({ candidateId: candidate._id });
  assert.equal(profile.github.verificationScore, undefined);
  assert.equal(profile.github.weightedScore, undefined);
});


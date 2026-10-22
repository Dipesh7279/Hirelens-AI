const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'report-test-only-secret';

const User = require('../models/User');
const Job = require('../models/Job');
const ScoreRecord = require('../models/ScoreRecord');
const JobApplication = require('../models/JobApplication');
const CandidateProfile = require('../models/CandidateProfile');
const candidateRoutes = require('../routes/CandidateRoute');
const { signAccessToken } = require('../utils/tokenUtils');

let mongoServer;
let server;
let baseUrl;
let recruiter;
let otherRecruiter;
let candidate;
let ownJob;
let otherJob;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  [recruiter, otherRecruiter, candidate] = await Promise.all([
    User.create({ name: 'Recruiter', email: 'report-recruiter@example.invalid', password: 'Disposable-Test-Password-123', role: 'recruiter' }),
    User.create({ name: 'Other Recruiter', email: 'report-other@example.invalid', password: 'Disposable-Test-Password-123', role: 'recruiter' }),
    User.create({ name: 'Candidate', email: 'report-candidate@example.invalid', password: 'Disposable-Test-Password-123', role: 'candidate' }),
  ]);
  [ownJob, otherJob] = await Promise.all([
    Job.create({ recruiterId: recruiter._id, title: 'Own role' }),
    Job.create({ recruiterId: otherRecruiter._id, title: 'Other role' }),
  ]);
  await ScoreRecord.create({
    candidateId: candidate._id,
    jobId: otherJob._id,
    weightedScore: 80,
    breakdown: { resumeQuality: 80 },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/candidates', candidateRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/candidates`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await mongoServer?.stop();
});

async function getReport(user, query = '') {
  const response = await fetch(`${baseUrl}/${candidate._id}/report${query}`, {
    headers: { authorization: `Bearer ${signAccessToken(user)}` },
  });
  return { status: response.status, body: await response.json() };
}

test('recruiter report endpoint never returns a candidate scored only for another recruiter job', async () => {
  assert.equal((await getReport(recruiter, `?jobId=${otherJob._id}`)).status, 403);
  assert.equal((await getReport(recruiter)).status, 404);

  await ScoreRecord.create({
    candidateId: candidate._id,
    jobId: ownJob._id,
    weightedScore: 70,
    breakdown: { resumeQuality: 70 },
  });
  const authorized = await getReport(recruiter, `?jobId=${ownJob._id}`);
  assert.equal(authorized.status, 200);
  assert.equal(String(authorized.body.score.jobId), String(ownJob._id));
  assert.equal(authorized.body.github, null);
});

test('candidate report returns advisory public github analysis when saved in candidate profile', async () => {
  await CandidateProfile.create({
    candidateId: candidate._id,
    uploadedBy: candidate._id,
    github: {
      username: 'sample-coder',
      skills: ['JavaScript', 'Python'],
      repositories: [
        {
          name: 'project-alpha',
          description: 'A tool for testing',
          repositoryUrl: 'https://github.com/sample-coder/project-alpha',
          ownerLogin: 'sample-coder',
          languages: { JavaScript: 100 },
          activityWindowDays: 90,
          recentCommitCount: 15,
          recentCommitCountCapped: false,
          hasRecentCommit: true,
          isFork: false,
          forkedFrom: null,
          forksCount: 0,
        },
      ],
      analysisLimits: {
        publicRepositoriesOnly: true,
        repositoryLimit: 10,
        repositoriesTruncated: false,
        commitWindowDays: 90,
        commitSampleLimit: 100,
        commitActivityScope: 'repository_recent_commits',
      },
      advisoryNotice: 'Public GitHub analysis is advisory only.',
      analyzedBy: recruiter._id,
      analyzedAt: new Date(),
    },
    skillMatch: {
      score: 85.5,
      matches: [
        { resumeSkill: 'JavaScript', githubSkill: 'JavaScript', similarity: 100 },
        { resumeSkill: 'Python', githubSkill: 'Python', similarity: 98.2 }
      ],
      computedAt: new Date(),
    },
  });

  const authorized = await getReport(recruiter, `?jobId=${ownJob._id}`);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.github.username, 'sample-coder');
  assert.deepEqual(authorized.body.github.skills, ['JavaScript', 'Python']);
  assert.equal(authorized.body.github.repositories.length, 1);
  assert.equal(authorized.body.github.repositories[0].name, 'project-alpha');
  assert.equal(authorized.body.github.repositories[0].repositoryUrl, 'https://github.com/sample-coder/project-alpha');
  assert.equal(authorized.body.github.analysisLimits.commitWindowDays, 90);
  assert.match(authorized.body.github.advisoryNotice, /advisory/i);
  assert.equal(authorized.body.skillMatch.score, 85.5);
  assert.equal(authorized.body.skillMatch.matches.length, 2);
  assert.equal(authorized.body.skillMatch.matches[0].resumeSkill, 'JavaScript');
  assert.equal(authorized.body.skillMatch.matches[0].similarity, 100);

  // Still forbidden for another recruiter's job
  assert.equal((await getReport(otherRecruiter, `?jobId=${ownJob._id}`)).status, 403);
});

test('recruiter report endpoint permits access for an unscored applicant who applied to the job', async () => {
  const applicantCandidate = await User.create({
    name: 'Applicant Only',
    email: 'applicant-only@example.invalid',
    password: 'Disposable-Test-Password-123',
    role: 'candidate',
  });
  await JobApplication.create({
    candidateId: applicantCandidate._id,
    jobId: ownJob._id,
  });

  const response = await fetch(`${baseUrl}/${applicantCandidate._id}/report?jobId=${ownJob._id}`, {
    headers: { authorization: `Bearer ${signAccessToken(recruiter)}` },
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.candidate.email, applicantCandidate.email);
  assert.equal(data.score, null);
});

test('feedback endpoint rejects candidate with no relationship and omits fabricated breakdown for unscored candidate', async () => {
  const unrelatedCandidate = await User.create({
    name: 'Unrelated Candidate',
    email: 'unrelated@example.invalid',
    password: 'Disposable-Test-Password-123',
    role: 'candidate',
  });

  // Attempting to submit feedback for a candidate who never applied or engaged returns 404
  const rejectedRes = await fetch(`${baseUrl}/${unrelatedCandidate._id}/feedback`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jobId: ownJob._id, decision: 'rejected' }),
  });
  assert.equal(rejectedRes.status, 404);
  assert.match((await rejectedRes.json()).error, /not applied or been evaluated/i);
});

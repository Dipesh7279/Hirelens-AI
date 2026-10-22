const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'pipeline-test-only-secret';

const User = require('../models/User');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const CandidateProfile = require('../models/CandidateProfile');
const Interview = require('../models/Interview');
const Feedback = require('../models/Feedback');
const candidateRoutes = require('../routes/CandidateRoute');
const { signAccessToken } = require('../utils/tokenUtils');

let mongoServer;
let server;
let baseUrl;
let recruiterA;
let recruiterB;
let candidate1;
let candidate2;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const password = 'Disposable-Test-Password-123';
  [recruiterA, recruiterB, candidate1, candidate2] = await Promise.all([
    User.create({ name: 'Recruiter Alpha', email: 'alpha@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Recruiter Beta', email: 'beta@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Alice Candidate', email: 'alice@example.invalid', password, role: 'candidate' }),
    User.create({ name: 'Bob Candidate', email: 'bob@example.invalid', password, role: 'candidate' }),
  ]);

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

async function getPipeline(user) {
  const response = await fetch(`${baseUrl}/pipeline`, {
    headers: { authorization: `Bearer ${signAccessToken(user)}` },
  });
  return { status: response.status, body: await response.json() };
}

test('returns empty pipeline when recruiter has no jobs or applicants', async () => {
  const res = await getPipeline(recruiterA);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { applied: [], screening: [], interviewing: [], offer: [] });
});

test('application-level cards and cross-job rejection isolation', async () => {
  // Recruiter A creates two jobs
  const [job1, job2] = await Promise.all([
    Job.create({ recruiterId: recruiterA._id, title: 'Fullstack Dev' }),
    Job.create({ recruiterId: recruiterA._id, title: 'DevOps Engineer' }),
  ]);

  // Recruiter B creates one job
  const jobB = await Job.create({ recruiterId: recruiterB._id, title: 'Data Scientist' });

  // Alice applies to Job 1 (interview) and Job 2 (rejected)
  const [app1, app2] = await Promise.all([
    JobApplication.create({ candidateId: candidate1._id, jobId: job1._id, status: 'interview' }),
    JobApplication.create({ candidateId: candidate1._id, jobId: job2._id, status: 'rejected' }),
  ]);

  // Bob applies to Job 1 (reviewing -> screening) and Job B (recruiter B's job)
  await Promise.all([
    JobApplication.create({ candidateId: candidate2._id, jobId: job1._id, status: 'reviewing' }),
    JobApplication.create({ candidateId: candidate2._id, jobId: jobB._id, status: 'applied' }),
  ]);

  // Fetch Recruiter A's pipeline
  const resA = await getPipeline(recruiterA);
  assert.equal(resA.status, 200);

  // Alice must appear in interviewing for Job 1, NOT masked by Job 2's rejection
  const interviewingCards = resA.body.interviewing;
  assert.equal(interviewingCards.length, 1);
  assert.equal(interviewingCards[0].candidateId, String(candidate1._id));
  assert.equal(interviewingCards[0].name, 'Alice Candidate');
  assert.equal(interviewingCards[0].jobTitle, 'Fullstack Dev');

  // Bob must appear in screening for Job 1
  const screeningCards = resA.body.screening;
  assert.equal(screeningCards.length, 1);
  assert.equal(screeningCards[0].candidateId, String(candidate2._id));
  assert.equal(screeningCards[0].jobTitle, 'Fullstack Dev');

  // Recruiter A must NOT see Bob's application to Job B (Recruiter B's job)
  const appliedCardsA = resA.body.applied;
  assert.equal(appliedCardsA.length, 0);

  // Fetch Recruiter B's pipeline: Bob must appear in applied for Data Scientist
  const resB = await getPipeline(recruiterB);
  assert.equal(resB.status, 200);
  assert.equal(resB.body.applied.length, 1);
  assert.equal(resB.body.applied[0].candidateId, String(candidate2._id));
  assert.equal(resB.body.applied[0].jobTitle, 'Data Scientist');
  assert.equal(resB.body.screening.length, 0);
  assert.equal(resB.body.interviewing.length, 0);
  assert.equal(resB.body.offer.length, 0);
});

test('handles candidate stage progression to offer correctly', async () => {
  const offerJob = await Job.create({ recruiterId: recruiterA._id, title: 'Lead Architect' });
  const offeredCandidate = await User.create({
    name: 'Charlie Architect',
    email: 'charlie@example.invalid',
    password: 'Disposable-Test-Password-123',
    role: 'candidate',
  });

  await JobApplication.create({
    candidateId: offeredCandidate._id,
    jobId: offerJob._id,
    status: 'offered',
  });

  const res = await getPipeline(recruiterA);
  assert.equal(res.status, 200);
  const offerCards = res.body.offer.filter((c) => c.candidateId === String(offeredCandidate._id));
  assert.equal(offerCards.length, 1);
  assert.equal(offerCards[0].name, 'Charlie Architect');
  assert.equal(offerCards[0].jobTitle, 'Lead Architect');
  assert.match(offerCards[0].stage, /Offer extended/i);
});


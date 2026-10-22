const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'job-application-test-only-secret';

const User = require('../models/User');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const CandidateProfile = require('../models/CandidateProfile');
const jobRoutes = require('../routes/jobRoutes');
const { signAccessToken } = require('../utils/tokenUtils');

let mongoServer;
let server;
let baseUrl;
let recruiter;
let otherRecruiter;
let candidate;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([Job.init(), JobApplication.init()]);
  const password = 'Disposable-Test-Password-123';
  [recruiter, otherRecruiter, candidate] = await Promise.all([
    User.create({ name: 'Recruiter One', email: 'recruiter-one@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Recruiter Two', email: 'recruiter-two@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Candidate One', email: 'candidate-one@example.invalid', password, role: 'candidate' }),
  ]);
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', jobRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/jobs`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await mongoServer?.stop();
});

async function request(path, user, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${signAccessToken(user)}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('candidate application and recruiter job ownership workflow is isolated', async () => {
  const created = await request('/', recruiter, 'POST', { title: 'Backend Engineer', requiredSkills: ['Node.js'] });
  assert.equal(created.status, 201);
  const jobId = created.body._id;

  const publicJobs = await request('/', candidate);
  assert.equal(publicJobs.status, 200);
  assert.equal(publicJobs.body.length, 1);
  assert.equal(Object.hasOwn(publicJobs.body[0], 'recruiterId'), false);

  // Attempting to apply without a parsed resume returns 400 Bad Request
  const noResumeApply = await request(`/${jobId}/applications`, candidate, 'POST', {});
  assert.equal(noResumeApply.status, 400);
  assert.match(noResumeApply.body.error, /upload your resume before applying/i);

  // Candidate uploads/parses resume
  await CandidateProfile.create({
    candidateId: candidate._id,
    uploadedBy: candidate._id,
    resume: { parsedAt: new Date(), fileName: 'candidate-resume.pdf' },
  });

  const applied = await request(`/${jobId}/applications`, candidate, 'POST', {});
  assert.equal(applied.status, 201);
  assert.equal(applied.body.status, 'applied');
  assert.equal((await request(`/${jobId}/applications`, candidate, 'POST', {})).status, 409);
  assert.equal((await request(`/${jobId}/applications`, otherRecruiter)).status, 403);

  const applicants = await request(`/${jobId}/applications`, recruiter);
  assert.equal(applicants.status, 200);
  assert.equal(applicants.body[0].candidateId.email, candidate.email);
  assert.equal((await request(`/applications/${applied.body._id}/status`, otherRecruiter, 'PATCH', { status: 'reviewing' })).status, 403);

  const changed = await request(`/applications/${applied.body._id}/status`, recruiter, 'PATCH', { status: 'reviewing' });
  assert.equal(changed.status, 200);
  assert.equal((await request('/applications/mine', candidate)).body[0].status, 'reviewing');

  assert.equal((await request(`/${jobId}`, otherRecruiter, 'PATCH', { status: 'closed' })).status, 403);
  assert.equal((await request(`/${jobId}`, recruiter, 'PATCH', { status: 'closed' })).status, 200);
  assert.equal((await request('/', candidate)).body.length, 0);
  assert.equal((await request(`/${jobId}/applications`, candidate, 'POST', {})).status, 409);
});

test('prevents score forgery and enforces that candidate applied before scoring', async () => {
  const unappliedCandidate = await User.create({
    name: 'Unapplied Candidate',
    email: 'unapplied@example.invalid',
    password: 'Disposable-Test-Password-123',
    role: 'candidate',
  });
  const openJob = await request('/', recruiter, 'POST', { title: 'Security Engineer', requiredSkills: ['Linux'] });
  assert.equal(openJob.status, 201);
  const jobId = openJob.body._id;

  // Attempting to score a candidate who has not applied must be rejected with 403
  const forbiddenScore = await request(`/${jobId}/scores`, recruiter, 'POST', {
    candidateId: unappliedCandidate._id,
    weightedScore: 95,
    breakdown: { resumeQuality: 95, skillMatch: 95 },
  });
  assert.equal(forbiddenScore.status, 403);
  assert.match(forbiddenScore.body.error, /has not applied/i);

  // Candidate uploads resume and applies
  await CandidateProfile.create({
    candidateId: unappliedCandidate._id,
    uploadedBy: unappliedCandidate._id,
    resume: { parsedAt: new Date(), fileName: 'unapplied-resume.pdf' },
  });
  const applyRes = await request(`/${jobId}/applications`, unappliedCandidate, 'POST', {});
  assert.equal(applyRes.status, 201);

  // Now scoring is permitted
  const validScore = await request(`/${jobId}/scores`, recruiter, 'POST', {
    candidateId: unappliedCandidate._id,
    weightedScore: 92,
    breakdown: { resumeQuality: 90, skillMatch: 95 },
  });
  assert.equal(validScore.status, 201);
  assert.equal(validScore.body.weightedScore, 92);
});

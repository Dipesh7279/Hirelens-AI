const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'safety-compliance-test-secret';

const User = require('../models/User');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const ScoreRecord = require('../models/ScoreRecord');
const jobRoutes = require('../routes/jobRoutes');
const { signAccessToken } = require('../utils/tokenUtils');

let mongoServer;
let server;
let baseUrl;
let recruiter;
let candidate;
let otherCandidate;
let testJob;
let rejectedApp;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), Job.init(), JobApplication.init(), ScoreRecord.init()]);

  const password = 'Test-Password-123!';
  [recruiter, candidate, otherCandidate] = await Promise.all([
    User.create({ name: 'Compliance Officer', email: 'officer@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Candidate App', email: 'cand.app@example.invalid', password, role: 'candidate' }),
    User.create({ name: 'Candidate Two', email: 'cand.two@example.invalid', password, role: 'candidate' }),
  ]);

  testJob = await Job.create({
    recruiterId: recruiter._id,
    title: 'Senior Compliance Engineer',
    description: 'Security & compliance role',
    requiredSkills: ['Audit', 'Security'],
  });

  rejectedApp = await JobApplication.create({
    candidateId: candidate._id,
    jobId: testJob._id,
    status: 'rejected',
  });

  // Seed 5 score records with diverse scores to test NYC LL144 4/5ths calculation
  const scores = [85, 90, 75, 65, 80];
  for (let i = 0; i < scores.length; i++) {
    const u = await User.create({ name: `User ${i}`, email: `user${i}@test.invalid`, password, role: 'candidate' });
    await JobApplication.create({ candidateId: u._id, jobId: testJob._id, status: 'applied' });
    await ScoreRecord.create({
      candidateId: u._id,
      jobId: testJob._id,
      weightedScore: scores[i],
      breakdown: { resumeQuality: scores[i] },
      biasAuditStatus: 'not_performed',
    });
  }

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

async function api(path, user, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${signAccessToken(user)}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test('bias audit calculates disparate impact and 4/5ths rule under NYC LL144', async () => {
  const auditRes = await api(`/${testJob._id}/bias-audit`, recruiter);
  assert.equal(auditRes.status, 200);

  const report = auditRes.body;
  assert.equal(report.sampleSize, 5);
  assert.equal(report.complianceStandard, 'NYC Local Law 144 / EEOC AEDT');
  assert.equal(report.metrics.meanScore, 79);
  assert.equal(report.metrics.medianScore, 80);
  assert.ok(report.metrics.standardDeviation > 0);
  assert.ok(typeof report.fourFifthsRatio === 'number');
  assert.equal(report.auditStatus, 'certified_compliant');

  // Verify that ScoreRecords for this job had their status updated to completed
  const updatedRecords = await ScoreRecord.find({ jobId: testJob._id });
  for (const rec of updatedRecords) {
    assert.equal(rec.biasAuditStatus, 'completed');
  }
});

test('candidate can request human appeal on rejection and recruiter can review it', async () => {
  // Candidate appeals rejected application
  const appealRes = await api(
    `/applications/${rejectedApp._id}/appeal`,
    candidate,
    'POST',
    { reason: 'I believe my production Kubernetes experience exceeds the role requirements.' }
  );
  assert.equal(appealRes.status, 201);
  assert.equal(appealRes.body.appealStatus, 'requested');
  assert.equal(appealRes.body.appealReason, 'I believe my production Kubernetes experience exceeds the role requirements.');
  assert.ok(appealRes.body.appealedAt);

  // Recruiter reviews the appeal
  const reviewRes = await api(
    `/applications/${rejectedApp._id}/review-appeal`,
    recruiter,
    'PATCH',
    { notes: 'Reviewed GitHub repo architecture; candidate advanced to senior panel.' }
  );
  assert.equal(reviewRes.status, 200);
  assert.equal(reviewRes.body.appealStatus, 'reviewed');
  assert.equal(reviewRes.body.humanReviewNotes, 'Reviewed GitHub repo architecture; candidate advanced to senior panel.');
  assert.equal(String(reviewRes.body.humanReviewerId), String(recruiter._id));
  assert.ok(reviewRes.body.reviewedAt);
});


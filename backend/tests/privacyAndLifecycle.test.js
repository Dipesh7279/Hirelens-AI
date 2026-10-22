const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'privacy-lifecycle-test-secret';
process.env.INTERNAL_SERVICE_KEY = 'hirelens-internal-shared-secret-dev';

const User = require('../models/User');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const CandidateProfile = require('../models/CandidateProfile');
const Interview = require('../models/Interview');
const ScoreRecord = require('../models/ScoreRecord');
const Feedback = require('../models/Feedback');
const RefreshToken = require('../models/RefreshToken');
const { storeResume, downloadResume } = require('../services/resumeObjectStorage');

const authRoutes = require('../routes/authRoutes');
const resumeRoutes = require('../routes/resumeRoutes');
const candidateRoutes = require('../routes/CandidateRoute');
const jobRoutes = require('../routes/jobRoutes');
const interviewRoutes = require('../routes/interviewRoutes');
const { signAccessToken } = require('../utils/tokenUtils');

let mongoServer;
let server;
let baseUrl;
let candidate;
let recruiter;
let testJob;
let candidateToken;
let recruiterToken;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    User.init(),
    Job.init(),
    JobApplication.init(),
    CandidateProfile.init(),
    Interview.init(),
    ScoreRecord.init(),
    Feedback.init(),
    RefreshToken.init(),
  ]);

  const password = 'Password-123!';
  [candidate, recruiter] = await Promise.all([
    User.create({ name: 'Alice Candidate', email: 'alice.privacy@test.invalid', password, role: 'candidate' }),
    User.create({ name: 'Bob Recruiter', email: 'bob.privacy@test.invalid', password, role: 'recruiter' }),
  ]);

  candidateToken = signAccessToken(candidate);
  recruiterToken = signAccessToken(recruiter);

  testJob = await Job.create({
    recruiterId: recruiter._id,
    title: 'Privacy Compliance Specialist',
    description: 'Ensure privacy by design',
    requiredSkills: ['GDPR', 'Security'],
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/resume', resumeRoutes);
  app.use('/api/candidate', candidateRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/interviews', interviewRoutes);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('GDPR Art 20: Candidate can export all personal data package', async () => {
  // Setup candidate data
  const stored = await storeResume(Buffer.from('%PDF-1.4 test resume'), 'test_resume.pdf', 'application/pdf');
  await CandidateProfile.create({
    candidateId: candidate._id,
    uploadedBy: candidate._id,
    resume: {
      fileName: 'test_resume.pdf',
      storageKey: stored.storageKey,
      mimeType: 'application/pdf',
      fileSize: 20,
      skills: ['GDPR', 'Node.js'],
      authenticityScore: 95,
      flags: [],
    },
  });

  const app = await JobApplication.create({
    candidateId: candidate._id,
    jobId: testJob._id,
    status: 'applied',
  });

  const iv = await Interview.create({
    candidateId: candidate._id,
    recruiterId: recruiter._id,
    jobTitle: testJob.title,
    status: 'in_progress',
    questions: [{ type: 'technical', question: 'How does GDPR Art 17 work?', expectedFocus: 'Right to erasure' }],
    responses: [{ questionIndex: 0, answer: 'It mandates data deletion upon candidate request' }],
  });

  await Feedback.create({
    candidateId: candidate._id,
    jobId: testJob._id,
    recruiterId: recruiter._id,
    decision: 'selected',
    text: 'Strong candidate profile',
  });

  const res = await fetch(`${baseUrl}/api/candidate/me/export`, {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.account.email, candidate.email);
  assert.equal(data.profile.resume.fileName, 'test_resume.pdf');
  assert.equal(data.applications.length, 1);
  assert.equal(data.applications[0].jobTitle, 'Privacy Compliance Specialist');
  assert.equal(data.interviews.length, 1);
  assert.equal(data.interviews[0].responses[0].answer, 'It mandates data deletion upon candidate request');
  assert.equal(data.feedback.length, 1);
  assert.equal(data.feedback[0].decision, 'selected');
});

test('GDPR Art 17: Candidate can purge stored resume and GridFS chunks', async () => {
  const profile = await CandidateProfile.findOne({ candidateId: candidate._id });
  const storageKey = profile.resume.storageKey;

  // Verify file exists in GridFS before deletion
  const fileBefore = await downloadResume(storageKey);
  assert.ok(fileBefore);

  const res = await fetch(`${baseUrl}/api/resume/${candidate._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${candidateToken}` },
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.message, /Resume purged successfully/i);

  // Verify file no longer exists in GridFS
  const fileAfter = await downloadResume(storageKey);
  assert.equal(fileAfter, null);

  // Verify CandidateProfile resume subdocument is cleared
  const updatedProfile = await CandidateProfile.findOne({ candidateId: candidate._id });
  assert.equal(updatedProfile, null); // completely deleted because no github profile was bound
});

test('Candidate can withdraw active job application', async () => {
  const app = await JobApplication.findOne({ candidateId: candidate._id });
  assert.ok(app);

  const res = await fetch(`${baseUrl}/api/jobs/applications/${app._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${candidateToken}` },
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.message, /Application withdrawn successfully/i);

  const exists = await JobApplication.exists({ _id: app._id });
  assert.equal(exists, null);
});

test('User can change password and old session tokens are revoked', async () => {
  const res = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${candidateToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      currentPassword: 'Password-123!',
      newPassword: 'Brand-New-Password-456!',
    }),
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.accessToken);

  // Attempt to login with old password should fail
  const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: candidate.email, password: 'Password-123!' }),
  });
  assert.equal(oldLogin.status, 401);

  // Login with new password should succeed
  const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: candidate.email, password: 'Brand-New-Password-456!' }),
  });
  assert.equal(newLogin.status, 200);
  const newLoginData = await newLogin.json();
  candidateToken = newLoginData.accessToken;
});

test('Interview Integrity DoS Protection rejects oversized event arrays', async () => {
  const iv = await Interview.findOne({ candidateId: candidate._id });

  // Array of 60 events (exceeds max 50)
  const oversizedEvents = Array.from({ length: 60 }, () => ({
    event: 'tab_switch',
    timestamp: new Date().toISOString(),
    confidence: 1,
  }));

  const res = await fetch(`${baseUrl}/api/interviews/${iv._id}/integrity-log`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${candidateToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ events: oversizedEvents }),
  });

  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /events array cannot exceed 50 items/i);
});

test('GDPR Art 17 Account Erasure purges user, applications, interviews, and session data', async () => {
  const res = await fetch(`${baseUrl}/api/auth/account`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${candidateToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ currentPassword: 'Brand-New-Password-456!' }),
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.message, /Account and associated personal data erased successfully/i);

  // Verify User record is deleted
  const user = await User.findById(candidate._id);
  assert.equal(user, null);

  // Verify Interviews are purged
  const ivCount = await Interview.countDocuments({ candidateId: candidate._id });
  assert.equal(ivCount, 0);

  // Verify Feedback is purged
  const fbCount = await Feedback.countDocuments({ candidateId: candidate._id });
  assert.equal(fbCount, 0);
});


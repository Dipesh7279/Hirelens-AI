const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'interview-integrity-test-secret';
process.env.NODE_ENV = 'test';

const User = require('../models/User');
const Interview = require('../models/Interview');
const interviewRoutes = require('../routes/interviewRoutes');
const { signAccessToken } = require('../utils/tokenUtils');
const {
  createInitialState,
  deriveFrameEvents,
  resetAllStates,
} = require('../utils/integrityEvents');
const { summarizeIntegrity, discloseIntegrityAfterCompletion } = require('../utils/interviewDisclosure');

let mongoServer;
let server;
let baseUrl;
let recruiter;
let candidate;
let otherCandidate;
let originalFetch;

test.before(async () => {
  originalFetch = global.fetch;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), Interview.init()]);

  const password = 'Disposable-Test-Password-123';
  [recruiter, candidate, otherCandidate] = await Promise.all([
    User.create({ name: 'Recruiter', email: 'recruiter-int@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Candidate One', email: 'candidate-int1@example.invalid', password, role: 'candidate' }),
    User.create({ name: 'Candidate Two', email: 'candidate-int2@example.invalid', password, role: 'candidate' }),
  ]);

  const app = express();
  app.use(express.json());
  app.use('/api/interviews', interviewRoutes);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/interviews`;
});

test.after(async () => {
  global.fetch = originalFetch;
  if (server) await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await mongoose.disconnect();
  await mongoServer?.stop();
});

test('Step 3 (unit): deriveFrameEvents sustains 5s for face_absent, 6s for looking_away, and debounces 15s', () => {
  const state = createInitialState();
  const t0 = 1_000_000;

  // Initial missing face starts timer, does not emit
  assert.deepEqual(deriveFrameEvents(state, { faceCount: 0 }, t0), []);
  // 4s absence (< 5s threshold) -> no event
  assert.deepEqual(deriveFrameEvents(state, { faceCount: 0 }, t0 + 4000), []);
  // 6s absence (>= 5s threshold) -> emits 1 face_absent
  const e1 = deriveFrameEvents(state, { faceCount: 0 }, t0 + 6000);
  assert.equal(e1.length, 1);
  assert.equal(e1[0].event, 'face_absent');
  // Continued absence within 15s debounce -> no duplicate
  assert.deepEqual(deriveFrameEvents(state, { faceCount: 0 }, t0 + 12000), []);
  // After 15s debounce -> emits again
  const e2 = deriveFrameEvents(state, { faceCount: 0 }, t0 + 21500);
  assert.equal(e2.length, 1);
  assert.equal(e2[0].event, 'face_absent');

  // Face returns looking away -> starts lookingAway timer, resets absentSince
  const t1 = t0 + 30000;
  assert.deepEqual(deriveFrameEvents(state, { faceCount: 1, lookingAway: true }, t1), []);
  // 4s looking away (< 6s) -> no event
  assert.deepEqual(deriveFrameEvents(state, { faceCount: 1, lookingAway: true }, t1 + 4000), []);
  // 6.5s looking away (>= 6s) -> emits looking_away
  const e3 = deriveFrameEvents(state, { faceCount: 1, lookingAway: true }, t1 + 6500);
  assert.equal(e3.length, 1);
  assert.equal(e3[0].event, 'looking_away');
  // Duplicate within 15s suppressed
  assert.deepEqual(deriveFrameEvents(state, { faceCount: 1, lookingAway: true }, t1 + 10000), []);
});

test('Step 3 (integration): consent gate, server-side frame event derivation, client tab_switch only + timestamp clamp, ownership & completion locks', async () => {
  resetAllStates();
  const iv = await Interview.create({
    candidateId: candidate._id,
    recruiterId: recruiter._id,
    jobTitle: 'Security Engineer',
    questions: [
      { type: 'technical', question: 'Q1', expectedFocus: 'F1' },
      { type: 'technical', question: 'Q2', expectedFocus: 'F2' },
    ],
    status: 'scheduled',
  });

  const makeFrameForm = () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('ffd8ffe0', 'hex')], { type: 'image/jpeg' }), 'frame.jpg');
    return form;
  };

  // 1. /frame without consent -> 403
  const noConsentRes = await originalFetch(`${baseUrl}/${iv._id}/frame`, {
    method: 'POST',
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
    body: makeFrameForm(),
  });
  assert.equal(noConsentRes.status, 403);

  // Give consent -> status becomes in_progress
  const consentRes = await originalFetch(`${baseUrl}/${iv._id}/consent`, {
    method: 'POST',
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
  });
  assert.equal(consentRes.status, 200);

  // 2. Other candidate cannot post frame or integrity log -> 403
  const otherCandidateFrame = await originalFetch(`${baseUrl}/${iv._id}/frame`, {
    method: 'POST',
    headers: { authorization: `Bearer ${signAccessToken(otherCandidate)}` },
    body: makeFrameForm(),
  });
  assert.equal(otherCandidateFrame.status, 403);

  // 3. Mock AI returning faceCount: 2 -> stores multiple_faces server-side and increments framesAnalyzed
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/integrity/analyze-frame')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          faceCount: 2,
          phoneDetected: false,
          confidence: 0,
          lookingAway: false,
          yawRatio: 0,
          pitchRatio: 0,
          attentionAvailable: true,
          phoneCheckAvailable: true,
        }),
      };
    }
    return originalFetch(url, options);
  };

  const frameRes = await originalFetch(`${baseUrl}/${iv._id}/frame`, {
    method: 'POST',
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
    body: makeFrameForm(),
  });
  assert.equal(frameRes.status, 200);

  let updated = await Interview.findById(iv._id);
  assert.equal(updated.framesAnalyzed, 1);
  assert.equal(updated.integrityLog.length, 1);
  assert.equal(updated.integrityLog[0].event, 'multiple_faces');

  // 4. Client /integrity-log ignores face_absent/phone_detected/looking_away and only stores tab_switch with clamped timestamp
  const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
  const beforeLogMs = Date.now();
  const logRes = await originalFetch(`${baseUrl}/${iv._id}/integrity-log`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(candidate)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      events: [
        { event: 'face_absent', confidence: 0.9, timestamp: futureDate },
        { event: 'phone_detected', confidence: 0.95, timestamp: futureDate },
        { event: 'looking_away', confidence: 0.8, timestamp: futureDate },
        { event: 'tab_switch', confidence: 1, timestamp: futureDate },
      ],
    }),
  });
  const afterLogMs = Date.now();
  assert.equal(logRes.status, 200);
  const logBody = await logRes.json();
  assert.equal(logBody.stored, 1, 'Only tab_switch should be stored from client batch');

  updated = await Interview.findById(iv._id);
  assert.equal(updated.integrityLog.length, 2);
  const tabEvent = updated.integrityLog[1];
  assert.equal(tabEvent.event, 'tab_switch');
  assert.ok(
    tabEvent.timestamp.getTime() <= afterLogMs && tabEvent.timestamp.getTime() >= beforeLogMs - 1000,
    'Future client timestamp must be clamped to server now'
  );

  // 5. Complete interview -> rejects new frames (403) and new logs (409)
  await originalFetch(`${baseUrl}/${iv._id}/answers`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(candidate)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      responses: [
        { questionIndex: 0, answer: 'Answer 1' },
        { questionIndex: 1, answer: 'Answer 2' },
      ],
    }),
  });
  const completeRes = await originalFetch(`${baseUrl}/${iv._id}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
  });
  assert.equal(completeRes.status, 200);

  const postCompleteFrame = await originalFetch(`${baseUrl}/${iv._id}/frame`, {
    method: 'POST',
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
    body: makeFrameForm(),
  });
  assert.equal(postCompleteFrame.status, 403);

  const postCompleteLog = await originalFetch(`${baseUrl}/${iv._id}/integrity-log`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(candidate)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ events: [{ event: 'tab_switch', confidence: 1 }] }),
  });
  assert.equal(postCompleteLog.status, 409);
});

test('Step 4: summarizeIntegrity counts all 5 events, discloses summary to recruiter only when completed, and never exposes to candidate', async () => {
  // Unit check for summarizeIntegrity levels
  const noneSummary = summarizeIntegrity({ framesAnalyzed: 10, integrityLog: [] });
  assert.equal(noneSummary.level, 'none');
  assert.equal(noneSummary.advisoryNote, 'Advisory - not part of the score');

  const lowSummary = summarizeIntegrity({
    framesAnalyzed: 25,
    startedAt: new Date(Date.now() - 12 * 60000),
    completedAt: new Date(),
    integrityLog: [
      { event: 'looking_away' },
      { event: 'tab_switch' },
    ],
  });
  assert.equal(lowSummary.level, 'low');
  assert.equal(lowSummary.counts.looking_away, 1);
  assert.equal(lowSummary.counts.tab_switch, 1);
  assert.equal(lowSummary.framesAnalyzed, 25);
  assert.ok(lowSummary.durationMinutes >= 11.9 && lowSummary.durationMinutes <= 12.1);

  const reviewSummary = summarizeIntegrity({
    framesAnalyzed: 40,
    integrityLog: [
      { event: 'multiple_faces' },
      { event: 'face_absent' },
      { event: 'phone_detected' },
      { event: 'looking_away' },
    ],
  });
  assert.equal(reviewSummary.level, 'review');

  // Withheld before completion
  const inProgressDisclosed = discloseIntegrityAfterCompletion({
    status: 'in_progress',
    framesAnalyzed: 5,
    integrityLog: [{ event: 'tab_switch' }],
  });
  assert.equal(inProgressDisclosed.integritySummary, undefined);
  assert.deepEqual(inProgressDisclosed.integrityLog, []);

  // Integration check on GET /api/interviews for recruiter vs candidate
  await Interview.create({
    candidateId: candidate._id,
    recruiterId: recruiter._id,
    jobTitle: 'In-Progress Role',
    status: 'in_progress',
    framesAnalyzed: 8,
    integrityLog: [{ event: 'looking_away', confidence: 0.75 }],
  });

  const recruiterRes = await originalFetch(baseUrl, {
    headers: { authorization: `Bearer ${signAccessToken(recruiter)}` },
  });
  assert.equal(recruiterRes.status, 200);
  const recruiterList = await recruiterRes.json();

  const completedIv = recruiterList.find((item) => item.status === 'completed');
  const inProgressIv = recruiterList.find((item) => item.status === 'in_progress');
  assert.ok(completedIv.integritySummary, 'Completed interview must include integritySummary for recruiter');
  assert.equal(completedIv.integritySummary.counts.multiple_faces, 1);
  assert.equal(completedIv.integritySummary.counts.tab_switch, 1);
  assert.equal(inProgressIv.integritySummary, undefined, 'In-progress interview must not include integritySummary');
  assert.deepEqual(inProgressIv.integrityLog, []);

  const candidateRes = await originalFetch(baseUrl, {
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
  });
  assert.equal(candidateRes.status, 200);
  const candidateList = await candidateRes.json();
  for (const item of candidateList) {
    assert.equal(item.integritySummary, undefined);
    assert.equal(item.integrityLog, undefined);
    assert.equal(item.questions, undefined);
  }
});


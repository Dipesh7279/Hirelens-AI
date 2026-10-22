const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'interview-qgen-test-secret';

const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Interview = require('../models/Interview');
const interviewRoutes = require('../routes/interviewRoutes');
const { signAccessToken } = require('../utils/tokenUtils');

let mongoServer;
let server;
let baseUrl;
let recruiter;
let otherRecruiter;
let candidate;
let originalFetch;

const SAMPLE_AI_QUESTIONS = [
  { type: 'technical', question: 'Explain Node.js event loop phases.', expectedFocus: 'Timers, poll, check.' },
  { type: 'technical', question: 'How does FastAPI dependency injection work?', expectedFocus: 'Depends and lifecycle.' },
  { type: 'technical', question: 'Describe MongoDB compound index selectivity.', expectedFocus: 'ESR rule.' },
  { type: 'project', question: 'Walk through the architecture of Repo-0.', expectedFocus: 'Module boundaries.' },
  { type: 'project', question: 'How did you test Repo-1 under load?', expectedFocus: 'Benchmarking.' },
  { type: 'behavioral', question: 'Tell me about resolving a production incident.', expectedFocus: 'Blameless postmortem.' },
];

test.before(async () => {
  originalFetch = global.fetch;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), CandidateProfile.init(), Interview.init()]);

  const password = 'Disposable-Test-Password-123';
  [recruiter, otherRecruiter, candidate] = await Promise.all([
    User.create({ name: 'Recruiter', email: 'recruiter-qgen@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Other Recruiter', email: 'other-recruiter-qgen@example.invalid', password, role: 'recruiter' }),
    User.create({ name: 'Candidate', email: 'candidate-qgen@example.invalid', password, role: 'candidate' }),
  ]);

  // Give the candidate 20 GitHub repositories to exercise the <=15 cap
  const repositories = Array.from({ length: 20 }, (_, i) => ({
    name: `  Repo-${i}  `,
    description: `Repository ${i}`,
    language: 'JavaScript',
  }));
  await CandidateProfile.create({
    candidateId: candidate._id,
    uploadedBy: candidate._id,
    resume: {
      skills: ['Node.js', '  FastAPI  ', 'x'.repeat(80)],
      projects: [{ title: 'ResumeProjectAlpha' }],
    },
    github: {
      username: 'candidate-gh',
      skills: ['MongoDB', 'node.js'],
      repositories,
    },
  });

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

test('Step 1: caps githubRepositories to <=15, trims/caps skills, and records questionSource="ai" on 200', async () => {
  let capturedAiPayload = null;

  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/interview/generate-questions')) {
      capturedAiPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ questions: SAMPLE_AI_QUESTIONS }),
      };
    }
    return originalFetch(url, options);
  };

  const response = await originalFetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      candidateEmail: candidate.email,
      jobTitle: 'Senior Backend Engineer',
      verifiedSkills: ['  Node.js  ', 'FastAPI', '', 'y'.repeat(61)],
      projectTitles: ['  CustomProject  '],
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json();

  assert.ok(capturedAiPayload, 'Expected AI service to be called');
  assert.ok(Array.isArray(capturedAiPayload.githubRepositories));
  assert.equal(capturedAiPayload.githubRepositories.length, 15, 'githubRepositories must be capped at 15');
  assert.equal(capturedAiPayload.githubRepositories[0], 'Repo-0', 'repo names must be trimmed');
  assert.ok(
    capturedAiPayload.verifiedSkills.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 60),
    'all verifiedSkills must be trimmed non-empty strings <= 60 chars'
  );

  assert.equal(body.questionSource, 'ai');
  assert.equal(body.questions.length, 6);
});

test('Step 1: AI 5xx/error falls back to 6 questions (3/2/1) with questionSource="fallback" and no EEOC terms', async () => {
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/interview/generate-questions')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ detail: 'Gemini unavailable' }),
      };
    }
    return originalFetch(url, options);
  };

  const response = await originalFetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      candidateEmail: candidate.email,
      jobTitle: 'Platform Engineer',
      verifiedSkills: ['Node.js', 'Docker', 'Kubernetes'],
      projectTitles: ['DeployPipeline'],
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.questionSource, 'fallback');
  assert.equal(body.questions.length, 6);

  const counts = body.questions.reduce((acc, q) => {
    acc[q.type] = (acc[q.type] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { technical: 3, project: 2, behavioral: 1 });

  const forbidden = /\b(age|married|pregnant|religion|nationality|disability|gender)\b/i;
  for (const q of body.questions) {
    assert.doesNotMatch(q.question, forbidden);
    assert.doesNotMatch(q.expectedFocus, forbidden);
  }
});

test('Step 2: malformed AI response (wrong type counts, duplicate questions, or empty focus) falls back with questionSource="fallback"', async () => {
  const malformedPayloads = [
    // Wrong distribution (4 technical, 1 project, 1 behavioral)
    SAMPLE_AI_QUESTIONS.map((q, idx) => (idx === 3 ? { ...q, type: 'technical' } : q)),
    // Duplicate question text
    SAMPLE_AI_QUESTIONS.map((q, idx) => (idx === 1 ? { ...q, question: SAMPLE_AI_QUESTIONS[0].question } : q)),
    // Empty expectedFocus
    SAMPLE_AI_QUESTIONS.map((q, idx) => (idx === 0 ? { ...q, expectedFocus: '   ' } : q)),
  ];

  for (const badQuestions of malformedPayloads) {
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/interview/generate-questions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ questions: badQuestions }),
        };
      }
      return originalFetch(url, options);
    };

    const response = await originalFetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signAccessToken(recruiter)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        candidateEmail: candidate.email,
        jobTitle: 'Backend Reliability Engineer',
        verifiedSkills: ['Node.js'],
      }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.questionSource, 'fallback');
    assert.equal(body.questions.length, 6);
    const uniqueQuestions = new Set(body.questions.map((q) => q.question.toLowerCase()));
    assert.equal(uniqueQuestions.size, 6, 'Fallback questions must all be unique even when 1 skill is provided');
  }
});

test('Step 3: generateFallbackQuestions without projects grounds project questions in verified skills and keeps all 6 unique', () => {
  const fallback = interviewRoutes.generateFallbackQuestions('API Engineer', ['Python'], [], []);
  assert.equal(fallback.length, 6);
  const projectQuestions = fallback.filter((q) => q.type === 'project');
  assert.equal(projectQuestions.length, 2);
  for (const pq of projectQuestions) {
    assert.match(pq.question, /Python/);
  }
  const uniqueQuestions = new Set(fallback.map((q) => q.question.toLowerCase()));
  assert.equal(uniqueQuestions.size, 6);
});

test('Step 4: recruiter view includes expectedFocus while candidate room view hides expectedFocus and integrityLog', async () => {
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/interview/generate-questions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ questions: SAMPLE_AI_QUESTIONS }),
      };
    }
    return originalFetch(url, options);
  };

  const createRes = await originalFetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      candidateEmail: candidate.email,
      jobTitle: 'Distributed Systems Engineer',
      verifiedSkills: ['Node.js', 'FastAPI', 'MongoDB'],
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  // Recruiter GET /api/interviews includes expectedFocus and questionSource
  const recruiterRes = await originalFetch(baseUrl, {
    headers: { authorization: `Bearer ${signAccessToken(recruiter)}` },
  });
  assert.equal(recruiterRes.status, 200);
  const recruiterList = await recruiterRes.json();
  const recruiterView = recruiterList.find((iv) => String(iv._id) === String(created._id));
  assert.ok(recruiterView);
  assert.equal(recruiterView.questionSource, 'ai');
  assert.equal(recruiterView.questions.length, 6);
  assert.ok(recruiterView.questions.every((q) => typeof q.expectedFocus === 'string' && q.expectedFocus.length > 0));

  // Candidate GET /api/interviews/:id/room receives only { type, question } — never expectedFocus or integrityLog
  const roomRes = await originalFetch(`${baseUrl}/${created._id}/room`, {
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
  });
  assert.equal(roomRes.status, 200);
  const roomBody = await roomRes.json();
  assert.equal(roomBody.questions.length, 6);
  assert.equal(roomBody.integrityLog, undefined);
  for (const q of roomBody.questions) {
    assert.ok(q.type);
    assert.ok(q.question);
    assert.equal(q.expectedFocus, undefined, 'expectedFocus must never be exposed to candidates');
  }
});

test('Step 5: anti-bias screening rejects AI questions or expectedFocus containing prohibited personal inquiries', async () => {
  const biasedPayloads = [
    // Age / graduation year inquiry
    SAMPLE_AI_QUESTIONS.map((q, idx) => (idx === 0 ? { ...q, question: 'What was your graduation year from college?' } : q)),
    // Family / marital status inquiry
    SAMPLE_AI_QUESTIONS.map((q, idx) => (idx === 5 ? { ...q, question: 'Do you have children or family plans that affect travel?' } : q)),
    // Health / disability inquiry in expectedFocus
    SAMPLE_AI_QUESTIONS.map((q, idx) => (idx === 1 ? { ...q, expectedFocus: 'Probe whether candidate has a disability or chronic illness' } : q)),
    // Religion inquiry
    SAMPLE_AI_QUESTIONS.map((q, idx) => (idx === 2 ? { ...q, question: 'Will your religious holidays conflict with team on-call?' } : q)),
  ];

  for (const badQuestions of biasedPayloads) {
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/interview/generate-questions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ questions: badQuestions }),
        };
      }
      return originalFetch(url, options);
    };

    const response = await originalFetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signAccessToken(recruiter)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        candidateEmail: candidate.email,
        jobTitle: 'Backend Security Engineer',
        verifiedSkills: ['Node.js', 'Go'],
      }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.questionSource, 'fallback', 'Anti-bias screening failure must trigger safe fallback');
    assert.equal(body.questions.length, 6);

    for (const q of body.questions) {
      assert.equal(interviewRoutes.containsProhibitedInquiry(q.question), false);
      assert.equal(interviewRoutes.containsProhibitedInquiry(q.expectedFocus), false);
    }
  }
});

test('Step 6: interview scheduling validates future timestamps and rejects invalid or past dates', async () => {
  const futureDate = new Date(Date.now() + 86400000).toISOString();
  const pastDate = new Date(Date.now() - 86400000).toISOString();

  // Rejects past date at creation
  const pastRes = await originalFetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      candidateEmail: candidate.email,
      jobTitle: 'DevOps Engineer',
      verifiedSkills: ['Kubernetes'],
      scheduledAt: pastDate,
    }),
  });
  assert.equal(pastRes.status, 400);
  const pastBody = await pastRes.json();
  assert.equal(pastBody.error, 'scheduledAt must be a valid future date');

  // Rejects invalid date string at creation
  const invalidRes = await originalFetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      candidateEmail: candidate.email,
      jobTitle: 'DevOps Engineer',
      verifiedSkills: ['Kubernetes'],
      scheduledAt: 'not-a-valid-date',
    }),
  });
  assert.equal(invalidRes.status, 400);

  // Successfully accepts valid future timestamp or leaves unscheduled
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/interview/generate-questions')) {
      return { ok: true, status: 200, json: async () => ({ questions: SAMPLE_AI_QUESTIONS }) };
    }
    return originalFetch(url, options);
  };

  const validRes = await originalFetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      candidateEmail: candidate.email,
      jobTitle: 'DevOps Engineer',
      verifiedSkills: ['Kubernetes'],
      scheduledAt: futureDate,
    }),
  });
  assert.equal(validRes.status, 201);
  const validBody = await validRes.json();
  assert.equal(new Date(validBody.scheduledAt).toISOString(), futureDate);
});

test('Step 7: recruiter ownership isolation and reschedule state guards', async () => {
  // Create an interview owned by recruiter
  const futureDate = new Date(Date.now() + 3600000).toISOString();
  const iv = await Interview.create({
    candidateId: candidate._id,
    recruiterId: recruiter._id,
    jobTitle: 'Infrastructure Architect',
    questions: SAMPLE_AI_QUESTIONS,
    questionSource: 'ai',
    scheduledAt: new Date(futureDate),
    status: 'scheduled',
  });

  // Other recruiter cannot reschedule recruiter's interview (403)
  const otherRescheduleRes = await originalFetch(`${baseUrl}/${iv._id}/schedule`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${signAccessToken(otherRecruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ scheduledAt: new Date(Date.now() + 7200000).toISOString() }),
  });
  assert.equal(otherRescheduleRes.status, 403);
  const otherRescheduleBody = await otherRescheduleRes.json();
  assert.equal(otherRescheduleBody.error, 'Not your interview');

  // Other recruiter cannot view recruiter's interview via GET /:id (403)
  const otherGetRes = await originalFetch(`${baseUrl}/${iv._id}`, {
    headers: { authorization: `Bearer ${signAccessToken(otherRecruiter)}` },
  });
  assert.equal(otherGetRes.status, 403);

  // Owning recruiter can reschedule with a valid future timestamp
  const newDate = new Date(Date.now() + 10800000).toISOString();
  const validReschedule = await originalFetch(`${baseUrl}/${iv._id}/schedule`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ scheduledAt: newDate }),
  });
  assert.equal(validReschedule.status, 200);
  const rescheduledBody = await validReschedule.json();
  assert.equal(new Date(rescheduledBody.scheduledAt).toISOString(), newDate);

  // Owning recruiter cannot reschedule with a past timestamp
  const pastReschedule = await originalFetch(`${baseUrl}/${iv._id}/schedule`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ scheduledAt: '2020-01-01T00:00:00.000Z' }),
  });
  assert.equal(pastReschedule.status, 400);

  // Cannot reschedule once interview is in_progress or completed (409)
  iv.status = 'in_progress';
  await iv.save();

  const inProgressReschedule = await originalFetch(`${baseUrl}/${iv._id}/schedule`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${signAccessToken(recruiter)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ scheduledAt: new Date(Date.now() + 14400000).toISOString() }),
  });
  assert.equal(inProgressReschedule.status, 409);
  const inProgressBody = await inProgressReschedule.json();
  assert.equal(inProgressBody.error, 'Only scheduled interviews can be rescheduled');
});

test('Step 8: candidate GET /:id receives redacted questions without expectedFocus or integrity log', async () => {
  const iv = await Interview.create({
    candidateId: candidate._id,
    recruiterId: recruiter._id,
    jobTitle: 'Cloud Architect',
    questions: SAMPLE_AI_QUESTIONS,
    questionSource: 'ai',
    status: 'scheduled',
    integrityLog: [
      { event: 'tab_switch', timestamp: new Date(), confidence: 1 },
    ],
  });

  // Candidate fetches GET /api/interviews/:id
  const candRes = await originalFetch(`${baseUrl}/${iv._id}`, {
    headers: { authorization: `Bearer ${signAccessToken(candidate)}` },
  });
  assert.equal(candRes.status, 200);
  const candBody = await candRes.json();
  assert.equal(candBody.id, String(iv._id));
  assert.equal(candBody.jobTitle, 'Cloud Architect');
  assert.equal(candBody.integrityLog, undefined, 'integrityLog must not be present in candidate view');
  assert.equal(candBody.questions.length, 6);
  for (const q of candBody.questions) {
    assert.ok(q.type);
    assert.ok(q.question);
    assert.equal(q.expectedFocus, undefined, 'expectedFocus must be redacted from candidate view');
  }

  // Recruiter fetches GET /api/interviews/:id
  const recRes = await originalFetch(`${baseUrl}/${iv._id}`, {
    headers: { authorization: `Bearer ${signAccessToken(recruiter)}` },
  });
  assert.equal(recRes.status, 200);
  const recBody = await recRes.json();
  assert.equal(recBody._id, String(iv._id));
  assert.ok(recBody.questions.every((q) => typeof q.expectedFocus === 'string' && q.expectedFocus.length > 0));
});

test('Step 9: fallback generation requires at least one verified skill', () => {
  assert.throws(
    () => interviewRoutes.generateFallbackQuestions('Backend Lead', [], [], []),
    /At least one verified skill is required/
  );
  assert.throws(
    () => interviewRoutes.generateFallbackQuestions('Backend Lead', ['', '   '], [], []),
    /At least one verified skill is required/
  );
});

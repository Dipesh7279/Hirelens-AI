const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Readable } = require('node:stream');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_ACCESS_SECRET = 'resume-route-isolated-test-secret';
process.env.MAX_UPLOAD_MB = '1';

const storage = require('../services/resumeObjectStorage');
let storeCalls = 0;
let removeCalls = [];
let downloadCalls = 0;
let storageFailure = null;
storage.storeResume = async (buffer, originalName, mimeType) => {
  storeCalls += 1;
  if (storageFailure) throw storageFailure;
  return {
    storageKey: '123e4567-e89b-42d3-a456-426614174000.pdf',
    originalName,
    mimeType,
    size: buffer.length,
  };
};
storage.removeResume = async (key) => { removeCalls.push(key); };
storage.downloadResume = async () => {
  downloadCalls += 1;
  return { Body: Readable.from(['synthetic private resume']) };
};

const resumeRouter = require('../routes/resumeRoutes');
const errorHandler = require('../middleware/errorHandler');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');

let mongo;
let server;
let baseUrl;
let aiFetch;
const originalFetch = global.fetch;
const pdfMime = 'application/pdf';
const validAIResponse = {
  parsed: { skills: ['Python'], education: [], experience: [], projects: [] },
  authenticity: { authenticityScore: 100, flags: [] },
  parsingMode: 'heuristic_fallback',
};

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), CandidateProfile.init()]);
  const app = express();
  app.use(express.json());
  app.use('/api/resume', resumeRouter);
  app.use(errorHandler);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/resume`;
  global.fetch = (...args) => aiFetch(...args);
});

test.after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await mongo?.stop();
});

async function makeCandidate(email = 'resume-candidate@example.invalid') {
  return User.create({ name: 'Resume Test Candidate', email, password: 'Disposable-Test-Password-123', role: 'candidate' });
}

function tokenFor(user, role = user.role) {
  return jwt.sign({ sub: String(user._id), role }, process.env.JWT_ACCESS_SECRET);
}

async function upload({ user, name = 'resume.pdf', mime = pdfMime, bytes = Buffer.from('%PDF-1.7 synthetic bytes'), candidateEmail } = {}) {
  const form = new FormData();
  if (candidateEmail) form.append('candidateEmail', candidateEmail);
  form.append('file', new Blob([bytes], { type: mime }), name);
  return originalFetch(`${baseUrl}/parse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenFor(user)}` },
    body: form,
  });
}

test.beforeEach(async () => {
  await Promise.all([User.deleteMany({}), CandidateProfile.deleteMany({})]);
  storeCalls = 0;
  removeCalls = [];
  downloadCalls = 0;
  storageFailure = null;
  aiFetch = async () => ({ ok: true, status: 200, json: async () => validAIResponse });
});

test('rejects unsupported upload MIME with 400 before parsing or storage', async () => {
  const candidate = await makeCandidate();
  const response = await upload({ user: candidate, name: 'resume.txt', mime: 'text/plain', bytes: 'not a resume' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /PDF or DOCX/);
  assert.equal(storeCalls, 0);
});

test('rejects oversized upload with 413 before calling AI or storage', async () => {
  const candidate = await makeCandidate();
  const response = await upload({ user: candidate, bytes: Buffer.alloc(1024 * 1024 + 1) });
  assert.equal(response.status, 413);
  assert.equal(storeCalls, 0);
});

test('preserves the AI service 422 for a file whose bytes do not match its PDF name', async () => {
  const candidate = await makeCandidate();
  aiFetch = async () => ({ ok: false, status: 422, json: async () => ({ detail: 'File content does not match the PDF extension' }) });
  const response = await upload({ user: candidate, bytes: Buffer.from('not actually a PDF') });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error,
    'Could not extract readable text from this resume. Try a text-based PDF or DOCX.');
  assert.equal(storeCalls, 0);
});

test('returns 400 when no resume file is supplied', async () => {
  const candidate = await makeCandidate();
  const response = await originalFetch(`${baseUrl}/parse`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenFor(candidate)}` },
  });
  assert.equal(response.status, 400);
  assert.equal(storeCalls, 0);
});

test('parses first, stores privately, then persists parsed fields and disclosed mode', async () => {
  const candidate = await makeCandidate();
  aiFetch = async (url, options) => {
    assert.match(url, /\/ai\/resume\/parse$/);
    assert.equal(options.method, 'POST');
    assert.equal(storeCalls, 0);
    return { ok: true, status: 200, json: async () => validAIResponse };
  };
  const response = await upload({ user: candidate });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.parsingMode, 'heuristic_fallback');
  assert.deepEqual(body.parsed.skills, ['Python']);
  assert.equal(body.profile.resume.storageKey, '123e4567-e89b-42d3-a456-426614174000.pdf');
  assert.equal((await CandidateProfile.findOne({ candidateId: candidate._id })).resume.skills[0], 'Python');
  assert.equal(storeCalls, 1);
});

test('returns a safe 503 when the AI service connection is refused', async () => {
  const candidate = await makeCandidate();
  aiFetch = async () => {
    const error = new TypeError('fetch failed');
    error.cause = Object.assign(new Error('private network detail'), { code: 'ECONNREFUSED' });
    throw error;
  };
  const response = await upload({ user: candidate });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Resume parsing service could not be reached. Check AI_SERVICE_URL and confirm the AI service is running.',
    code: 'AI_SERVICE_CONNECTION_FAILED',
  });
  assert.equal(storeCalls, 0);
});

test('times out the AI-service request and returns a safe 503', async () => {
  const candidate = await makeCandidate();
  aiFetch = async () => { throw Object.assign(new Error('synthetic timeout'), { name: 'TimeoutError' }); };
  const response = await upload({ user: candidate });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Resume parsing timed out. Check AI_SERVICE_URL and AI service availability.',
    code: 'AI_SERVICE_TIMEOUT',
  });
  assert.equal(storeCalls, 0);
});

test('preserves an upstream 413 and does not expose non-string provider details', async () => {
  const candidate = await makeCandidate();
  aiFetch = async () => ({ ok: false, status: 413, json: async () => ({ detail: ['private', 'diagnostics'] }) });
  const response = await upload({ user: candidate });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Resume file is too large' });
  assert.equal(storeCalls, 0);
});

test('does not expose provider details even when the upstream error is a string', async () => {
  const candidate = await makeCandidate();
  aiFetch = async () => ({ ok: false, status: 503, json: async () => ({ detail: 'secret provider diagnostic' }) });
  const response = await upload({ user: candidate });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Resume parsing service is temporarily unavailable. Please try again.',
  });
  assert.equal(storeCalls, 0);
});

test('maps Gemini auth/model failures to specific safe actionable messages', async (t) => {
  const cases = [
    ['GEMINI_REQUEST_REJECTED', 'Gemini rejected the request. Check the model setting and AI service compatibility.'],
    ['GEMINI_API_KEY_INVALID', 'Gemini API key is missing, invalid, or expired. Check the AI service configuration.'],
    ['GEMINI_ACCESS_DENIED', 'Gemini denied this key or project access to the selected model. Check API permissions.'],
    ['GEMINI_MODEL_NOT_FOUND', 'The configured Gemini model was not found. Set GEMINI_MODEL to gemini-3.8-flash and restart the AI service.'],
  ];
  for (const [code, message] of cases) {
    await t.test(code, async () => {
      const candidate = await makeCandidate(`gemini-${code.toLowerCase()}@example.invalid`);
      aiFetch = async () => ({
        ok: false,
        status: 503,
        headers: new Headers({ 'x-error-code': code }),
        json: async () => ({ detail: 'private provider response' }),
      });
      const response = await upload({ user: candidate });
      const body = await response.json();
      assert.equal(response.status, 503, JSON.stringify(body));
      assert.deepEqual(body, { error: message, code });
      assert.equal(storeCalls, 0);
    });
  }
});

test('replaces a generic AI 502 with a useful safe parse-failure message', async () => {
  const candidate = await makeCandidate();
  aiFetch = async () => ({ ok: false, status: 502, json: async () => ({ detail: 'private parse stack trace' }) });
  const response = await upload({ user: candidate });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'Resume text could not be structured. Please try again with a text-based resume or retry later.',
    code: 'AI_SERVICE_PARSE_FAILED',
  });
  assert.equal(storeCalls, 0);
});

test('returns a safe 503 if GridFS storage is unavailable', async () => {
  const candidate = await makeCandidate();
  storageFailure = new storage.ResumeStorageError('private database diagnostic');
  const response = await upload({ user: candidate });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'Could not store the resume in MongoDB. Check database availability and storage limits.');
  assert.equal(body.code, 'GRIDFS_OPERATION_FAILED');
  assert.doesNotMatch(JSON.stringify(body), /private database diagnostic/);
});

test('returns a safe 503 when MongoDB is disconnected', async () => {
  const candidate = await makeCandidate();
  storageFailure = new storage.ResumeStorageError('private database address', 'GRIDFS_UNAVAILABLE');
  const response = await upload({ user: candidate });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body, {
    error: 'MongoDB resume storage is unavailable. Check the database connection and try again.',
    code: 'GRIDFS_UNAVAILABLE',
  });
  assert.doesNotMatch(JSON.stringify(body), /private database address/);
});

test('only the candidate can download their original resume', async () => {
  const owner = await makeCandidate('owner@example.invalid');
  const other = await makeCandidate('other@example.invalid');
  await CandidateProfile.create({
    candidateId: owner._id,
    uploadedBy: owner._id,
    resume: { fileName: 'resume.pdf', storageKey: '123e4567-e89b-42d3-a456-426614174000.pdf', mimeType: pdfMime },
  });
  const denied = await originalFetch(`${baseUrl}/${owner._id}/file`, { headers: { Authorization: `Bearer ${tokenFor(other)}` } });
  assert.equal(denied.status, 403);
  assert.equal(downloadCalls, 0);
  const allowed = await originalFetch(`${baseUrl}/${owner._id}/file`, { headers: { Authorization: `Bearer ${tokenFor(owner)}` } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.equal(await allowed.text(), 'synthetic private resume');
  assert.equal(downloadCalls, 1);
});

test('recruiter can download only a candidate who applied to that recruiter job', async () => {
  const candidate = await makeCandidate('applied-candidate@example.invalid');
  const recruiter = await User.create({ name: 'Test Recruiter', email: 'allowed-recruiter@example.invalid', password: 'Disposable-Test-Password-123', role: 'recruiter' });
  const unrelated = await User.create({ name: 'Other Recruiter', email: 'other-recruiter@example.invalid', password: 'Disposable-Test-Password-123', role: 'recruiter' });
  const job = await Job.create({ recruiterId: recruiter._id, title: 'Test role' });
  await JobApplication.create({ candidateId: candidate._id, jobId: job._id });
  await CandidateProfile.create({
    candidateId: candidate._id, uploadedBy: candidate._id,
    resume: { fileName: 'resume.pdf', storageKey: '123e4567-e89b-42d3-a456-426614174000.pdf', mimeType: pdfMime },
  });
  const denied = await originalFetch(`${baseUrl}/${candidate._id}/file`, {
    headers: { Authorization: `Bearer ${tokenFor(unrelated)}` },
  });
  assert.equal(denied.status, 403);
  const allowed = await originalFetch(`${baseUrl}/${candidate._id}/file`, {
    headers: { Authorization: `Bearer ${tokenFor(recruiter)}` },
  });
  assert.equal(allowed.status, 200);
});

test('candidate can edit parsed fields but cannot change authenticity metadata', async () => {
  const owner = await makeCandidate('editor@example.invalid');
  const other = await makeCandidate('other-editor@example.invalid');
  await CandidateProfile.create({
    candidateId: owner._id,
    uploadedBy: owner._id,
    resume: { skills: ['Python'], authenticityScore: 72, flags: ['duplicate_content'] },
  });
  const edits = {
    skills: ['React'], education: [], experience: [], projects: [], authenticityScore: 100,
  };
  const denied = await originalFetch(`${baseUrl}/${owner._id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokenFor(other)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...edits, authenticityScore: undefined }),
  });
  assert.equal(denied.status, 403);
  const forbiddenEdit = await originalFetch(`${baseUrl}/${owner._id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokenFor(owner)}`, 'content-type': 'application/json' },
    body: JSON.stringify(edits),
  });
  assert.equal(forbiddenEdit.status, 400);
  const allowed = await originalFetch(`${baseUrl}/${owner._id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokenFor(owner)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ skills: ['React'], education: [], experience: [], projects: [], githubUsername: '@octo-dev' }),
  });
  assert.equal(allowed.status, 200);
  const saved = await CandidateProfile.findOne({ candidateId: owner._id });
  assert.deepEqual(saved.resume.skills, ['React']);
  assert.equal(saved.resume.githubUsername, 'octo-dev');
  assert.ok(saved.resume.confirmedAt instanceof Date, 'PATCH must persist resume.confirmedAt');
  assert.ok(saved.resume.githubConfirmedAt instanceof Date, 'PATCH with githubUsername must persist resume.githubConfirmedAt');
  assert.equal(saved.resume.authenticityScore, 72);
  assert.deepEqual(saved.resume.flags, ['duplicate_content']);
});

test('removes a newly stored GridFS file if profile persistence fails', async () => {
  const candidate = await makeCandidate('cleanup@example.invalid');
  const originalUpdate = CandidateProfile.findOneAndUpdate;
  CandidateProfile.findOneAndUpdate = async () => { throw new Error('synthetic database failure'); };
  try {
    const response = await upload({ user: candidate });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
    assert.deepEqual(removeCalls, ['123e4567-e89b-42d3-a456-426614174000.pdf']);
  } finally {
    CandidateProfile.findOneAndUpdate = originalUpdate;
  }
});

test('removes the replaced GridFS file only after the new profile is saved', async () => {
  const candidate = await makeCandidate('replace@example.invalid');
  const previousKey = '223e4567-e89b-42d3-a456-426614174000.pdf';
  await CandidateProfile.create({
    candidateId: candidate._id, uploadedBy: candidate._id,
    resume: { fileName: 'old.pdf', storageKey: previousKey, mimeType: pdfMime },
  });
  const response = await upload({ user: candidate });
  assert.equal(response.status, 200);
  assert.deepEqual(removeCalls, [previousKey]);
  assert.equal((await CandidateProfile.findOne({ candidateId: candidate._id })).resume.storageKey,
    '123e4567-e89b-42d3-a456-426614174000.pdf');
});

test('successful first parse followed by a second parse succeeds without timing out', async () => {
  const candidate = await makeCandidate('sequential-parse@example.invalid');

  // Attempt 1: First parse succeeds with Gemini
  aiFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      parsed: { skills: ['Python', 'Docker'], education: [], experience: [], projects: [] },
      authenticity: { authenticityScore: 100, flags: [] },
      parsingMode: 'gemini',
    }),
  });

  const res1 = await upload({ user: candidate, name: 'first_resume.pdf' });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.parsingMode, 'gemini');
  assert.deepEqual(data1.parsed.skills, ['Python', 'Docker']);

  // Verify profile updated after first parse and starts unconfirmed
  let profile = await CandidateProfile.findOne({ candidateId: candidate._id });
  assert.deepEqual(profile.resume.skills, ['Python', 'Docker']);
  assert.equal(profile.resume.confirmedAt, null);

  // Candidate confirms first resume
  await originalFetch(`${baseUrl}/${candidate._id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenFor(candidate)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ skills: ['Python', 'Docker'], education: [], experience: [], projects: [] }),
  });
  profile = await CandidateProfile.findOne({ candidateId: candidate._id });
  assert.ok(profile.resume.confirmedAt instanceof Date);

  // Attempt 2: Second parse returns immediately with heuristic fallback (e.g. Gemini 429 quota reached)
  aiFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      parsed: { skills: ['Node.js', 'PostgreSQL'], education: [], experience: [], projects: [] },
      authenticity: { authenticityScore: 90, flags: [] },
      parsingMode: 'heuristic_fallback',
    }),
  });

  const res2 = await upload({ user: candidate, name: 'second_resume.pdf' });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.parsingMode, 'heuristic_fallback');
  assert.deepEqual(data2.parsed.skills, ['Node.js', 'PostgreSQL']);

  // Profile now reflects the second resume and resets confirmedAt to null until re-confirmed
  profile = await CandidateProfile.findOne({ candidateId: candidate._id });
  assert.deepEqual(profile.resume.skills, ['Node.js', 'PostgreSQL']);
  assert.equal(profile.resume.fileName, 'second_resume.pdf');
  assert.equal(profile.resume.confirmedAt, null);
});

test('frontend recruiter resume contract discloses heuristic fallback mode and handles error alert', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const frontendSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Recruiterresume.jsx'), 'utf8');

  // Verify frontend handles heuristic_fallback mode with dedicated advisory notice
  assert.match(frontendSource, /result\.parsingMode === 'heuristic_fallback'/);
  assert.match(frontendSource, /AI structuring is temporarily unavailable/);

  // Verify frontend handles safe server error feedback
  assert.match(frontendSource, /role="alert"/);
  assert.match(frontendSource, /err\.response\?\.data\?\.error/);
});


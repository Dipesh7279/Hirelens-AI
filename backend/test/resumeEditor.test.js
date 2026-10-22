const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeResumeEdits, ResumeEditValidationError } = require('../utils/resumeEditor');

const validEdits = () => ({
  skills: [' Python ', 'React'],
  education: [{ degree: ' BSc ', institute: 'Example University', year: '2024' }],
  experience: [{ role: 'Engineer', company: 'Example Co', duration: '2022-2024' }],
  projects: [{ title: 'Portfolio', description: 'Personal site', techStack: ['React', 'Node'] }],
});

test('normalizes the allowed parsed resume fields and trims strings', () => {
  const result = normalizeResumeEdits(validEdits());

  assert.deepEqual(result.skills, ['Python', 'React']);
  assert.equal(result.education[0].degree, 'BSc');
  assert.deepEqual(result.projects[0].techStack, ['React', 'Node']);
});

test('allows partial updates and omits missing fields', () => {
  const result = normalizeResumeEdits({ skills: ['GraphQL', 'TypeScript'] });
  assert.deepEqual(result, { skills: ['GraphQL', 'TypeScript'] });
});

test('rejects non-list fields and excessive item counts', () => {
  assert.throws(() => normalizeResumeEdits({ ...validEdits(), skills: 'Python' }), ResumeEditValidationError);
  assert.throws(() => normalizeResumeEdits({ ...validEdits(), skills: Array(101).fill('skill') }), ResumeEditValidationError);
});

test('rejects attempts to change server-owned resume metadata', () => {
  assert.throws(() => normalizeResumeEdits({ ...validEdits(), authenticityScore: 100 }), /Only parsed resume fields/);
});

test('rejects malformed nested values and oversized text', () => {
  assert.throws(() => normalizeResumeEdits({ ...validEdits(), projects: [null] }), ResumeEditValidationError);
  assert.throws(() => normalizeResumeEdits({ ...validEdits(), skills: ['x'.repeat(121)] }), ResumeEditValidationError);
});

test('normalizes optional githubUsername and confirmGithub while rejecting invalid handles or confirmedAt overrides', () => {
  const withHandle = normalizeResumeEdits({ ...validEdits(), githubUsername: ' @octo-cat ', confirmGithub: true });
  assert.equal(withHandle.githubUsername, 'octo-cat');
  assert.equal(withHandle.confirmGithub, true);

  const cleared = normalizeResumeEdits({ ...validEdits(), githubUsername: '   ' });
  assert.equal(cleared.githubUsername, null);

  assert.throws(
    () => normalizeResumeEdits({ ...validEdits(), githubUsername: 'invalid handle with spaces' }),
    ResumeEditValidationError
  );
  assert.throws(
    () => normalizeResumeEdits({ ...validEdits(), confirmedAt: new Date().toISOString() }),
    /Only parsed resume fields/
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { canDownloadResume } = require('../utils/resumeAccess');

const candidateId = 'candidate-123';
const recruiterId = 'recruiter-456';
const profile = { uploadedBy: recruiterId };

test('resume download is limited to its candidate, uploading recruiter, or admin', () => {
  assert.equal(canDownloadResume({ sub: candidateId, role: 'candidate' }, candidateId, profile), true);
  assert.equal(canDownloadResume({ sub: 'other-candidate', role: 'candidate' }, candidateId, profile), false);
  assert.equal(canDownloadResume({ sub: recruiterId, role: 'recruiter' }, candidateId, profile), true);
  assert.equal(canDownloadResume({ sub: 'other-recruiter', role: 'recruiter' }, candidateId, profile), false);
  assert.equal(canDownloadResume({ sub: 'job-owner', role: 'recruiter' }, candidateId, profile, true), true);
  assert.equal(canDownloadResume({ sub: 'unrelated-recruiter', role: 'recruiter' }, candidateId, profile, false), false);
  assert.equal(canDownloadResume({ sub: 'admin-1', role: 'admin' }, candidateId, profile), true);
  assert.equal(canDownloadResume(null, candidateId, profile), false);
});

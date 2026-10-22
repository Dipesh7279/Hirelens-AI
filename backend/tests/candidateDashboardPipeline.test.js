const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let deriveCandidatePipelineState;

test.before(async () => {
  const mod = await import('../../frontend/src/utils/candidatePipeline.js');
  deriveCandidatePipelineState = mod.deriveCandidatePipelineState;
});

test('Case 1: no resume -> step 1 action_required, step 2 pending, step 3 pending, 0 of 3 complete', () => {
  const state = deriveCandidatePipelineState(null, []);

  assert.equal(state.hasResume, false);
  assert.equal(state.step1.status, 'action_required');
  assert.equal(state.step1.badge, 'Action Required');
  assert.equal(state.step2.status, 'pending');
  assert.equal(state.step2.badge, 'Pending Resume');
  assert.equal(state.step3.status, 'pending');
  assert.equal(state.step3.badge, 'Pending Schedule');
  assert.equal(state.completedCount, 0);
  assert.equal(state.overallBadge, '0 of 3 complete · Upload resume to begin');
  assert.equal(state.heuristicMetric.displayValue, 'Not parsed');
});

test('Case 2: parsed resume not yet reviewed -> step 1 complete, step 2 action_required (skills not marked confirmed just because resume has skills)', () => {
  const unconfirmedProfile = {
    resume: {
      fileName: 'candidate_cv.pdf',
      skills: ['Python', 'FastAPI', 'PostgreSQL'],
      education: [{ degree: 'B.Tech', institute: 'Test Institute', year: '2025' }],
      projects: [{ title: 'HireLens Demo' }],
      authenticityScore: 100,
      parsedAt: '2026-10-22T10:00:00.000Z',
      confirmedAt: null,
      githubConfirmedAt: null,
    },
  };

  const state = deriveCandidatePipelineState(unconfirmedProfile, []);

  assert.equal(state.hasResume, true);
  assert.equal(state.skillsConfirmed, false, 'Skills must not be marked confirmed before candidate confirmation');
  assert.equal(state.step1.status, 'complete');
  assert.equal(state.step2.status, 'action_required');
  assert.equal(state.step2.badge, 'Action Required');
  assert.equal(state.completedCount, 1);
  assert.equal(state.overallBadge, '1 of 3 complete · Confirmation required');
  assert.equal(state.heuristicMetric.displayValue, '100/100');
  assert.equal(state.heuristicMetric.badge, 'Heuristic only');
});

test('Case 3: reviewed/confirmed skills (no GitHub handle) -> step 1 complete, step 2 complete, 2 of 3 complete', () => {
  const confirmedSkillsProfile = {
    resume: {
      fileName: 'candidate_cv.pdf',
      skills: ['Python', 'FastAPI'],
      confirmedAt: '2026-10-22T11:00:00.000Z',
      githubUsername: null,
      githubConfirmedAt: null,
      authenticityScore: 92,
    },
  };

  const state = deriveCandidatePipelineState(confirmedSkillsProfile, []);

  assert.equal(state.skillsConfirmed, true);
  assert.equal(state.isStep2Confirmed, true);
  assert.equal(state.step1.status, 'complete');
  assert.equal(state.step2.status, 'complete');
  assert.equal(state.step2.badge, 'Skills Confirmed');
  assert.equal(state.step3.status, 'pending');
  assert.equal(state.completedCount, 2);
  assert.equal(state.overallBadge, '2 of 3 complete · Awaiting interview schedule');
});

test('Case 4: GitHub detected on resume but not confirmed -> step 2 remains action_required until GitHub handle is confirmed', () => {
  // 4a: Neither skills nor GitHub confirmed yet
  const unconfirmedBoth = {
    resume: {
      fileName: 'candidate_cv.pdf',
      skills: ['TypeScript', 'Node.js'],
      githubUsername: 'detected-handle',
      confirmedAt: null,
      githubConfirmedAt: null,
    },
  };
  const stateA = deriveCandidatePipelineState(unconfirmedBoth, []);
  assert.equal(stateA.detectedGithub, 'detected-handle');
  assert.equal(stateA.githubConfirmed, false);
  assert.equal(stateA.step2.status, 'action_required');

  // 4b: Skills confirmed, but detected GitHub still unconfirmed
  const skillsOnlyConfirmed = {
    resume: {
      fileName: 'candidate_cv.pdf',
      skills: ['TypeScript', 'Node.js'],
      githubUsername: 'detected-handle',
      confirmedAt: '2026-10-22T11:00:00.000Z',
      githubConfirmedAt: null,
    },
  };
  const stateB = deriveCandidatePipelineState(skillsOnlyConfirmed, []);
  assert.equal(stateB.skillsConfirmed, true);
  assert.equal(stateB.githubConfirmed, false, 'Detected GitHub is not proof of confirmation');
  assert.equal(stateB.isStep2Confirmed, false);
  assert.equal(stateB.step2.status, 'action_required');
  assert.equal(stateB.step2.badge, 'Confirm GitHub');

  // 4c: Both skills and GitHub confirmed
  const bothConfirmed = {
    resume: {
      fileName: 'candidate_cv.pdf',
      skills: ['TypeScript', 'Node.js'],
      githubUsername: 'detected-handle',
      confirmedAt: '2026-10-22T11:00:00.000Z',
      githubConfirmedAt: '2026-10-22T11:00:00.000Z',
    },
  };
  const stateC = deriveCandidatePipelineState(bothConfirmed, []);
  assert.equal(stateC.githubConfirmed, true);
  assert.equal(stateC.isStep2Confirmed, true);
  assert.equal(stateC.step2.status, 'complete');
  assert.equal(stateC.step2.badge, 'Confirmed · @detected-handle');
});

test('Case 5, 6, 7: interview states (no interview vs scheduled/ready vs completed) never mislabel scheduled as 3/3 complete', () => {
  const confirmedProfile = {
    resume: {
      fileName: 'candidate_cv.pdf',
      skills: ['Python', 'React'],
      githubUsername: 'candidate-gh',
      confirmedAt: '2026-10-22T11:00:00.000Z',
      githubConfirmedAt: '2026-10-22T11:00:00.000Z',
    },
  };

  // Case 5: No interview
  const noInterviewState = deriveCandidatePipelineState(confirmedProfile, []);
  assert.equal(noInterviewState.step3.status, 'pending');
  assert.equal(noInterviewState.step3.badge, 'Pending Schedule');
  assert.equal(noInterviewState.completedCount, 2);

  // Case 6: Scheduled interview -> step 3 is "ready", NOT "complete", and overallBadge is "2 of 3 complete · Interview scheduled"
  const scheduledState = deriveCandidatePipelineState(confirmedProfile, [
    { _id: 'iv-1', jobTitle: 'Backend Engineer', status: 'scheduled', scheduledAt: '2026-11-01T10:00:00.000Z' },
  ]);
  assert.equal(scheduledState.step3.status, 'ready');
  assert.equal(scheduledState.step3.badge, 'Ready (Scheduled)');
  assert.equal(scheduledState.completedCount, 2);
  assert.equal(scheduledState.overallBadge, '2 of 3 complete · Interview scheduled');
  assert.doesNotMatch(scheduledState.overallBadge, /3\/3/);

  // Case 7: Completed interview -> step 3 is "complete" and overallBadge is "3 of 3 steps complete"
  const completedState = deriveCandidatePipelineState(confirmedProfile, [
    { _id: 'iv-1', jobTitle: 'Backend Engineer', status: 'completed' },
  ]);
  assert.equal(completedState.step3.status, 'complete');
  assert.equal(completedState.step3.badge, 'Complete');
  assert.equal(completedState.completedCount, 3);
  assert.equal(completedState.overallBadge, '3 of 3 steps complete');
});

test('Candidate dashboard UI contract: HireLens branding, no fake +24% velocity or fake Search control, and clear heuristic explanation', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');

  assert.match(appSource, /HireLens/);
  assert.doesNotMatch(appSource, /AI Recruit/);
  assert.doesNotMatch(appSource, /\+24%/);
  assert.doesNotMatch(appSource, /Hiring velocity this month/);
  assert.doesNotMatch(appSource, />\s*Search\.\.\.\s*</);
  assert.match(appSource, /Resume Text-Pattern Check/);
});


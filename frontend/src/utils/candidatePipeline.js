export function deriveCandidatePipelineState(profile, interviews = []) {
  const safeInterviews = Array.isArray(interviews) ? interviews : [];
  const resume = profile?.resume || null;

  const hasResume = Boolean(
    resume?.fileName ||
      resume?.storageKey ||
      resume?.parsedAt ||
      (Array.isArray(resume?.skills) && resume.skills.length > 0)
  );

  const skills = Array.isArray(resume?.skills)
    ? resume.skills.filter((s) => typeof s === 'string' && s.trim().length > 0)
    : [];
  const hasSkills = skills.length > 0;
  const skillsConfirmed = Boolean(hasResume && hasSkills && resume?.confirmedAt);

  const rawResumeGithub = typeof resume?.githubUsername === 'string' ? resume.githubUsername.trim() : '';
  const rawProfileGithub = typeof profile?.github?.username === 'string' ? profile.github.username.trim() : '';
  const detectedGithub = rawResumeGithub || rawProfileGithub || null;
  const githubConfirmed = Boolean(detectedGithub && resume?.githubConfirmedAt);

  const isStep2Confirmed = Boolean(skillsConfirmed && (!detectedGithub || githubConfirmed));

  const completedInterviews = safeInterviews.filter((item) => item?.status === 'completed');
  const inProgressInterview = safeInterviews.find((item) => item?.status === 'in_progress') || null;
  const scheduledInterview = safeInterviews.find((item) => item?.status === 'scheduled') || null;
  const nextInterview = inProgressInterview || scheduledInterview || null;

  const step1 = hasResume
    ? {
        status: 'complete',
        badge: 'Complete',
        title: '1. Upload Resume',
        description: resume?.fileName
          ? `Uploaded ${resume.fileName}. You can review or replace your resume at any time.`
          : 'Resume parsed and stored in your profile.',
        ctaLabel: 'Review / Replace Resume →',
        ctaTo: '/dashboard/resume',
      }
    : {
        status: 'action_required',
        badge: 'Action Required',
        title: '1. Upload Resume',
        description: 'Submit your PDF or DOCX resume to extract skills, credentials, and projects.',
        ctaLabel: 'Upload Resume Now →',
        ctaTo: '/dashboard/resume',
      };

  let step2;
  if (!hasResume) {
    step2 = {
      status: 'pending',
      badge: 'Pending Resume',
      title: '2. Confirm Skills & GitHub',
      description: 'Upload and parse your resume first to review extracted skills and GitHub details.',
      ctaLabel: 'Review Credentials →',
      ctaTo: '/dashboard/resume',
    };
  } else if (isStep2Confirmed) {
    step2 = {
      status: 'complete',
      badge: detectedGithub ? `Confirmed · @${detectedGithub}` : 'Skills Confirmed',
      title: '2. Confirm Skills & GitHub',
      description: detectedGithub
        ? `Reviewed ${skills.length} skill${skills.length === 1 ? '' : 's'} and confirmed @${detectedGithub} for public repository review.`
        : `Reviewed and confirmed ${skills.length} extracted skill${skills.length === 1 ? '' : 's'} and project entries.`,
      ctaLabel: 'Update Confirmed Credentials →',
      ctaTo: '/dashboard/resume',
    };
  } else if (skillsConfirmed && detectedGithub && !githubConfirmed) {
    step2 = {
      status: 'action_required',
      badge: 'Confirm GitHub',
      title: '2. Confirm Skills & GitHub',
      description: `GitHub handle @${detectedGithub} was detected on your resume but has not been confirmed yet. Review and confirm it on the Resume Parser page.`,
      ctaLabel: 'Confirm GitHub Handle →',
      ctaTo: '/dashboard/resume',
    };
  } else {
    step2 = {
      status: 'action_required',
      badge: 'Action Required',
      title: '2. Confirm Skills & GitHub',
      description: detectedGithub
        ? `Resume parsed (${skills.length} skill${skills.length === 1 ? '' : 's'} and @${detectedGithub} detected). Review and confirm your extracted fields before relying on them.`
        : hasSkills
          ? `Resume parsed (${skills.length} skill${skills.length === 1 ? '' : 's'} extracted). Review and confirm your skills and projects to complete this step.`
          : 'No skills have been confirmed yet. Add and save your skills on the Resume Parser page.',
      ctaLabel: 'Review & Confirm Credentials →',
      ctaTo: '/dashboard/resume',
    };
  }

  let step3;
  if (nextInterview) {
    step3 = {
      status: 'ready',
      badge: inProgressInterview ? 'In Progress' : 'Ready (Scheduled)',
      title: '3. Adaptive Interview',
      description: inProgressInterview
        ? `Your interview for ${nextInterview.jobTitle || 'this role'} is currently in progress.`
        : `Scheduled for ${nextInterview.jobTitle || 'your application'}. Enter the interview room when ready.`,
      ctaLabel: inProgressInterview ? 'Resume Interview Room →' : 'Launch Interview Room →',
      ctaTo: `/interviews/${nextInterview._id}`,
    };
  } else if (completedInterviews.length > 0) {
    step3 = {
      status: 'complete',
      badge: 'Complete',
      title: '3. Adaptive Interview',
      description: `Completed ${completedInterviews.length} adaptive interview${completedInterviews.length === 1 ? '' : 's'}.`,
      ctaLabel: 'View Interview History →',
      ctaTo: '/interviews',
    };
  } else {
    step3 = {
      status: 'pending',
      badge: 'Pending Schedule',
      title: '3. Adaptive Interview',
      description: 'Role-grounded technical, project, and behavioral questions unlock once a recruiter schedules your interview.',
      ctaLabel: 'View Interview Status →',
      ctaTo: '/interviews',
    };
  }

  const completedCount = [step1.status, step2.status, step3.status].filter((s) => s === 'complete').length;

  let overallBadge;
  if (completedCount === 3) {
    overallBadge = '3 of 3 steps complete';
  } else if (step3.status === 'ready') {
    overallBadge = inProgressInterview
      ? `${completedCount} of 3 complete · Interview in progress`
      : `${completedCount} of 3 complete · Interview scheduled`;
  } else if (step1.status === 'action_required') {
    overallBadge = '0 of 3 complete · Upload resume to begin';
  } else if (step2.status === 'action_required') {
    overallBadge = `${completedCount} of 3 complete · Confirmation required`;
  } else {
    overallBadge = `${completedCount} of 3 complete · Awaiting interview schedule`;
  }

  let upcomingStatusBadge;
  if (nextInterview) {
    upcomingStatusBadge = {
      label: inProgressInterview ? 'In progress' : 'Interview scheduled',
      tone: 'amber',
    };
  } else if (completedInterviews.length > 0) {
    upcomingStatusBadge = {
      label: 'Interview completed',
      tone: 'emerald',
    };
  } else if (step1.status === 'action_required' || step2.status === 'action_required') {
    upcomingStatusBadge = {
      label: 'Action required',
      tone: 'indigo',
    };
  } else {
    upcomingStatusBadge = {
      label: 'Awaiting schedule',
      tone: 'slate',
    };
  }

  const rawScore = resume?.authenticityScore;
  const hasScore = Number.isFinite(rawScore);
  const heuristicMetric = {
    score: hasScore ? rawScore : null,
    displayValue: hasScore ? `${rawScore}/100` : 'Not parsed',
    badge: hasScore ? 'Heuristic only' : 'Pending resume',
    flags: Array.isArray(resume?.flags) ? resume.flags : [],
    explanation:
      'Checks only for repeated phrases, template boilerplate, or hidden characters. Not a resume-quality, plagiarism, or hiring score, and never used in candidate ranking.',
  };

  return {
    hasResume,
    hasSkills,
    skills,
    skillsConfirmed,
    detectedGithub,
    githubConfirmed,
    isStep2Confirmed,
    nextInterview,
    completedInterviewsCount: completedInterviews.length,
    totalInterviewsCount: safeInterviews.length,
    completedCount,
    overallBadge,
    upcomingStatusBadge,
    heuristicMetric,
    steps: [step1, step2, step3],
    step1,
    step2,
    step3,
  };
}


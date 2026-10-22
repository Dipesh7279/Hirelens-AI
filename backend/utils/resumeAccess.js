function canDownloadResume(user, candidateId, profile, hasAppliedToRecruiterJob = false) {
  if (!user || !profile) return false;
  const uid = String(user.sub);
  if (user.role === 'admin') return true;
  if (user.role === 'candidate') return uid === String(candidateId);
  return user.role === 'recruiter' && (uid === String(profile.uploadedBy) || hasAppliedToRecruiterJob);
}

module.exports = { canDownloadResume };

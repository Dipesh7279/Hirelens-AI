const LIMITS = {
  skills: 100,
  education: 30,
  experience: 30,
  projects: 30,
};

class ResumeEditValidationError extends Error {}

function cleanText(value, field, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ResumeEditValidationError(`${field} must be text`);
  const text = value.trim();
  if (text.length > maxLength) {
    throw new ResumeEditValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return text;
}

function cleanList(value, field, maxItems, cleanItem) {
  if (!Array.isArray(value)) throw new ResumeEditValidationError(`${field} must be a list`);
  if (value.length > maxItems) throw new ResumeEditValidationError(`${field} can contain at most ${maxItems} items`);
  return value.map(cleanItem);
}

function cleanRecord(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResumeEditValidationError(`${field} entries must be objects`);
  }
  return value;
}

function cleanGithubUsername(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new ResumeEditValidationError('GitHub username must be text');
  const trimmed = value.trim().replace(/^@+/, '');
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(trimmed)) {
    throw new ResumeEditValidationError('GitHub username must be a valid GitHub handle (1-39 alphanumeric characters or hyphens)');
  }
  return trimmed;
}

function normalizeResumeEdits(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ResumeEditValidationError('Resume edits must be an object');
  }
  const allowed = new Set(['skills', 'education', 'experience', 'projects', 'githubUsername', 'confirmGithub']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new ResumeEditValidationError('Only parsed resume fields can be edited');
  }

  const result = {};
  if (body.skills !== undefined) {
    result.skills = cleanList(body.skills, 'skills', LIMITS.skills, (item) => cleanText(item, 'Skill', 120));
  }
  if (body.education !== undefined) {
    result.education = cleanList(body.education, 'education', LIMITS.education, (value) => {
      const item = cleanRecord(value, 'Education');
      return {
        degree: cleanText(item?.degree, 'Degree', 160),
        institute: cleanText(item?.institute, 'Institute', 200),
        year: cleanText(item?.year, 'Education year', 40),
      };
    });
  }
  if (body.experience !== undefined) {
    result.experience = cleanList(body.experience, 'experience', LIMITS.experience, (value) => {
      const item = cleanRecord(value, 'Experience');
      return {
        role: cleanText(item?.role, 'Role', 160),
        company: cleanText(item?.company, 'Company', 200),
        duration: cleanText(item?.duration, 'Duration', 80),
      };
    });
  }
  if (body.projects !== undefined) {
    result.projects = cleanList(body.projects, 'projects', LIMITS.projects, (value) => {
      const item = cleanRecord(value, 'Project');
      return {
        title: cleanText(item?.title, 'Project title', 160),
        description: cleanText(item?.description, 'Project description', 2000),
        techStack: cleanList(item?.techStack ?? [], 'Project tech stack', 50,
          (technology) => cleanText(technology, 'Technology', 120)),
      };
    });
  }
  if (body.githubUsername !== undefined) {
    result.githubUsername = cleanGithubUsername(body.githubUsername);
  }
  if (body.confirmGithub !== undefined) {
    if (typeof body.confirmGithub !== 'boolean') {
      throw new ResumeEditValidationError('confirmGithub must be a boolean');
    }
    result.confirmGithub = body.confirmGithub;
  }

  return result;
}

module.exports = { normalizeResumeEdits, ResumeEditValidationError };

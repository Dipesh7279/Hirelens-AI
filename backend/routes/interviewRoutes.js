const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const Interview = require('../models/Interview');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const { discloseIntegrityAfterCompletion } = require('../utils/interviewDisclosure');
const {
  MAX_LOG_ENTRIES,
  recordFrameAnalysis,
  clearInterviewState,
  clampTimestamp,
} = require('../utils/integrityEvents');

const router = express.Router();
router.use(requireAuth);

const base = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const AI_SERVICE_URL = base.endsWith('/ai') ? base : `${base}/ai`;
const EVENT_TYPES = Interview.EVENT_TYPES;

// A frame every ~3s is ~20 req/min; allow headroom but cap abuse
const frameLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
const integrityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 500 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many integrity log requests' },
});
const answersLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 500 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many answer submissions' },
});
const frameUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Invalid interview id' });

function parseFutureSchedule(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now() ? date : null;
}

// Product safety safeguard: anti-bias pattern checking against inquiries into protected characteristics or non-job personal background
const PROHIBITED_INQUIRY_PATTERNS = [
  /\b(?:graduat(?:ed|ion)\s+year|high\s+school\s+year|date\s+of\s+birth|when\s+were\s+you\s+born|retirement\s+plans?|how\s+old\s+are\s+you)\b/i,
  /\b(?:children|kids|childcare|pregnancy|pregnant|spouse|husband|wife|marital\s+status|maiden\s+name|family\s+plans?|plan(?:ning)?\s+to\s+have\s+(?:a\s+)?family)\b/i,
  /\b(?:disabilit(?:y|ies)|physical\s+impairments?|medical\s+history|sick\s+leave|psychiatric|mental\s+health|workers['’]?\s*compensation|health\s+conditions?|chronic\s+illness(?:es)?)\b/i,
  /\b(?:religious\s+holidays?|sabbath|church|mosque|synagogue|place\s+of\s+worship|creed|religious\s+beliefs?)\b/i,
  /\b(?:native\s+language|mother\s+tongue|citizenship\s+history|ancestral\s+origin|country\s+of\s+birth|where\s+are\s+you\s+originally\s+from|what\s+is\s+your\s+nationality|gender\s+identity|sexual\s+orientation|racial\s+background|ethnic\s+background)\b/i,
];

function containsProhibitedInquiry(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return PROHIBITED_INQUIRY_PATTERNS.some((pattern) => pattern.test(text));
}

async function ai(path, options = {}) {
  const headers = {
    'X-Internal-Secret': process.env.INTERNAL_SERVICE_KEY || 'hirelens-internal-shared-secret-dev',
    ...(options.headers || {}),
  };
  const r = await fetch(`${AI_SERVICE_URL}${path}`, { ...options, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body.detail || `AI service returned ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

/** Load interview and enforce that the caller is its candidate or recruiter. */
async function loadOwned(req, res, who) {
  const iv = await Interview.findById(req.params.id);
  if (!iv) { res.status(404).json({ error: 'Interview not found' }); return null; }
  const uid = String(req.user.sub);
  const ok =
    req.user.role === 'admin' ||
    (who === 'candidate' && String(iv.candidateId) === uid) ||
    (who === 'recruiter' && String(iv.recruiterId) === uid);
  if (!ok) { res.status(403).json({ error: 'Not your interview' }); return null; }
  return iv;
}

// Limits mirror ai-service/app/models/interview_schema.py (QuestionRequest). Exceeding
// them makes FastAPI return 422, which previously triggered a silent template fallback.
const AI_LIMITS = { skills: 30, projects: 10, repos: 15, itemLength: 60, jobDescription: 4000 };

/** Trim, drop non-strings/empties, enforce max item length, dedupe (case-insensitive), cap count. */
function cleanList(values, max, maxLength = AI_LIMITS.itemLength) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const item = value.trim();
    if (!item || item.length > maxLength) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function generateFallbackQuestions(jobTitle, verifiedSkills = [], projectTitles = [], githubRepositories = []) {
  const skills = cleanList(verifiedSkills, AI_LIMITS.skills);
  if (skills.length === 0) {
    throw new Error('At least one verified skill is required to generate grounded interview questions');
  }
  const projects = cleanList([...projectTitles, ...githubRepositories], AI_LIMITS.projects + AI_LIMITS.repos);
  const questions = [];

  const technicalTemplates = [
    (skill) => ({
      type: 'technical',
      question: `In your experience with ${skill}, how have you approached scalability, production debugging, and maintainability?`,
      expectedFocus: `In-depth hands-on knowledge of ${skill}, production edge cases, and design trade-offs.`,
    }),
    (skill) => ({
      type: 'technical',
      question: `What architectural patterns and failure-handling strategies do you rely on when building services with ${skill}?`,
      expectedFocus: `Resilience, interface boundaries, error handling, and operational reliability in ${skill}.`,
    }),
    (skill) => ({
      type: 'technical',
      question: `How do you structure automated testing, performance profiling, and code reviews for ${skill} codebases?`,
      expectedFocus: `Testing discipline, observability, and long-term maintainability in ${skill}.`,
    }),
  ];

  for (let i = 0; i < 3; i++) {
    const skill = skills[i % skills.length];
    questions.push(technicalTemplates[i](skill));
  }

  const projectTemplatesWithProject = [
    (proj) => ({
      type: 'project',
      question: `Can you detail the architecture of ${proj}, the toughest technical hurdle you solved, and what you would redesign today?`,
      expectedFocus: `System design choices, code ownership, technical complexity, and problem resolution in ${proj}.`,
    }),
    (proj) => ({
      type: 'project',
      question: `How did you validate reliability, edge cases, and deployment readiness while building ${proj}?`,
      expectedFocus: `Testing strategy, trade-off analysis, and iterative engineering improvements in ${proj}.`,
    }),
  ];

  const projectTemplatesWithSkill = [
    (skill) => ({
      type: 'project',
      question: `Describe a complex software component you delivered using ${skill} and how you resolved its primary architectural bottlenecks.`,
      expectedFocus: `Hands-on system design, technical trade-offs, and problem resolution with ${skill}.`,
    }),
    (skill) => ({
      type: 'project',
      question: `Walk through how you took a feature built with ${skill} from initial design to production validation and monitoring.`,
      expectedFocus: `End-to-end execution, testing strategy, and production readiness using ${skill}.`,
    }),
  ];

  for (let i = 0; i < 2; i++) {
    if (projects.length > 0) {
      const proj = projects[i % projects.length];
      questions.push(projectTemplatesWithProject[i](proj));
    } else {
      const skill = skills[i % skills.length];
      questions.push(projectTemplatesWithSkill[i](skill));
    }
  }

  const role = typeof jobTitle === 'string' && jobTitle.trim() ? jobTitle.trim() : 'software engineering';
  questions.push({
    type: 'behavioral',
    question: `When building software for a role like ${role}, how do you handle tight deadlines while ensuring code quality and cross-team collaboration?`,
    expectedFocus: 'Prioritization, cross-functional collaboration, transparency, and engineering integrity.',
  });

  // Verify all fallback questions pass product safety anti-bias screening
  for (const q of questions) {
    if (containsProhibitedInquiry(q.question) || containsProhibitedInquiry(q.expectedFocus)) {
      throw new Error('Fallback question failed anti-bias safety screening');
    }
  }

  return questions;
}

function validateAndNormalizeAiQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions) || rawQuestions.length !== 6) return null;
  const counts = { technical: 0, project: 0, behavioral: 0 };
  const seenQuestions = new Set();
  const normalized = [];

  for (const item of rawQuestions) {
    if (!item || typeof item !== 'object') return null;
    const { type } = item;
    if (!Object.prototype.hasOwnProperty.call(counts, type)) return null;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const expectedFocus = typeof item.expectedFocus === 'string' ? item.expectedFocus.trim() : '';
    if (!question || question.length > 500 || !expectedFocus || expectedFocus.length > 400) {
      return null;
    }
    // Anti-bias safeguard: reject questions inquiring into protected personal attributes
    if (containsProhibitedInquiry(question) || containsProhibitedInquiry(expectedFocus)) {
      return null;
    }
    const key = question.replace(/\s+/g, ' ').toLowerCase();
    if (seenQuestions.has(key)) return null;
    seenQuestions.add(key);
    counts[type] += 1;
    normalized.push({ type, question, expectedFocus });
  }

  if (counts.technical !== 3 || counts.project !== 2 || counts.behavioral !== 1) {
    return null;
  }
  return normalized;
}

// ---------------- MODULE 5 ----------------

// Recruiter creates an interview; questions are generated from verified skills + projects
router.post('/', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const { candidateEmail, jobTitle, jobDescription = '', verifiedSkills, projectTitles = [], scheduledAt } = req.body;
    const requestedSkills = cleanList(verifiedSkills, AI_LIMITS.skills);
    if (!candidateEmail || typeof jobTitle !== 'string' || requestedSkills.length === 0) {
      return res.status(400).json({ error: 'candidateEmail, jobTitle and verifiedSkills[] are required' });
    }
    const title = jobTitle.trim();
    if (title.length < 2 || title.length > 120) {
      return res.status(400).json({ error: 'jobTitle must be 2-120 characters' });
    }
    const description = typeof jobDescription === 'string' ? jobDescription.slice(0, AI_LIMITS.jobDescription) : '';
    const candidate = await User.findOne({ email: String(candidateEmail).trim().toLowerCase(), role: 'candidate' });
    if (!candidate) return res.status(404).json({ error: 'No candidate with that email' });
    const schedule = scheduledAt === undefined ? undefined : parseFutureSchedule(scheduledAt);
    if (scheduledAt !== undefined && !schedule) {
      return res.status(400).json({ error: 'scheduledAt must be a valid future date' });
    }

    // Enrich with candidate's stored resume skills, projects, and public GitHub repositories when authorized
    const rawProfile = await CandidateProfile.findOne({ candidateId: candidate._id });
    let profile = rawProfile;
    if (rawProfile && req.user.role === 'recruiter' && String(rawProfile.uploadedBy) !== String(req.user.sub)) {
      const recruiterJobs = await Job.find({ recruiterId: req.user.sub }).select('_id').lean();
      if (recruiterJobs.length > 0) {
        const applied = await JobApplication.exists({
          candidateId: candidate._id,
          jobId: { $in: recruiterJobs.map((j) => j._id) },
        });
        if (!applied) profile = null;
      }
    }
    const profileSkills = Array.isArray(profile?.resume?.skills) ? profile.resume.skills : [];
    const githubSkills = Array.isArray(profile?.github?.skills) ? profile.github.skills : [];
    const enrichedSkills = cleanList([...requestedSkills, ...profileSkills, ...githubSkills], AI_LIMITS.skills);

    const profileProjects = (profile?.resume?.projects || []).map((p) => p?.title);
    const enrichedProjects = cleanList([...cleanList(projectTitles, AI_LIMITS.projects), ...profileProjects], AI_LIMITS.projects);
    const githubRepos = cleanList((profile?.github?.repositories || []).map((r) => r?.name), AI_LIMITS.repos);

    let questions;
    let questionSource = 'ai';
    try {
      const response = await ai('/interview/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: title,
          jobDescription: description,
          verifiedSkills: enrichedSkills,
          projectTitles: enrichedProjects,
          githubRepositories: githubRepos,
        }),
      });
      questions = validateAndNormalizeAiQuestions(response.questions);
      if (!questions) {
        const malformed = new Error('AI service returned an unexpected question set');
        malformed.status = 'malformed';
        throw malformed;
      }
    } catch (error) {
      // Grounded fallback question bank when AI service is unavailable or rate limited.
      // Log the status only - never the request body (candidate data) or the AI error text.
      console.warn(`[Interview] AI question generation failed (status ${error.status || 'network'}); using template fallback`);
      questionSource = 'fallback';
      questions = generateFallbackQuestions(title, enrichedSkills, enrichedProjects, githubRepos);
    }

    const iv = await Interview.create({
      candidateId: candidate._id,
      recruiterId: req.user.sub,
      jobTitle: title,
      jobDescription: description,
      questions,
      questionSource,
      scheduledAt: schedule,
    });
    res.status(201).json(iv);
  } catch (err) {
    next(err);
  }
});

// A recruiter may reschedule only their own interview, and only before it starts.
router.patch('/:id/schedule', validId, requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const iv = await loadOwned(req, res, 'recruiter');
    if (!iv) return;
    if (iv.status !== 'scheduled') return res.status(409).json({ error: 'Only scheduled interviews can be rescheduled' });
    const schedule = parseFutureSchedule(req.body.scheduledAt);
    if (!schedule) return res.status(400).json({ error: 'scheduledAt must be a valid future date' });
    iv.scheduledAt = schedule;
    await iv.save();
    res.json({ id: iv._id, scheduledAt: iv.scheduledAt, status: iv.status });
  } catch (err) { next(err); }
});

// Recruiter: their interviews (with integrity logs). Candidate: their own, WITHOUT questions/log.
router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === 'candidate') {
      const list = await Interview.find({ candidateId: req.user.sub })
        .select('jobTitle scheduledAt status createdAt').sort('-createdAt');
      return res.json(list);
    }
    const filter = req.user.role === 'admin' ? {} : { recruiterId: req.user.sub };
    const interviews = await Interview.find(filter).populate('candidateId', 'name email').sort('-createdAt');
    res.json(interviews.map(discloseIntegrityAfterCompletion));
  } catch (err) { next(err); }
});

// Candidate view of one interview (no expected answers, no integrity log)
router.get('/:id/room', validId, requireRole('candidate'), async (req, res, next) => {
  try {
    const iv = await loadOwned(req, res, 'candidate');
    if (!iv) return;
    res.json({
      id: iv._id, jobTitle: iv.jobTitle, status: iv.status,
      questions: iv.questions.map(({ type, question }) => ({ type, question })),
      responses: iv.responses.map(({ questionIndex, answer }) => ({ questionIndex, answer })),
    });
  } catch (err) { next(err); }
});

// Single interview lookup: candidate receives redacted view; recruiter receives full dossier
router.get('/:id', validId, async (req, res, next) => {
  try {
    const isCandidate = req.user.role === 'candidate';
    const iv = await loadOwned(req, res, isCandidate ? 'candidate' : 'recruiter');
    if (!iv) return;
    if (isCandidate) {
      return res.json({
        id: iv._id,
        jobTitle: iv.jobTitle,
        status: iv.status,
        scheduledAt: iv.scheduledAt,
        createdAt: iv.createdAt,
        questions: iv.questions.map(({ type, question }) => ({ type, question })),
        responses: iv.responses.map(({ questionIndex, answer }) => ({ questionIndex, answer })),
      });
    }
    res.json(discloseIntegrityAfterCompletion(iv));
  } catch (err) { next(err); }
});

// Recruiter full detail incl. expected focus + integrity log
router.get('/lookup/candidate', requireRole('recruiter', 'admin'), async (req, res) => {
  const u = await User.findOne({ email: String(req.query.email || '').trim().toLowerCase(), role: 'candidate' }).select('_id');
  u ? res.json({ id: u._id }) : res.status(404).json({ error: 'Not found' });
});

// ---------------- MODULE 6 ----------------

// Candidate gives explicit consent -> interview starts
router.post('/:id/consent', validId, requireRole('candidate'), async (req, res, next) => {
  try {
    const iv = await loadOwned(req, res, 'candidate');
    if (!iv) return;
    if (iv.status === 'completed') return res.status(409).json({ error: 'Interview already completed' });
    iv.consentGivenAt = new Date();
    iv.startedAt = iv.startedAt || new Date();
    iv.status = 'in_progress';
    await iv.save();
    res.json({ status: iv.status });
  } catch (err) { next(err); }
});

// Frame -> FastAPI (face count + head pose + phone). Server derives integrity events; frame is NOT stored.
router.post('/:id/frame', validId, requireRole('candidate'), frameLimiter, frameUpload.single('file'),
  async (req, res, next) => {
    try {
      const iv = await loadOwned(req, res, 'candidate');
      if (!iv) return;
      if (!iv.consentGivenAt || iv.status !== 'in_progress') {
        return res.status(403).json({ error: 'Consent required before frame analysis' });
      }
      if (!req.file) return res.status(400).json({ error: 'No frame uploaded (field "file")' });

      const form = new FormData();
      form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), 'frame.jpg');
      const analysis = await ai('/integrity/analyze-frame', { method: 'POST', body: form });

      iv.framesAnalyzed = (Number(iv.framesAnalyzed) || 0) + 1;
      const derivedEvents = recordFrameAnalysis(iv._id, analysis);
      const room = MAX_LOG_ENTRIES - iv.integrityLog.length;
      if (derivedEvents.length && room > 0) {
        iv.integrityLog.push(...derivedEvents.slice(0, room));
      }
      await iv.save();

      res.json(analysis);
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED') return res.status(503).json({ error: 'AI service is unavailable' });
      if (err.status) return res.status(err.status === 503 ? 503 : 502).json({ error: err.message });
      next(err);
    }
  });

// Append client-reported integrity events. Only `tab_switch` is accepted from the browser;
// camera-derived events are recorded server-side in POST /:id/frame.
router.post('/:id/integrity-log', validId, requireRole('candidate'), integrityLimiter, async (req, res, next) => {
  try {
    const iv = await loadOwned(req, res, 'candidate');
    if (!iv) return;
    if (iv.status !== 'in_progress') return res.status(409).json({ error: 'Interview is not in progress' });
    if (!Array.isArray(req.body.events)) return res.status(400).json({ error: 'events[] is required' });
    if (req.body.events.length > 50) {
      return res.status(400).json({ error: 'events array cannot exceed 50 items per batch' });
    }

    const nowMs = Date.now();
    const events = req.body.events
      .filter((e) => e?.event === 'tab_switch')
      .map((e) => ({
        event: 'tab_switch',
        timestamp: clampTimestamp(e.timestamp, iv.startedAt, nowMs),
        confidence: Math.min(1, Math.max(0, Number(e.confidence) || 1)),
      }));

    const room = MAX_LOG_ENTRIES - iv.integrityLog.length;
    if (events.length && room > 0) {
      iv.integrityLog.push(...events.slice(0, room));
      await iv.save();
    }
    res.json({ stored: Math.min(events.length, Math.max(room, 0)) });
  } catch (err) { next(err); }
});

// Save candidate answers separately from integrity data.
router.post('/:id/answers', validId, requireRole('candidate'), answersLimiter, async (req, res, next) => {
  try {
    const iv = await loadOwned(req, res, 'candidate');
    if (!iv) return;
    if (iv.status !== 'in_progress') return res.status(409).json({ error: 'Interview is not in progress' });
    if (!Array.isArray(req.body.responses)) return res.status(400).json({ error: 'responses[] is required' });

    const seen = new Set();
    const responses = [];
    for (const item of req.body.responses) {
      const questionIndex = Number(item?.questionIndex);
      if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= iv.questions.length || seen.has(questionIndex)) {
        return res.status(400).json({ error: 'Each response must reference a unique, valid question index' });
      }
      if (typeof item.answer !== 'string' || item.answer.length > 10000) {
        return res.status(400).json({ error: 'Answers must be text up to 10,000 characters' });
      }
      seen.add(questionIndex);
      responses.push({ questionIndex, answer: item.answer.trim(), updatedAt: new Date() });
    }

    iv.responses = responses;
    await iv.save();
    res.json({ saved: responses.length });
  } catch (err) { next(err); }
});

router.post('/:id/complete', validId, requireRole('candidate'), async (req, res, next) => {
  try {
    const iv = await loadOwned(req, res, 'candidate');
    if (!iv) return;
    if (iv.status !== 'in_progress') return res.status(409).json({ error: 'Interview is not in progress' });
    if (iv.responses.length !== iv.questions.length || iv.responses.some((response) => !response.answer.trim())) {
      return res.status(400).json({ error: 'Answer every interview question before completing' });
    }
    iv.status = 'completed';
    iv.completedAt = new Date();
    await iv.save();
    clearInterviewState(iv._id);

    // Advance only applications belonging to this interview's recruiter that are still in 'applied' status
    const recruiterJobs = await Job.find({ recruiterId: iv.recruiterId }).select('_id').lean().catch(() => []);
    if (recruiterJobs.length > 0) {
      await JobApplication.updateMany(
        {
          candidateId: iv.candidateId,
          jobId: { $in: recruiterJobs.map((j) => j._id) },
          status: 'applied',
        },
        { $set: { status: 'interview' } }
      ).catch(() => {});
    }

    res.json({ status: iv.status, completedAt: iv.completedAt });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.parseFutureSchedule = parseFutureSchedule;
module.exports.cleanList = cleanList;
module.exports.generateFallbackQuestions = generateFallbackQuestions;
module.exports.validateAndNormalizeAiQuestions = validateAndNormalizeAiQuestions;
module.exports.containsProhibitedInquiry = containsProhibitedInquiry;
module.exports.AI_LIMITS = AI_LIMITS;

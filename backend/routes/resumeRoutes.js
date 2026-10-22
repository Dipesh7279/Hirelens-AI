const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const { normalizeResumeEdits, ResumeEditValidationError } = require('../utils/resumeEditor');
const { storeResume, downloadResume, removeResume, sanitizeOriginalName, ResumeStorageError } = require('../services/resumeObjectStorage');
const { canDownloadResume } = require('../utils/resumeAccess');

const router = express.Router();
router.use(requireAuth);

async function candidateAppliedToRecruiterJob(candidateId, recruiterId) {
  const jobs = await Job.find({ recruiterId }).select('_id').lean();
  if (!jobs.length) return false;
  return Boolean(await JobApplication.exists({
    candidateId,
    jobId: { $in: jobs.map((job) => job._id) },
  }));
}

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 5);
const base = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const AI_SERVICE_URL = base.endsWith('/ai') ? base : `${base}/ai`;
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'hirelens-internal-shared-secret-dev';

const parseLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 10,
  keyGenerator: (req) => (req.user?.sub ? String(req.user.sub) : (req.ip || 'global')),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resume parse attempts. Please wait a few minutes before trying again.' },
});

const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    const error = new Error('Only PDF or DOCX files are allowed');
    error.code = 'UNSUPPORTED_RESUME_TYPE';
    return cb(error);
  },
});

// POST /api/resume/parse  (multipart: file [+ candidateEmail if recruiter])
router.post('/parse', parseLimiter, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });

    let candidate;
    if (req.user.role === 'candidate') {
      candidate = await User.findById(req.user.sub);
    } else if (['recruiter', 'admin'].includes(req.user.role)) {
      const email = String(req.body.candidateEmail || '').toLowerCase().trim();
      if (!email) return res.status(400).json({ error: 'candidateEmail is required' });
      candidate = await User.findOne({ email, role: 'candidate' });
    } else {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (!candidate) return res.status(404).json({ error: 'No candidate registered with that email' });

    const oldProfile = await CandidateProfile.findOne({ candidateId: candidate._id }).select('uploadedBy resume.storageKey');
    if (req.user.role === 'recruiter') {
      const applied = await candidateAppliedToRecruiterJob(candidate._id, req.user.sub);
      const isExistingUploader = oldProfile && String(oldProfile.uploadedBy) === String(req.user.sub);
      const isCandidateOwned = oldProfile?.resume?.storageKey && String(oldProfile.uploadedBy) === String(candidate._id);
      if (isCandidateOwned) {
        return res.status(403).json({ error: 'Cannot overwrite a resume uploaded directly by the candidate' });
      }
      if (!applied && !isExistingUploader) {
        return res.status(403).json({ error: 'Candidate has not applied to one of your jobs' });
      }
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname
    );
    const aiRes = await fetch(`${AI_SERVICE_URL}/resume/parse`, {
      method: 'POST',
      body: form,
      headers: {
        'X-Internal-Secret': INTERNAL_SERVICE_KEY,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) {
      const aiErrorCode = aiRes.headers?.get?.('x-error-code');
      const geminiErrors = {
        GEMINI_REQUEST_REJECTED: 'Gemini rejected the request. Check the model setting and AI service compatibility.',
        GEMINI_API_KEY_INVALID: 'Gemini API key is missing, invalid, or expired. Check the AI service configuration.',
        GEMINI_ACCESS_DENIED: 'Gemini denied this key or project access to the selected model. Check API permissions.',
        GEMINI_MODEL_NOT_FOUND: 'The configured Gemini model was not found. Set GEMINI_MODEL to gemini-3.8-flash and restart the AI service.',
      };
      if (Object.hasOwn(geminiErrors, aiErrorCode)) {
        return res.status(503).json({
          error: geminiErrors[aiErrorCode],
          code: aiErrorCode,
        });
      }
      const status = [400, 413, 422, 502, 503].includes(aiRes.status) ? aiRes.status : 502;
      const safeErrors = {
        400: 'Only PDF or DOCX resumes can be parsed',
        413: 'Resume file is too large',
        422: 'Could not extract readable text from this resume. Try a text-based PDF or DOCX.',
        502: 'Resume text could not be structured. Please try again with a text-based resume or retry later.',
        503: 'Resume parsing service is temporarily unavailable. Please try again.',
      };
      return res.status(status).json({
        error: safeErrors[status] || 'Resume parsing service failed. Please try again.',
        ...(status === 502 ? { code: 'AI_SERVICE_PARSE_FAILED' } : {}),
      });
    }

    const { parsed, authenticity } = body;
    const detectedGithub = typeof parsed?.githubUsername === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parsed.githubUsername.trim())
      ? parsed.githubUsername.trim()
      : null;
    const storedFile = await storeResume(req.file.buffer, req.file.originalname, req.file.mimetype);
    let profile;
    try {
      profile = await CandidateProfile.findOneAndUpdate(
        { candidateId: candidate._id },
        {
          uploadedBy: req.user.sub,
          resume: {
            fileName: storedFile.originalName,
            storageKey: storedFile.storageKey,
            mimeType: storedFile.mimeType,
            fileSize: storedFile.size,
            githubUsername: detectedGithub,
            githubConfirmedAt: null,
            skills: parsed.skills,
            education: parsed.education,
            experience: parsed.experience,
            projects: parsed.projects,
            authenticityScore: authenticity.authenticityScore,
            flags: authenticity.flags,
            parsingMode: body.parsingMode || 'gemini',
            parsedAt: new Date(),
            confirmedAt: null,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      if (detectedGithub) {
        try {
          const ghRes = await fetch(`${AI_SERVICE_URL}/github/${encodeURIComponent(detectedGithub)}/analyze`, {
            headers: { 'X-Internal-Secret': INTERNAL_SERVICE_KEY },
            signal: AbortSignal.timeout(8000),
          });
          if (ghRes.ok) {
            const ghData = await ghRes.json();
            if (ghData && Array.isArray(ghData.repositories)) {
              profile.github = {
                username: detectedGithub,
                skills: Array.isArray(ghData.skills) ? ghData.skills : [],
                repositories: ghData.repositories,
                analysisLimits: ghData.analysisLimits,
                advisoryNotice: ghData.advisoryNotice,
                analyzedBy: req.user.sub,
                analyzedAt: new Date(),
              };

              // Automated Resume & GitHub Skill Matching via MiniLM
              if (Array.isArray(parsed.skills) && parsed.skills.length > 0 && Array.isArray(profile.github.skills) && profile.github.skills.length > 0) {
                try {
                  const matchRes = await fetch(`${AI_SERVICE_URL}/github/match`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Internal-Secret': INTERNAL_SERVICE_KEY,
                    },
                    body: JSON.stringify({
                      resumeSkills: parsed.skills,
                      githubSkills: profile.github.skills,
                    }),
                    signal: AbortSignal.timeout(5000),
                  });
                  if (matchRes.ok) {
                    const matchData = await matchRes.json();
                    if (matchData && Array.isArray(matchData.matches)) {
                      profile.skillMatch = {
                        score: typeof matchData.score === 'number' ? matchData.score : 0,
                        matches: matchData.matches,
                        computedAt: new Date(),
                      };
                    }
                  }
                } catch {
                  // Non-fatal if AI skill matching encounters network latency
                }
              }

              await profile.save();
            }
          } else if (!profile.github?.username) {
            profile.github = { username: detectedGithub };
            await profile.save();
          }
        } catch {
          if (!profile.github?.username) {
            profile.github = { username: detectedGithub };
            await profile.save().catch(() => {});
          }
        }
      }
    } catch (error) {
      await removeResume(storedFile.storageKey).catch((cleanupError) => {
        console.error(`[Resume storage] GridFS cleanup after profile write failed (${cleanupError.code || cleanupError.name || 'Error'})`);
      });
      throw error;
    }
    if (oldProfile?.resume?.storageKey && oldProfile.resume.storageKey !== storedFile.storageKey) {
      await removeResume(oldProfile.resume.storageKey).catch((error) => {
        console.warn(`[Resume storage] Could not remove replaced GridFS file (${error.code || error.name || 'Error'})`);
      });
    }
    res.json({ candidate: { id: candidate._id, name: candidate.name, email: candidate.email }, profile, parsed, authenticity, parsingMode: body.parsingMode || 'gemini' });
  } catch (err) {
    if (err instanceof ResumeStorageError) {
      const storageCode = err.code || 'GRIDFS_OPERATION_FAILED';
      console.error(`[Resume storage] ${storageCode}`);
      const safeErrors = {
        GRIDFS_UNAVAILABLE: 'MongoDB resume storage is unavailable. Check the database connection and try again.',
        GRIDFS_OPERATION_FAILED: 'Could not store the resume in MongoDB. Check database availability and storage limits.',
        INVALID_FILE_TYPE: 'Only PDF and DOCX resumes can be stored.',
      };
      return res.status(storageCode === 'INVALID_FILE_TYPE' ? 400 : 503).json({
        error: safeErrors[storageCode] || safeErrors.GRIDFS_OPERATION_FAILED,
        code: storageCode,
      });
    }
    const networkErrorCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH']);
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    const causeCode = networkErrorCodes.has(err.cause?.code) ? err.cause.code : null;
    if (timedOut || causeCode) {
      const failureCode = timedOut ? 'AI_SERVICE_TIMEOUT' : 'AI_SERVICE_CONNECTION_FAILED';
      const safeCause = causeCode ? ` (${causeCode})` : '';
      console.error(`[Resume parse] ${timedOut ? 'AI service request timed out' : `AI service connection failed${safeCause}`}; verify AI_SERVICE_URL and AI service availability`);
      return res.status(503).json({
        error: timedOut
          ? 'Resume parsing timed out. Check AI_SERVICE_URL and AI service availability.'
          : 'Resume parsing service could not be reached. Check AI_SERVICE_URL and confirm the AI service is running.',
        code: failureCode,
      });
    }
    next(err);
  }
});

// Download the original resume via an authenticated, ownership-checked route.
router.get('/:candidateId/file', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.candidateId)) return res.status(400).json({ error: 'Invalid candidate id' });
    if (req.user.role === 'candidate' && String(req.user.sub) !== String(req.params.candidateId)) {
      return res.status(403).json({ error: 'You are not allowed to download this resume' });
    }
    const profile = await CandidateProfile.findOne({ candidateId: req.params.candidateId });
    if (!profile?.resume?.storageKey) return res.status(404).json({ error: 'Stored resume not found' });

    const appliedToRecruiterJob = req.user.role === 'recruiter'
      ? await candidateAppliedToRecruiterJob(req.params.candidateId, req.user.sub)
      : false;
    if (!canDownloadResume(req.user, req.params.candidateId, profile, appliedToRecruiterJob)) {
      return res.status(403).json({ error: 'You are not allowed to download this resume' });
    }

    const object = await downloadResume(profile.resume.storageKey);
    if (!object?.Body) return res.status(404).json({ error: 'Stored resume file is missing' });
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(profile.resume.mimeType || 'application/octet-stream');
    res.attachment(sanitizeOriginalName(profile.resume.fileName || 'resume'));
    object.Body.on('error', next).pipe(res);
  } catch (error) {
    if (error instanceof ResumeStorageError) {
      if (error.code === 'INVALID_STORAGE_KEY') return res.status(404).json({ error: 'Stored resume file not found' });
      return res.status(503).json({ error: 'Resume storage is unavailable' });
    }
    next(error);
  }
});

// Candidate edits only their own parsed fields; authenticity metadata remains server-owned.
router.patch('/:candidateId', requireRole('candidate'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.candidateId)) {
      return res.status(400).json({ error: 'Invalid candidate id' });
    }
    if (String(req.user.sub) !== String(req.params.candidateId)) {
      return res.status(403).json({ error: 'You can only edit your own resume profile' });
    }

    let edits;
    try {
      edits = normalizeResumeEdits(req.body);
    } catch (error) {
      if (error instanceof ResumeEditValidationError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    const now = new Date();
    const setUpdate = { 'resume.confirmedAt': now };
    if (edits.skills !== undefined) setUpdate['resume.skills'] = edits.skills;
    if (edits.education !== undefined) setUpdate['resume.education'] = edits.education;
    if (edits.experience !== undefined) setUpdate['resume.experience'] = edits.experience;
    if (edits.projects !== undefined) setUpdate['resume.projects'] = edits.projects;
    if (edits.githubUsername !== undefined) {
      setUpdate['resume.githubUsername'] = edits.githubUsername;
      setUpdate['resume.githubConfirmedAt'] = edits.githubUsername ? now : null;
      if (edits.githubUsername) {
        setUpdate['github.username'] = edits.githubUsername;
      }
    } else if (edits.confirmGithub === true) {
      setUpdate['resume.githubConfirmedAt'] = now;
    } else if (edits.confirmGithub === false) {
      setUpdate['resume.githubConfirmedAt'] = null;
    }

    const profile = await CandidateProfile.findOneAndUpdate(
      { candidateId: req.user.sub },
      { $set: setUpdate },
      { new: true, runValidators: true }
    );
    if (!profile) return res.status(404).json({ error: 'Parse a resume before editing its fields' });

    if (Array.isArray(edits.skills) && edits.skills.length > 0 && Array.isArray(profile.github?.skills) && profile.github.skills.length > 0) {
      try {
        const matchRes = await fetch(`${AI_SERVICE_URL}/github/match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': INTERNAL_SERVICE_KEY,
          },
          body: JSON.stringify({
            resumeSkills: edits.skills,
            githubSkills: profile.github.skills,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (matchRes.ok) {
          const matchData = await matchRes.json();
          if (matchData && Array.isArray(matchData.matches)) {
            profile.skillMatch = {
              score: typeof matchData.score === 'number' ? matchData.score : 0,
              matches: matchData.matches,
              computedAt: new Date(),
            };
            await profile.save();
          }
        }
      } catch {
        // Non-fatal if skill matching service is busy
      }
    }

    res.json({ profile });
  } catch (error) { next(error); }
});

// DELETE /api/resume/:candidateId - purge resume document and GridFS binary chunks (GDPR Right to Erasure)
router.delete('/:candidateId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.candidateId)) {
      return res.status(400).json({ error: 'Invalid candidate id' });
    }
    const isSelf = String(req.user.sub) === String(req.params.candidateId);
    if (!isSelf && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own resume' });
    }

    const profile = await CandidateProfile.findOne({ candidateId: req.params.candidateId });
    if (!profile || !profile.resume?.storageKey) {
      return res.status(404).json({ error: 'No stored resume found to delete' });
    }

    if (profile.resume.storageKey) {
      await removeResume(profile.resume.storageKey).catch((err) => {
        console.warn(`[Resume storage] GridFS file removal warning: ${err.message}`);
      });
    }

    profile.resume = undefined;
    profile.skillMatch = undefined;
    if (!profile.github?.username) {
      await CandidateProfile.deleteOne({ _id: profile._id });
    } else {
      await profile.save();
    }

    res.json({ message: 'Resume purged successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/resume/:candidateId - stored profile (used to prefill interview + scoring forms)
router.get('/:candidateId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.candidateId)) return res.status(400).json({ error: 'Invalid id' });
    if (req.user.role === 'candidate' && String(req.user.sub) !== String(req.params.candidateId)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const profile = await CandidateProfile.findOne({ candidateId: req.params.candidateId });
    if (!profile) return res.status(404).json({ error: 'No profile yet' });
    if (req.user.role === 'recruiter' && String(profile.uploadedBy) !== String(req.user.sub)) {
      const applied = await candidateAppliedToRecruiterJob(req.params.candidateId, req.user.sub);
      if (!applied) return res.status(403).json({ error: 'Candidate has not applied to one of your jobs' });
    }
    if (req.user.role === 'candidate' && String(req.user.sub) !== String(req.params.candidateId)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    res.json(profile);
  } catch (err) { next(err); }
});

module.exports = router;

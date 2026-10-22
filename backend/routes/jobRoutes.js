const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const Job = require('../models/Job');
const ScoreRecord = require('../models/ScoreRecord');
const User = require('../models/User');
const JobApplication = require('../models/JobApplication');
const CandidateProfile = require('../models/CandidateProfile');
const { performBiasAudit } = require('../services/biasAuditEngine');

const router = express.Router();
router.use(requireAuth);

async function ownJob(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid job id' });
    return null;
  }
  const job = await Job.findById(req.params.id);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return null; }
  if (req.user.role !== 'admin' && String(job.recruiterId) !== String(req.user.sub)) {
    res.status(403).json({ error: 'Not your job' });
    return null;
  }
  return job;
}

router.post('/', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const { title, description = '', requiredSkills = [] } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    res.status(201).json(await Job.create({ recruiterId: req.user.sub, title, description, requiredSkills }));
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const filter = req.user.role === 'candidate'
      ? { status: 'open' }
      : req.user.role === 'admin' ? {} : { recruiterId: req.user.sub };
    const projection = req.user.role === 'candidate' ? '-recruiterId' : undefined;
    res.json(await Job.find(filter, projection).sort('-createdAt'));
  } catch (e) { next(e); }
});

router.get('/applications/mine', requireRole('candidate'), async (req, res, next) => {
  try {
    res.json(await JobApplication.find({ candidateId: req.user.sub })
      .populate('jobId', 'title description requiredSkills status')
      .sort('-createdAt'));
  } catch (e) { next(e); }
});

router.post('/:id/applications', requireRole('candidate'), async (req, res, next) => {
  try {
    const profile = await CandidateProfile.findOne({ candidateId: req.user.sub });
    if (!profile || !profile.resume?.parsedAt) {
      return res.status(400).json({ error: 'Please upload your resume before applying to jobs' });
    }
    const job = await Job.findById(req.params.id).select('status');
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'open') return res.status(409).json({ error: 'This job is not accepting applications' });
    const application = await JobApplication.create({ candidateId: req.user.sub, jobId: job._id });
    res.status(201).json(application);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'You already applied to this job' });
    next(error);
  }
});

router.get('/:id/applications', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const job = await ownJob(req, res);
    if (!job) return;
    res.json(await JobApplication.find({ jobId: job._id })
      .populate('candidateId', 'name email')
      .sort('-createdAt'));
  } catch (e) { next(e); }
});

router.patch('/applications/:applicationId/status', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    if (!mongoose.isValidObjectId(applicationId)) return res.status(400).json({ error: 'Invalid application id' });
    const allowed = ['applied', 'reviewing', 'interview', 'rejected', 'offered'];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid application status' });
    const application = await JobApplication.findById(applicationId);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const job = await Job.findById(application.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (req.user.role !== 'admin' && String(job.recruiterId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'Not your job' });
    }
    application.status = req.body.status;
    await application.save();
    res.json(application);
  } catch (e) { next(e); }
});

// POST /api/jobs/applications/:id/appeal (Candidate appeals an adverse rejection decision)
router.post('/applications/:id/appeal', requireRole('candidate'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid application id' });
    const application = await JobApplication.findOne({ _id: req.params.id, candidateId: req.user.sub });
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status !== 'rejected') {
      return res.status(400).json({ error: 'Only rejected applications can be appealed' });
    }
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 1000) {
      return res.status(400).json({ error: 'Appeal reason must be between 10 and 1000 characters' });
    }
    application.appealStatus = 'requested';
    application.appealReason = reason;
    application.appealedAt = new Date();
    await application.save();
    res.status(201).json(application);
  } catch (e) { next(e); }
});

// PATCH /api/jobs/applications/:id/review-appeal (Recruiter human review on appeal)
router.patch('/applications/:id/review-appeal', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid application id' });
    const application = await JobApplication.findById(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const job = await Job.findById(application.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (req.user.role !== 'admin' && String(job.recruiterId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'Not your job' });
    }
    if (application.appealStatus !== 'requested') {
      return res.status(400).json({ error: 'No pending appeal for this application' });
    }
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
    application.appealStatus = 'reviewed';
    application.humanReviewerId = req.user.sub;
    application.humanReviewNotes = notes;
    application.reviewedAt = new Date();
    await application.save();
    res.json(application);
  } catch (e) { next(e); }
});

// DELETE /api/jobs/applications/:id (Candidate withdraws their pending application)
router.delete('/applications/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid application id' });
    const application = await JobApplication.findById(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const isApplicant = String(application.candidateId) === String(req.user.sub);
    const isAdmin = req.user.role === 'admin';
    if (!isApplicant && !isAdmin) {
      return res.status(403).json({ error: 'You can only withdraw your own applications' });
    }

    if (application.status === 'offered') {
      return res.status(400).json({ error: 'Cannot withdraw an application after an offer has been extended' });
    }

    await JobApplication.deleteOne({ _id: application._id });
    res.json({ message: 'Application withdrawn successfully' });
  } catch (e) { next(e); }
});

router.patch('/:id', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const job = await ownJob(req, res);
    if (!job) return;
    const allowed = new Set(['title', 'description', 'requiredSkills', 'status']);
    if (!req.body || Object.keys(req.body).some((key) => !allowed.has(key))) {
      return res.status(400).json({ error: 'Unsupported job fields' });
    }
    if (req.body.title !== undefined && (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.length > 120)) {
      return res.status(400).json({ error: 'title must be 1-120 characters' });
    }
    if (req.body.description !== undefined && (typeof req.body.description !== 'string' || req.body.description.length > 4000)) {
      return res.status(400).json({ error: 'description must be at most 4000 characters' });
    }
    if (req.body.requiredSkills !== undefined && (!Array.isArray(req.body.requiredSkills) || req.body.requiredSkills.length > 100 || req.body.requiredSkills.some((skill) => typeof skill !== 'string' || skill.length > 120))) {
      return res.status(400).json({ error: 'requiredSkills must be a list of up to 100 short text values' });
    }
    if (req.body.status !== undefined && !['open', 'closed'].includes(req.body.status)) {
      return res.status(400).json({ error: 'status must be open or closed' });
    }
    Object.assign(job, req.body);
    await job.save();
    res.json(job);
  } catch (e) { next(e); }
});

// Persist a score returned by POST /api/ai/score/candidate
router.post('/:id/scores', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const job = await ownJob(req, res);
    if (!job) return;
    const { candidateId, weightedScore, breakdown, weights, explanation, biasAuditFlags } = req.body;
    if (!mongoose.isValidObjectId(candidateId) || typeof weightedScore !== 'number' || !breakdown) {
      return res.status(400).json({ error: 'candidateId, weightedScore and breakdown are required' });
    }
    if (!Number.isFinite(weightedScore) || weightedScore < 0 || weightedScore > 100) {
      return res.status(400).json({ error: 'weightedScore must be between 0 and 100' });
    }
    const candidate = await User.findOne({ _id: candidateId, role: 'candidate' }).select('_id');
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    const hasApplied = await JobApplication.exists({ candidateId, jobId: job._id });
    if (!hasApplied) {
      return res.status(403).json({ error: 'Candidate has not applied to this job' });
    }
    const rec = await ScoreRecord.create({
      candidateId, jobId: job._id, weightedScore, breakdown, weights, explanation, biasAuditFlags,
      biasAuditStatus: 'not_performed',
    });
    res.status(201).json(rec);
  } catch (e) { next(e); }
});

// Ranked candidates: GET /api/jobs/:id/candidates?sort=score|name&minScore=60
router.get('/:id/candidates', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const job = await ownJob(req, res);
    if (!job) return;

    const records = await ScoreRecord.find({ jobId: job._id }).sort('-createdAt').lean();
    const latest = new Map(); // newest record per candidate
    for (const r of records) if (!latest.has(String(r.candidateId))) latest.set(String(r.candidateId), r);

    const users = await User.find({ _id: { $in: [...latest.keys()] } }).select('name email').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const minScore = req.query.minScore === undefined ? 0 : Number(req.query.minScore);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      return res.status(400).json({ error: 'minScore must be between 0 and 100' });
    }
    let rows = [...latest.values()]
      .filter((r) => r.weightedScore >= minScore)
      .map((r) => ({
        candidateId: r.candidateId,
        name: byId.get(String(r.candidateId))?.name || 'Unknown',
        email: byId.get(String(r.candidateId))?.email || '',
        weightedScore: r.weightedScore,
        breakdown: r.breakdown,
        explanation: r.explanation,
        biasAuditStatus: r.biasAuditStatus || 'not_performed',
        scoredAt: r.createdAt,
      }));

    rows.sort(req.query.sort === 'name'
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) => b.weightedScore - a.weightedScore);

    res.json({ job: { id: job._id, title: job.title }, candidates: rows });
  } catch (e) { next(e); }
});

// GET /api/jobs/:id/bias-audit (NYC Local Law 144 AEDT Bias Audit Certificate)
router.get('/:id/bias-audit', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const job = await ownJob(req, res);
    if (!job) return;
    const audit = await performBiasAudit(job._id);
    res.json(audit);
  } catch (e) { next(e); }
});

module.exports = router;

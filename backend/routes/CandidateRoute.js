const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const ScoreRecord = require('../models/ScoreRecord');
const Interview = require('../models/Interview');
const Feedback = require('../models/Feedback');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const User = require('../models/User');
const CandidateProfile = require('../models/CandidateProfile');
const { discloseIntegrityAfterCompletion } = require('../utils/interviewDisclosure');

const router = express.Router();
router.use(requireAuth);

const base = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const AI_SERVICE_URL = base.endsWith('/ai') ? base : `${base}/ai`;

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Invalid candidate id' });

// GET /api/candidates/pipeline - Real candidate pipeline scoped to the recruiter's jobs & interviews
router.get('/pipeline', requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const jobFilter = isAdmin ? {} : { recruiterId: req.user.sub };
    const jobs = await Job.find(jobFilter).select('_id title status').lean();
    const jobIds = jobs.map((j) => j._id);
    const jobTitleById = new Map(jobs.map((j) => [String(j._id), j.title]));

    const [applications, interviews, feedbacks, uploadedProfiles] = await Promise.all([
      isAdmin
        ? JobApplication.find({}).populate('candidateId', 'name email').populate('jobId', 'title').sort('-createdAt').lean()
        : jobIds.length
          ? JobApplication.find({ jobId: { $in: jobIds } }).populate('candidateId', 'name email').populate('jobId', 'title').sort('-createdAt').lean()
          : [],
      Interview.find(isAdmin ? {} : { recruiterId: req.user.sub })
        .populate('candidateId', 'name email')
        .sort('-createdAt')
        .lean(),
      Feedback.find(isAdmin ? {} : { recruiterId: req.user.sub })
        .populate('jobId', 'title')
        .select('candidateId decision jobId')
        .sort('-createdAt')
        .lean(),
      CandidateProfile.find(isAdmin ? {} : { uploadedBy: req.user.sub })
        .populate('candidateId', 'name email')
        .select('candidateId resume.skills resume.fileName github.username')
        .sort('-createdAt')
        .lean(),
    ]);

    const pipeline = {
      applied: [],
      screening: [],
      interviewing: [],
      offer: [],
    };

    // Index feedbacks by `candidateId:jobId`
    const fbByCandidateJob = new Map();
    for (const fb of feedbacks) {
      const cid = String(fb.candidateId);
      const jid = String(fb.jobId?._id || fb.jobId);
      const key = `${cid}:${jid}`;
      if (!fbByCandidateJob.has(key)) fbByCandidateJob.set(key, fb);
    }

    // Index interviews by `candidateId:jobTitle` and `candidateId`
    const ivByCandidateJob = new Map();
    const ivByCandidate = new Map();
    for (const iv of interviews) {
      const cid = String(iv.candidateId?._id || iv.candidateId);
      const title = (iv.jobTitle || '').trim().toLowerCase();
      const key = `${cid}:${title}`;
      if (!ivByCandidateJob.has(key)) ivByCandidateJob.set(key, iv);
      if (!ivByCandidate.has(cid)) ivByCandidate.set(cid, iv);
    }

    const processedCandidatesWithApps = new Set();

    // 1. Process application-level cards
    for (const app of applications) {
      if (!app.candidateId || !app.jobId) continue;
      const cid = String(app.candidateId._id || app.candidateId);
      const jid = String(app.jobId._id || app.jobId);
      const jobTitle = app.jobId.title || jobTitleById.get(jid) || 'Open Role';
      processedCandidatesWithApps.add(cid);

      const fb = fbByCandidateJob.get(`${cid}:${jid}`);
      const iv = ivByCandidateJob.get(`${cid}:${jobTitle.trim().toLowerCase()}`);

      // If this specific application or its feedback is rejected, omit THIS application card.
      // Other applications for the same candidate remain unaffected.
      if (app.status === 'rejected' || fb?.decision === 'rejected') {
        continue;
      }

      const card = {
        id: String(app._id),
        candidateId: cid,
        name: app.candidateId.name || 'Candidate',
        email: app.candidateId.email || '',
        jobTitle,
        stage: '',
      };

      if (app.status === 'offered' || fb?.decision === 'selected') {
        card.stage = `Offer extended · ${jobTitle}`;
        pipeline.offer.push(card);
      } else if (app.status === 'interview' || (iv && iv.status !== 'cancelled')) {
        card.stage = iv
          ? `${jobTitle} (${iv.status.replace('_', ' ')})`
          : `Interview · ${jobTitle}`;
        pipeline.interviewing.push(card);
      } else if (app.status === 'reviewing') {
        card.stage = `Screening · ${jobTitle}`;
        pipeline.screening.push(card);
      } else {
        card.stage = `Applied · ${jobTitle}`;
        pipeline.applied.push(card);
      }
    }

    // 2. Process uploaded profiles or direct interviewees without formal applications
    for (const prof of uploadedProfiles) {
      const cid = String(prof.candidateId?._id || prof.candidateId);
      if (processedCandidatesWithApps.has(cid)) continue;
      if (!prof.candidateId || typeof prof.candidateId !== 'object') continue;

      const iv = ivByCandidate.get(cid);
      const card = {
        id: `profile-${cid}`,
        candidateId: cid,
        name: prof.candidateId.name || 'Candidate',
        email: prof.candidateId.email || '',
        jobTitle: iv?.jobTitle || 'Uploaded Candidate',
        stage: iv
          ? `${iv.jobTitle} (${iv.status.replace('_', ' ')})`
          : prof.resume?.skills?.length
            ? `Resume verified (${prof.resume.skills.length} skills)`
            : 'Uploaded Resume',
      };

      if (iv && iv.status !== 'cancelled') {
        pipeline.interviewing.push(card);
      } else if (prof.resume?.skills?.length) {
        pipeline.screening.push(card);
      } else {
        pipeline.applied.push(card);
      }
    }

    res.json(pipeline);
  } catch (e) {
    next(e);
  }
});

// GET /api/candidate/me/export - GDPR Article 20 Data Portability Export
router.get('/me/export', requireRole('candidate'), async (req, res, next) => {
  try {
    const candidateId = req.user.sub;
    const [user, profile, applications, interviews, feedbacks] = await Promise.all([
      User.findById(candidateId).select('name email role createdAt updatedAt'),
      CandidateProfile.findOne({ candidateId }).select('-__v'),
      JobApplication.find({ candidateId }).populate('jobId', 'title description status').sort('-createdAt'),
      Interview.find({ candidateId }).select('jobTitle status scheduledAt consentGivenAt startedAt completedAt questions responses createdAt'),
      Feedback.find({ candidateId }).populate('jobId', 'title').select('decision text createdAt'),
    ]);

    if (!user) return res.status(404).json({ error: 'Candidate account not found' });

    // Sanitized interview responses without internal proctoring integrity logs
    const sanitizedInterviews = interviews.map((iv) => ({
      jobTitle: iv.jobTitle,
      status: iv.status,
      scheduledAt: iv.scheduledAt,
      consentGivenAt: iv.consentGivenAt,
      startedAt: iv.startedAt,
      completedAt: iv.completedAt,
      questions: (iv.questions || []).map((q) => ({ type: q.type, question: q.question })),
      responses: iv.responses || [],
    }));

    const exportPackage = {
      exportMetadata: {
        exportedAt: new Date().toISOString(),
        regulation: 'GDPR Article 20 & CCPA Data Portability',
        candidateId,
      },
      account: {
        name: user.name,
        email: user.email,
        role: user.role,
        memberSince: user.createdAt,
      },
      profile: {
        resume: profile?.resume || null,
        github: profile?.github || null,
        skillMatch: profile?.skillMatch || null,
      },
      applications: applications.map((app) => ({
        id: app._id,
        jobTitle: app.jobId?.title || 'Unknown Job',
        jobStatus: app.jobId?.status || 'unknown',
        applicationStatus: app.status,
        appealStatus: app.appealStatus,
        appliedAt: app.createdAt,
      })),
      interviews: sanitizedInterviews,
      feedback: feedbacks.map((fb) => ({
        jobTitle: fb.jobId?.title || 'General Review',
        decision: fb.decision,
        text: fb.text,
        date: fb.createdAt,
      })),
    };

    res.setHeader('Content-Disposition', `attachment; filename="hirelens_data_export_${candidateId}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(exportPackage);
  } catch (err) {
    next(err);
  }
});

// Full score + interview report (recruiter). Optional ?jobId=
router.get('/:id/report', validId, requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const filter = { candidateId: req.params.id };
    let reportJobTitle;
    let ownedJobIds = [];
    if (req.query.jobId && !mongoose.isValidObjectId(req.query.jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    if (req.user.role === 'admin') {
      if (req.query.jobId) filter.jobId = req.query.jobId;
    } else if (req.query.jobId) {
      const job = await Job.findById(req.query.jobId).select('recruiterId title');
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (String(job.recruiterId) !== String(req.user.sub)) return res.status(403).json({ error: 'Not your job' });
      filter.jobId = job._id;
      reportJobTitle = job.title;
      ownedJobIds = [job._id];
    } else {
      const ownedJobs = await Job.find({ recruiterId: req.user.sub }).select('_id');
      ownedJobIds = ownedJobs.map((job) => job._id);
      filter.jobId = { $in: ownedJobIds };
    }

    const [candidate, score, interviews, profile, applicationExists] = await Promise.all([
      User.findOne({ _id: req.params.id, role: 'candidate' }).select('name email'),
      ScoreRecord.findOne(filter).sort('-createdAt'),
      Interview.find({
        candidateId: req.params.id,
        ...(req.user.role === 'admin' ? {} : {
          recruiterId: req.user.sub,
          ...(reportJobTitle ? { jobTitle: reportJobTitle } : {}),
        }),
      }).sort('-createdAt'),
      CandidateProfile.findOne({ candidateId: req.params.id }).select('github resume skillMatch uploadedBy'),
      req.user.role === 'admin'
        ? true
        : JobApplication.exists({
            jobId: req.query.jobId ? filter.jobId : { $in: ownedJobIds },
            candidateId: req.params.id,
          }),
    ]);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    const isUploadedByRecruiter = profile && String(profile.uploadedBy) === String(req.user.sub);
    const hasAccess = req.user.role === 'admin' || Boolean(score || interviews.length > 0 || applicationExists || isUploadedByRecruiter);

    if (!hasAccess) {
      return res.status(404).json({ error: 'No candidate record found for your jobs or interviews' });
    }
    // Integrity signals are advisory and withheld until each interview is completed.
    const reviewableInterviews = interviews.map(discloseIntegrityAfterCompletion);
    res.json({
      candidate,
      score,
      interviews: reviewableInterviews,
      github: profile?.github || null,
      resume: profile?.resume || null,
      skillMatch: profile?.skillMatch || null,
    });
  } catch (e) { next(e); }
});

function generateFallbackFeedback(jobTitle, decision, interviewNotes, hasCompletedInterview = false) {
  if (hasCompletedInterview) {
    if (decision === 'selected') {
      return `Thank you for taking the time to complete your technical interview for the ${jobTitle} position. The hiring team was impressed with your technical problem solving and communication. ${interviewNotes ? `In particular: ${interviewNotes}. ` : ''}We look forward to moving forward with the next steps in our hiring process.`;
    }
    return `Thank you for interviewing for the ${jobTitle} role. We appreciated the opportunity to review your technical work and discussion. ${interviewNotes ? `The team noted: ${interviewNotes}. ` : ''}While we have decided not to advance your candidacy at this time, we encourage you to keep developing your portfolio and consider future openings with us.`;
  }
  // Application / CV screening stage - candidate has not completed an interview
  if (decision === 'selected') {
    return `Thank you for applying for the ${jobTitle} position. Following our review of your application, resume credentials, and technical background, we are pleased to advance you to the next stage of our recruitment process. ${interviewNotes ? `Notes: ${interviewNotes}. ` : ''}Our team will be in touch shortly with interview scheduling details.`;
  }
  return `Thank you for your interest in the ${jobTitle} position. After reviewing your resume and technical qualifications against our current requirements, we have decided to move forward with other candidates whose profiles align more closely with our immediate needs. ${interviewNotes ? `Notes: ${interviewNotes}. ` : ''}We appreciate your time and wish you success in your job search.`;
}

// Generate + store feedback after a decision (recruiter)
router.post('/:id/feedback', validId, requireRole('recruiter', 'admin'), async (req, res, next) => {
  try {
    const { jobId, decision, interviewNotes = '' } = req.body;
    if (!mongoose.isValidObjectId(jobId) || !['selected', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'jobId and decision (selected|rejected) are required' });
    }
    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (req.user.role !== 'admin' && String(job.recruiterId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'Not your job' });
    }

    // Verify candidate has an active relationship to this job or recruiter
    const [application, score, profile] = await Promise.all([
      JobApplication.findOne({ candidateId: req.params.id, jobId }),
      ScoreRecord.findOne({ candidateId: req.params.id, jobId }).sort('-createdAt'),
      CandidateProfile.findOne({ candidateId: req.params.id }).select('uploadedBy'),
    ]);

    const interview = await Interview.findOne({
      candidateId: req.params.id,
      ...(req.user.role === 'admin' ? {} : { recruiterId: req.user.sub }),
      status: 'completed',
    }).sort('-completedAt');

    const hasInterviewForJob = await Interview.exists({
      candidateId: req.params.id,
      ...(req.user.role === 'admin' ? {} : { recruiterId: req.user.sub }),
      jobTitle: job.title,
    });

    const isUploadedByRecruiter = profile && String(profile.uploadedBy) === String(req.user.sub);
    const hasRelationship = Boolean(application || hasInterviewForJob || score || isUploadedByRecruiter);
    if (!hasRelationship) {
      return res.status(404).json({ error: 'Candidate has not applied or been evaluated for this job' });
    }

    const breakdown = score?.breakdown
      ? (score.breakdown.toObject ? score.breakdown.toObject() : score.breakdown)
      : null;

    const hasCompletedInterview = Boolean(interview);

    let feedbackText;
    try {
      const aiRes = await fetch(`${AI_SERVICE_URL}/feedback/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': process.env.INTERNAL_SERVICE_KEY || 'hirelens-internal-shared-secret-dev',
        },
        body: JSON.stringify({
          jobTitle: job.title,
          decision,
          breakdown,
          interviewNotes: String(interviewNotes).slice(0, 3000),
          hasCompletedInterview,
        }),
      });
      const body = await aiRes.json().catch(() => ({}));
      if (aiRes.ok && typeof body.feedback === 'string' && body.feedback.trim()) {
        feedbackText = body.feedback.trim();
        // Strict invariant check: if candidate never completed an interview, purge any hallucinated interview phrases
        if (!hasCompletedInterview && (/throughout\s+(?:the|your)\s+interview/i.test(feedbackText) || /during\s+(?:the|your)\s+interview/i.test(feedbackText))) {
          feedbackText = generateFallbackFeedback(job.title, decision, interviewNotes, false);
        }
      } else {
        feedbackText = generateFallbackFeedback(job.title, decision, interviewNotes, hasCompletedInterview);
      }
    } catch {
      feedbackText = generateFallbackFeedback(job.title, decision, interviewNotes, hasCompletedInterview);
    }

    const fb = await Feedback.findOneAndUpdate(
      { candidateId: req.params.id, jobId },
      { recruiterId: req.user.sub, decision, text: feedbackText },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(fb);
  } catch (e) {
    next(e);
  }
});

// Candidate reads their own feedback; recruiters can read too
router.get('/:id/feedback', validId, async (req, res, next) => {
  try {
    const isSelf = String(req.user.sub) === req.params.id;
    if (!isSelf && !['recruiter', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const filter = isSelf && ['recruiter', 'admin'].includes(req.user.role)
      ? (req.user.role === 'admin' ? {} : { recruiterId: req.user.sub })
      : {
          candidateId: req.params.id,
          ...(req.user.role === 'recruiter' ? { recruiterId: req.user.sub } : {}),
        };
    res.json(await Feedback.find(filter)
      .populate('jobId', 'title')
      .populate('candidateId', 'name email')
      .select('-recruiterId')
      .sort('-createdAt'));
  } catch (e) { next(e); }
});

module.exports = router;

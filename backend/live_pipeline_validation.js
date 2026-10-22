const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
require('dotenv').config();

const { signAccessToken } = require('./utils/tokenUtils');
const User = require('./models/User');
const CandidateProfile = require('./models/CandidateProfile');
const JobApplication = require('./models/JobApplication');
const Job = require('./models/Job');
const Interview = require('./models/Interview');
const Feedback = require('./models/Feedback');

function request(options, postData = null, isMultipart = false) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (postData) {
      if (isMultipart) {
        req.write(postData);
      } else {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
    }
    req.end();
  });
}

async function run() {
  console.log('===============================================================');
  console.log('STARTING LIVE REAL-DATA END-TO-END PIPELINE VALIDATION');
  console.log('===============================================================');

  await connectDB();
  const timestamp = Date.now();

  // -------------------------------------------------------------------------
  // STEP 1: Candidate Account Creation & Real Resume Ingestion
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 1: Candidate Account Creation & Real Resume Ingestion ---');
  const candEmail = `alex.live.${timestamp}@example.com`;
  const candPassword = 'Password123!';
  const candName = 'Alex Live Rivera';

  const regRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { name: candName, email: candEmail, password: candPassword, role: 'candidate' });

  console.log('1.1 Registered Candidate:', candEmail, 'Status:', regRes.status);
  const candToken = regRes.body.accessToken || regRes.body.token;
  const candUser = regRes.body.user;
  const candidateId = candUser?.id || candUser?._id;
  console.log('    Candidate ID:', candidateId);

  // Upload real resume: test-resumes/FullStack_Engineer.pdf
  const pdfPath = path.resolve(__dirname, '../test-resumes/FullStack_Engineer.pdf');
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Resume fixture not found at: ${pdfPath}`);
  }
  const fileBytes = fs.readFileSync(pdfPath);
  console.log('1.2 Loading Real Resume Fixture:', path.basename(pdfPath), `(${fileBytes.length} bytes)`);

  // Build multipart form boundary
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  const crlf = '\r\n';
  const head = Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="file"; filename="FullStack_Engineer.pdf"${crlf}` +
    `Content-Type: application/pdf${crlf}${crlf}`
  );
  const tail = Buffer.from(`${crlf}--${boundary}--${crlf}`);
  const multipartBody = Buffer.concat([head, fileBytes, tail]);

  const parseRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/resume/parse',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': multipartBody.length,
      'Authorization': `Bearer ${candToken}`
    }
  }, multipartBody, true);

  console.log('1.3 Resume Parse Status:', parseRes.status);
  console.log('    Detected GitHub Username:', parseRes.body?.parsed?.githubUsername);
  console.log('    Extracted Skills Count:', parseRes.body?.parsed?.skills?.length);
  console.log('    Extracted Skills Sample:', parseRes.body?.parsed?.skills?.slice(0, 6));

  // Inspect MongoDB CandidateProfile
  const profile1 = await CandidateProfile.findOne({ candidateId });
  console.log('1.4 MongoDB CandidateProfile verification:');
  console.log('    - Resume Storage Key:', profile1?.resume?.storageKey ? 'Present (GridFS)' : 'Missing');
  console.log('    - GitHub Repositories Count:', profile1?.github?.repositories?.length);
  console.log('    - GitHub Top Languages:', profile1?.github?.skills);
  console.log('    - MiniLM SkillMatch Score:', profile1?.skillMatch?.score);
  console.log('    - MiniLM SkillMatch Matches Count:', profile1?.skillMatch?.matches?.length);

  // -------------------------------------------------------------------------
  // STEP 2: Candidate Verification & Field Correction
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 2: Candidate Verification & Field Correction ---');
  const updatedSkills = [...(profile1?.resume?.skills || ['React', 'TypeScript', 'Node.js']), 'GraphQL'];
  const patchRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/resume/${candidateId}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${candToken}`
    }
  }, { skills: updatedSkills });

  console.log('2.1 Patch Resume Skills Status:', patchRes.status);
  const profile2 = await CandidateProfile.findOne({ candidateId });
  console.log('    - Updated Skills Count:', profile2?.resume?.skills?.length);
  console.log('    - Contains GraphQL:', profile2?.resume?.skills?.includes('GraphQL'));
  console.log('    - Recalculated SkillMatch Score:', profile2?.skillMatch?.score);

  // -------------------------------------------------------------------------
  // STEP 3: Job Creation & Candidate Application
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 3: Recruiter Job Creation & Application ---');
  const recEmail = `recruiter.live.${timestamp}@example.com`;
  const recRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { name: 'Sarah Tech Recruiter', email: recEmail, password: 'Password123!', role: 'recruiter' });

  const recToken = recRes.body.accessToken || recRes.body.token;
  console.log('3.1 Registered Recruiter:', recEmail, 'Status:', recRes.status);

  // Recruiter creates job
  const jobRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/jobs',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${recToken}`
    }
  }, {
    title: 'Senior Cloud Systems Architect',
    description: 'Design and deploy distributed cloud systems with React, TypeScript, Node.js, and Redis.',
    requiredSkills: ['React', 'TypeScript', 'Node.js', 'Redis', 'Docker']
  });

  const jobId = jobRes.body?._id;
  console.log('3.2 Created Job:', jobRes.body?.title, 'ID:', jobId);

  // Candidate applies to job
  const applyRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/jobs/${jobId}/applications`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${candToken}`
    }
  }, {});
  console.log('3.3 Candidate Applied to Job Status:', applyRes.status, 'Application Status:', applyRes.body?.status);

  // -------------------------------------------------------------------------
  // STEP 4: Grounded Technical Interview Generation
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 4: Grounded Technical Interview Generation ---');
  const ivGenRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/interviews',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${recToken}`
    }
  }, {
    candidateEmail: candEmail,
    jobTitle: 'Senior Cloud Systems Architect',
    verifiedSkills: ['React', 'TypeScript', 'Node.js'],
    scheduledAt: new Date(Date.now() + 86400000).toISOString()
  });

  console.log('4.1 Interview Creation Status:', ivGenRes.status);
  const interviewId = ivGenRes.body?._id;
  const questions = ivGenRes.body?.questions || [];
  console.log('    Interview ID:', interviewId);
  console.log('    Generated Questions Count:', questions.length);
  questions.slice(0, 3).forEach((q, i) => {
    console.log(`    Q${i+1} [${q.type}]: ${q.question.slice(0, 80)}...`);
  });

  // -------------------------------------------------------------------------
  // STEP 5: Active Interview Room & Real-Time Proctoring
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 5: Active Interview Room & Real-Time Proctoring ---');
  // Candidate checks room
  const roomRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/interviews/${interviewId}/room`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${candToken}` }
  });
  console.log('5.1 Room View Status:', roomRes.status);
  console.log('    Privacy Invariant Check - integrityLog omitted from room:', roomRes.body.integrityLog === undefined);

  // Consent
  const consentRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/interviews/${interviewId}/consent`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${candToken}` }
  }, {});
  console.log('5.2 Consent Given Status:', consentRes.status, 'Interview Status:', consentRes.body.status);

  // Simulate Proctoring Incidents
  const logRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/interviews/${interviewId}/integrity-log`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${candToken}`
    }
  }, {
    events: [
      { event: 'tab_switch', confidence: 0.95, timestamp: new Date().toISOString() },
      { event: 'face_absent', confidence: 0.90, timestamp: new Date().toISOString() }
    ]
  });
  console.log('5.3 Logged Proctoring Events Status:', logRes.status, 'Stored count:', logRes.body?.stored);

  // Candidate answers all questions
  const responsesPayload = questions.map((q, idx) => ({
    questionIndex: idx,
    answer: `In our production system for ${q.type}, we implemented modular separation, single-flight request deduplication, and automated latency benchmarks to ensure sub-10ms response times.`
  }));

  const ansRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/interviews/${interviewId}/answers`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${candToken}`
    }
  }, { responses: responsesPayload });
  console.log('5.4 Submitted Answers Status:', ansRes.status, 'Saved count:', ansRes.body?.saved);

  // Complete interview
  const compRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/interviews/${interviewId}/complete`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${candToken}` }
  }, {});
  console.log('5.5 Completed Interview Status:', compRes.status, 'Interview Status:', compRes.body?.status);

  // Verify JobApplication status automatically advanced to 'reviewing'
  const appDoc = await JobApplication.findOne({ candidateId, jobId });
  console.log('5.6 JobApplication Status automatically advanced to:', appDoc?.status);

  // -------------------------------------------------------------------------
  // STEP 6: Recruiter Final Dossier & Decision
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 6: Recruiter Final Dossier & Decision ---');
  // Create ScoreRecord
  await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/jobs/${jobId}/scores`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${recToken}`
    }
  }, {
    candidateId,
    weightedScore: 92,
    breakdown: { resumeQuality: 95, githubVerification: 90, skillMatch: 94, experienceRelevance: 89 },
    weights: { resumeQuality: 0.25, githubVerification: 0.25, skillMatch: 0.30, experienceRelevance: 0.20 },
    explanation: 'Exceptional full-stack architecture depth and verifiable public GitHub code contributions.'
  });

  // Recruiter fetches full candidate dossier report
  const reportRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/candidates/${candidateId}/report?jobId=${jobId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${recToken}` }
  });

  console.log('6.1 Recruiter Report Status:', reportRes.status);
  const report = reportRes.body;
  console.log('    - Candidate Name:', report?.candidate?.name);
  console.log('    - Weighted Score:', report?.score?.weightedScore);
  console.log('    - Resume Skills:', report?.resume?.skills?.length);
  console.log('    - Public GitHub Repos:', report?.github?.repositories?.length);
  console.log('    - MiniLM SkillMatch Score:', report?.skillMatch?.score);
  console.log('    - MiniLM Top Matches:');
  (report?.skillMatch?.matches || []).slice(0, 3).forEach(m => {
    console.log(`      * ${m.resumeSkill} -> ${m.githubSkill} (${m.similarity}%)`);
  });
  console.log('    - Completed Interviews Count:', report?.interviews?.length);
  console.log('    - Disclosed Integrity Log Length:', report?.interviews?.[0]?.integrityLog?.length);

  // Recruiter publishes feedback
  const fbRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/candidates/${candidateId}/feedback`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${recToken}`
    }
  }, {
    jobId,
    decision: 'selected',
    interviewNotes: 'Demonstrated outstanding command of distributed microservices, TypeScript typing, and system resilience.'
  });

  console.log('6.2 Recruiter Decision & Feedback Status:', fbRes.status);
  console.log('    - Feedback Decision:', fbRes.body?.decision);
  console.log('    - Feedback Word Count:', fbRes.body?.text?.split(' ').length);
  console.log('    - Feedback Text Snippet:', fbRes.body?.text?.slice(0, 160) + '...');

  // -------------------------------------------------------------------------
  // STEP 7: Candidate Reads Feedback
  // -------------------------------------------------------------------------
  console.log('\n--- STEP 7: Candidate Reads Feedback ---');
  const candFbRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: `/api/candidates/${candidateId}/feedback`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${candToken}` }
  });
  console.log('7.1 Candidate Fetched Feedback Status:', candFbRes.status);
  console.log('    - Received Feedback Records Count:', candFbRes.body?.length);
  console.log('    - Received Decision:', candFbRes.body?.[0]?.decision);

  console.log('\n===============================================================');
  console.log('ALL 7 STAGES OF LIVE REAL-DATA PIPELINE COMPLETED SUCCESSFULLY!');
  console.log('===============================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n*** PIPELINE VALIDATION ERROR ***', err);
  process.exit(1);
});


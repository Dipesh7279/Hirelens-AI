const dns = require('dns');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('./config/db');
require('dotenv').config();

const User = require('./models/User');
const Job = require('./models/Job');
const JobApplication = require('./models/JobApplication');
const CandidateProfile = require('./models/CandidateProfile');
const Interview = require('./models/Interview');
const ScoreRecord = require('./models/ScoreRecord');
const Feedback = require('./models/Feedback');

async function seed() {
  await connectDB();
  console.log('Connected to MongoDB. Starting demo data seed...');

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Recruiter user
  let recruiter = await User.findOne({ email: 'recruiter@hirelens.ai' });
  if (!recruiter) {
    recruiter = await User.create({
      name: 'Sarah Connor',
      email: 'recruiter@hirelens.ai',
      password: 'Password123!',
      role: 'recruiter',
    });
    console.log('Created recruiter: recruiter@hirelens.ai');
  } else {
    recruiter.password = 'Password123!';
    recruiter.name = 'Sarah Connor';
    await recruiter.save();
    console.log('Updated recruiter: recruiter@hirelens.ai');
  }

  // 2. Candidate 1: Alex Rivera (Senior Full-Stack, Strong Hire)
  let cand1 = await User.findOne({ email: 'alex.rivera@example.com' });
  if (!cand1) {
    cand1 = await User.create({
      name: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      password: 'Password123!',
      role: 'candidate',
    });
    console.log('Created candidate 1: alex.rivera@example.com');
  } else {
    cand1.password = 'Password123!';
    await cand1.save();
  }

  // 3. Candidate 2: Elena Rostova (ML / AI Engineer, Review Needed)
  let cand2 = await User.findOne({ email: 'elena.rostova@example.com' });
  if (!cand2) {
    cand2 = await User.create({
      name: 'Elena Rostova',
      email: 'elena.rostova@example.com',
      password: 'Password123!',
      role: 'candidate',
    });
    console.log('Created candidate 2: elena.rostova@example.com');
  } else {
    cand2.password = 'Password123!';
    await cand2.save();
  }

  // 4. Jobs owned by Sarah Connor
  let job1 = await Job.findOne({ recruiterId: recruiter._id, title: 'Senior Full Stack Lead' });
  if (!job1) {
    job1 = await Job.create({
      recruiterId: recruiter._id,
      title: 'Senior Full Stack Lead',
      description: 'Lead a high-throughput microservices team using React, TypeScript, Node.js, and Redis.',
      requiredSkills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'Redis'],
      status: 'open',
    });
    console.log('Created job 1: Senior Full Stack Lead');
  }

  let job2 = await Job.findOne({ recruiterId: recruiter._id, title: 'Lead Machine Learning Engineer' });
  if (!job2) {
    job2 = await Job.create({
      recruiterId: recruiter._id,
      title: 'Lead Machine Learning Engineer',
      description: 'Design and deploy scalable computer vision and LLM agent pipelines using FastAPI and PyTorch.',
      requiredSkills: ['Python', 'FastAPI', 'PyTorch', 'Scikit-Learn', 'Redis', 'Docker'],
      status: 'open',
    });
    console.log('Created job 2: Lead Machine Learning Engineer');
  }

  // 5. Job Applications
  await JobApplication.deleteMany({ jobId: { $in: [job1._id, job2._id] } });
  const app1 = await JobApplication.create({
    jobId: job1._id,
    candidateId: cand1._id,
    status: 'reviewing',
  });
  const app2 = await JobApplication.create({
    jobId: job1._id,
    candidateId: cand2._id,
    status: 'reviewing',
  });
  console.log('Created job applications');

  // 6. Candidate 1 Profile & GitHub Evidence
  await CandidateProfile.deleteMany({ candidateId: { $in: [cand1._id, cand2._id] } });
  await CandidateProfile.create({
    candidateId: cand1._id,
    uploadedBy: cand1._id,
    resume: {
      fileName: 'FullStack_Engineer.pdf',
      githubUsername: 'yyx990803',
      skills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'Redis', 'GraphQL', 'AWS'],
      education: [{ degree: 'B.S. Computer Science', institute: 'University of California, Berkeley', year: '2019' }],
      experience: [
        { role: 'Staff Software Engineer', company: 'CloudCore Systems', duration: '2022 - Present' },
        { role: 'Senior Full-Stack Developer', company: 'NextWave Labs', duration: '2019 - 2022' }
      ],
      projects: [
        {
          title: 'distributed-cache-mesh',
          description: 'High-throughput in-memory cache clustering layer built with Node.js and Redis streams.',
          techStack: ['Node.js', 'TypeScript', 'Redis', 'Docker']
        },
        {
          title: 'reactive-ui-toolkit',
          description: 'Zero-dependency reactive UI component library optimized for virtual DOM performance.',
          techStack: ['React', 'TypeScript', 'CSS3']
        }
      ],
      authenticityScore: 94,
      flags: ['Clean original formatting detected; technical terminology is contextually grounded.'],
      parsedAt: new Date(),
    },
    github: {
      username: 'yyx990803',
      skills: ['TypeScript', 'JavaScript', 'HTML', 'CSS'],
      repositories: [
        {
          name: 'reactive-ui-toolkit',
          description: 'High-performance reactive frontend component framework and runtime',
          repositoryUrl: 'https://github.com/yyx990803/reactive-ui-toolkit',
          ownerLogin: 'yyx990803',
          languages: { TypeScript: 84.5, JavaScript: 15.5 },
          activityWindowDays: 90,
          recentCommitCount: 38,
          recentCommitCountCapped: false,
          hasRecentCommit: true,
          lastCommit: new Date().toISOString(),
          isFork: false,
          forksCount: 412,
        },
        {
          name: 'distributed-cache-mesh',
          description: 'Distributed memory caching and consensus synchronization engine',
          repositoryUrl: 'https://github.com/yyx990803/distributed-cache-mesh',
          ownerLogin: 'yyx990803',
          languages: { TypeScript: 92.1, Shell: 7.9 },
          activityWindowDays: 90,
          recentCommitCount: 22,
          recentCommitCountCapped: false,
          hasRecentCommit: true,
          lastCommit: new Date().toISOString(),
          isFork: false,
          forksCount: 88,
        }
      ],
      analysisLimits: {
        publicRepositoriesOnly: true,
        repositoryLimit: 15,
        repositoriesTruncated: false,
        commitWindowDays: 90,
        commitSampleLimit: 100,
        commitActivityScope: 'repository_recent_commits',
      },
      cachedAt: new Date(),
    },
    skillMatch: {
      score: 88.6,
      matches: [
        { resumeSkill: 'TypeScript', githubSkill: 'TypeScript', similarity: 100.0 },
        { resumeSkill: 'React', githubSkill: 'JavaScript', similarity: 86.4 },
        { resumeSkill: 'Node.js', githubSkill: 'JavaScript', similarity: 89.2 },
        { resumeSkill: 'PostgreSQL', githubSkill: 'Shell', similarity: 72.1 },
        { resumeSkill: 'Docker', githubSkill: 'Shell', similarity: 81.5 },
        { resumeSkill: 'Redis', githubSkill: 'TypeScript', similarity: 78.4 },
        { resumeSkill: 'GraphQL', githubSkill: 'TypeScript', similarity: 84.3 },
      ],
      computedAt: new Date(),
    }
  });

  // Candidate 2 Profile & GitHub Evidence
  await CandidateProfile.create({
    candidateId: cand2._id,
    uploadedBy: cand2._id,
    resume: {
      fileName: 'Python_AI_Engineer.docx',
      githubUsername: 'octocat',
      skills: ['Python', 'FastAPI', 'PyTorch', 'Scikit-Learn', 'Redis', 'Docker', 'Pandas'],
      education: [{ degree: 'M.S. Data Science & Machine Learning', institute: 'Georgia Tech', year: '2021' }],
      experience: [
        { role: 'Senior Machine Learning Engineer', company: 'Cognitive Dynamics', duration: '2021 - Present' }
      ],
      projects: [
        {
          title: 'realtime-anomaly-detector',
          description: 'Real-time time-series anomaly detection microservice with PyTorch and FastAPI.',
          techStack: ['Python', 'FastAPI', 'PyTorch', 'Redis']
        }
      ],
      authenticityScore: 88,
      flags: ['Clean technical structure; substantiated machine learning pipeline architecture.'],
      parsedAt: new Date(),
    },
    github: {
      username: 'octocat',
      skills: ['Python', 'Ruby', 'HTML'],
      repositories: [
        {
          name: 'realtime-anomaly-detector',
          description: 'Streaming inference API for sensor timeseries telemetry',
          repositoryUrl: 'https://github.com/octocat/realtime-anomaly-detector',
          ownerLogin: 'octocat',
          languages: { Python: 96.0, Shell: 4.0 },
          activityWindowDays: 90,
          recentCommitCount: 19,
          recentCommitCountCapped: false,
          hasRecentCommit: true,
          lastCommit: new Date().toISOString(),
          isFork: false,
          forksCount: 34,
        }
      ],
      analysisLimits: {
        publicRepositoriesOnly: true,
        repositoryLimit: 15,
        repositoriesTruncated: false,
        commitWindowDays: 90,
        commitSampleLimit: 100,
        commitActivityScope: 'repository_recent_commits',
      },
      cachedAt: new Date(),
    },
    skillMatch: {
      score: 84.2,
      matches: [
        { resumeSkill: 'Python', githubSkill: 'Python', similarity: 100.0 },
        { resumeSkill: 'FastAPI', githubSkill: 'Python', similarity: 89.5 },
        { resumeSkill: 'PyTorch', githubSkill: 'Python', similarity: 92.1 },
        { resumeSkill: 'Scikit-Learn', githubSkill: 'Python', similarity: 88.0 },
        { resumeSkill: 'Redis', githubSkill: 'Ruby', similarity: 64.3 },
        { resumeSkill: 'Docker', githubSkill: 'Ruby', similarity: 65.0 },
        { resumeSkill: 'Pandas', githubSkill: 'Python', similarity: 90.5 },
      ],
      computedAt: new Date(),
    }
  });
  console.log('Created candidate profiles');

  // 7. Score Records
  await ScoreRecord.deleteMany({ jobId: job1._id });
  await ScoreRecord.create({
    candidateId: cand1._id,
    jobId: job1._id,
    weightedScore: 91,
    breakdown: {
      resumeQuality: 94,
      githubVerification: 89,
      skillMatch: 95,
      experienceRelevance: 88,
    },
    weights: {
      resumeQuality: 0.25,
      githubVerification: 0.25,
      skillMatch: 0.30,
      experienceRelevance: 0.20,
    },
    explanation: 'Candidate exhibits exceptional mastery of React 19 internals, TypeScript type systems, and distributed caching architectures. Strong public GitHub evidence supports claimed production experience.',
    biasAuditFlags: [],
    biasAuditStatus: 'not_performed',
  });

  await ScoreRecord.create({
    candidateId: cand2._id,
    jobId: job1._id,
    weightedScore: 72,
    breakdown: {
      resumeQuality: 88,
      githubVerification: 70,
      skillMatch: 65,
      experienceRelevance: 68,
    },
    weights: {
      resumeQuality: 0.25,
      githubVerification: 0.25,
      skillMatch: 0.30,
      experienceRelevance: 0.20,
    },
    explanation: 'Candidate has strong machine learning and Python fundamentals. Some frontend full-stack skills require deeper evaluation.',
    biasAuditFlags: [],
    biasAuditStatus: 'not_performed',
  });
  console.log('Created score records');

  // 8. Interviews with Questions, Answers, and Sealed Proctoring Logs
  await Interview.deleteMany({ recruiterId: recruiter._id });
  const interview1 = await Interview.create({
    candidateId: cand1._id,
    recruiterId: recruiter._id,
    jobTitle: 'Senior Full Stack Lead',
    jobDescription: 'Lead a high-throughput microservices team using React, TypeScript, Node.js, and Redis.',
    scheduledAt: new Date(Date.now() - 3600000),
    status: 'completed',
    consentGivenAt: new Date(Date.now() - 3500000),
    startedAt: new Date(Date.now() - 3400000),
    completedAt: new Date(Date.now() - 1200000),
    questions: [
      {
        type: 'technical',
        question: 'Explain how React 19 handles asynchronous action transitions and compiler-driven memoization compared to manual useMemo hooks.',
        expectedFocus: 'useActionState, React compiler, reconciliation performance'
      },
      {
        type: 'project',
        question: 'In your distributed-cache-mesh repository, what strategy did you use to prevent cache stampedes and handle node replication desynchronization?',
        expectedFocus: 'Mutual exclusion locks, probabilistic early expiration, Redis stream replication'
      },
      {
        type: 'behavioral',
        question: 'Describe how you resolved an architectural deadlock in your engineering team when choosing between GraphQL and REST for microservice communication.',
        expectedFocus: 'Pragmatic benchmarks, developer velocity, contract stability'
      }
    ],
    responses: [
      {
        questionIndex: 0,
        answer: 'React 19 compiler automatically detects dependencies and inserts memoization primitives during build time, eliminating the overhead of manual dependency arrays. useActionState manages pending transition lifecycles natively without manual state setters.',
        updatedAt: new Date(Date.now() - 2500000)
      },
      {
        questionIndex: 1,
        answer: 'We implemented single-flight request coalescing and XADD Redis streams for cross-datacenter replication, ensuring cache misses are collapsed into single origin queries and preventing stampedes.',
        updatedAt: new Date(Date.now() - 1800000)
      },
      {
        questionIndex: 2,
        answer: 'I set up an empirical latency benchmark and prototype service schema. We chose REST for high-throughput public endpoints and GraphQL for dynamic mobile clients, achieving unanimous team alignment.',
        updatedAt: new Date(Date.now() - 1300000)
      }
    ],
    integrityLog: [
      {
        timestamp: new Date(Date.now() - 2800000),
        event: 'tab_switch',
        confidence: 0.95
      },
      {
        timestamp: new Date(Date.now() - 2100000),
        event: 'face_absent',
        confidence: 0.90
      }
    ]
  });

  const interview2 = await Interview.create({
    candidateId: cand2._id,
    recruiterId: recruiter._id,
    jobTitle: 'Senior Full Stack Lead',
    jobDescription: 'Lead a high-throughput microservices team using React, TypeScript, Node.js, and Redis.',
    scheduledAt: new Date(Date.now() - 7200000),
    status: 'completed',
    consentGivenAt: new Date(Date.now() - 7100000),
    startedAt: new Date(Date.now() - 7000000),
    completedAt: new Date(Date.now() - 5000000),
    questions: [
      {
        type: 'technical',
        question: 'How do you optimize FastAPI async worker concurrency when handling CPU-bound PyTorch tensor operations?',
        expectedFocus: 'ProcessPoolExecutor, thread offloading, model batching'
      }
    ],
    responses: [
      {
        questionIndex: 0,
        answer: 'We separate the I/O async event loop from tensor calculations using ProcessPoolExecutor workers and dynamic batching.',
        updatedAt: new Date(Date.now() - 5500000)
      }
    ],
    integrityLog: [
      {
        timestamp: new Date(Date.now() - 6200000),
        event: 'phone_detected',
        confidence: 0.88
      }
    ]
  });
  console.log('Created interviews with sealed integrity logs');

  // 9. Feedback Record
  await Feedback.deleteMany({ jobId: job1._id });
  await Feedback.create({
    candidateId: cand1._id,
    jobId: job1._id,
    recruiterId: recruiter._id,
    decision: 'selected',
    text: 'Congratulations! We are delighted to recommend you for the Senior Full Stack Lead role. Your interview demonstrated exceptional command of modern React architecture and distributed caching systems. Your public GitHub repositories provided strong corroborating evidence for your architectural claims.',
  });
  console.log('Created feedback record');

  console.log('\n========================================');
  console.log('DEMO DATA SEEDED SUCCESSFULLY!');
  console.log('========================================');
  console.log('Recruiter Login:');
  console.log('  Email:    recruiter@hirelens.ai');
  console.log('  Password: Password123!');
  console.log('Candidate 1 Login:');
  console.log('  Email:    alex.rivera@example.com');
  console.log('  Password: Password123!');
  console.log('Candidate 2 Login:');
  console.log('  Email:    elena.rostova@example.com');
  console.log('  Password: Password123!');
  console.log('========================================\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});

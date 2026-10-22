const mongoose = require('mongoose');

const githubRepositorySchema = new mongoose.Schema({
  name: String,
  description: String,
  repositoryUrl: String,
  ownerLogin: String,
  languages: { type: Map, of: Number },
  activityWindowDays: Number,
  recentCommitCount: Number,
  recentCommitCountCapped: Boolean,
  hasRecentCommit: Boolean,
  lastCommit: String,
  isFork: Boolean,
  forkedFrom: String,
  forksCount: Number,
}, { _id: false });

const githubAnalysisLimitsSchema = new mongoose.Schema({
  publicRepositoriesOnly: Boolean,
  repositoryLimit: Number,
  repositoriesTruncated: Boolean,
  commitWindowDays: Number,
  commitSampleLimit: Number,
  commitActivityScope: String,
}, { _id: false });

const skillMatchItemSchema = new mongoose.Schema({
  resumeSkill: String,
  githubSkill: String,
  similarity: Number,
}, { _id: false });

const skillMatchSchema = new mongoose.Schema({
  score: Number,
  matches: [skillMatchItemSchema],
  computedAt: Date,
}, { _id: false });

const profileSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resume: {
      fileName: String,
      storageKey: String,
      mimeType: String,
      fileSize: Number,
      githubUsername: String,
      githubConfirmedAt: Date,
      skills: [String],
      education: [{ degree: String, institute: String, year: String, _id: false }],
      experience: [{ role: String, company: String, duration: String, _id: false }],
      projects: [{ title: String, description: String, techStack: [String], _id: false }],
      authenticityScore: Number,
      flags: [String],
      parsingMode: String,
      parsedAt: Date,
      confirmedAt: Date,
    },
    github: {
      username: String,
      skills: [String],
      repositories: [githubRepositorySchema],
      analysisLimits: githubAnalysisLimitsSchema,
      advisoryNotice: String,
      analyzedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      analyzedAt: Date,
    },
    skillMatch: skillMatchSchema,
  },
  { timestamps: true }
);

module.exports = mongoose.model('CandidateProfile', profileSchema);

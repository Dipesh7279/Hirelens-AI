const mongoose = require('mongoose');

const EVENT_TYPES = ['multiple_faces', 'face_absent', 'phone_detected', 'looking_away', 'tab_switch'];

const interviewSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    jobTitle: { type: String, required: true, trim: true, maxlength: 120 },
    jobDescription: { type: String, default: '', maxlength: 4000 },

    // Module 5
    questions: [
      {
        type: { type: String, enum: ['technical', 'project', 'behavioral'] },
        question: String,
        expectedFocus: String,
        _id: false,
      },
    ],
    // Whether questions came from the AI generator or the deterministic template fallback
    questionSource: { type: String, enum: ['ai', 'fallback'], default: 'ai' },
    responses: [
      {
        questionIndex: { type: Number, required: true, min: 0 },
        answer: { type: String, maxlength: 10000, default: '' },
        updatedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    scheduledAt: Date,
    status: { type: String, enum: ['scheduled', 'in_progress', 'completed'], default: 'scheduled' },

    // Module 6 - kept apart from ScoreRecord on purpose: integrity flags must never feed the hiring score
    consentGivenAt: Date,
    startedAt: Date,
    completedAt: Date,
    framesAnalyzed: { type: Number, default: 0, min: 0 },
    integrityLog: [
      {
        timestamp: { type: Date, default: Date.now },
        event: { type: String, enum: EVENT_TYPES, required: true },
        confidence: { type: Number, min: 0, max: 1, default: 1 },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Interview', interviewSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;

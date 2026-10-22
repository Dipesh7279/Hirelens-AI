const mongoose = require('mongoose');

const jobApplicationSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
  status: {
    type: String,
    enum: ['applied', 'reviewing', 'interview', 'rejected', 'offered'],
    default: 'applied',
  },
  appealStatus: {
    type: String,
    enum: ['none', 'requested', 'reviewed'],
    default: 'none',
  },
  appealReason: { type: String, default: null },
  appealedAt: { type: Date, default: null },
  humanReviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  humanReviewNotes: { type: String, default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

jobApplicationSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);

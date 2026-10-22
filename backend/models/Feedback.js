const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    decision: { type: String, enum: ['selected', 'rejected'], required: true },
    text: { type: String, required: true },
  },
  { timestamps: true }
);
feedbackSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
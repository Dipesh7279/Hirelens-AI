const mongoose = require('mongoose');

module.exports = mongoose.model(
  'Job',
  new mongoose.Schema(
    {
      recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      title: { type: String, required: true, trim: true, maxlength: 120 },
      description: { type: String, default: '', maxlength: 4000 },
      requiredSkills: [String],
      status: { type: String, enum: ['open', 'closed'], default: 'open' },
    },
    { timestamps: true }
  )
);
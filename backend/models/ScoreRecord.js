const mongoose = require("mongoose");


const scoreRecordSchema =
  new mongoose.Schema(

    {
      candidateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Job",
        required: true,
      },

      weightedScore: { type: Number, min: 0, max: 100, required: true },

      breakdown: {
        resumeQuality: Number,
        githubVerification: Number,
        skillMatch: Number,
        experienceRelevance: Number
      },

      weights: {
        resumeQuality: Number,
        githubVerification: Number,
        skillMatch: Number,
        experienceRelevance: Number
      },

      explanation: String,

      biasAuditFlags: {
        type: [String],
        default: []
      },

      biasAuditStatus: {
        type: String,
        enum: ['not_performed', 'completed'],
        default: 'not_performed'
      }
    },

    {
      timestamps: true
    }
  );


module.exports =
  mongoose.model(
    "ScoreRecord",
    scoreRecordSchema
  );

const mongoose = require("mongoose");

const repositorySchema = new mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Candidate"
    },

    username: String,

    repoName: String,

    languages: {
      type: Map,
      of: Number
    },

    commitCount: {
      type: Number,
      default: 0
    },

    lastCommit: Date,

    isFork: {
      type: Boolean,
      default: false
    },

    originalityScore: {
      type: Number,
      default: 0
    },

    readmeQuality: {
      type: Number,
      default: 0
    }
  },

  {
    timestamps: true
  }
);


module.exports =
  mongoose.model(
    "Repository",
    repositorySchema
  );
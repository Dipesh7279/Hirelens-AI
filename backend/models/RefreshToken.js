const mongoose = require('mongoose');

/**
 * Stores a HASH of each issued refresh token (never the raw token).
 * Enables rotation: each refresh consumes the old token and issues a new one.
 * `replacedBy` + `revoked` allow reuse detection — if a revoked/consumed
 * token is presented again, we can detect theft and revoke the whole family.
 */
const RefreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    family: {
      type: String, // shared id across a rotation chain, for reuse detection
      required: true,
      index: true,
    },
    revoked: {
      type: Boolean,
      default: false,
    },
    replacedByHash: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    userAgent: String,
    ip: String,
  },
  { timestamps: true }
);

// TTL index — MongoDB automatically purges expired refresh token docs
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);

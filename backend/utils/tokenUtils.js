const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10);

/** Sign a short-lived access token carrying id + role only (no PII beyond that). */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

/** Generate a cryptographically random opaque refresh token (raw, sent to client). */
function generateRawRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

/** SHA-256 hash of the raw refresh token — this is what we persist in Mongo. */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function refreshExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TTL_DAYS);
  return d;
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

module.exports = {
  signAccessToken,
  generateRawRefreshToken,
  hashToken,
  refreshExpiryDate,
  verifyAccessToken,
  REFRESH_TTL_DAYS,
};

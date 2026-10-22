const crypto = require('crypto');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const CandidateProfile = require('../models/CandidateProfile');
const JobApplication = require('../models/JobApplication');
const Interview = require('../models/Interview');
const ScoreRecord = require('../models/ScoreRecord');
const Feedback = require('../models/Feedback');
const { removeResume } = require('../services/resumeObjectStorage');
const {
  signAccessToken,
  generateRawRefreshToken,
  hashToken,
  refreshExpiryDate,
  REFRESH_TTL_DAYS,
} = require('../utils/tokenUtils');

const REFRESH_COOKIE_NAME = 'refreshToken';

function normalizeAuthEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth', // scope cookie to auth routes only
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

/** Issue a fresh refresh token, persist its hash, set the httpOnly cookie. */
async function issueRefreshToken(res, user, family, req) {
  const rawToken = generateRawRefreshToken();
  const tokenHash = hashToken(rawToken);

  await RefreshToken.create({
    user: user._id,
    tokenHash,
    family,
    expiresAt: refreshExpiryDate(),
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
  });

  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions());
}

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, password, role } = req.body;
    const email = normalizeAuthEmail(req.body.email);

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const allowedRoles = ['candidate', 'recruiter']; // admin created via seed/CLI only, never self-serve
    const finalRole = allowedRoles.includes(role) ? role : 'candidate';

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = await User.create({ name, email, password, role: finalRole });

    const accessToken = signAccessToken(user);
    const family = crypto.randomUUID();
    await issueRefreshToken(res, user, family, req);

    return res.status(201).json({
      user: user.toSafeObject(),
      accessToken,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { password } = req.body;
    const email = normalizeAuthEmail(req.body.email);
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const accessToken = signAccessToken(user);
    const family = crypto.randomUUID();
    await issueRefreshToken(res, user, family, req);

    return res.status(200).json({
      user: user.toSafeObject(),
      accessToken,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/refresh
// Reads refresh token from httpOnly cookie, rotates it, returns a new access token.
exports.refresh = async (req, res, next) => {
  try {
    const rawToken = req.cookies[REFRESH_COOKIE_NAME];
    if (!rawToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const tokenHash = hashToken(rawToken);
    const stored = await RefreshToken.findOne({ tokenHash });

    if (!stored) {
      // Unknown token — either expired/purged or forged. Reject.
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    if (stored.revoked) {
      // REUSE DETECTED: a token already consumed/revoked was presented again.
      // This indicates possible token theft — revoke the entire family.
      await RefreshToken.updateMany(
        { family: stored.family },
        { $set: { revoked: true } }
      );
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      return res.status(401).json({ error: 'Refresh token reuse detected. All sessions revoked.' });
    }

    if (stored.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    const user = await User.findById(stored.user);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Rotate: revoke old, issue new in the same family
    stored.revoked = true;
    await stored.save();

    await issueRefreshToken(res, user, stored.family, req);
    const accessToken = signAccessToken(user);

    return res.status(200).json({ accessToken });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/logout
exports.logout = async (req, res, next) => {
  try {
    const rawToken = req.cookies[REFRESH_COOKIE_NAME];
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await RefreshToken.updateOne({ tokenHash }, { $set: { revoked: true } });
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/change-password (protected)
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await User.findById(req.user.sub).select('+password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await user.comparePassword(currentPassword);
    if (!match) return res.status(401).json({ error: 'Incorrect current password' });

    user.password = newPassword;
    await user.save();

    // Revoke all prior refresh token chains for security
    await RefreshToken.updateMany({ user: user._id }, { $set: { revoked: true } });

    // Issue a clean new session
    const family = crypto.randomUUID();
    await issueRefreshToken(res, user, family, req);
    const accessToken = signAccessToken(user);

    return res.status(200).json({ message: 'Password updated successfully', accessToken });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/auth/account (GDPR / CCPA Right to Erasure)
exports.deleteAccount = async (req, res, next) => {
  try {
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: 'currentPassword is required to delete account' });
    }

    const user = await User.findById(req.user.sub).select('+password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await user.comparePassword(currentPassword);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    // Purge candidate profile and GridFS binary file
    const profile = await CandidateProfile.findOne({ candidateId: user._id });
    if (profile?.resume?.storageKey) {
      await removeResume(profile.resume.storageKey).catch((err) => {
        console.warn(`[Account deletion] GridFS cleanup warning: ${err.message}`);
      });
    }
    if (profile) {
      await CandidateProfile.deleteOne({ _id: profile._id });
    }

    // Purge associated application data
    await Promise.all([
      JobApplication.deleteMany({ candidateId: user._id }),
      Interview.deleteMany({ candidateId: user._id }),
      ScoreRecord.deleteMany({ candidateId: user._id }),
      Feedback.deleteMany({ candidateId: user._id }),
      RefreshToken.deleteMany({ user: user._id }),
    ]);

    await User.deleteOne({ _id: user._id });
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });

    return res.status(200).json({ message: 'Account and associated personal data erased successfully' });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me  (protected)
exports.me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

exports.normalizeAuthEmail = normalizeAuthEmail;

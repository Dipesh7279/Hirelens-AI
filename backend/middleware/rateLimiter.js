const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

function createLoginLimiters({ windowMs = 15 * 60 * 1000, ipMax = 200, accountMax = 10, ipStore, accountStore } = {}) {
  const ipLimiter = rateLimit({
    windowMs,
    max: ipMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    ...(ipStore ? { store: ipStore } : {}),
    message: { error: 'Too many login attempts from this network. Please try again later.' },
  });

  // Hash the normalized email so the in-memory limiter key does not retain raw addresses.
  // The IP ceiling remains a backstop; account buckets prevent a shared network's
  // failures for one user from consuming every other user's allowance.
  const accountLimiter = rateLimit({
    windowMs,
    max: accountMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    ...(accountStore ? { store: accountStore } : {}),
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      return `account:${crypto.createHash('sha256').update(email).digest('hex')}`;
    },
    message: { error: 'Too many failed login attempts for this account. Please try again later.' },
  });

  return (req, res, next) => {
    ipLimiter(req, res, (ipError) => {
      if (ipError || res.headersSent) return next(ipError);
      accountLimiter(req, res, next);
    });
  };
}

// Keep registration and login from consuming each other's attempt budget.
// A per-IP threshold that is too small locks out everyone sharing a home,
// school, or office connection. Successful requests never count.
const registrationLimiterOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many registration attempts from this network. Please try again in 15 minutes.' },
};

const registerLimiter = rateLimit(registrationLimiterOptions);
const loginLimiter = createLoginLimiters();

// Looser limiter for refresh — legitimate clients call this often
const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Please slow down.' },
});

// General API-wide limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  // interview frames have their own dedicated limiter (see interviewRoutes.js)
  skip: (req) => /^\/api\/interviews\/[^/]+\/frame$/.test(req.originalUrl.split('?')[0]),
});

module.exports = { registerLimiter, loginLimiter, refreshLimiter, generalLimiter, createLoginLimiters };

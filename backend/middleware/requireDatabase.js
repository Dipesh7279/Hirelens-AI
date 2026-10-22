const mongoose = require('mongoose');

function requireDatabase(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();

  return res.status(503).json({
    code: 'DATABASE_UNAVAILABLE',
    error: 'The database is unavailable. Check the database connection and try again.',
  });
}

module.exports = requireDatabase;

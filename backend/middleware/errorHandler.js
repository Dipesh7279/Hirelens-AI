/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  console.error(`[Error] ${req.method} ${req.route?.path || req.baseUrl || '/'} — ${err.name || 'Error'}`);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ error: messages.join(', ') });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({ error: `${field} already in use` });
  }

  const status = err.code === 'UNSUPPORTED_RESUME_TYPE'
    ? 400
    : (err.statusCode || err.status || (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE' ? 413 : 500));
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : (err.message || 'Request failed'),
  });
}

module.exports = errorHandler;

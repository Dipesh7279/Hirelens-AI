require('./config/backendEnv').loadBackendEnv();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const resumeRoutes = require('./routes/resumeRoutes');
const errorHandler = require('./middleware/errorHandler');
const requireDatabase = require('./middleware/requireDatabase');
const { generalLimiter } = require('./middleware/rateLimiter');
const aiRoutes = require('./routes/AI_routes');
const interviewRoutes = require('./routes/interviewRoutes');
const app = express();
const jobRoutes = require('./routes/jobRoutes');
const candidateRoutes = require('./routes/CandidateRoute');

// --- Security & core middleware ---
app.use(helmet());
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (!allowedOrigins.includes('http://localhost:5173')) allowedOrigins.push('http://localhost:5173');
if (!allowedOrigins.includes('http://127.0.0.1:5173')) allowedOrigins.push('http://127.0.0.1:5173');

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // required so the browser sends/receives the httpOnly refresh cookie
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(generalLimiter);

// --- Routes ---
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
app.get('/api/ready', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ready' : 'not_ready',
    database: databaseReady ? 'connected' : 'disconnected',
  });
});
app.use('/api', requireDatabase);
app.use('/api/auth', authRoutes);
app.use('/api/resume', resumeRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/candidates', candidateRoutes);
// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// --- Centralized error handler (must be last) ---
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function ensureDatabaseAndConnect() {
  const { spawn } = require('child_process');
  const path = require('path');
  const net = require('net');

  const isPortOpen = (port) =>
    new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(400);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => { sock.destroy(); resolve(false); });
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(port, '127.0.0.1');
    });

  const startLocalDbIfNeeded = async () => {
    if (await isPortOpen(27017)) return;
    console.log('[MongoDB] Local port 27017 is not running; starting embedded local MongoDB (start-local-db.js)...');
    const child = spawn(process.execPath, [path.join(__dirname, 'start-local-db.js')], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (await isPortOpen(27017)) break;
    }
  };

  const isExplicitLocalUri = /^mongodb:\/\/(?:127\.0\.0\.1|localhost):27017(?:\/|$)/i.test(
    String(process.env.MONGO_URI || '').trim()
  );
  if (isExplicitLocalUri) {
    await startLocalDbIfNeeded();
  }

  await connectDB();
}

if (require.main === module) {
  ensureDatabaseAndConnect().then(() => {
    const srv = app.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`);
    });
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use by another running backend instance.`);
      } else {
        console.error(`[Server] Listen error: ${err.message}`);
      }
      process.exit(1);
    });
  }).catch((error) => {
    // Do not print the connection string or the driver's raw message.
    console.error(`[MongoDB] Startup aborted (${error.name || 'connection error'}). Check MONGO_URI configuration.`);
    process.exit(1);
  });
}

module.exports = app;

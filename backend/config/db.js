const dns = require('dns');
const mongoose = require('mongoose');

const connectOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 8000,
};

async function connectWithUri(uri, label) {
  try {
    const conn = await mongoose.connect(uri, connectOptions);
    console.log(`[MongoDB] Connected to ${label}: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    // If SRV lookup failed due to local resolver rejecting SRV records (common on Windows/hotspots)
    if (
      typeof uri === 'string' &&
      uri.startsWith('mongodb+srv://') &&
      (error?.code === 'ECONNREFUSED' || error?.syscall === 'querySrv' || error?.message?.includes('querySrv'))
    ) {
      const fallbackServers = process.env.DNS_SERVERS
        ? process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
        : ['8.8.8.8', '1.1.1.1'];
      dns.setServers(fallbackServers);
      const conn = await mongoose.connect(uri, connectOptions);
      console.log(`[MongoDB] Connected to ${label}: ${conn.connection.host}`);
      return conn;
    }
    throw error;
  }
}

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required; refusing to start without the configured database');
  try {
    await connectWithUri(mongoUri, 'configured MongoDB');
  } catch (error) {
    const startupError = new Error('Could not connect to the configured MongoDB; server startup aborted');
    startupError.cause = error;
    throw startupError;
  }
};

module.exports = connectDB;

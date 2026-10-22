const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const path = require('path');

async function main() {
  console.log('[Local MongoDB] Starting in-memory MongoDB instance on port 27017...');
  const mongod = await MongoMemoryServer.create({
    instance: {
      port: 27017,
      dbName: 'ai_recruitment',
    },
  });

  const uri = mongod.getUri();
  console.log(`[Local MongoDB] MongoDB running at: ${uri}`);

  if (process.env.SEED_DEMO === 'true') {
    console.log('[Local MongoDB] Seeding demo users, jobs, candidates, and interview data...');
    const seedProcess = spawn(
      process.execPath,
      [path.join(__dirname, 'seed_demo.js')],
      {
        env: {
          ...process.env,
          MONGO_URI: 'mongodb://127.0.0.1:27017/ai_recruitment',
        },
        stdio: 'inherit',
      }
    );

    seedProcess.on('close', (code) => {
      if (code === 0) {
        console.log('[Local MongoDB] Database seeding completed successfully.');
      } else {
        console.warn(`[Local MongoDB] Seeding process exited with code ${code}.`);
      }
    });
  } else {
    console.log('[Local MongoDB] Ready to serve backend requests on port 27017.');
  }

  const cleanup = async () => {
    console.log('[Local MongoDB] Stopping MongoDB instance...');
    await mongod.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('[Local MongoDB] Failed to initialize:', err);
  process.exit(1);
});


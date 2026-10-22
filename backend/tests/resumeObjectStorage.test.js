const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  createResumeObjectStorage,
  sanitizeOriginalName,
  validateStorageKey,
  ResumeStorageError,
} = require('../services/resumeObjectStorage');

const BUCKET_NAME = 'resume_storage_test';
let mongoServer;
let bucket;
let storage;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
  storage = createResumeObjectStorage({ bucketName: BUCKET_NAME });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

test.beforeEach(async () => {
  await bucket.drop().catch((error) => {
    if (error.code !== 26 && error.codeName !== 'NamespaceNotFound') throw error;
  });
});

test('stores PDF and DOCX buffers in GridFS and returns the file id as storage key', async () => {
  const pdf = Buffer.from('%PDF synthetic resume');
  const saved = await storage.storeResume(pdf, 'C:/uploads/cv.pdf', 'application/pdf');

  assert.match(saved.storageKey, /^[0-9a-f]{24}$/i);
  assert.equal(saved.originalName, 'cv.pdf');
  assert.equal(saved.mimeType, 'application/pdf');
  assert.equal(saved.size, pdf.length);

  const [file] = await bucket.find({ _id: new mongoose.mongo.ObjectId(saved.storageKey) }).toArray();
  assert.equal(file.filename.endsWith('.pdf'), true);
  assert.equal(file.contentType, 'application/pdf');
  assert.equal(file.metadata.originalName, 'cv.pdf');

  const docx = Buffer.from('synthetic docx bytes');
  const savedDocx = await storage.storeResume(
    docx,
    'resume.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  assert.match(savedDocx.storageKey, /^[0-9a-f]{24}$/i);
  const docxStream = (await storage.downloadResume(savedDocx.storageKey)).Body;
  const docxChunks = [];
  for await (const chunk of docxStream) docxChunks.push(chunk);
  assert.deepEqual(Buffer.concat(docxChunks), docx);
});

test('downloads only a valid existing GridFS id and returns null when file is missing', async () => {
  const buffer = Buffer.from('%PDF private synthetic bytes');
  const saved = await storage.storeResume(buffer, 'private.pdf', 'application/pdf');

  const result = await storage.downloadResume(saved.storageKey);
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), buffer);
  assert.equal(await storage.downloadResume('ffffffffffffffffffffffff'), null);
  await assert.rejects(storage.downloadResume('../resume.pdf'), { code: 'INVALID_STORAGE_KEY' });
});

test('deletes GridFS file and its chunks and treats repeated removal as safe', async () => {
  const saved = await storage.storeResume(Buffer.from('to delete'), 'delete.pdf', 'application/pdf');
  const id = new mongoose.mongo.ObjectId(saved.storageKey);
  assert.equal((await bucket.find({ _id: id }).toArray()).length, 1);

  await storage.removeResume(saved.storageKey);
  await storage.removeResume(saved.storageKey);
  assert.equal((await bucket.find({ _id: id }).toArray()).length, 0);
  assert.equal(await mongoose.connection.db.collection(`${BUCKET_NAME}.chunks`).countDocuments({ files_id: id }), 0);
});

test('fails clearly when the MongoDB database is not available', async () => {
  const disconnectedStorage = createResumeObjectStorage({ getDatabase: () => null });
  await assert.rejects(
    disconnectedStorage.storeResume(Buffer.from('file'), 'resume.pdf', 'application/pdf'),
    (error) => error instanceof ResumeStorageError && error.code === 'GRIDFS_UNAVAILABLE'
  );
});

test('rejects unsupported file types and invalid storage ids', async () => {
  await assert.rejects(
    storage.storeResume(Buffer.from('file'), 'resume.txt', 'text/plain'),
    (error) => error instanceof ResumeStorageError && error.code === 'INVALID_FILE_TYPE'
  );
  assert.throws(() => validateStorageKey('../private.pdf'), { code: 'INVALID_STORAGE_KEY' });
  assert.equal(sanitizeOriginalName('..\\cv\r\n.pdf'), 'cv.pdf');
});

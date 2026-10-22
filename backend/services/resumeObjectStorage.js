const path = require('path');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');

const EXTENSIONS = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
const STORAGE_KEY_PATTERN = /^[0-9a-f]{24}$/i;
const STORAGE_TIMEOUT_MS = 30_000;
const BUCKET_NAME = 'resumes';

class ResumeStorageError extends Error {
  constructor(message, code = 'GRIDFS_OPERATION_FAILED') {
    super(message);
    this.name = 'ResumeStorageError';
    this.code = code;
  }
}

function sanitizeOriginalName(name) {
  const baseName = path.basename(String(name || 'resume')).replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (baseName || 'resume').slice(0, 180);
}

function createResumeObjectStorage({
  getDatabase = () => mongoose.connection.db,
  GridFSBucketClass = mongoose.mongo.GridFSBucket,
  bucketName = BUCKET_NAME,
} = {}) {
  function getBucket() {
    const database = getDatabase();
    if (!database) {
      throw new ResumeStorageError('MongoDB is not connected', 'GRIDFS_UNAVAILABLE');
    }
    try {
      return new GridFSBucketClass(database, { bucketName });
    } catch {
      throw new ResumeStorageError('MongoDB GridFS is unavailable', 'GRIDFS_UNAVAILABLE');
    }
  }

  async function findFile(bucket, id) {
    try {
      const files = await bucket.find({ _id: id }).limit(1).toArray();
      return files[0] || null;
    } catch {
      throw new ResumeStorageError('Could not read resume from MongoDB GridFS');
    }
  }

  function objectIdFor(storageKey) {
    validateStorageKey(storageKey);
    return new mongoose.mongo.ObjectId(storageKey);
  }

  async function storeResume(buffer, originalName, mimeType) {
    const extension = EXTENSIONS[mimeType];
    if (!extension) throw new ResumeStorageError('Only PDF and DOCX resumes can be stored', 'INVALID_FILE_TYPE');
    if (!Buffer.isBuffer(buffer)) throw new ResumeStorageError('Resume content must be a buffer', 'INVALID_FILE_CONTENT');

    const bucket = getBucket();
    const filename = `${randomUUID()}${extension}`;
    let uploadStream;

    try {
      uploadStream = bucket.openUploadStream(filename, {
        contentType: mimeType,
        metadata: { originalName: sanitizeOriginalName(originalName) },
      });
      await pipeline(
        Readable.from([buffer]),
        uploadStream,
        { signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) }
      );
    } catch {
      if (uploadStream && typeof uploadStream.abort === 'function') {
        try {
          await uploadStream.abort();
        } catch (cleanupError) {
          console.error(`[Resume storage] GridFS upload cleanup failed (${cleanupError.name || 'Error'})`);
        }
      }
      throw new ResumeStorageError('Could not store resume in MongoDB GridFS');
    }

    return {
      storageKey: uploadStream.id.toString(),
      originalName: sanitizeOriginalName(originalName),
      mimeType,
      size: buffer.length,
    };
  }

  async function downloadResume(storageKey) {
    const bucket = getBucket();
    const id = objectIdFor(storageKey);
    if (!await findFile(bucket, id)) return null;
    try {
      return { Body: bucket.openDownloadStream(id) };
    } catch {
      throw new ResumeStorageError('Could not download resume from MongoDB GridFS');
    }
  }

  async function removeResume(storageKey) {
    const bucket = getBucket();
    const id = objectIdFor(storageKey);
    if (!await findFile(bucket, id)) return;
    try {
      await bucket.delete(id);
    } catch {
      throw new ResumeStorageError('Could not remove resume from MongoDB GridFS');
    }
  }

  return { storeResume, downloadResume, removeResume };
}

function validateStorageKey(key) {
  if (typeof key !== 'string' || !STORAGE_KEY_PATTERN.test(key)) {
    throw new ResumeStorageError('Invalid resume storage key', 'INVALID_STORAGE_KEY');
  }
}

const defaultStorage = createResumeObjectStorage();
module.exports = {
  ...defaultStorage,
  createResumeObjectStorage,
  sanitizeOriginalName,
  validateStorageKey,
  ResumeStorageError,
};

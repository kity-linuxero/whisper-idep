'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { nanoid } = require('nanoid');
const config = require('../config');

// Any audio/video extension ffmpeg can plausibly read; we don't trust the
// browser-provided mimetype alone (often wrong/missing for m4a etc.), so we
// allow-list by extension instead.
const ALLOWED_EXT = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wma',
  '.mp4', '.mov', '.mkv', '.webm', '.avi',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = req.jobId; // set by the route handler before calling upload
    const dir = path.join(config.uploadsDir, jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'original' + path.extname(file.originalname).toLowerCase());
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return cb(new Error(`unsupported file extension: ${ext || '(none)'}`));
  }
  cb(null, true);
}

function assignJobId(req, res, next) {
  req.jobId = nanoid(12);
  next();
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

module.exports = { upload, assignJobId };

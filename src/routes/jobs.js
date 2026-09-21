'use strict';

const fs = require('fs');
const express = require('express');
const jobsRepo = require('../db/jobsRepo');
const queue = require('../jobs/queue');
const { upload, assignJobId } = require('../middleware/upload');

const router = express.Router();

router.post('/jobs', assignJobId, upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'missing "audio" file field' });
  }
  const model = (req.body.model || 'small').toLowerCase();
  if (!['small', 'medium'].includes(model)) {
    return res.status(400).json({ error: 'model must be "small" or "medium"' });
  }

  const job = {
    id: req.jobId,
    original_filename: req.file.originalname,
    model,
    file_size_bytes: req.file.size,
  };
  jobsRepo.insertJob(job);

  queue.enqueue({ id: job.id, model, uploadPath: req.file.path });

  res.status(201).json({ id: job.id, status: 'queued' });
});

router.get('/jobs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const rows = jobsRepo.listJobs({ limit, offset });
  res.json(rows.map(sanitize));
});

router.get('/jobs/:id', (req, res) => {
  const job = jobsRepo.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(sanitize(job));
});

router.get('/jobs/:id/result', (req, res) => {
  const job = jobsRepo.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status !== 'done') {
    return res.status(409).json({ error: `job is ${job.status}, not done yet` });
  }
  const format = (req.query.format || 'txt').toLowerCase();
  const filePath = format === 'json' ? job.result_json_path : job.result_text_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'result file missing' });
  }
  const baseName = job.original_filename.replace(/\.[^./]+$/, '') || 'transcripcion';
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${baseName}.${format === 'json' ? 'json' : 'txt'}"`
  );
  res.sendFile(filePath);
});

router.delete('/jobs/:id', (req, res) => {
  const job = jobsRepo.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  jobsRepo.deleteJob(req.params.id);
  res.status(204).end();
});

// Never leak local filesystem paths to the frontend.
function sanitize(job) {
  const { result_text_path, result_json_path, ...rest } = job;
  return rest;
}

module.exports = router;

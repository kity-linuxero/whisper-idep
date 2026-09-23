'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const jobsRepo = require('../db/jobsRepo');
const queue = require('../jobs/queue');
const worker = require('../jobs/worker');
const engines = require('../remote/engines');
const { upload, assignJobId } = require('../middleware/upload');

const router = express.Router();

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

router.post('/jobs', assignJobId, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'missing "audio" file field' });
  }
  const discard = () => fs.promises.rm(path.join(config.uploadsDir, req.jobId), { recursive: true, force: true }).catch(() => {});

  // Models are whatever the engine has installed.
  let models;
  try {
    models = await engines.listModels();
  } catch (err) {
    await discard();
    return res.status(503).json({ error: `El motor de transcripción no está disponible: ${err.message}` });
  }
  const model = String(req.body.model || models.default || '').toLowerCase();
  if (!models.data.some((m) => m.id === model)) {
    await discard();
    return res.status(400).json({ error: `model must be one of: ${models.data.map((m) => m.id).join(', ')}` });
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

const CONTENT_TYPES = {
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
};

function resultPath(id, format) {
  return path.join(config.uploadsDir, id, `output.${format}`);
}

router.get('/jobs/:id/result', (req, res) => {
  const job = jobsRepo.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status !== 'done') {
    return res.status(409).json({ error: `job is ${job.status}, not done yet` });
  }
  const format = (req.query.format || 'txt').toLowerCase();
  if (!worker.RESULT_FORMATS.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${worker.RESULT_FORMATS.join(', ')}` });
  }
  const filePath = resultPath(job.id, format);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'result file missing' });
  }
  const baseName = job.original_filename.replace(/\.[^./]+$/, '') || 'transcripcion';
  res.setHeader('Content-Type', CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${format}"`);
  res.sendFile(filePath);
});

// Cancel a job that hasn't finished yet — works whether it's still waiting in
// the queue or actively converting/uploading/transcribing right now. The
// actual DB status flips to 'cancelled' asynchronously once the killed child
// process exits, so callers should keep polling GET /jobs/:id afterwards.
router.post('/jobs/:id/cancel', (req, res) => {
  const job = jobsRepo.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });

  if (TERMINAL_STATUSES.includes(job.status)) {
    return res.status(409).json({ error: `job is already ${job.status}` });
  }

  if (job.status === 'queued' && queue.cancelQueued(job.id)) {
    jobsRepo.markCancelled(job.id, 'Cancelado por el usuario (en cola)');
    return res.json({ id: job.id, status: 'cancelled' });
  }

  const found = worker.cancelActive(job.id);
  if (!found) {
    // Race: it finished (or was already removed) between our read and now.
    return res.status(409).json({ error: 'job already finished' });
  }
  res.json({ id: job.id, status: 'cancelling' });
});

// Remove a job from history. If it hasn't finished yet, it's cancelled first
// (best-effort — the worker's own cleanup still runs asynchronously in the
// background). Local result files are deleted so nothing lingers on disk
// once it's gone from the list.
router.delete('/jobs/:id', (req, res) => {
  const job = jobsRepo.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });

  if (!TERMINAL_STATUSES.includes(job.status)) {
    if (job.status === 'queued') queue.cancelQueued(job.id);
    else worker.cancelActive(job.id);
  }

  jobsRepo.deleteJob(req.params.id);

  const jobDir = path.join(config.uploadsDir, req.params.id);
  fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});

  res.status(204).end();
});

// Never leak local filesystem paths (or engine internals) to the frontend.
// result_formats lists what can be downloaded: jobs from 1.x only have txt/json.
function sanitize(job) {
  const { result_text_path, result_json_path, engine_job_id, ...rest } = job;
  if (job.status === 'done') {
    rest.result_formats = worker.RESULT_FORMATS.filter((f) => fs.existsSync(resultPath(job.id, f)));
  }
  return rest;
}

module.exports = router;

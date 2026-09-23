'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const jobsRepo = require('../db/jobsRepo');
const engines = require('../remote/engines');

const RESULT_FORMATS = ['txt', 'json', 'srt', 'vtt'];
// Tolerate short engine/network blips while polling (~1 min at the default interval).
const MAX_POLL_ERRORS = 30;

// Jobs currently being processed (past "queued"), keyed by id, so a cancel
// request can reach whatever is running right now for that job (ffmpeg, the
// upload, or the remote transcription).
const activeJobs = new Map();

class CancelledError extends Error {}

function ffmpegConvert(inputPath, outputPath, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
    if (onSpawn) onSpawn(child);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg conversion failed (${code}): ${stderr.trim().slice(-500)}`));
    });
  });
}

/** Duration of the (already-converted) audio itself, in seconds — distinct from
 * how long the transcription takes to run, which is what the user actually cares
 * about comparing when judging "is this taking longer than it should". */
function getAudioDuration(wavPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      wavPath,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(parseFloat(stdout.trim()) || null);
      else reject(new Error(`ffprobe failed (${code}): ${stderr.trim().slice(-300)}`));
    });
  });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new CancelledError()); }, { once: true });
  });
}

/** Request cancellation of a job that's already past the queued stage. Returns
 * true if an active job was found. The DB status flips to 'cancelled'
 * asynchronously, once processJob unwinds. */
function cancelActive(id) {
  const entry = activeJobs.get(id);
  if (!entry) return false;
  entry.controller.abort();
  if (entry.child) entry.child.kill('SIGTERM');
  return true;
}

/**
 * Poll the engine until the remote job finishes. Only a real change in
 * progress counts as a heartbeat (jobsRepo.setStatus bumps last_progress_at),
 * so the UI's "possibly stuck" warning keeps meaning "the engine went quiet".
 */
async function waitForEngine(engine, engineJobId, localId, signal) {
  let lastProgress = -1;
  let errors = 0;
  const deadline = Date.now() + config.maxJobMinutes * 60_000;
  for (;;) {
    await sleep(config.pollIntervalMs, signal);
    let remote;
    try {
      remote = await engine.getJob(engineJobId, { signal });
      errors = 0;
    } catch (err) {
      if (signal.aborted) throw new CancelledError();
      if (err.status === 404) {
        throw new Error('El motor ya no tiene este trabajo (¿se reinició?)');
      }
      if (++errors >= MAX_POLL_ERRORS) throw err;
      continue;
    }

    if (remote.status === 'done') return remote;
    if (remote.status === 'failed') throw new Error(remote.error || 'el motor informó un error');
    if (remote.status === 'cancelled') throw new Error('el trabajo fue cancelado en el motor');
    if (remote.progress !== lastProgress && remote.status === 'transcribing') {
      lastProgress = remote.progress;
      jobsRepo.setStatus(localId, 'transcribing', remote.progress);
    }
    if (Date.now() > deadline) throw new Error(`job timed out after ${config.maxJobMinutes} min`);
  }
}

async function processJob(job) {
  const jobDir = path.join(config.uploadsDir, job.id);
  const wavPath = path.join(jobDir, 'input.wav');
  const engine = engines.pick();

  const entry = { controller: new AbortController(), child: null };
  const { signal } = entry.controller;
  activeJobs.set(job.id, entry);
  let engineJobId = null;

  try {
    jobsRepo.setStatus(job.id, 'converting', 0);
    await ffmpegConvert(job.uploadPath, wavPath, (child) => {
      entry.child = child;
      if (signal.aborted) child.kill('SIGTERM');
    });
    entry.child = null;
    if (signal.aborted) throw new CancelledError();

    getAudioDuration(wavPath)
      .then((seconds) => jobsRepo.setAudioDuration(job.id, seconds))
      .catch((err) => console.warn(`[job ${job.id}] could not read audio duration:`, err.message));

    jobsRepo.setStatus(job.id, 'uploading', 0);
    const created = await engine.createJob(wavPath, { model: job.model, signal });
    engineJobId = created.id;
    jobsRepo.setEngine(job.id, engine.id, engineJobId);

    jobsRepo.setStatus(job.id, 'transcribing', 0);
    const remote = await waitForEngine(engine, engineJobId, job.id, signal);

    for (const format of RESULT_FORMATS) {
      await engine.downloadResult(engineJobId, format, path.join(jobDir, `output.${format}`), { signal });
    }
    await engine.deleteJob(engineJobId).catch((err) => {
      console.warn(`[job ${job.id}] could not delete engine job ${engineJobId}:`, err.message);
    });

    const durationSeconds = remote.started_at && remote.finished_at
      ? (Date.parse(remote.finished_at) - Date.parse(remote.started_at)) / 1000
      : null;
    jobsRepo.finishJob(job.id, {
      result_text_path: path.join(jobDir, 'output.txt'),
      result_json_path: path.join(jobDir, 'output.json'),
      duration_seconds: durationSeconds,
      compute_device: remote.device,
    });
  } catch (err) {
    if (signal.aborted) {
      console.warn(`[job ${job.id}] cancelled by user`);
      jobsRepo.markCancelled(job.id, 'Cancelado por el usuario');
    } else {
      console.error(`[job ${job.id}] failed:`, err.message);
      jobsRepo.failJob(job.id, err.message);
    }
    if (engineJobId) await engine.deleteJob(engineJobId).catch(() => {});
  } finally {
    activeJobs.delete(job.id);
    // Clean up the original upload (converted WAV/results stay for download).
    fs.promises.unlink(job.uploadPath).catch(() => {});
  }
}

/** On process startup, any job left mid-flight from a crash/restart can't be
 * resumed; mark it failed and free the engine if it was already running there. */
function recoverStaleJobs() {
  const stale = jobsRepo.findStaleActiveJobs();
  for (const { id, engine_id: engineId, engine_job_id: engineJobId } of stale) {
    console.warn(`[startup] marking interrupted job ${id} as failed`);
    jobsRepo.failJob(id, 'interrupted by restart');
    const engine = engineJobId && engines.get(engineId);
    if (engine) engine.deleteJob(engineJobId).catch(() => {});
  }
}

module.exports = { processJob, recoverStaleJobs, cancelActive, RESULT_FORMATS };

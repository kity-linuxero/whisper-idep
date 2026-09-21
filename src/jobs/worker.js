'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const jobsRepo = require('../db/jobsRepo');
const { sshRun, rsyncTo, rsyncFrom, runRemoteWhisper } = require('../remote/whisperClient');

// Jobs currently being processed (past the "queued" stage), keyed by id, so a
// cancel request can reach whichever child process (ffmpeg/ssh/rsync) is
// running right now for that job.
const activeJobs = new Map();

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

function setStatus(id, status, progress) {
  jobsRepo.setStatus(id, status, progress);
}

/** Request cancellation of a job that's already past the queued stage. Returns
 * true if an active job was found and a kill signal was sent to its current
 * child process (the actual DB status flips to 'cancelled' asynchronously,
 * once that child process actually exits and processJob's catch block runs). */
function cancelActive(id) {
  const entry = activeJobs.get(id);
  if (!entry) return false;
  entry.cancelRequested = true;
  if (entry.killFn) entry.killFn();
  return true;
}

async function processJob(job) {
  const jobDir = path.join(config.uploadsDir, job.id);
  const wavPath = path.join(jobDir, 'input.wav');

  const entry = { cancelRequested: false, killFn: null };
  activeJobs.set(job.id, entry);
  const registerKill = (child) => {
    entry.killFn = () => child.kill('SIGTERM');
    // Cancel may have arrived in the brief gap between phases, before this
    // phase's child existed yet to be killed.
    if (entry.cancelRequested) entry.killFn();
  };

  try {
    setStatus(job.id, 'converting', 0);
    await ffmpegConvert(job.uploadPath, wavPath, registerKill);

    getAudioDuration(wavPath)
      .then((seconds) => jobsRepo.setAudioDuration(job.id, seconds))
      .catch((err) => console.warn(`[job ${job.id}] could not read audio duration:`, err.message));

    setStatus(job.id, 'uploading', 0);
    await sshRun(`MKJOBDIR ${job.id}`, { onSpawn: registerKill });
    await rsyncTo(wavPath, job.id, 'input.wav', { onSpawn: registerKill });

    setStatus(job.id, 'transcribing', 0);
    const transcribeStartedAt = Date.now();
    const computeDevice = await runRemoteWhisper(
      job.id, job.model, (pct) => setStatus(job.id, 'transcribing', pct), { onSpawn: registerKill }
    );
    const durationSeconds = (Date.now() - transcribeStartedAt) / 1000;

    await rsyncFrom(job.id, jobDir, { onSpawn: registerKill });
    await sshRun(`CLEANJOB ${job.id}`);

    jobsRepo.finishJob(job.id, {
      result_text_path: path.join(jobDir, 'output.txt'),
      result_json_path: path.join(jobDir, 'output.json'),
      duration_seconds: durationSeconds,
      compute_device: computeDevice,
    });
  } catch (err) {
    if (entry.cancelRequested) {
      console.warn(`[job ${job.id}] cancelled by user`);
      jobsRepo.markCancelled(job.id, 'Cancelado por el usuario');
    } else {
      console.error(`[job ${job.id}] failed:`, err.message);
      jobsRepo.failJob(job.id, err.message);
    }
    await sshRun(`KILLJOB ${job.id}`).catch(() => {});
    await sshRun(`CLEANJOB ${job.id}`).catch(() => {});
  } finally {
    activeJobs.delete(job.id);
    // Clean up the original upload (converted WAV/results stay for download).
    fs.promises.unlink(job.uploadPath).catch(() => {});
  }
}

/** On process startup, any job left mid-flight from a crash/restart can't be resumed. */
function recoverStaleJobs() {
  const stale = jobsRepo.findStaleActiveJobs();
  for (const { id } of stale) {
    console.warn(`[startup] marking interrupted job ${id} as failed`);
    jobsRepo.failJob(id, 'interrupted by restart');
    sshRun(`KILLJOB ${id}`).catch(() => {});
    sshRun(`CLEANJOB ${id}`).catch(() => {});
  }
}

module.exports = { processJob, recoverStaleJobs, cancelActive };

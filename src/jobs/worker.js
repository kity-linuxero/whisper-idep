'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const jobsRepo = require('../db/jobsRepo');
const { sshRun, rsyncTo, rsyncFrom, runRemoteWhisper } = require('../remote/whisperClient');

function ffmpegConvert(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg conversion failed (${code}): ${stderr.trim().slice(-500)}`));
    });
  });
}

function setStatus(id, status, progress) {
  jobsRepo.setStatus(id, status, progress);
}

async function processJob(job) {
  const jobDir = path.join(config.uploadsDir, job.id);
  const wavPath = path.join(jobDir, 'input.wav');
  const startedAt = Date.now();

  try {
    setStatus(job.id, 'converting', 0);
    await ffmpegConvert(job.uploadPath, wavPath);

    setStatus(job.id, 'uploading', 0);
    await sshRun(`MKJOBDIR ${job.id}`);
    await rsyncTo(wavPath, job.id, 'input.wav');

    setStatus(job.id, 'transcribing', 0);
    const computeDevice = await runRemoteWhisper(job.id, job.model, (pct) => setStatus(job.id, 'transcribing', pct));

    await rsyncFrom(job.id, jobDir);
    await sshRun(`CLEANJOB ${job.id}`);

    const durationSeconds = (Date.now() - startedAt) / 1000;
    jobsRepo.finishJob(job.id, {
      result_text_path: path.join(jobDir, 'output.txt'),
      result_json_path: path.join(jobDir, 'output.json'),
      duration_seconds: durationSeconds,
      compute_device: computeDevice,
    });
  } catch (err) {
    console.error(`[job ${job.id}] failed:`, err.message);
    jobsRepo.failJob(job.id, err.message);
    await sshRun(`KILLJOB ${job.id}`).catch(() => {});
    await sshRun(`CLEANJOB ${job.id}`).catch(() => {});
  } finally {
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

module.exports = { processJob, recoverStaleJobs };

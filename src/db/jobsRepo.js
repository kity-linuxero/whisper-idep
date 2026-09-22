'use strict';

const db = require('./index');

function insertJob(job) {
  db.prepare(
    `INSERT INTO jobs (id, original_filename, model, status, progress, file_size_bytes, last_progress_at)
     VALUES (@id, @original_filename, @model, 'queued', 0, @file_size_bytes, datetime('now'))`
  ).run(job);
}

/** Every call is a "heartbeat" from the worker (phase change or a real change
 * in the progress the engine reports), so last_progress_at always reflects how long it's been
 * since we last actually heard from the job — the frontend uses it to flag a
 * job that's gone quiet for longer than expected as possibly stuck. */
function setStatus(id, status, progress) {
  const fields = { id, status };
  let sql = "UPDATE jobs SET status = @status, last_progress_at = datetime('now')";
  if (progress !== undefined) {
    fields.progress = progress;
    sql += ', progress = @progress';
  }
  if (status === 'converting') {
    sql += ", started_at = COALESCE(started_at, datetime('now'))";
  }
  sql += ' WHERE id = @id';
  db.prepare(sql).run(fields);
}

function setEngine(id, engineId, engineJobId) {
  db.prepare('UPDATE jobs SET engine_id = @engineId, engine_job_id = @engineJobId WHERE id = @id')
    .run({ id, engineId, engineJobId });
}

function setAudioDuration(id, seconds) {
  db.prepare('UPDATE jobs SET audio_duration_seconds = @seconds WHERE id = @id').run({ id, seconds });
}

function finishJob(id, { result_text_path, result_json_path, duration_seconds, compute_device }) {
  db.prepare(
    `UPDATE jobs
     SET status = 'done', progress = 100, result_text_path = @result_text_path,
         result_json_path = @result_json_path, duration_seconds = @duration_seconds,
         compute_device = @compute_device, finished_at = datetime('now')
     WHERE id = @id`
  ).run({
    id,
    result_text_path,
    result_json_path,
    duration_seconds: duration_seconds ?? null,
    compute_device: compute_device ?? null,
  });
}

function failJob(id, error) {
  db.prepare(
    `UPDATE jobs SET status = 'failed', error = @error, finished_at = datetime('now') WHERE id = @id`
  ).run({ id, error: String(error).slice(0, 2000) });
}

function markCancelled(id, message) {
  db.prepare(
    `UPDATE jobs SET status = 'cancelled', error = @error, finished_at = datetime('now') WHERE id = @id`
  ).run({ id, error: message || 'cancelado por el usuario' });
}

function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function listJobs({ limit = 50, offset = 0 } = {}) {
  return db
    .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

function deleteJob(id) {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

function findStaleActiveJobs() {
  return db
    .prepare(
      `SELECT id, engine_id, engine_job_id FROM jobs WHERE status IN ('queued','converting','uploading','transcribing')`
    )
    .all();
}

module.exports = {
  insertJob,
  setStatus,
  setEngine,
  setAudioDuration,
  finishJob,
  failJob,
  markCancelled,
  getJob,
  listJobs,
  deleteJob,
  findStaleActiveJobs,
};

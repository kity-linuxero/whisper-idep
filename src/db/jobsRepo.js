'use strict';

const db = require('./index');

function insertJob(job) {
  db.prepare(
    `INSERT INTO jobs (id, original_filename, model, status, progress, file_size_bytes)
     VALUES (@id, @original_filename, @model, 'queued', 0, @file_size_bytes)`
  ).run(job);
}

function setStatus(id, status, progress) {
  const fields = { id, status };
  let sql = 'UPDATE jobs SET status = @status';
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
      `SELECT id FROM jobs WHERE status IN ('queued','converting','uploading','transcribing')`
    )
    .all();
}

module.exports = {
  insertJob,
  setStatus,
  finishJob,
  failJob,
  getJob,
  listJobs,
  deleteJob,
  findStaleActiveJobs,
};

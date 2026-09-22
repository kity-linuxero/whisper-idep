-- 2.0: the engine is a remote HTTP API (whisper-engine). Models are whatever
-- the engine has, so the small/medium CHECK goes; each job remembers which
-- engine ran it and under which id (engine_id is ready for several engines).
BEGIN TRANSACTION;

CREATE TABLE jobs_new (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','converting','uploading','transcribing','done','failed','cancelled')) DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  duration_seconds REAL,
  file_size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  result_text_path TEXT,
  result_json_path TEXT,
  compute_device TEXT,
  last_progress_at TEXT,
  audio_duration_seconds REAL,
  engine_id TEXT,
  engine_job_id TEXT
);

INSERT INTO jobs_new (
  id, original_filename, model, status, progress, error, duration_seconds,
  file_size_bytes, created_at, started_at, finished_at, result_text_path,
  result_json_path, compute_device, last_progress_at, audio_duration_seconds
)
SELECT
  id, original_filename, model, status, progress, error, duration_seconds,
  file_size_bytes, created_at, started_at, finished_at, result_text_path,
  result_json_path, compute_device, last_progress_at, audio_duration_seconds
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

COMMIT;

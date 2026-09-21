BEGIN TRANSACTION;

CREATE TABLE jobs_new (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  model TEXT NOT NULL CHECK(model IN ('small','medium')),
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
  compute_device TEXT
);

INSERT INTO jobs_new (
  id, original_filename, model, status, progress, error, duration_seconds,
  file_size_bytes, created_at, started_at, finished_at, result_text_path,
  result_json_path, compute_device
)
SELECT
  id, original_filename, model, status, progress, error, duration_seconds,
  file_size_bytes, created_at, started_at, finished_at, result_text_path,
  result_json_path, compute_device
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

COMMIT;

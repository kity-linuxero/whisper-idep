CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  model TEXT NOT NULL CHECK(model IN ('small','medium')),
  status TEXT NOT NULL CHECK(status IN ('queued','converting','uploading','transcribing','done','failed')) DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  duration_seconds REAL,
  file_size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  result_text_path TEXT,
  result_json_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

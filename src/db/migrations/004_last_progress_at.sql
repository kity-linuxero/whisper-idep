ALTER TABLE jobs ADD COLUMN last_progress_at TEXT;
UPDATE jobs SET last_progress_at = COALESCE(finished_at, started_at, created_at);

'use strict';

const path = require('path');

function required(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return fallback;
  }
  return v;
}

// 1.x talked to the engine over SSH. Fail loudly instead of starting with a
// config that silently does nothing — see "Migrar desde 1.x" in the README.
const LEGACY_VARS = ['CT110_HOST', 'SSH_USER', 'SSH_KEY_PATH', 'KNOWN_HOSTS_PATH'];
if (!process.env.ENGINE_URL && LEGACY_VARS.some((v) => process.env[v])) {
  throw new Error(
    'Config de 1.x detectada (CT110_HOST/SSH_*). Desde 2.0 el motor se usa por HTTP: '
    + 'definir ENGINE_URL y ENGINE_TOKEN (ver README, "Migrar desde 1.x").'
  );
}

module.exports = {
  host: required('HOST', '0.0.0.0'),
  port: parseInt(required('PORT', '3000'), 10),
  dbPath: required('DB_PATH', path.join(__dirname, '..', 'data', 'jobs.db')),
  uploadsDir: required('UPLOADS_DIR', path.join(__dirname, '..', 'uploads')),
  engine: {
    id: 'default',
    url: required('ENGINE_URL'),
    token: required('ENGINE_TOKEN'),
  },
  pollIntervalMs: parseInt(required('ENGINE_POLL_MS', '2000'), 10),
  maxUploadMb: parseInt(required('MAX_UPLOAD_MB', '2048'), 10),
  maxJobMinutes: parseInt(required('MAX_JOB_MINUTES', '90'), 10),
};

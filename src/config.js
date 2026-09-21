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

module.exports = {
  port: parseInt(required('PORT', '3000'), 10),
  dbPath: required('DB_PATH', path.join(__dirname, '..', 'data', 'jobs.db')),
  uploadsDir: required('UPLOADS_DIR', path.join(__dirname, '..', 'uploads')),
  ct110Host: required('CT110_HOST'),
  sshUser: required('SSH_USER', 'whisperjobs'),
  sshKeyPath: required('SSH_KEY_PATH', '/app/secrets/id_ed25519'),
  knownHostsPath: required('KNOWN_HOSTS_PATH', '/app/secrets/known_hosts'),
  maxUploadMb: parseInt(required('MAX_UPLOAD_MB', '2048'), 10),
  maxJobMinutes: parseInt(required('MAX_JOB_MINUTES', '90'), 10),
};

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');

require('./db'); // runs migrations as a side effect

const queue = require('./jobs/queue');
const worker = require('./jobs/worker');
const jobsRoutes = require('./routes/jobs');
const healthRoutes = require('./routes/health');
const modelsRoutes = require('./routes/models');

fs.mkdirSync(config.uploadsDir, { recursive: true });

queue.setProcessor(worker.processJob);
worker.recoverStaleJobs();
worker.purgeStoredAudio()
  .catch((err) => console.warn('[startup] could not purge stored audio:', err.message));

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', jobsRoutes);
app.use('/api', healthRoutes);
app.use('/api', modelsRoutes);

// Multer/other errors thrown synchronously in a route land here.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err.message);
  const status = /unsupported file extension|model must be/.test(err.message) ? 400 : 500;
  res.status(status).json({ error: err.message });
});

app.listen(config.port, config.host, () => {
  console.log(`whisper-app listening on :${config.port} (engine: ${config.engine.url})`);
});

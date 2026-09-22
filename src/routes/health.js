'use strict';

const express = require('express');
const queue = require('../jobs/queue');
const engines = require('../remote/engines');
const { version } = require('../../package.json');

const router = express.Router();

// Stays 200 even when the engine is down: this is the app's own liveness check
// (used by the container healthcheck); engine state is reported alongside.
router.get('/health', async (req, res) => {
  let engine;
  try {
    const h = await engines.pick().health();
    engine = { ok: true, version: h.version, busy: h.busy };
  } catch (err) {
    engine = { ok: false, error: err.message };
  }
  res.json({ ok: true, queueLength: queue.queueLength(), version, engine });
});

module.exports = router;

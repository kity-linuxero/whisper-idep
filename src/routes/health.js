'use strict';

const express = require('express');
const queue = require('../jobs/queue');
const { version } = require('../../package.json');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, queueLength: queue.queueLength(), version });
});

module.exports = router;

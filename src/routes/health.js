'use strict';

const express = require('express');
const queue = require('../jobs/queue');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, queueLength: queue.queueLength() });
});

module.exports = router;

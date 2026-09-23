'use strict';

const express = require('express');
const engines = require('../remote/engines');

const router = express.Router();

/** Models available on the engine, for the upload form's <select>. */
router.get('/models', async (req, res) => {
  try {
    const models = await engines.listModels();
    res.json({ default: models.default, models: models.data.map((m) => m.id) });
  } catch (err) {
    res.status(503).json({ error: `El motor de transcripción no está disponible: ${err.message}` });
  }
});

module.exports = router;

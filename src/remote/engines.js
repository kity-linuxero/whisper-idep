'use strict';

const config = require('../config');
const { createEngineClient } = require('./engineClient');

// A single engine for now. Kept behind a tiny registry so a future release can
// register several and pick one per job (distributed processing) without
// touching the worker.
const engines = new Map([[config.engine.id, createEngineClient(config.engine)]]);

function get(id) {
  return engines.get(id) || null;
}

function pick() {
  return engines.get(config.engine.id);
}

let modelsCache = { at: 0, value: null };

/** Engine's model list, cached briefly so the upload form doesn't hit the engine every time. */
async function listModels({ maxAgeMs = 30_000 } = {}) {
  if (modelsCache.value && Date.now() - modelsCache.at < maxAgeMs) return modelsCache.value;
  const value = await pick().listModels();
  modelsCache = { at: Date.now(), value };
  return value;
}

module.exports = { get, pick, listModels };

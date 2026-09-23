'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

class EngineError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * HTTP client for one whisper-engine instance (https://github.com/kity-linuxero/whisper-engine).
 * Takes url/token as parameters rather than reading config, so several engines
 * can coexist later (distributed processing) — each job records which engine ran it.
 */
function createEngineClient({ id = 'default', url, token, timeoutMs = 15_000 }) {
  const base = url.replace(/\/+$/, '');

  async function request(route, { method = 'GET', body, signal, timeout = timeoutMs } = {}) {
    const signals = [];
    if (timeout) signals.push(AbortSignal.timeout(timeout));
    if (signal) signals.push(signal);
    let res;
    try {
      res = await fetch(base + route, {
        method,
        body,
        headers: { Authorization: `Bearer ${token}` },
        signal: signals.length ? AbortSignal.any(signals) : undefined,
      });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      throw new EngineError(`motor inalcanzable (${base}): ${err.cause ? err.cause.message : err.message}`, 0);
    }
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
      throw new EngineError(`motor: ${msg}`, res.status);
    }
    return res;
  }

  return {
    id,
    url: base,

    async health() {
      // /health is public; no need for the token, but sending it is harmless.
      return (await request('/health', { timeout: 5_000 })).json();
    },

    async listModels() {
      return (await request('/v1/models')).json();
    },

    /** Streams the file up (no buffering in memory). No timeout: large uploads
     * on slow links can legitimately take minutes; cancel via `signal`. */
    async createJob(filePath, { model, language, signal } = {}) {
      const form = new FormData();
      form.append('file', await fs.openAsBlob(filePath), path.basename(filePath));
      if (model) form.append('model', model);
      if (language) form.append('language', language);
      return (await request('/v1/jobs', { method: 'POST', body: form, signal, timeout: 0 })).json();
    },

    async getJob(jobId, { signal } = {}) {
      return (await request(`/v1/jobs/${encodeURIComponent(jobId)}`, { signal })).json();
    },

    async downloadResult(jobId, format, destPath, { signal } = {}) {
      const res = await request(
        `/v1/jobs/${encodeURIComponent(jobId)}/result?format=${format}`,
        { signal, timeout: 120_000 }
      );
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
    },

    /** Cancel (if running) and delete on the engine. 404 counts as success. */
    async deleteJob(jobId) {
      try {
        await request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    },
  };
}

module.exports = { createEngineClient, EngineError };

'use strict';

// Deliberately trivial single-worker FIFO: CT110 has 3 cores and one shared
// iGPU, so we never want two whisper-cli invocations running at once.
const queue = [];
let busy = false;
let processFn = null;

function setProcessor(fn) {
  processFn = fn;
}

function enqueue(job) {
  queue.push(job);
  drain();
}

async function drain() {
  if (busy || queue.length === 0) return;
  busy = true;
  const job = queue.shift();
  try {
    await processFn(job);
  } catch (err) {
    // processFn is expected to handle its own errors (mark job failed);
    // this catch only guards against the queue itself getting stuck.
    console.error('[queue] unhandled error processing job', job.id, err);
  } finally {
    busy = false;
    drain();
  }
}

function queueLength() {
  return queue.length + (busy ? 1 : 0);
}

module.exports = { setProcessor, enqueue, queueLength };

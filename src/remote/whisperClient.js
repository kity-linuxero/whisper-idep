'use strict';

const { spawn } = require('child_process');
const config = require('../config');

const PROGRESS_RE = /progress\s*=\s*(\d+)%/;
const OPENVINO_OK_RE = /OpenVINO model loaded/;
const OPENVINO_FAIL_RE = /failed to init OpenVINO encoder/;

function sshArgs(extra) {
  return [
    '-i', config.sshKeyPath,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', `UserKnownHostsFile=${config.knownHostsPath}`,
    `${config.sshUser}@${config.ct110Host}`,
    ...extra,
  ];
}

/** Run a short dispatcher command (MKJOBDIR / KILLJOB / CLEANJOB) and wait for it to exit. */
function sshRun(command, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', sshArgs([command]));
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ssh command timed out: ${command}`));
    }, timeoutMs);
    child.stdout.resume(); // drain and discard — unread stdout can prevent 'close' from firing
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

/** rsync a local file up into the job's directory on CT110 as the given remote filename. */
function rsyncTo(localPath, jobId, remoteFilename) {
  return new Promise((resolve, reject) => {
    const dest = `${config.sshUser}@${config.ct110Host}:${jobId}/${remoteFilename}`;
    const child = spawn('rsync', [
      '-a',
      '-e', `ssh -i ${config.sshKeyPath} -o BatchMode=yes -o UserKnownHostsFile=${config.knownHostsPath}`,
      localPath,
      dest,
    ]);
    child.stdout.resume();
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`rsync upload failed (${code}): ${stderr.trim()}`));
    });
  });
}

/** rsync the whisper-cli output files back down from CT110 into localDir. */
function rsyncFrom(jobId, localDir) {
  return new Promise((resolve, reject) => {
    const src = `${config.sshUser}@${config.ct110Host}:${jobId}/output.*`;
    const child = spawn('rsync', [
      '-a',
      '-e', `ssh -i ${config.sshKeyPath} -o BatchMode=yes -o UserKnownHostsFile=${config.knownHostsPath}`,
      src,
      `${localDir}/`,
    ]);
    child.stdout.resume();
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`rsync download failed (${code}): ${stderr.trim()}`));
    });
  });
}

/**
 * Run whisper-cli remotely via the RUNJOB forced command, streaming live progress
 * off stderr (whisper.cpp's -pp flag prints "whisper_print_progress_callback: progress = NN%").
 *
 * Also watches the same stderr stream for whisper.cpp's own OpenVINO encoder-init
 * log lines to report whether the job actually ran on the iGPU or silently fell
 * back to CPU (both are logged via whisper.cpp's default log sink, which is stderr).
 * Resolves with the detected device: 'GPU', 'CPU', or 'unknown' if neither line appeared.
 */
function runRemoteWhisper(jobId, model, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', sshArgs([`RUNJOB ${jobId} ${model}`]));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('job timed out'));
    }, config.maxJobMinutes * 60_000);

    // whisper-cli prints the full transcript to stdout as it transcribes, in addition to
    // writing -otxt/-oj files. If nothing reads this stream, it never reaches 'end', and
    // Node's 'close' event (which waits for all stdio streams to close) never fires — the
    // remote process can finish and exit cleanly while this promise hangs forever.
    child.stdout.resume();

    let buf = '';
    let stderrTail = '';
    let device = 'unknown';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      buf += text;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const m = line.match(PROGRESS_RE);
        if (m) onProgress(Math.min(100, parseInt(m[1], 10)));
        if (OPENVINO_OK_RE.test(line)) device = 'GPU';
        else if (OPENVINO_FAIL_RE.test(line)) device = 'CPU';
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(device);
      else reject(new Error(`whisper-cli exited ${code}: ${stderrTail.trim().slice(-500)}`));
    });
  });
}

module.exports = { sshRun, rsyncTo, rsyncFrom, runRemoteWhisper };

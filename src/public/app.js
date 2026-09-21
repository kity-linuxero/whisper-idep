const fileInput = document.getElementById('audiofile');
const modelSelect = document.getElementById('model');
const btn = document.getElementById('btnSend');
const uploadWrap = document.getElementById('uploadWrap');
const uploadBar = document.getElementById('uploadBar');
const uploadPct = document.getElementById('uploadPct');
const processWrap = document.getElementById('processWrap');
const processBar = document.getElementById('processBar');
const processBarInner = document.getElementById('processBarInner');
const processPct = document.getElementById('processPct');
const processLabel = document.getElementById('processLabel');
const errorMsg = document.getElementById('errorMsg');
const errorMsgText = document.getElementById('errorMsgText');
const resultDiv = document.getElementById('result');
const resultMeta = document.getElementById('resultMeta');
const downloadActions = document.getElementById('downloadActions');
const downloadTxt = document.getElementById('downloadTxt');
const downloadJson = document.getElementById('downloadJson');
const historyBody = document.getElementById('historyBody');
const themeBtn = document.getElementById('btnTheme');
const dropzone = document.getElementById('dropzone');
const fileNameLabel = document.getElementById('fileName');
const btnRefreshHistory = document.getElementById('btnRefreshHistory');

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch (_) {}
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
  }
  themeBtn.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (_) {}
  });
})();

function renderFileName(file) {
  fileNameLabel.textContent = file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : '';
}

fileInput.addEventListener('change', () => renderFileName(fileInput.files[0]));

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === 'dragover') dropzone.classList.add('dragover');
    else dropzone.classList.remove('dragover');
    if (evt === 'drop' && e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      renderFileName(fileInput.files[0]);
    }
  });
});

btnRefreshHistory.addEventListener('click', loadHistory);

const STATUS_LABELS = {
  queued: 'En cola',
  converting: 'Convirtiendo audio',
  uploading: 'Subiendo al motor',
  transcribing: 'Transcribiendo',
  done: 'Listo',
  failed: 'Error',
};

let pollTimer = null;

function resetUi() {
  errorMsg.style.display = 'none';
  resultDiv.style.display = 'none';
  resultDiv.textContent = '';
  uploadWrap.style.display = 'none';
  processWrap.style.display = 'none';
  resultMeta.style.display = 'none';
  downloadActions.style.display = 'none';
  uploadBar.style.width = '0%';
  uploadPct.textContent = '0%';
  processBarInner.style.width = '0%';
  processPct.textContent = '0%';
  processBar.classList.remove('indeterminate');
}

function showError(msg) {
  errorMsgText.textContent = msg;
  errorMsg.style.display = 'flex';
  btn.disabled = false;
}

btn.addEventListener('click', () => {
  const file = fileInput.files[0];
  if (!file) { showError('Elegí un archivo primero.'); return; }

  resetUi();
  btn.disabled = true;

  const form = new FormData();
  form.append('audio', file);
  form.append('model', modelSelect.value);

  const xhr = new XMLHttpRequest();
  uploadWrap.style.display = 'block';

  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    uploadBar.style.width = pct + '%';
    uploadPct.textContent = pct + '%';
  });

  xhr.addEventListener('load', () => {
    if (xhr.status === 201) {
      const { id } = JSON.parse(xhr.responseText);
      uploadBar.style.width = '100%';
      uploadPct.textContent = '100%';
      processWrap.style.display = 'block';
      pollJob(id);
    } else {
      let msg = xhr.responseText;
      try { msg = JSON.parse(xhr.responseText).error; } catch (_) {}
      showError(`Error ${xhr.status}: ${msg}`);
    }
  });

  xhr.addEventListener('error', () => showError('Error de red al subir el archivo.'));

  xhr.open('POST', '/api/jobs');
  xhr.send(form);
});

function pollJob(id) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const resp = await fetch(`/api/jobs/${id}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const job = await resp.json();
      renderJobProgress(job);

      if (job.status === 'done') {
        clearInterval(pollTimer);
        btn.disabled = false;
        await showResult(job);
        loadHistory();
      } else if (job.status === 'failed') {
        clearInterval(pollTimer);
        btn.disabled = false;
        showError(job.error || 'La transcripción falló.');
        loadHistory();
      }
    } catch (err) {
      // transient network hiccup while polling — keep trying silently
      console.warn('poll error', err);
    }
  }, 1500);
}

function renderJobProgress(job) {
  processLabel.textContent = STATUS_LABELS[job.status] || job.status;
  if (job.status === 'transcribing') {
    processBar.classList.remove('indeterminate');
    processBarInner.style.width = job.progress + '%';
    processPct.textContent = job.progress + '%';
  } else if (job.status === 'converting' || job.status === 'uploading' || job.status === 'queued') {
    // No granular progress for these short phases — show an indeterminate-looking bar.
    processBar.classList.add('indeterminate');
    processBarInner.style.width = '100%';
    processPct.textContent = '';
  } else {
    processBarInner.style.width = '100%';
    processPct.textContent = '100%';
  }
}

const DEVICE_LABELS = { GPU: 'GPU (iGPU)', CPU: 'CPU', unknown: 'desconocido' };

async function showResult(job) {
  const resp = await fetch(`/api/jobs/${job.id}/result?format=txt`);
  if (!resp.ok) return;
  const text = await resp.text();
  resultDiv.textContent = text;
  resultDiv.style.display = 'block';

  const deviceLabel = DEVICE_LABELS[job.compute_device] || 'desconocido';
  const durationLabel = job.duration_seconds ? `${Math.round(job.duration_seconds)}s` : '—';
  resultMeta.innerHTML = [
    `Modelo: ${escapeHtml(job.model)}`,
    `Motor: ${deviceLabel}`,
    `Idioma: Español (forzado)`,
    `Tiempo: ${durationLabel}`,
  ].map((t) => `<span class="chip">${t}</span>`).join('');
  resultMeta.style.display = 'flex';

  downloadTxt.href = `/api/jobs/${job.id}/result?format=txt`;
  downloadJson.href = `/api/jobs/${job.id}/result?format=json`;
  downloadActions.style.display = 'block';
}

function statusPillHtml(status) {
  return `<span class="status-pill status-${status}">${STATUS_LABELS[status] || status}</span>`;
}

async function loadHistory() {
  const resp = await fetch('/api/jobs?limit=50');
  if (!resp.ok) return;
  const jobs = await resp.json();
  historyBody.innerHTML = jobs.map((j) => `
    <tr>
      <td data-label="Archivo">${escapeHtml(j.original_filename)}</td>
      <td data-label="Modelo">${j.model}</td>
      <td data-label="Motor">${j.compute_device ? (DEVICE_LABELS[j.compute_device] || j.compute_device) : '—'}</td>
      <td data-label="Estado">${statusPillHtml(j.status)}</td>
      <td data-label="Fecha">${new Date(j.created_at + 'Z').toLocaleString()}</td>
      <td data-label="Descargas">${j.status === 'done'
        ? `<span class="actions-row">
             <a class="action" href="/api/jobs/${j.id}/result?format=txt">.txt</a>
             <a class="action" href="/api/jobs/${j.id}/result?format=json">.json</a>
           </span>`
        : ''}</td>
    </tr>
  `).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

loadHistory();
setInterval(loadHistory, 10000);

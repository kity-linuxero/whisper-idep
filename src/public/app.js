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
const btnCancel = document.getElementById('btnCancel');
const errorMsg = document.getElementById('errorMsg');
const resultDiv = document.getElementById('result');
const resultMeta = document.getElementById('resultMeta');
const downloadActions = document.getElementById('downloadActions');
const downloadTxt = document.getElementById('downloadTxt');
const downloadJson = document.getElementById('downloadJson');
const historyBody = document.getElementById('historyBody');

const STATUS_LABELS = {
  queued: 'En cola',
  converting: 'Convirtiendo audio',
  uploading: 'Subiendo al motor',
  transcribing: 'Transcribiendo',
  done: 'Listo',
  failed: 'Error',
  cancelled: 'Cancelado',
};

const ACTIVE_STATUSES = ['queued', 'converting', 'uploading', 'transcribing'];

let pollTimer = null;
let currentJobId = null;

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
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
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
      currentJobId = id;
      uploadBar.style.width = '100%';
      uploadPct.textContent = '100%';
      processWrap.style.display = 'block';
      btnCancel.disabled = false;
      btnCancel.textContent = 'Cancelar';
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
        btnCancel.disabled = true;
        currentJobId = null;
        await showResult(job);
        loadHistory();
      } else if (job.status === 'failed') {
        clearInterval(pollTimer);
        btn.disabled = false;
        btnCancel.disabled = true;
        currentJobId = null;
        showError(job.error || 'La transcripción falló.');
        loadHistory();
      } else if (job.status === 'cancelled') {
        clearInterval(pollTimer);
        btn.disabled = false;
        btnCancel.disabled = true;
        currentJobId = null;
        showError('Trabajo cancelado.');
        loadHistory();
      }
    } catch (err) {
      // transient network hiccup while polling — keep trying silently
      console.warn('poll error', err);
    }
  }, 1500);
}

btnCancel.addEventListener('click', async () => {
  if (!currentJobId) return;
  if (!confirm('¿Cancelar esta transcripción?')) return;
  btnCancel.disabled = true;
  btnCancel.textContent = 'Cancelando...';
  try {
    await cancelJobRequest(currentJobId);
  } catch (err) {
    console.warn('cancel error', err);
  }
});

async function cancelJobRequest(id) {
  const resp = await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' });
  if (!resp.ok && resp.status !== 409) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp;
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
  resultMeta.textContent = `Modelo: ${job.model} · Motor: ${deviceLabel} · Idioma: Español (forzado) · Tiempo: ${durationLabel}`;
  resultMeta.style.display = 'block';

  downloadTxt.href = `/api/jobs/${job.id}/result?format=txt`;
  downloadJson.href = `/api/jobs/${job.id}/result?format=json`;
  downloadActions.style.display = 'block';
}

function statusPillHtml(job) {
  const label = STATUS_LABELS[job.status] || job.status;
  const suffix = job.status === 'transcribing' ? ` ${job.progress}%` : '';
  return `<span class="status-pill status-${job.status}">${label}${suffix}</span>`;
}

function historyActionsHtml(j) {
  if (ACTIVE_STATUSES.includes(j.status)) {
    return `<a class="action action-danger" href="#" data-cancel="${j.id}">Cancelar</a>`;
  }
  const downloads = j.status === 'done'
    ? `<a class="action" href="/api/jobs/${j.id}/result?format=txt">.txt</a><a class="action" href="/api/jobs/${j.id}/result?format=json">.json</a>`
    : '';
  return `${downloads}<a class="action action-danger" href="#" data-delete="${j.id}">Borrar</a>`;
}

async function loadHistory() {
  const resp = await fetch('/api/jobs?limit=50');
  if (!resp.ok) return;
  const jobs = await resp.json();
  historyBody.innerHTML = jobs.map((j) => `
    <tr>
      <td>${escapeHtml(j.original_filename)}</td>
      <td>${j.model}</td>
      <td>${j.compute_device ? (DEVICE_LABELS[j.compute_device] || j.compute_device) : '—'}</td>
      <td>${statusPillHtml(j)}</td>
      <td>${new Date(j.created_at + 'Z').toLocaleString()}</td>
      <td>${historyActionsHtml(j)}</td>
    </tr>
  `).join('');
}

historyBody.addEventListener('click', async (e) => {
  const cancelId = e.target.dataset.cancel;
  const deleteId = e.target.dataset.delete;
  if (!cancelId && !deleteId) return;
  e.preventDefault();

  if (cancelId) {
    if (!confirm('¿Cancelar esta transcripción?')) return;
    try {
      await cancelJobRequest(cancelId);
      if (cancelId === currentJobId) btnCancel.disabled = true;
    } catch (err) {
      console.warn('cancel error', err);
    }
    loadHistory();
  } else if (deleteId) {
    if (!confirm('¿Borrar esta transcripción del historial? Esta acción no se puede deshacer.')) return;
    try {
      await fetch(`/api/jobs/${deleteId}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('delete error', err);
    }
    loadHistory();
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

loadHistory();
setInterval(loadHistory, 4000);

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
const errorMsgText = document.getElementById('errorMsgText');
const resultDiv = document.getElementById('result');
const resultMeta = document.getElementById('resultMeta');
const downloadActions = document.getElementById('downloadActions');
const downloadLinks = document.getElementById('downloadLinks');
const historyBody = document.getElementById('historyBody');
const themeBtn = document.getElementById('btnTheme');
const dropzone = document.getElementById('dropzone');
const fileNameLabel = document.getElementById('fileName');
const btnRefreshHistory = document.getElementById('btnRefreshHistory');
const stallHint = document.getElementById('stallHint');
const footerVersion = document.getElementById('footerVersion');

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
  cancelled: 'Cancelado',
};

const ACTIVE_STATUSES = ['queued', 'converting', 'uploading', 'transcribing'];

// Umbrales para avisar que un trabajo puede estar trabado, en base a cuánto
// hace que llegó la última novedad real del motor (cambio de fase o una
// nueva línea de progreso de whisper-cli) — no cuánto hace que se envió.
const STALL_WARN_SECONDS = 180;  // "va lento" / posible contención de CPU
const STALL_ALERT_SECONDS = 300; // "probablemente trabado"

function secondsSince(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString.replace(' ', 'T') + 'Z').getTime();
  return Math.max(0, Math.round((Date.now() - then) / 1000));
}

function formatElapsed(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function stallLevel(seconds) {
  if (seconds === null) return null;
  if (seconds >= STALL_ALERT_SECONDS) return 'alert';
  if (seconds >= STALL_WARN_SECONDS) return 'warn';
  return null;
}

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
  stallHint.style.display = 'none';
  stallHint.className = 'stall-hint';
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
  renderStallHint(job);
}

function renderStallHint(job) {
  const elapsed = secondsSince(job.last_progress_at);
  const level = stallLevel(elapsed);
  if (!level) {
    stallHint.style.display = 'none';
    return;
  }
  const suffix = level === 'alert' ? ' — podría estar trabado, quizás convenga cancelar.' : ' — puede ser contención de CPU normal.';
  stallHint.textContent = `Sin novedades hace ${formatElapsed(elapsed)}${suffix}`;
  stallHint.className = `stall-hint stall-hint--${level}`;
  stallHint.style.display = 'block';
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Friendly labels for the usual whisper.cpp models; anything else the engine
// offers shows up by its plain id.
const MODEL_LABELS = {
  tiny: 'Mínimo (tiny) — muy rápido, baja precisión',
  base: 'Básico (base) — rápido, precisión modesta',
  small: 'Rápido (small) — ~3x tiempo real',
  medium: 'Preciso (medium) — ~5x más lento, mejor en cruces de voces',
  'large-v3-turbo': 'Muy preciso (large-v3-turbo) — lento sin GPU dedicada',
  'large-v3': 'Máxima precisión (large-v3) — muy lento sin GPU dedicada',
};
const LANGUAGE_LABELS = { es: 'Español', en: 'Inglés', pt: 'Portugués', auto: 'Automático' };
let engineLanguage = null;
let modelsErrorShown = false;

async function loadModels() {
  try {
    const resp = await fetch('/api/models');
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    engineLanguage = body.language || null;
    modelSelect.innerHTML = body.models.map((id) => `
      <option value="${escapeHtml(id)}"${id === body.default ? ' selected' : ''}>${escapeHtml(MODEL_LABELS[id] || id)}</option>
    `).join('');
    btn.disabled = false;
    if (modelsErrorShown) errorMsg.style.display = 'none';
    modelsErrorShown = false;
  } catch (err) {
    modelSelect.innerHTML = '<option value="" disabled selected>Motor no disponible</option>';
    showError(`No se pudo consultar el motor de transcripción: ${err.message}`);
    modelsErrorShown = true;
    btn.disabled = true; // showError re-enables it; there's nothing to send to yet
    setTimeout(loadModels, 10_000);
  }
}

const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M12 16l-4-4M12 16l4-4"></path><path d="M4 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path></svg>';

function downloadLinksHtml(job, withIcon) {
  return (job.result_formats || ['txt', 'json'])
    .map((f) => `<a class="action" href="/api/jobs/${job.id}/result?format=${f}">${withIcon ? `${DOWNLOAD_ICON} Descargar ` : ''}.${f}</a>`)
    .join('');
}

async function showResult(job) {
  const resp = await fetch(`/api/jobs/${job.id}/result?format=txt`);
  if (!resp.ok) return;
  const text = await resp.text();
  resultDiv.textContent = text;
  resultDiv.style.display = 'block';

  resultMeta.innerHTML = [
    `Modelo: ${escapeHtml(job.model)}`,
    ...(engineLanguage ? [`Idioma: ${escapeHtml(LANGUAGE_LABELS[engineLanguage] || engineLanguage)}`] : []),
    `Duración del audio: ${formatDuration(job.audio_duration_seconds)}`,
    `Tardó en transcribir: ${formatDuration(job.duration_seconds)}`,
  ].map((t) => `<span class="chip">${t}</span>`).join('');
  resultMeta.style.display = 'flex';

  downloadLinks.innerHTML = downloadLinksHtml(job, true);
  downloadActions.style.display = 'block';
}

function statusPillHtml(job) {
  const label = STATUS_LABELS[job.status] || job.status;
  const suffix = job.status === 'transcribing' ? ` ${job.progress}%` : '';
  let html = `<span class="status-pill status-${job.status}">${label}${suffix}</span>`;
  if (ACTIVE_STATUSES.includes(job.status)) {
    const elapsed = secondsSince(job.last_progress_at);
    const level = stallLevel(elapsed);
    if (level) {
      html += `<br><span class="stall-hint stall-hint--${level} stall-hint--inline">sin novedades hace ${formatElapsed(elapsed)}</span>`;
    }
  }
  return html;
}

function historyActionsHtml(j) {
  if (ACTIVE_STATUSES.includes(j.status)) {
    return `<a class="action action-danger" href="#" data-cancel="${j.id}">Cancelar</a>`;
  }
  const downloads = j.status === 'done'
    ? downloadLinksHtml(j, false)
    : '';
  return `<span class="actions-row">${downloads}<a class="action action-danger" href="#" data-delete="${j.id}">Borrar</a></span>`;
}

async function loadHistory() {
  const resp = await fetch('/api/jobs?limit=50');
  if (!resp.ok) return;
  const jobs = await resp.json();
  historyBody.innerHTML = jobs.map((j) => `
    <tr>
      <td data-label="Archivo">${escapeHtml(j.original_filename)}</td>
      <td data-label="Modelo">${escapeHtml(j.model)}</td>
      <td data-label="Audio">${formatDuration(j.audio_duration_seconds)}</td>
      <td data-label="Tardó">${formatDuration(j.duration_seconds)}</td>
      <td data-label="Estado">${statusPillHtml(j)}</td>
      <td data-label="Fecha">${new Date(j.created_at + 'Z').toLocaleString()}</td>
      <td data-label="Acciones">${historyActionsHtml(j)}</td>
    </tr>
  `).join('');
}

historyBody.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-cancel],[data-delete]');
  if (!target) return;
  const cancelId = target.dataset.cancel;
  const deleteId = target.dataset.delete;
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

btn.disabled = true;
loadModels();
loadHistory();
setInterval(loadHistory, 4000);

fetch('/api/health')
  .then((r) => r.json())
  .then(({ version }) => {
    if (version) footerVersion.textContent = `v${version}`;
  })
  .catch(() => {});

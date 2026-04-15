// =============================================================================
// Art & Science 2026 — voting.js
//
// CONFIGURAZIONE: sostituisci con l'URL dell'Apps Script Web App
// dopo il deploy su Google (vedi appscript/Code.gs).
// =============================================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby6HsOLYhr6iGPzFZ3CyoJBMTXzz17Y5IOI6dhoBtsCxBmfOVKSXl-rIGnzdmrrAuLd/exec';

// =============================================================================
// STATO GLOBALE
// =============================================================================
const state = {
  token:        null,
  jurorName:    null,
  opere:        [],
  config:       null,
  votes:        {},     // { opera_n: { criterio: valore } }
  currentIndex: 0,
  votingOpen:   false,
  saveTimer:    null,
};

// =============================================================================
// INIT
// =============================================================================
async function init() {
  const params = new URLSearchParams(window.location.search);
  state.token = params.get('j');

  if (!state.token) {
    showError('URL non valido. Usa il link personale ricevuto via email.');
    return;
  }

  if (APPS_SCRIPT_URL === 'REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL') {
    showError('Configurazione mancante: URL Apps Script non impostato (vedi js/voting.js).');
    return;
  }

  try {
    showLoading('Caricamento opere…');

    // Carica opere e config in parallelo
    const [opere, config] = await Promise.all([
      fetchJson('data/opere.json'),
      fetchJson('data/config.json'),
    ]);
    state.opere  = opere;
    state.config = config;

    showLoading('Verifica accesso…');

    // Valida token + controlla apertura in parallelo
    const [validateRes, openRes] = await Promise.all([
      callApi({ action: 'validate', token: state.token }),
      callApi({ action: 'isOpen'  }),
    ]);

    if (!validateRes.ok) {
      showError('Link non riconosciuto. Contatta l\'organizzatore.');
      return;
    }
    state.jurorName  = validateRes.name;
    state.votingOpen = openRes.open;

    // Carica voti esistenti
    const votesRes = await callApi({ action: 'getVotes', token: state.token });
    if (votesRes.ok && votesRes.votes) {
      // Converte le chiavi da stringa a numero
      for (const [k, v] of Object.entries(votesRes.votes)) {
        state.votes[parseInt(k)] = v;
      }
    }

    // Costruisci UI
    buildCriteria();
    updateHeader();
    navigateTo(0);
    updateProgress();

    hide('loading');
    show('opera-card');
    show('nav-bar');

    if (!state.votingOpen) showBanner('⚠️ Votazioni chiuse — puoi consultare i tuoi voti ma non modificarli.');

  } catch (err) {
    showError('Errore di connessione: ' + err.message);
  }
}

// =============================================================================
// COSTRUZIONE CRITERI
// =============================================================================
function buildCriteria() {
  const container = document.getElementById('criteria');
  container.innerHTML = '';

  for (const c of state.config.criteri) {
    const div = document.createElement('div');
    div.className = 'criterion';
    div.innerHTML = `
      <div class="criterion-header">
        <span class="criterion-label">${c.etichetta}</span>
        <span class="criterion-value abstained" id="val-${c.id}">Ast</span>
      </div>
      <div class="vote-row" data-criterion="${c.id}"></div>`;

    const row = div.querySelector('.vote-row');

    // Pulsante Astenuto (valore 0)
    row.appendChild(makeVoteBtn(c.id, 0, 'AST', 'btn-ast'));

    // Pulsanti 1–10
    for (let v = 1; v <= 10; v++) {
      row.appendChild(makeVoteBtn(c.id, v, String(v), ''));
    }

    container.appendChild(div);
  }
}

function makeVoteBtn(criterionId, value, label, extraClass) {
  const btn = document.createElement('button');
  btn.className = 'vote-btn ' + extraClass;
  btn.textContent = label;
  btn.dataset.value = value;
  btn.addEventListener('click', () => selectVote(criterionId, value));
  return btn;
}

// =============================================================================
// NAVIGAZIONE
// =============================================================================
function navigateTo(index) {
  if (index < 0 || index >= state.opere.length) return;
  state.currentIndex = index;
  renderOpera();
}

function renderOpera() {
  const op  = state.opere[state.currentIndex];
  const n   = op.n;

  el('opera-number').textContent  = `Opera ${n}`;
  el('opera-school').textContent  = op.scuola || '';
  el('opera-title').textContent   = op.titolo;
  el('opera-authors').textContent = (op.nomi_autori || []).join(', ');
  el('opera-description').textContent = op.descrizione || '';
  el('opera-description').classList.remove('expanded');
  el('btn-expand').textContent = 'Mostra tutto';

  // Foto
  const img = el('opera-photo');
  const num = String(n).padStart(2, '0');
  img.src = `photos/${num}.jpg`;
  img.alt = op.titolo;

  // Contatore navigazione
  el('nav-counter').textContent = `${state.currentIndex + 1} / ${state.opere.length}`;
  el('btn-prev').disabled = (state.currentIndex === 0);
  el('btn-next').disabled = (state.currentIndex === state.opere.length - 1);

  // Voti attuali
  const currentVotes = state.votes[n] || {};
  for (const c of state.config.criteri) {
    setVoteUI(c.id, currentVotes[c.id] ?? 0);
  }

  // Status
  setSaveStatus('', '');
  window.scrollTo(0, 0);
}

// =============================================================================
// VOTO
// =============================================================================
function selectVote(criterionId, value) {
  if (!state.votingOpen) return;

  const n = state.opere[state.currentIndex].n;
  if (!state.votes[n]) {
    state.votes[n] = {};
    for (const c of state.config.criteri) state.votes[n][c.id] = 0;
  }

  state.votes[n][criterionId] = value;
  setVoteUI(criterionId, value);
  updateProgress();

  // Auto-save con debounce 700ms
  clearTimeout(state.saveTimer);
  setSaveStatus('…', 'saving');
  state.saveTimer = setTimeout(saveCurrentOpera, 700);
}

function setVoteUI(criterionId, value) {
  const row = document.querySelector(`[data-criterion="${criterionId}"]`);
  if (!row) return;
  row.querySelectorAll('.vote-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.value) === value);
  });
  const valEl = el('val-' + criterionId);
  if (value === 0) {
    valEl.textContent = 'Ast';
    valEl.className   = 'criterion-value abstained';
  } else {
    valEl.textContent = String(value);
    valEl.className   = 'criterion-value';
  }
}

async function saveCurrentOpera() {
  const op     = state.opere[state.currentIndex];
  const votes  = state.votes[op.n];
  if (!votes) return;

  const params = { action: 'saveVote', token: state.token, opera: op.n };
  for (const c of state.config.criteri) params[c.id] = votes[c.id] ?? 0;

  try {
    const res = await callApi(params);
    if (res.ok) {
      setSaveStatus('Salvato ✓', 'saved');
      setTimeout(() => setSaveStatus('', ''), 2500);
    } else {
      setSaveStatus('Errore: ' + (res.error || '?'), 'error');
    }
  } catch (e) {
    setSaveStatus('Errore di rete', 'error');
  }
}

// =============================================================================
// PROGRESS
// =============================================================================
function updateProgress() {
  const tot  = state.opere.length;
  const done = state.opere.filter(op => {
    const v = state.votes[op.n];
    return v && state.config.criteri.some(c => (v[c.id] ?? 0) > 0);
  }).length;

  el('progress-text').textContent  = `${done} / ${tot} votate`;
  el('progress-fill').style.width  = `${tot > 0 ? (done / tot) * 100 : 0}%`;
}

// =============================================================================
// OVERVIEW MODALE
// =============================================================================
function openOverview() {
  const grid = el('overview-grid');
  grid.innerHTML = '';

  for (let i = 0; i < state.opere.length; i++) {
    const op    = state.opere[i];
    const voted = state.votes[op.n] &&
      state.config.criteri.some(c => (state.votes[op.n][c.id] ?? 0) > 0);

    const btn = document.createElement('button');
    btn.className = 'ov-item' +
      (voted ? ' voted' : '') +
      (i === state.currentIndex ? ' current' : '');
    btn.textContent = op.n;
    btn.addEventListener('click', () => {
      navigateTo(i);
      closeOverview();
    });
    grid.appendChild(btn);
  }

  show('overview-overlay');
}

function closeOverview() { hide('overview-overlay'); }

// =============================================================================
// DESCRIZIONE EXPAND
// =============================================================================
function toggleDescription() {
  const desc = el('opera-description');
  const btn  = el('btn-expand');
  if (desc.classList.toggle('expanded')) {
    btn.textContent = 'Mostra meno';
  } else {
    btn.textContent = 'Mostra tutto';
  }
}

// =============================================================================
// HELPERS UI
// =============================================================================
function updateHeader() {
  el('juror-name').textContent = state.jurorName || '';
}

function showLoading(msg) {
  el('loading-msg').textContent = msg || 'Caricamento…';
  show('loading');
}

function showError(msg) {
  hide('loading');
  el('error-msg').textContent = msg;
  show('error-state');
}

function showBanner(msg) {
  const banner = document.createElement('div');
  banner.style.cssText =
    'background:#fff3cd;color:#856404;padding:10px 16px;font-size:13px;text-align:center;';
  banner.textContent = msg;
  document.getElementById('main').prepend(banner);
}

function setSaveStatus(msg, cls) {
  const s = el('save-status');
  s.textContent = msg;
  s.className   = cls;
}

function el(id)       { return document.getElementById(id); }
function show(id)     { el(id).hidden = false; }
function hide(id)     { el(id).hidden = true; }
function fetchJson(u) { return fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }

function callApi(params) {
  const url = new URL(APPS_SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetch(url.toString(), { redirect: 'follow' })
    .then(r => r.json());
}

// =============================================================================
// SWIPE (mobile)
// =============================================================================
let touchX0 = 0;
document.addEventListener('touchstart', e => { touchX0 = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend',   e => {
  const dx = e.changedTouches[0].clientX - touchX0;
  if (Math.abs(dx) > 55) navigateTo(state.currentIndex + (dx < 0 ? 1 : -1));
}, { passive: true });

// =============================================================================
// TASTIERA (desktop)
// =============================================================================
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft')  navigateTo(state.currentIndex - 1);
  if (e.key === 'ArrowRight') navigateTo(state.currentIndex + 1);
});

// =============================================================================
// EVENTI PULSANTI — collegati all'HTML via onclick o listener
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  el('btn-prev').addEventListener('click', () => navigateTo(state.currentIndex - 1));
  el('btn-next').addEventListener('click', () => navigateTo(state.currentIndex + 1));
  el('btn-overview').addEventListener('click', openOverview);
  el('btn-close-overview').addEventListener('click', closeOverview);
  el('btn-expand').addEventListener('click', toggleDescription);
  el('overview-overlay').addEventListener('click', e => {
    if (e.target === el('overview-overlay')) closeOverview();
  });
  init();
});

// =============================================================================
// Art & Science 2026 — results.js
// =============================================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby6HsOLYhr6iGPzFZ3CyoJBMTXzz17Y5IOI6dhoBtsCxBmfOVKSXl-rIGnzdmrrAuLd/exec';

let autoRefreshTimer = null;

// Stato ordinamento: { col: 'media', dir: 1 }  (1 = decrescente, -1 = crescente)
let sortState = { col: 'media', dir: 1 };

// Cache dei dati per re-sort senza rifetch
let cachedRankings = [];
let cachedConfig   = null;
let cachedNGiurati = '?';
let cachedOpereMap = {};

// =============================================================================
// FORMULA DI PUNTEGGIO  (deve rispecchiare data/config.json)
// =============================================================================
function computeScore(operaVotes, operaMeta, config) {
  let totalePesi = 0, sommaPesata = 0;
  const criteri = {};

  for (const c of config.criteri) {
    const vals = (operaVotes[c.id] || []).filter(v => v > 0);
    if (vals.length > 0) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      criteri[c.id]  = avg;
      sommaPesata   += avg * c.peso;
      totalePesi    += c.peso;
    } else {
      criteri[c.id] = null;
    }
  }

  const media_criteri = totalePesi > 0 ? sommaPesata / totalePesi : null;
  const bonus = config.campionato.abilitato
    ? (operaMeta.campionato_max / config.campionato.divisore) * config.campionato.peso
    : 0;
  const totale = media_criteri !== null ? media_criteri + bonus : null;

  return { criteri, media_criteri, bonus, totale };
}

// =============================================================================
// INIT
// =============================================================================
async function init() {
  if (APPS_SCRIPT_URL === 'REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL') {
    showStatus('Configurazione mancante: URL Apps Script non impostato.');
    return;
  }

  try {
    const [opere, config] = await Promise.all([
      fetchJson('data/opere.json'),
      fetchJson('data/config.json'),
    ]);
    cachedConfig = config;

    const opereMap = {};
    for (const op of opere) opereMap[op.n] = op;
    cachedOpereMap = opereMap;

    async function refresh() {
      try {
        const url = new URL(APPS_SCRIPT_URL);
        url.searchParams.set('action', 'getResults');
        const res = await fetch(url.toString(), { redirect: 'follow' }).then(r => r.json());

        if (!res.ok) { showStatus('Errore: ' + (res.error || '?')); return; }

        cachedRankings = buildRankings(res.votes, opereMap, config);
        cachedNGiurati = res.n_giurati || '?';
        renderTable();
        el('last-update').textContent = 'Aggiornato: ' + new Date().toLocaleTimeString('it-IT');
        el('results-status').textContent = '';
      } catch (err) {
        showStatus('Errore di rete: ' + err.message);
      }
    }

    await refresh();
    autoRefreshTimer = setInterval(refresh, 60000);
    el('btn-refresh').addEventListener('click', () => {
      clearInterval(autoRefreshTimer);
      refresh();
      autoRefreshTimer = setInterval(refresh, 60000);
    });

  } catch (err) {
    showStatus('Errore: ' + err.message);
  }
}

// =============================================================================
// COSTRUZIONE CLASSIFICA
// =============================================================================
function buildRankings(votes, opereMap, config) {
  const result = [];
  for (const op of Object.values(opereMap)) {
    const operaVotes = votes[op.n] || {};
    const score = computeScore(operaVotes, op, config);
    const nVoti = Math.max(...config.criteri.map(c => (operaVotes[c.id] || []).length), 0);
    result.push({ op, score, nVoti });
  }
  return result;
}

// =============================================================================
// SORT
// =============================================================================
function getVal(row, col) {
  if (col === 'n')      return row.op.n;
  if (col === 'totale') return row.score.totale;
  if (col === 'media')  return row.score.media_criteri;
  if (col === 'bonus')  return row.score.bonus;
  if (col === 'voti')   return row.nVoti;
  // criterio
  return row.score.criteri[col];
}

function sortRankings(rankings, col, dir) {
  return [...rankings].sort((a, b) => {
    let va = getVal(a, col);
    let vb = getVal(b, col);
    // null sempre in fondo, indipendentemente dalla direzione
    if (va === null && vb === null) return a.op.n - b.op.n;
    if (va === null) return 1;
    if (vb === null) return -1;
    return dir * (vb - va);   // dir=-1 → decrescente, dir=+1 → crescente
  });
}

function onSortClick(col) {
  if (sortState.col === col) {
    sortState.dir *= -1;          // inverti direzione
  } else {
    sortState.col = col;
    sortState.dir = 1;            // default: decrescente
  }
  renderTable();
}

// =============================================================================
// RENDER TABELLA
// =============================================================================
function renderTable() {
  if (!cachedConfig) return;
  const config    = cachedConfig;
  const rankings  = sortRankings(cachedRankings, sortState.col, sortState.dir);

  el('n-giurati').textContent = cachedNGiurati;
  const n_voted = cachedRankings.filter(r => r.score.totale !== null).length;
  el('n-voted').textContent = `${n_voted} / ${cachedRankings.length} opere con almeno un voto`;

  const wrap = el('results-table-wrap');
  wrap.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'ranking';

  // Definizione colonne: { key, label, title }
  const cols = [
    { key: 'media',  label: '#',     title: 'Classifica per media criteri. Il numero più piccolo in grigio sotto indica la posizione con bonus campionato.' },
    { key: 'n',      label: 'Opera', title: 'Numero opera' },
    ...config.criteri.map(c => ({ key: c.id, label: c.etichetta.split(' ')[0], title: c.etichetta })),
    { key: 'media',  label: 'Media', title: 'Media criteri' },
    { key: 'bonus',  label: 'Bonus', title: 'Bonus campionato' },
    { key: 'totale', label: 'Totale',title: 'Punteggio finale' },
    { key: 'voti',   label: 'Voti',  title: 'Numero giurati che hanno votato' },
  ];

  // Thead — colonne cliccabili
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');

  cols.forEach((c, i) => {
    const th = document.createElement('th');
    th.title = c.title;

    const isActive = sortState.col === c.key;
    const arrow    = isActive ? (sortState.dir === 1 ? ' ↓' : ' ↑') : '';
    th.innerHTML   = escHtml(c.label) + `<span class="sort-arrow">${arrow}</span>`;

    if (isActive) th.classList.add('sort-active');

    // Prima colonna (#) = alias per 'media', non duplicare il click
    const clickKey = c.key;
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => onSortClick(clickKey));
    trHead.appendChild(th);
  });

  thead.appendChild(trHead);
  table.appendChild(thead);

  // Pre-calcola ranking per totale e per media (senza bonus) — fuori dal loop
  const byTotal = cachedRankings
    .filter(r => r.score.totale !== null)
    .sort((a, b) => b.score.totale - a.score.totale);
  const rankByTotalMap = {};
  byTotal.forEach((r, i) => { rankByTotalMap[r.op.n] = i + 1; });

  const byMedia = cachedRankings
    .filter(r => r.score.media_criteri !== null)
    .sort((a, b) => b.score.media_criteri - a.score.media_criteri);
  const rankByMediaMap = {};
  byMedia.forEach((r, i) => { rankByMediaMap[r.op.n] = i + 1; });

  // Tbody
  const tbody = document.createElement('tbody');
  let rank = 1;

  for (const { op, score, nVoti } of rankings) {
    const tr = document.createElement('tr');
    if (score.totale !== null) tr.className = `rank-${rank <= 3 ? rank : ''}`;

    const rankT = rankByTotalMap[op.n] || null;   // rank con bonus
    const rankM = rankByMediaMap[op.n] || null;   // rank senza bonus

    // Cella rank: numero principale = rank per media, sub = rank con bonus
    let rankCell;
    if (rankM === null) {
      rankCell = `<td class="rank-num score-na">—</td>`;
    } else {
      const rankClass = `rank-num rank-${rankM <= 3 ? rankM : ''}`;
      let bonusSub = '';
      if (rankT !== null && rankT !== rankM) {
        // il bonus sposta la posizione
        const crossed10 = (rankT <= 10 && rankM > 10) ? ' rank-bonus-top10' : '';
        bonusSub = `<span class="rank-media-sub${crossed10}" title="Posizione con bonus campionato">(${rankT})</span>`;
      }
      rankCell = `<td class="${rankClass}">${rankM}${bonusSub}</td>`;
    }

    const criteriaScores = config.criteri.map(c => {
      const v = score.criteri[c.id];
      return `<td class="score-cell">${v !== null ? fmt(v) : '<span class="score-na">—</span>'}</td>`;
    }).join('');

    tr.innerHTML = `
      ${rankCell}
      <td>
        <span class="opera-n-badge">${op.n}</span>
        <button class="opera-title-btn" onclick="openOperaModal(${op.n})">${escHtml(op.titolo)}</button>
        <span class="opera-school-small">${escHtml(op.scuola || '')}</span>
      </td>
      ${criteriaScores}
      <td class="score-cell">${score.media_criteri !== null ? fmt(score.media_criteri) : '<span class="score-na">—</span>'}</td>
      <td class="score-cell">${fmt(score.bonus)}</td>
      <td class="score-cell ${score.totale !== null ? 'score-final' : 'score-na'}">${score.totale !== null ? fmt(score.totale) : '—'}</td>
      <td class="score-cell"><span class="n-votes-badge">${nVoti}</span></td>`;

    tbody.appendChild(tr);
    if (score.totale !== null) rank++;
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
}

// =============================================================================
// HELPERS
// =============================================================================
function fmt(n)      { return typeof n === 'number' ? n.toFixed(2) : '—'; }
function escHtml(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function el(id)      { return document.getElementById(id); }
function showStatus(msg) { el('results-status').textContent = msg; }
function fetchJson(u)    { return fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }

function openOperaModal(n) {
  const op = cachedOpereMap[n];
  if (!op) return;
  el('opera-modal-n').textContent = `Opera n. ${op.n}`;
  el('opera-modal-title').textContent = op.titolo;
  el('opera-modal-school').textContent = op.scuola || '';
  el('opera-modal-desc').textContent = op.descrizione || '';
  const img = el('opera-modal-img');
  if (op.photo) {
    img.src = 'photos/' + op.photo;
    img.alt = op.titolo;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }
  const overlay = el('opera-modal-overlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeOperaModal() {
  el('opera-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

// =============================================================================
// AVVIO
// =============================================================================
document.addEventListener('DOMContentLoaded', init);

// =============================================================================
// Art & Science 2026 — results.js
// =============================================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby6HsOLYhr6iGPzFZ3CyoJBMTXzz17Y5IOI6dhoBtsCxBmfOVKSXl-rIGnzdmrrAuLd/exec';

let autoRefreshTimer = null;

// Stato ordinamento: { col: 'media', dir: 1 }  (1 = decrescente, -1 = crescente)
let sortState = { col: 'media', dir: 1 };

// Vista attiva: 'generale' | 'liceo'
let viewMode = 'generale';

function setView(mode) {
  viewMode = mode;
  el('btn-view-generale').classList.toggle('view-btn-active', mode === 'generale');
  el('btn-view-liceo').classList.toggle('view-btn-active', mode === 'liceo');
  el('btn-view-grafico').classList.toggle('view-btn-active', mode === 'grafico');
  renderTable();
}

// Cache dei dati per re-sort senza rifetch
let cachedRankings = [];
let cachedConfig   = null;
let cachedNGiurati = '?';
let cachedOpereMap = {};

// =============================================================================
// FORMULA DI PUNTEGGIO  (deve rispecchiare data/config.json)
// =============================================================================
function stdDev(vals) {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sq   = vals.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(sq / (vals.length - 1));
}

function computeScore(operaVotes, operaMeta, config) {
  let totalePesi = 0, sommaPesata = 0;
  const criteri = {}, std_criteri = {};

  for (const c of config.criteri) {
    const vals = (operaVotes[c.id] || []).filter(v => v > 0);
    if (vals.length > 0) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      criteri[c.id]     = avg;
      std_criteri[c.id] = vals.length >= 2 ? stdDev(vals) : null;
      sommaPesata       += avg * c.peso;
      totalePesi        += c.peso;
    } else {
      criteri[c.id]     = null;
      std_criteri[c.id] = null;
    }
  }

  const media_criteri = totalePesi > 0 ? sommaPesata / totalePesi : null;

  // Propagazione errori: σ_M = sqrt(Σ (w_c · σ_c)²) / Σ w_c
  let std_media = null;
  if (totalePesi > 0) {
    let sumVarPesata = 0;
    for (const c of config.criteri) {
      if (criteri[c.id] !== null) {
        const s = std_criteri[c.id] !== null ? std_criteri[c.id] : 0;
        sumVarPesata += (c.peso * s) ** 2;
      }
    }
    std_media = Math.sqrt(sumVarPesata) / totalePesi;
  }

  const bonus = config.campionato.abilitato
    ? (operaMeta.campionato_max / config.campionato.divisore) * config.campionato.peso
    : 0;
  const totale = media_criteri !== null ? media_criteri + bonus : null;

  return { criteri, std_criteri, media_criteri, std_media, bonus, totale };
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
  if (viewMode === 'liceo')   { renderBySchool(); return; }
  if (viewMode === 'grafico') { renderChart();    return; }

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
      const s = score.std_criteri[c.id];
      const stdSpan = (v !== null && s !== null) ? `<span class="score-std">±${s.toFixed(2)}</span>` : '';
      return `<td class="score-cell">${v !== null ? fmt(v) + stdSpan : '<span class="score-na">—</span>'}</td>`;
    }).join('');
    const stdMediaSpan = (score.media_criteri !== null && score.std_media !== null)
      ? `<span class="score-std">±${score.std_media.toFixed(2)}</span>` : '';

    tr.innerHTML = `
      ${rankCell}
      <td>
        <span class="opera-n-badge">${op.n}</span>
        <button class="opera-title-btn" onclick="openOperaModal(${op.n})">${escHtml(op.titolo)}</button>
        <span class="opera-school-small">${escHtml(op.scuola || '')}</span>
      </td>
      ${criteriaScores}
      <td class="score-cell">${score.media_criteri !== null ? fmt(score.media_criteri) + stdMediaSpan : '<span class="score-na">—</span>'}</td>
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
// RENDER PER LICEO
// =============================================================================
function renderBySchool() {
  const config = cachedConfig;

  el('n-giurati').textContent = cachedNGiurati;
  const n_voted = cachedRankings.filter(r => r.score.totale !== null).length;
  el('n-voted').textContent = `${n_voted} / ${cachedRankings.length} opere con almeno un voto`;

  // Classifica assoluta per media e per totale
  const byMedia = cachedRankings
    .filter(r => r.score.media_criteri !== null)
    .sort((a, b) => b.score.media_criteri - a.score.media_criteri);
  const rankByMediaMap = {};
  byMedia.forEach((r, i) => { rankByMediaMap[r.op.n] = i + 1; });

  const byTotal = cachedRankings
    .filter(r => r.score.totale !== null)
    .sort((a, b) => b.score.totale - a.score.totale);
  const rankByTotalMap = {};
  byTotal.forEach((r, i) => { rankByTotalMap[r.op.n] = i + 1; });

  // Raggruppa per scuola
  const schools = {};
  for (const row of cachedRankings) {
    const scuola = row.op.scuola || '(senza scuola)';
    if (!schools[scuola]) schools[scuola] = [];
    schools[scuola].push(row);
  }

  // Ordina le scuole per miglior posizione assoluta (media) tra le proprie opere
  const sortedSchools = Object.keys(schools).sort((a, b) => {
    const bestA = Math.min(...schools[a].map(r => rankByMediaMap[r.op.n] ?? Infinity));
    const bestB = Math.min(...schools[b].map(r => rankByMediaMap[r.op.n] ?? Infinity));
    return bestA - bestB;
  });

  const wrap = el('results-table-wrap');
  wrap.innerHTML = '';

  for (const scuola of sortedSchools) {
    const rows = [...schools[scuola]].sort((a, b) => {
      const ra = rankByMediaMap[a.op.n] ?? Infinity;
      const rb = rankByMediaMap[b.op.n] ?? Infinity;
      return ra - rb;
    });

    const section = document.createElement('div');
    section.className = 'school-section';

    const header = document.createElement('div');
    header.className = 'school-header';
    header.innerHTML = `
      <span class="school-header-name">${escHtml(scuola)}</span>
      <span class="school-count">${rows.length} ${rows.length === 1 ? 'opera' : 'opere'}</span>
    `;

    const table = document.createElement('table');
    table.className = 'ranking';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    [
      { label: '#',      title: 'Posizione assoluta in classifica (per media criteri). Il numero in grigio indica la posizione con bonus campionato.' },
      { label: 'Opera',  title: 'Numero e titolo opera' },
      { label: 'Media',  title: 'Media criteri' },
      { label: 'Bonus',  title: 'Bonus campionato' },
      { label: 'Totale', title: 'Punteggio finale' },
      { label: 'Voti',   title: 'Numero giurati che hanno votato' },
    ].forEach(({ label, title }) => {
      const th = document.createElement('th');
      th.textContent = label;
      th.title = title;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const { op, score, nVoti } of rows) {
      const tr = document.createElement('tr');
      const rankM = rankByMediaMap[op.n] ?? null;
      const rankT = rankByTotalMap[op.n] ?? null;

      let rankCell;
      if (rankM === null) {
        rankCell = `<td class="rank-num score-na">—</td>`;
      } else {
        const rankClass = `rank-num rank-${rankM <= 3 ? rankM : ''}`;
        let bonusSub = '';
        if (rankT !== null && rankT !== rankM) {
          const crossed10 = (rankT <= 10 && rankM > 10) ? ' rank-bonus-top10' : '';
          bonusSub = `<span class="rank-media-sub${crossed10}" title="Posizione con bonus campionato">(${rankT})</span>`;
        }
        rankCell = `<td class="${rankClass}">${rankM}${bonusSub}</td>`;
      }

      tr.innerHTML = `
        ${rankCell}
        <td>
          <span class="opera-n-badge">${op.n}</span>
          <button class="opera-title-btn" onclick="openOperaModal(${op.n})">${escHtml(op.titolo)}</button>
        </td>
        <td class="score-cell">${score.media_criteri !== null ? fmt(score.media_criteri) : '<span class="score-na">—</span>'}</td>
        <td class="score-cell">${fmt(score.bonus)}</td>
        <td class="score-cell ${score.totale !== null ? 'score-final' : 'score-na'}">${score.totale !== null ? fmt(score.totale) : '—'}</td>
        <td class="score-cell"><span class="n-votes-badge">${nVoti}</span></td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    section.appendChild(header);
    section.appendChild(table);
    wrap.appendChild(section);
  }
}

// =============================================================================
// GRAFICO TOP 12
// =============================================================================
function renderChart() {
  const wrap = el('results-table-wrap');
  wrap.innerHTML = '';

  const top12 = [...cachedRankings]
    .filter(r => r.score.media_criteri !== null && r.nVoti > 0)
    .sort((a, b) => b.score.media_criteri - a.score.media_criteri)
    .slice(0, 12);

  if (top12.length === 0) {
    wrap.innerHTML = '<p style="text-align:center;color:#6b7280;padding:40px;">Nessun dato disponibile</p>';
    return;
  }

  const sems   = top12.map(r => r.score.std_media !== null ? r.score.std_media / Math.sqrt(r.nVoti) : 0);
  const scores = top12.map(r => r.score.media_criteri);
  const rawMin = Math.min(...scores.map((s, i) => s - sems[i]));
  const rawMax = Math.max(...scores.map((s, i) => s + sems[i]));
  const pad    = Math.max(0.25, (rawMax - rawMin) * 0.18);
  const yMin   = Math.max(0,  parseFloat((rawMin - pad).toFixed(1)));
  const yMax   = Math.min(10, parseFloat((rawMax + pad + 0.1).toFixed(1)));

  const mg = { top: 36, right: 24, bottom: 116, left: 66 };
  const W = 860, H = 440;
  const iW = W - mg.left - mg.right;
  const iH = H - mg.top - mg.bottom;
  const n  = top12.length;
  const bW = iW / n;
  const bI = bW * 0.52;

  const sy = v => mg.top + iH - (v - yMin) / (yMax - yMin) * iH;
  const sx = i => mg.left + i * bW + bW / 2;

  // Y ticks
  const rawStep = (yMax - yMin) / 5;
  const step    = Math.max(0.1, parseFloat(rawStep.toFixed(1)));
  const ticks   = [];
  for (let t = yMin; t <= yMax + step * 0.01; t += step)
    ticks.push(parseFloat(t.toFixed(2)));

  const parts = [];

  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" rx="12"/>`);

  for (const tk of ticks) {
    const y = sy(tk);
    if (y < mg.top - 2 || y > mg.top + iH + 2) continue;
    parts.push(`<line x1="${mg.left}" x2="${mg.left + iW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${mg.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${tk.toFixed(1)}</text>`);
  }

  const ymid = mg.top + iH / 2;
  parts.push(`<text x="14" y="${ymid.toFixed(0)}" text-anchor="middle" font-size="11" fill="#6b7280" transform="rotate(-90 14 ${ymid.toFixed(0)})">Punteggio medio</text>`);

  const barColors = ['#b8860b', '#757575', '#a0522d'];

  for (let i = 0; i < n; i++) {
    const { op, score, nVoti } = top12[i];
    const x     = sx(i);
    const y     = sy(score.media_criteri);
    const yBase = sy(yMin);
    const color = i < 3 ? barColors[i] : '#4f46e5';
    const sem   = sems[i];
    const cap   = 7;

    parts.push(`<rect x="${(x - bI / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bI.toFixed(1)}" height="${Math.max(0, yBase - y).toFixed(1)}" fill="${color}" opacity="0.82" rx="3"/>`);

    if (sem > 0.001) {
      const yT = sy(score.media_criteri + sem);
      const yB = sy(score.media_criteri - sem);
      parts.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${yT.toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#374151" stroke-width="1.8"/>`);
      parts.push(`<line x1="${(x - cap).toFixed(1)}" x2="${(x + cap).toFixed(1)}" y1="${yT.toFixed(1)}" y2="${yT.toFixed(1)}" stroke="#374151" stroke-width="1.8"/>`);
      parts.push(`<line x1="${(x - cap).toFixed(1)}" x2="${(x + cap).toFixed(1)}" y1="${yB.toFixed(1)}" y2="${yB.toFixed(1)}" stroke="#374151" stroke-width="1.8"/>`);
    }

    parts.push(`<text x="${x.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#374151">${score.media_criteri.toFixed(2)}</text>`);

    const lbl = `${op.n} – ${op.titolo.length > 16 ? op.titolo.substring(0, 16) + '…' : op.titolo}`;
    const lx  = x.toFixed(1);
    const ly  = (mg.top + iH + 15).toFixed(1);
    parts.push(`<text x="${lx}" y="${ly}" text-anchor="end" font-size="10" fill="#374151" transform="rotate(-40 ${lx} ${ly})">${escHtml(lbl)}</text>`);
  }

  parts.push(`<line x1="${mg.left}" x2="${mg.left}" y1="${mg.top}" y2="${mg.top + iH}" stroke="#9ca3af" stroke-width="1.5"/>`);
  parts.push(`<line x1="${mg.left}" x2="${mg.left + iW}" y1="${mg.top + iH}" y2="${mg.top + iH}" stroke="#9ca3af" stroke-width="1.5"/>`);
  parts.push(`<text x="${(W / 2).toFixed(0)}" y="22" text-anchor="middle" font-size="13" font-weight="700" fill="#1a1a2e">Top 12 · Punteggio medio ± errore standard (σ/√n)</text>`);

  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;margin:0 auto;overflow:visible;" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;

  const container = document.createElement('div');
  container.style.cssText = 'background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 12px rgba(0,0,0,.06);';
  container.innerHTML = svg + `<p style="text-align:center;font-size:12px;color:#6b7280;margin-top:6px;">Barre di errore = σ/√n · Le prime 3 posizioni sono evidenziate (oro, argento, bronzo)</p>`;
  wrap.appendChild(container);
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

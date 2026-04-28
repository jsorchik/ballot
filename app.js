'use strict';

const STATE = {
  electionsIndex: null,
  election: null,
  filters: {
    search: '',
    levels: new Set(),
    parties: new Set(),
    contestedOnly: false,
    undecidedOnly: false,
    sort: 'ballot',
    candidateSort: 'default',
  },
  selections: {},
};

const LEVEL_LABELS = {
  federal: 'Federal',
  'state-exec': 'State exec',
  'state-leg': 'State legislature',
  'state-board': 'State boards',
  judicial: 'Judicial',
  county: 'County',
  school: 'School',
};

const LEVEL_ORDER = ['federal', 'state-exec', 'state-leg', 'state-board', 'judicial', 'county', 'school'];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const res = await fetch('data/elections.json');
    STATE.electionsIndex = await res.json();
  } catch (e) {
    showError('Could not load elections index. If running locally, serve the directory over HTTP (e.g. `python3 -m http.server`).');
    return;
  }

  const select = document.getElementById('election-select');
  STATE.electionsIndex.elections.forEach((e) => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.name;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => loadElection(select.value));

  await loadElection(STATE.electionsIndex.elections[0].id);

  bindFilters();
  bindBallotActions();
}

async function loadElection(id) {
  const meta = STATE.electionsIndex.elections.find((e) => e.id === id);
  if (!meta) return;
  const res = await fetch(meta.file);
  STATE.election = await res.json();
  STATE.selections = loadSelections(id);
  document.getElementById('jurisdiction').textContent = STATE.election.jurisdiction || '';
  document.getElementById('last-updated').textContent = STATE.election.lastUpdated
    ? `data as of ${STATE.election.lastUpdated}`
    : '';
  buildLevelChips();
  buildPartyChips();
  render();
}

function buildLevelChips() {
  const present = new Set(STATE.election.races.map((r) => r.level));
  const container = document.getElementById('level-chips');
  container.innerHTML = '';
  LEVEL_ORDER.filter((l) => present.has(l)).forEach((level) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = LEVEL_LABELS[level] || level;
    chip.dataset.level = level;
    chip.addEventListener('click', () => {
      if (STATE.filters.levels.has(level)) STATE.filters.levels.delete(level);
      else STATE.filters.levels.add(level);
      chip.classList.toggle('active');
      render();
    });
    container.appendChild(chip);
  });
}

function buildPartyChips() {
  const partyCounts = new Map();
  STATE.election.races.forEach((r) =>
    r.candidates.forEach((c) => {
      partyCounts.set(c.party, (partyCounts.get(c.party) || 0) + 1);
    })
  );
  const container = document.getElementById('party-chips');
  container.innerHTML = '';
  Array.from(partyCounts.keys())
    .sort()
    .forEach((party) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = party;
      chip.dataset.party = party;
      chip.addEventListener('click', () => {
        if (STATE.filters.parties.has(party)) STATE.filters.parties.delete(party);
        else STATE.filters.parties.add(party);
        chip.classList.toggle('active');
        render();
      });
      container.appendChild(chip);
    });
}

function bindFilters() {
  document.getElementById('search').addEventListener('input', (e) => {
    STATE.filters.search = e.target.value.toLowerCase().trim();
    render();
  });
  document.getElementById('contested-only').addEventListener('change', (e) => {
    STATE.filters.contestedOnly = e.target.checked;
    render();
  });
  document.getElementById('undecided-only').addEventListener('change', (e) => {
    STATE.filters.undecidedOnly = e.target.checked;
    render();
  });
  document.getElementById('sort-select').addEventListener('change', (e) => {
    STATE.filters.sort = e.target.value;
    render();
  });
  document.getElementById('candidate-sort').addEventListener('change', (e) => {
    STATE.filters.candidateSort = e.target.value;
    render();
  });
}

function sortCandidates(candidates) {
  const mode = STATE.filters.candidateSort;
  if (mode === 'default') return candidates;
  const arr = [...candidates];
  if (mode === 'chance') {
    arr.sort((a, b) => (b.winChance?.value ?? -1) - (a.winChance?.value ?? -1));
  } else if (mode === 'woke-desc') {
    arr.sort((a, b) => (b.wokeIndex?.value ?? -1) - (a.wokeIndex?.value ?? -1));
  } else if (mode === 'woke-asc') {
    arr.sort((a, b) => (a.wokeIndex?.value ?? 99) - (b.wokeIndex?.value ?? 99));
  }
  return arr;
}

function bindBallotActions() {
  document.getElementById('copy-ballot').addEventListener('click', copyBallot);
  document.getElementById('print-ballot').addEventListener('click', () => window.print());
  document.getElementById('clear-ballot').addEventListener('click', () => {
    if (!confirm('Clear all selections for this election?')) return;
    STATE.selections = {};
    saveSelections();
    render();
  });
}

function applyFilters(races) {
  const f = STATE.filters;
  return races.filter((race) => {
    if (f.levels.size && !f.levels.has(race.level)) return false;
    if (f.contestedOnly && race.candidates.length < 2) return false;
    if (f.undecidedOnly && STATE.selections[race.id]) return false;
    if (f.parties.size) {
      const has = race.candidates.some((c) => f.parties.has(c.party));
      if (!has) return false;
    }
    if (f.search) {
      const haystack = (
        race.office +
        ' ' +
        (race.district || '') +
        ' ' +
        race.candidates.map((c) => `${c.name} ${c.party} ${c.occupation || ''}`).join(' ')
      ).toLowerCase();
      if (!haystack.includes(f.search)) return false;
    }
    return true;
  });
}

function sortRaces(races) {
  const sort = STATE.filters.sort;
  if (sort === 'level') {
    return [...races].sort((a, b) => {
      const la = LEVEL_ORDER.indexOf(a.level);
      const lb = LEVEL_ORDER.indexOf(b.level);
      if (la !== lb) return la - lb;
      return (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0);
    });
  }
  if (sort === 'contested') {
    return [...races].sort((a, b) => b.candidates.length - a.candidates.length);
  }
  return [...races].sort((a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0));
}

function render() {
  const container = document.getElementById('races');
  container.innerHTML = '';
  const races = sortRaces(applyFilters(STATE.election.races));
  if (!races.length) {
    container.innerHTML = '<div class="empty-state">No races match those filters.</div>';
  } else {
    races.forEach((race) => container.appendChild(renderRace(race)));
  }
  renderBallot();
}

function renderRace(race) {
  const tpl = document.getElementById('tpl-race').content.cloneNode(true);
  const article = tpl.querySelector('.race');
  article.dataset.raceId = race.id;
  article.querySelector('.race-office').textContent = race.office +
    (race.district ? ` — ${race.district}` : '');
  const metaParts = [];
  if (LEVEL_LABELS[race.level]) metaParts.push(LEVEL_LABELS[race.level]);
  if (race.termYears) metaParts.push(`${race.termYears}-year term`);
  if (race.seat === 'open') metaParts.push('open seat');
  if (race.incumbent) metaParts.push(`incumbent: ${race.incumbent}`);
  if (race.voteFor && race.voteFor > 1) metaParts.push(`vote for ${race.voteFor}`);
  if (race.notes) metaParts.push(race.notes);
  article.querySelector('.race-meta').textContent = metaParts.join(' · ');

  const tag = article.querySelector('.race-tag');
  if (race.candidates.length < 2) {
    tag.textContent = 'uncontested';
    tag.classList.add('uncontested');
  } else {
    tag.textContent = `${race.candidates.length} candidates`;
  }

  const list = article.querySelector('.candidates');
  sortCandidates(race.candidates).forEach((c) => list.appendChild(renderCandidate(race, c)));
  return article;
}

function renderCandidate(race, candidate) {
  const tpl = document.getElementById('tpl-candidate').content.cloneNode(true);
  const li = tpl.querySelector('.candidate');
  const radio = tpl.querySelector('input[type=radio]');
  radio.name = `race-${race.id}`;
  const candidateKey = candidate.name;
  radio.value = candidateKey;
  if (STATE.selections[race.id] === candidateKey) {
    radio.checked = true;
    li.classList.add('selected');
  }
  radio.addEventListener('change', () => {
    STATE.selections[race.id] = candidateKey;
    saveSelections();
    document
      .querySelectorAll(`[data-race-id="${race.id}"] .candidate`)
      .forEach((el) => el.classList.remove('selected'));
    li.classList.add('selected');
    renderBallot();
  });
  // allow deselect by clicking selected radio
  radio.addEventListener('click', (e) => {
    if (radio.dataset.wasChecked === 'true') {
      radio.checked = false;
      delete STATE.selections[race.id];
      saveSelections();
      li.classList.remove('selected');
      renderBallot();
      radio.dataset.wasChecked = 'false';
      e.preventDefault();
    } else {
      radio.dataset.wasChecked = 'true';
    }
  });

  tpl.querySelector('.candidate-name').textContent = candidate.name;
  const partyEl = tpl.querySelector('.candidate-party');
  partyEl.textContent = candidate.party || 'No Party Preference';
  partyEl.classList.add(`party-${(candidate.party || 'None').split(' ')[0]}`);
  if (candidate.incumbent) {
    tpl.querySelector('.candidate-incumbent').hidden = false;
  }
  tpl.querySelector('.candidate-occupation').textContent =
    candidate.occupation || '';

  const scandalEl = tpl.querySelector('.candidate-scandal');
  scandalEl.appendChild(renderScandal(candidate));

  const chanceEl = tpl.querySelector('.candidate-chance');
  renderChance(chanceEl, candidate.winChance);
  const wokeEl = tpl.querySelector('.candidate-woke');
  renderWoke(wokeEl, candidate.wokeIndex);

  return li;
}

function renderWoke(el, w) {
  if (!w || w.value == null) {
    el.classList.add('woke-unknown');
    const v = document.createElement('span');
    v.className = 'woke-value';
    v.textContent = '—';
    el.appendChild(v);
    const s = document.createElement('span');
    s.className = 'woke-source';
    s.textContent = 'woke n/a';
    el.appendChild(s);
    el.title = w?.rationale || 'No woke index available.';
    return;
  }
  const v = document.createElement('span');
  v.className = 'woke-value';
  v.textContent = `${w.value}/10`;
  el.appendChild(v);
  const bar = document.createElement('div');
  bar.className = 'woke-bar';
  const fill = document.createElement('span');
  fill.style.width = `${(w.value / 10) * 100}%`;
  bar.appendChild(fill);
  el.appendChild(bar);
  const s = document.createElement('span');
  s.className = `woke-source confidence-${w.confidence || 'medium'}`;
  s.textContent = `woke · ${w.confidence || 'medium'}`;
  el.appendChild(s);
  el.title = [w.rationale || '', w.confidence ? `confidence: ${w.confidence}` : ''].filter(Boolean).join(' · ');
}

function renderScandal(c) {
  const frag = document.createDocumentFragment();
  const sc = c.scandal || {};
  const searchUrl =
    sc.url || `https://www.google.com/search?q=${encodeURIComponent((sc.searchQuery || `${c.name} controversy scandal`))}`;
  if (sc.summary) {
    const span = document.createElement('span');
    span.className = 'scandal-summary';
    span.textContent = sc.summary;
    frag.appendChild(span);
  } else {
    const span = document.createElement('span');
    span.className = 'scandal-none';
    span.textContent = sc.none ? 'No notable controversy found.' : 'Needs research.';
    frag.appendChild(span);
  }
  const link = document.createElement('a');
  link.className = 'scandal-link';
  link.href = searchUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'search ↗';
  frag.appendChild(link);
  return frag;
}

function renderChance(el, wc) {
  if (!wc || wc.value == null) {
    el.classList.add('chance-unknown');
    const v = document.createElement('span');
    v.className = 'chance-value';
    v.textContent = wc?.label || '—';
    el.appendChild(v);
    if (wc?.source) {
      const s = document.createElement('span');
      s.className = 'chance-source';
      s.textContent = wc.source;
      el.appendChild(s);
    }
    el.title = [wc?.source, wc?.asOf ? `as of ${wc.asOf}` : '', wc?.note || ''].filter(Boolean).join(' · ');
    return;
  }
  const pct = Math.round(wc.value * 100);
  const v = document.createElement('span');
  v.className = 'chance-value';
  v.textContent = `${pct}%`;
  el.appendChild(v);
  const bar = document.createElement('div');
  bar.className = 'chance-bar';
  const fill = document.createElement('span');
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  el.appendChild(bar);
  const s = document.createElement('span');
  s.className = 'chance-source';
  if (wc.url) {
    const a = document.createElement('a');
    a.href = wc.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = wc.source || 'source';
    s.appendChild(a);
  } else {
    s.textContent = wc.source || '';
  }
  el.appendChild(s);
  el.title = [wc.source, wc.asOf ? `as of ${wc.asOf}` : '', wc.note || ''].filter(Boolean).join(' · ');
}

function renderBallot() {
  const list = document.getElementById('ballot-list');
  list.innerHTML = '';
  const total = STATE.election.races.length;
  const chosen = Object.keys(STATE.selections).filter((rid) =>
    STATE.election.races.some((r) => r.id === rid)
  ).length;
  document.getElementById('ballot-count').textContent = `${chosen} / ${total}`;

  STATE.election.races.forEach((race) => {
    const li = document.createElement('li');
    const sel = STATE.selections[race.id];
    if (sel) {
      const cand = race.candidates.find((c) => c.name === sel);
      li.className = 'ballot-item';
      li.innerHTML = `<div class="office">${escapeHtml(race.office)}${
        race.district ? ' — ' + escapeHtml(race.district) : ''
      }</div><div>${escapeHtml(sel)}${
        cand?.party ? ` <span class="candidate-party party-${escapeHtml((cand.party || '').split(' ')[0])}">${escapeHtml(cand.party)}</span>` : ''
      }</div>`;
    } else {
      li.className = 'ballot-item empty';
      li.innerHTML = `<div class="office">${escapeHtml(race.office)}${
        race.district ? ' — ' + escapeHtml(race.district) : ''
      }</div><div>(no choice yet)</div>`;
    }
    list.appendChild(li);
  });
}

function copyBallot() {
  const lines = [`My Ballot — ${STATE.election.name}`, ''];
  STATE.election.races.forEach((race) => {
    const sel = STATE.selections[race.id];
    const office = race.office + (race.district ? ` — ${race.district}` : '');
    lines.push(`${office}: ${sel || '—'}`);
  });
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(
    () => flashButton('copy-ballot', 'Copied!'),
    () => alert('Copy failed. Manual:\n\n' + text)
  );
}

function flashButton(id, label) {
  const btn = document.getElementById(id);
  const orig = btn.textContent;
  btn.textContent = label;
  setTimeout(() => (btn.textContent = orig), 1200);
}

function selectionsKey(eid) {
  return `ballot:${eid}`;
}
function loadSelections(eid) {
  try {
    return JSON.parse(localStorage.getItem(selectionsKey(eid)) || '{}');
  } catch {
    return {};
  }
}
function saveSelections() {
  localStorage.setItem(selectionsKey(STATE.election.id), JSON.stringify(STATE.selections));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showError(msg) {
  const c = document.getElementById('races');
  c.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

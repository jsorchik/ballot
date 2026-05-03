'use strict';

const STATE = {
  electionsIndex: null,
  electionMeta: null,           // entry from elections.json
  jurisdictionMeta: null,       // entry from elections.json's jurisdictions[]
  statewide: null,              // loaded statewide data (or null if election has none)
  jurisdiction: null,           // loaded jurisdiction data
  election: null,               // merged view: { id, name, date, lastUpdated, races, ... }
  filters: {
    search: '',
    levels: new Set(),
    showMinor: false,
    sort: 'ballot',
    candidateSort: 'default',
  },
  selections: {},
};

const JURISDICTION_PREF_KEY = 'lastJurisdiction';

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

  const electionSelect = document.getElementById('election-select');
  STATE.electionsIndex.elections.forEach((e) => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.name;
    electionSelect.appendChild(opt);
  });
  electionSelect.addEventListener('change', () => loadElection(electionSelect.value));

  const jurisdictionSelect = document.getElementById('jurisdiction-select');
  jurisdictionSelect.addEventListener('change', () =>
    loadJurisdiction(STATE.electionMeta.id, jurisdictionSelect.value)
  );

  await loadElection(STATE.electionsIndex.elections[0].id);

  bindFilters();
  bindBallotActions();
}

async function loadElection(electionId) {
  const meta = STATE.electionsIndex.elections.find((e) => e.id === electionId);
  if (!meta) return;
  STATE.electionMeta = meta;

  // Load statewide once per election (shared across jurisdictions).
  STATE.statewide = null;
  if (meta.statewide) {
    const res = await fetch(meta.statewide);
    STATE.statewide = await res.json();
  }

  // Populate jurisdiction picker for this election.
  const jurisdictionSelect = document.getElementById('jurisdiction-select');
  jurisdictionSelect.innerHTML = '';
  meta.jurisdictions.forEach((j) => {
    const opt = document.createElement('option');
    opt.value = j.id;
    opt.textContent = j.name;
    jurisdictionSelect.appendChild(opt);
  });

  const lastChosen = localStorage.getItem(`${JURISDICTION_PREF_KEY}:${electionId}`);
  const initialId =
    (lastChosen && meta.jurisdictions.some((j) => j.id === lastChosen) && lastChosen) ||
    meta.jurisdictions[0].id;
  jurisdictionSelect.value = initialId;

  await loadJurisdiction(electionId, initialId);
}

async function loadJurisdiction(electionId, jurisdictionId) {
  const electionMeta = STATE.electionsIndex.elections.find((e) => e.id === electionId);
  const jMeta = electionMeta.jurisdictions.find((j) => j.id === jurisdictionId);
  if (!jMeta) return;
  STATE.jurisdictionMeta = jMeta;
  localStorage.setItem(`${JURISDICTION_PREF_KEY}:${electionId}`, jurisdictionId);

  const res = await fetch(jMeta.file);
  STATE.jurisdiction = await res.json();

  // Build merged election view.
  const sw = STATE.statewide;
  const ju = STATE.jurisdiction;
  const races = [...(sw?.races || []), ...(ju.races || [])].sort(
    (a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0)
  );
  // "Data as of" should reflect the freshest source — the Polymarket cron
  // updates statewide.json's lastUpdated but not the jurisdiction file's.
  const lastUpdated = [ju.lastUpdated, sw?.lastUpdated]
    .filter(Boolean)
    .sort()
    .reverse()[0];

  STATE.election = {
    id: electionId,
    jurisdictionId: jurisdictionId,
    name: electionMeta.name,
    date: electionMeta.date,
    lastUpdated,
    notes: ju.notes || sw?.notes,
    races,
  };

  STATE.selections = loadSelections(electionId, jurisdictionId);

  renderHeader();
  buildLevelChips();
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

function renderHeader() {
  const path = STATE.jurisdiction?.path || [];
  const breadcrumb = document.getElementById('jurisdiction');
  breadcrumb.innerHTML = '';
  path.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = ' › ';
      breadcrumb.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = 'breadcrumb-seg';
    span.textContent = seg;
    breadcrumb.appendChild(span);
  });

  const districtsEl = document.getElementById('districts-line');
  districtsEl.innerHTML = '';
  const districts = STATE.jurisdiction?.districts || {};
  Object.entries(districts).forEach(([k, v]) => {
    const tag = document.createElement('span');
    tag.className = 'district-tag';
    tag.textContent = `${k}: ${v}`;
    districtsEl.appendChild(tag);
  });

  document.getElementById('last-updated').textContent = STATE.election.lastUpdated
    ? `data as of ${STATE.election.lastUpdated}`
    : '';
}

function bindFilters() {
  document.getElementById('search').addEventListener('input', (e) => {
    STATE.filters.search = e.target.value.toLowerCase().trim();
    render();
  });
  document.getElementById('show-minor').addEventListener('change', (e) => {
    STATE.filters.showMinor = e.target.checked;
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
  } else if (mode === 'lean-prog') {
    arr.sort((a, b) => (b.culturalLean?.value ?? -1) - (a.culturalLean?.value ?? -1));
  } else if (mode === 'lean-trad') {
    arr.sort((a, b) => (a.culturalLean?.value ?? 99) - (b.culturalLean?.value ?? 99));
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

function visibleCandidates(race) {
  const showMinor = STATE.filters.showMinor;
  const search = STATE.filters.search;
  const selected = STATE.selections[race.id];

  return race.candidates.filter((c) => {
    // Always keep the user's selected candidate visible.
    if (c.name === selected) return true;
    // Hide minors unless the toggle is on or search reveals them.
    if (!showMinor && c.tier === 'minor') {
      if (!search) return false;
      const hay = `${c.name} ${c.party} ${c.occupation || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function applyFilters(races) {
  const f = STATE.filters;
  return races.filter((race) => {
    if (f.levels.size && !f.levels.has(race.level)) return false;
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
  const total = race.candidates.length;
  const visible = visibleCandidates(race).length;
  if (total === 0) {
    tag.textContent = 'no candidates';
    tag.classList.add('uncontested');
  } else if (total === 1) {
    tag.textContent = 'uncontested';
    tag.classList.add('uncontested');
  } else if (visible < total) {
    tag.textContent = `${visible} of ${total}`;
  } else {
    tag.textContent = `${total} candidates`;
  }

  const list = article.querySelector('.candidates');
  const cands = visibleCandidates(race);
  sortCandidates(cands).forEach((c) => list.appendChild(renderCandidate(race, c)));
  const hidden = race.candidates.length - cands.length;
  if (hidden > 0) {
    const note = document.createElement('div');
    note.className = 'minor-note';
    note.textContent = `+${hidden} minor candidate${hidden === 1 ? '' : 's'} hidden — toggle "Show minor candidates" above.`;
    article.appendChild(note);
  }
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
    radio.dataset.wasChecked = 'true';
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
  partyEl.classList.add(`party-${partyClass(candidate.party)}`);
  if (candidate.incumbent) {
    tpl.querySelector('.candidate-incumbent').hidden = false;
  }
  tpl.querySelector('.candidate-occupation').textContent =
    candidate.occupation || '';

  const scandalEl = tpl.querySelector('.candidate-scandal');
  scandalEl.appendChild(renderScandal(candidate));

  const financeEl = tpl.querySelector('.candidate-finance');
  financeEl.appendChild(renderFinance(candidate));

  const chanceEl = tpl.querySelector('.candidate-chance');
  renderChance(chanceEl, candidate.winChance);
  const leanEl = tpl.querySelector('.candidate-lean');
  renderLean(leanEl, candidate.culturalLean);

  return li;
}

function renderLean(el, w) {
  if (!w || w.value == null) {
    el.classList.add('lean-unknown');
    const v = document.createElement('span');
    v.className = 'lean-value';
    v.textContent = '—';
    el.appendChild(v);
    const s = document.createElement('span');
    s.className = 'lean-source';
    s.textContent = 'lean n/a';
    el.appendChild(s);
    el.title = w?.rationale || 'No cultural-lean score available.';
    return;
  }
  const v = document.createElement('span');
  v.className = 'lean-value';
  v.textContent = `${w.value}/10`;
  el.appendChild(v);
  const bar = document.createElement('div');
  bar.className = 'lean-bar';
  const fill = document.createElement('span');
  fill.style.width = `${(w.value / 10) * 100}%`;
  bar.appendChild(fill);
  el.appendChild(bar);
  const s = document.createElement('span');
  const conf = w.confidence || 'medium';
  s.className = `lean-source confidence-${conf}`;
  const confLabel = { high: 'high conf.', medium: 'med conf.', low: 'low conf.' }[conf] || conf;
  s.textContent = confLabel;
  el.appendChild(s);
  el.title = [w.rationale || '', `confidence in score: ${conf}`].filter(Boolean).join(' · ');
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

function renderFinance(c) {
  const frag = document.createDocumentFragment();
  const f = c.finance || {};
  const searchUrl =
    f.summaryUrl ||
    f.searchUrl ||
    `https://www.google.com/search?q=${encodeURIComponent(`${c.name} campaign finance donors net worth`)}`;

  const line = document.createElement('span');
  line.className = 'finance-summary';
  if (f.summary) {
    line.innerHTML = `<span class="finance-label">$$ </span>${escapeHtml(f.summary)}`;
  } else {
    line.innerHTML = `<span class="finance-label">$$ </span><span class="finance-none">Not researched</span>`;
  }
  frag.appendChild(line);

  if (f.netWorth) {
    const sep = document.createElement('span');
    sep.className = 'finance-sep';
    sep.textContent = ' · ';
    frag.appendChild(sep);
    const nw = document.createElement('span');
    nw.className = 'finance-networth';
    nw.textContent = `Net worth ${f.netWorth}`;
    if (f.netWorthSource) nw.title = f.netWorthSource;
    frag.appendChild(nw);
  }

  if (f.confidence === 'low' && f.summary) {
    const conf = document.createElement('span');
    conf.className = 'finance-conf';
    conf.textContent = ' (low conf.)';
    conf.title = 'Editorial summary; verify via search link.';
    frag.appendChild(conf);
  }

  const link = document.createElement('a');
  link.className = 'finance-link';
  link.href = searchUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'search ↗';
  frag.appendChild(document.createTextNode(' '));
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
        cand?.party ? ` <span class="candidate-party party-${partyClass(cand.party)}">${escapeHtml(cand.party)}</span>` : ''
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

function selectionsKey(eid, jid) {
  return jid ? `ballot:${eid}:${jid}` : `ballot:${eid}`;
}
function loadSelections(eid, jid) {
  // Try the jurisdiction-scoped key first; fall back to legacy un-scoped key
  // so existing personal data isn't lost across the migration.
  try {
    const raw = localStorage.getItem(selectionsKey(eid, jid));
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem(selectionsKey(eid));
    return legacy ? JSON.parse(legacy) : {};
  } catch {
    return {};
  }
}
function saveSelections() {
  const key = selectionsKey(STATE.election.id, STATE.election.jurisdictionId);
  localStorage.setItem(key, JSON.stringify(STATE.selections));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function partyClass(party) {
  if (!party) return 'NPP';
  const p = party.toLowerCase();
  if (p.startsWith('democratic')) return 'Democratic';
  if (p.startsWith('republican')) return 'Republican';
  if (p.startsWith('green')) return 'Green';
  if (p.startsWith('libertarian')) return 'Libertarian';
  if (p.startsWith('peace')) return 'Peace';
  if (p.startsWith('american')) return 'American';
  if (p.startsWith('no party')) return 'NPP';
  if (p.startsWith('nonpartisan')) return 'Nonpartisan';
  return 'NPP';
}

function showError(msg) {
  const c = document.getElementById('races');
  c.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
}

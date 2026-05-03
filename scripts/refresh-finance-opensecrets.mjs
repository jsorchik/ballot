#!/usr/bin/env node
// Refreshes the `finance` field for any candidate that declares an
// `openSecretsCid`, pulling top-industry / top-contributor data from the
// OpenSecrets CRP API.
//
// OpenSecrets covers FEDERAL candidates (US House / Senate / President).
// State and local races aren't tracked here — for those, see Cal-Access /
// FollowTheMoney or hand-curate.
//
// Setup:
//   1. Free API key: https://www.opensecrets.org/api/admin/index.php?function=signup
//   2. Set OPENSECRETS_API_KEY env var (locally) or as a GH Actions secret.
//   3. Add `openSecretsCid: "N00033552"` to each federal candidate that has one.
//
// Usage:
//   OPENSECRETS_API_KEY=... node scripts/refresh-finance-opensecrets.mjs
//   OPENSECRETS_API_KEY=... node scripts/refresh-finance-opensecrets.mjs path/to/file.json

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_KEY = process.env.OPENSECRETS_API_KEY;
if (!API_KEY) {
  console.error(
    'OPENSECRETS_API_KEY not set. Get a free key at https://www.opensecrets.org/api/'
  );
  process.exit(1);
}

const BASE = 'https://www.opensecrets.org/api/';
const CYCLE = process.env.OPENSECRETS_CYCLE || '2026';
const today = new Date().toISOString().slice(0, 10);

let totalMutations = 0;
const filesToProcess = collectFiles();
for (const file of filesToProcess) {
  totalMutations += await processFile(file);
}
console.error(`\nDone. ${totalMutations} candidate(s) updated.`);

// ---- helpers ----

function collectFiles() {
  if (process.argv[2]) return [resolve(process.argv[2])];
  const idx = JSON.parse(readFileSync('data/elections.json', 'utf8'));
  const files = new Set();
  for (const e of idx.elections) {
    if (e.statewide) files.add(resolve(e.statewide));
    for (const j of e.jurisdictions || []) {
      if (j.file) files.add(resolve(j.file));
    }
  }
  return [...files];
}

async function processFile(filePath) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!data.races) return 0;
  let touched = false;
  let count = 0;

  for (const race of data.races) {
    for (const c of race.candidates) {
      const cid = c.openSecretsCid;
      if (!cid) continue;

      console.error(`[${cid}] ${c.name}`);
      try {
        const [summary, industries] = await Promise.all([
          fetchJson('candSummary', { cid, cycle: CYCLE }),
          fetchJson('candIndustry', { cid, cycle: CYCLE }),
        ]);

        const summaryData = summary?.response?.summary?.['@attributes'] || {};
        const industryRows =
          industries?.response?.industries?.industry?.map((r) => r['@attributes']) || [];

        const total = parseFloat(summaryData.total || '0');
        const totalFmt = formatMoney(total);

        const topIndustries = industryRows
          .slice(0, 3)
          .map((r) => `${r.industry_name} ($${formatMoney(parseFloat(r.total))})`);

        const finance = c.finance || {};
        finance.summary = topIndustries.length
          ? `Top industries: ${topIndustries.join(', ')}`
          : `Total raised: $${totalFmt}`;
        finance.summaryUrl = `https://www.opensecrets.org/members-of-congress/summary?cid=${cid}&cycle=${CYCLE}`;
        finance.totalRaised = totalFmt;
        finance.confidence = 'high';
        finance.source = 'OpenSecrets';
        finance.asOf = today;
        c.finance = finance;
        touched = true;
        count += 1;
        console.error(`  + total $${totalFmt}; top: ${topIndustries[0] || 'n/a'}`);
      } catch (e) {
        console.error(`  ! fetch failed: ${e.message}`);
      }
    }
  }

  if (touched) {
    data.lastUpdated = today;
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    console.error(`  → wrote ${filePath}`);
  }
  return count;
}

async function fetchJson(method, params) {
  const qs = new URLSearchParams({ method, output: 'json', apikey: API_KEY, ...params });
  const url = `${BASE}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${method}`);
  return res.json();
}

function formatMoney(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(Math.round(n));
}

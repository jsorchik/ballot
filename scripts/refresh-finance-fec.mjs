#!/usr/bin/env node
// Refreshes `finance.totalRaised` for any candidate that declares a
// `fecCandidateId`, using the FEC's free open-data API.
//
// FEC tracks FEDERAL races only (House, Senate, President). State governor /
// AG / state legislature races aren't here — for those, finance is curated
// manually.
//
// What this updates:
//   - finance.totalRaised      — cycle-to-date receipts (formatted, e.g., "5.2M")
//   - finance.totalRaisedRaw   — raw dollar number for sorting/comparison
//   - finance.summaryUrl       — link to the FEC profile if not already set
//   - finance.asOf             — today's ISO date
//
// What this DOES NOT touch:
//   - finance.summary          — editorial top-donor / top-industry one-liner
//   - finance.netWorth         — manual disclosure-based estimate
//   - finance.confidence       — editorial confidence flag
//
// Usage:
//   FEC_API_KEY=... node scripts/refresh-finance-fec.mjs
//   node scripts/refresh-finance-fec.mjs                # uses DEMO_KEY (rate-limited)
//
// Get a free key at https://api.data.gov/signup/

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY';
const CYCLE = process.env.FEC_CYCLE || '2026';
const today = new Date().toISOString().slice(0, 10);

if (API_KEY === 'DEMO_KEY') {
  console.error(
    '⚠ Using FEC DEMO_KEY (30 requests/hour limit). Free key at https://api.data.gov/signup/'
  );
}

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
    for (const j of e.jurisdictions || []) files.add(resolve(j.file));
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
      const fid = c.fecCandidateId;
      if (!fid) continue;

      console.error(`[${fid}] ${c.name}`);
      try {
        const url = `https://api.open.fec.gov/v1/candidate/${fid}/totals/?api_key=${API_KEY}&cycle=${CYCLE}&full_election=false&per_page=1`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const row = body?.results?.[0];
        if (!row) {
          console.error('  ! no totals row for this cycle');
          continue;
        }
        const receipts = row.receipts || 0;
        const finance = c.finance || {};
        finance.totalRaised = formatMoney(receipts);
        finance.totalRaisedRaw = receipts;
        finance.summaryUrl = finance.summaryUrl || `https://www.fec.gov/data/candidate/${fid}/?cycle=${CYCLE}`;
        finance.asOf = today;
        finance.totalRaisedSource = 'FEC';
        c.finance = finance;
        touched = true;
        count += 1;
        console.error(`  + raised $${formatMoney(receipts)} (cycle ${CYCLE})`);
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

function formatMoney(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(Math.round(n));
}

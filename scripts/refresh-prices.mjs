#!/usr/bin/env node
// Refreshes winChance values for any race that declares a `priceSources.polymarket`
// block, using the public Polymarket Gamma API.
//
// Without args, walks data/elections.json and processes every statewide and
// jurisdiction file referenced there. With a path arg, processes just that
// one file. Designed to be idempotent and safe to run from CI: if it can't
// find a market or the market is too illiquid, leaves the existing value
// alone and adds a note instead.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const today = new Date().toISOString().slice(0, 10);

let totalMutations = 0;
const filesToProcess = collectFiles();

for (const file of filesToProcess) {
  const mutations = await processFile(file);
  totalMutations += mutations;
}
console.error(`\nDone. ${totalMutations} value(s) changed across ${filesToProcess.length} file(s).`);

// ---- helpers ----

function collectFiles() {
  if (process.argv[2]) return [resolve(process.argv[2])];
  const indexPath = resolve('data/elections.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const files = new Set();
  for (const e of index.elections) {
    if (e.statewide) files.add(resolve(e.statewide));
    for (const j of e.jurisdictions || []) {
      if (j.file) files.add(resolve(j.file));
    }
  }
  return [...files];
}

async function processFile(filePath) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!data.races) {
    console.error(`[${filePath}] no races field, skipping`);
    return 0;
  }

  let mutations = 0;
  let touched = false;

  for (const race of data.races) {
    const cfg = race.priceSources?.polymarket;
    if (!cfg?.eventSlug) continue;

    console.error(`[${race.id}] fetching Polymarket event "${cfg.eventSlug}"`);
    let event;
    try {
      const url = `${GAMMA_BASE}/events?slug=${encodeURIComponent(cfg.eventSlug)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json();
      event = Array.isArray(arr) ? arr[0] : arr;
      if (!event?.markets) throw new Error('no markets in response');
    } catch (e) {
      console.error(`[${race.id}] fetch failed: ${e.message}`);
      continue;
    }

    const matchKey = cfg.matchBy || 'groupItemTitle';
    const minLiq = cfg.minLiquidity ?? 100;

    for (const candidate of race.candidates) {
      const market = event.markets.find(
        (m) =>
          m[matchKey] &&
          normalize(m[matchKey]) === normalize(candidate.name) &&
          !m.closed
      );

      if (!market) {
        console.error(`  - ${candidate.name}: no market match`);
        continue;
      }

      const liq = market.liquidityNum || 0;
      const bid = num(market.bestBid);
      const ask = num(market.bestAsk);
      const spread = bid != null && ask != null ? ask - bid : null;

      const before = candidate.winChance?.value ?? null;
      const wc = candidate.winChance || {};
      wc.url = `https://polymarket.com/event/${cfg.eventSlug}`;
      wc.asOf = today;
      wc.liquidityUsd = Math.round(liq);

      if (bid == null || ask == null || spread >= 0.2) {
        wc.value = null;
        wc.label = 'no quote';
        wc.source = 'Polymarket';
        wc.note = `No liquid two-sided market (bid=${fmt(bid)}, ask=${fmt(ask)}, liq $${Math.round(liq)}).`;
        delete wc.basis;
      } else {
        wc.value = round((bid + ask) / 2, 4);
        wc.basis = 'mid';
        delete wc.label;
        if (liq < minLiq) {
          wc.source = 'Polymarket (illiquid)';
          wc.note = `Thin market (~$${Math.round(liq)} liquidity); price may not reflect real consensus.`;
        } else {
          wc.source = 'Polymarket';
          if (wc.note && (wc.note.startsWith('Thin market') || wc.note.startsWith('No liquid'))) {
            delete wc.note;
          }
        }
      }
      candidate.winChance = wc;
      touched = true;

      if (before !== wc.value) mutations += 1;
      console.error(
        `  + ${candidate.name}: ${pct(before)} → ${pct(wc.value)}  (bid=${fmt(bid)} ask=${fmt(ask)} liq $${Math.round(liq)})`
      );
    }
  }

  if (touched) {
    data.lastUpdated = today;
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    console.error(`  → wrote ${filePath}\n`);
  }
  return mutations;
}

function normalize(s) {
  return String(s).toLowerCase().replace(/[\s.\-']+/g, '').trim();
}
function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function round(v, places) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
function pct(v) {
  if (v == null) return '—';
  return (v * 100).toFixed(1) + '%';
}
function fmt(v) {
  return v == null ? '—' : v.toFixed(3);
}

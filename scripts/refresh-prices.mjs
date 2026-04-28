#!/usr/bin/env node
// Refreshes winChance values for any race that declares a `priceSources.polymarket`
// block, using the public Polymarket Gamma API. Writes updates back to the JSON
// file. Designed to be idempotent and safe to run from CI: if it can't find a
// market, or the market is too illiquid, it leaves the existing value alone and
// just appends a note.
//
// Usage:
//   node scripts/refresh-prices.mjs [path-to-election.json]
//
// Default path: data/2026-06-primary.json
// Exit code 0 on success (whether or not anything changed).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const filePath = resolve(process.argv[2] || 'data/2026-06-primary.json');

const election = JSON.parse(readFileSync(filePath, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let mutations = 0;

for (const race of election.races) {
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

    // Honesty rules: only price a market that has BOTH a bid and an ask, and
    // skip if the spread is too wide (>= 20¢) — wide spreads mean nobody really
    // believes a price.
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

    if (before !== wc.value) mutations += 1;
    console.error(
      `  + ${candidate.name}: ${pct(before)} → ${pct(wc.value)}  (bid=${fmt(bid)} ask=${fmt(ask)} liq $${Math.round(liq)})`
    );
  }
}

election.lastUpdated = today;
writeFileSync(filePath, JSON.stringify(election, null, 2) + '\n');

console.error(`\nDone. ${mutations} value(s) changed. Wrote ${filePath}.`);

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

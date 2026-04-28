# Ballot Builder

A personal voting-decision tool. Lists candidates for each office on the ballot
with their party, a one-liner about their biggest known controversy (with a
search link for more), and a rough probability of winning where one is available.
Pick choices, copy the list, take it to the polling place.

Built first for the **California Primary — June 2, 2026**, scoped to a Sonoma
County (unincorporated, near Petaluma) ballot. Designed to be reused for future
elections by adding new files under `data/`.

## Run locally

```sh
python3 -m http.server 8765
# then open http://localhost:8765
```

(`fetch()` requires HTTP — opening `index.html` directly via `file://` won't work.)

## Add a new election

1. Drop a new file at `data/<id>.json` matching the shape of
   `data/2026-06-primary.json`.
2. Add an entry to `data/elections.json`.
3. Reload — the dropdown picks it up.

## Win-chance sources

- **Federal/Governor/Senate races**: prediction markets when available
  ([Polymarket](https://polymarket.com/), [Kalshi](https://kalshi.com/)).
- **Statewide downballot, state legislature, county**: rough estimate based on
  incumbency, district partisan lean, and field size — clearly labeled as
  estimates, not market data.
- **Local/judicial**: usually no meaningful forecast; shown as `—`.

Hover the chance value for source/date/note details.

## Scandal one-liners

Editorial calls based on contemporaneous reporting. For races without a confident
one-liner, the entry shows "Needs research" with a Google search link. Update the
JSON as you find more.

## Deploy to GitHub Pages

1. `git remote add origin git@github.com:<you>/<repo>.git`
2. `git push -u origin main`
3. On GitHub: Settings → Pages → Source: `main` / `/ (root)`.

No build step — it's plain HTML/CSS/JS.

## Files

- `index.html` — markup + templates
- `styles.css` — layout, candidate cards, ballot panel, print styles
- `app.js` — state, filters, sort, selection, localStorage, ballot rendering
- `data/elections.json` — list of available elections
- `data/<id>.json` — race + candidate data for one election

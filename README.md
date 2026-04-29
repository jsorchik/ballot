# Ballot Builder

A personal voting-decision tool. Lists every candidate on the ballot with
their party, a one-liner about their biggest known controversy (with a
search link for more), a rough probability of winning where one's
available, and a 0–10 "woke index" with a one-line rationale. Pick
choices, copy the list, take it to the polling place.

Built first for the **California Primary — June 2, 2026**, with one
jurisdiction populated: Sonoma County (unincorporated, near Petaluma).
Designed so anyone can fork-and-PR their own jurisdiction.

## Run locally

```sh
python3 -m http.server 8765
# then open http://localhost:8765
```

(`fetch()` requires HTTP — opening `index.html` via `file://` won't work.)

## Data model

```
data/
  elections.json                          # index: elections + their jurisdictions
  2026-06-primary/
    statewide.json                        # races every CA voter sees (Gov, AG, …)
    sonoma-petaluma.json                  # local races for one jurisdiction
    <your-jurisdiction>.json              # add your own here
```

`elections.json` is the routing table:

```json
{
  "elections": [
    {
      "id": "2026-06-primary",
      "name": "California Primary — June 2, 2026",
      "date": "2026-06-02",
      "statewide": "data/2026-06-primary/statewide.json",
      "jurisdictions": [
        {
          "id": "sonoma-petaluma",
          "name": "Sonoma County — Petaluma area (unincorporated)",
          "file": "data/2026-06-primary/sonoma-petaluma.json"
        }
      ]
    }
  ]
}
```

The app loads `statewide.json` once per election and merges its races
with whatever jurisdiction the user picked. Race ordering is governed
by each race's `ballotOrder` field.

## Add your jurisdiction

1. Copy `data/2026-06-primary/sonoma-petaluma.json` to
   `data/2026-06-primary/<your-jurisdiction>.json`.
2. Update the top of the file:
   ```json
   "id": "your-jurisdiction-id",
   "name": "Your jurisdiction display name",
   "path": ["State", "County", "City or area"],
   "districts": {
     "Congress": "CA-NN",
     "State Senate": "SD-NN",
     "State Assembly": "AD-NN",
     "Supervisor": "BOS District N"
   }
   ```
   `path` shows up as a breadcrumb in the header. `districts` shows up
   as small tags below it.
3. Replace each race's candidate list with the actual candidates for
   your district. Look up your sample ballot, your county registrar's
   "Candidates Who Filed" page, and Wikipedia/Ballotpedia.
4. Add an entry to `elections.json`:
   ```json
   { "id": "your-jurisdiction-id", "name": "Display name", "file": "data/2026-06-primary/your-jurisdiction-id.json" }
   ```
5. Reload — the dropdown picks it up.

For statewide races (Governor, AG, etc.) you don't need to do anything —
they're shared across all CA jurisdictions in `statewide.json`. Add a
`statewide.json` only when you build out a new election.

## Win-chance sources

- **Federal/Governor/Senate races**: prediction markets when available
  ([Polymarket](https://polymarket.com/), [Kalshi](https://kalshi.com/)).
- **Statewide downballot, state legislature, county**: rough estimate based on
  incumbency, district partisan lean, and field size — labeled as estimates,
  not market data.
- **Local/judicial**: usually no meaningful forecast; shown as `—`.

Hover the chance value for source/date/note.

### Live Polymarket refresh

Any race in any data file can declare a `priceSources.polymarket` block:

```json
"priceSources": {
  "polymarket": {
    "eventSlug": "california-governor-primary-election-first-place",
    "matchBy": "groupItemTitle",
    "minLiquidity": 200
  }
}
```

`scripts/refresh-prices.mjs` walks every file referenced in
`elections.json`, hits the public Polymarket Gamma API, matches each
candidate to a market by `groupItemTitle`, and updates `winChance` with
the bid/ask midpoint. Honesty rules:

- Requires **both** a best-bid and best-ask, with a spread under 20¢.
  Wider than that → `value: null` + `"no quote"` label.
- If liquidity is below `minLiquidity` the source becomes
  `Polymarket (illiquid)` with a thinness note in the tooltip.

```sh
node scripts/refresh-prices.mjs                   # refresh everything
node scripts/refresh-prices.mjs path/to/file.json # refresh one file
```

`.github/workflows/refresh-prices.yml` runs every 6 hours and on manual
dispatch, commits any changes, and triggers the GH Pages rebuild.

## Woke index

0 = traditional/anti-DEI/anti-identity-politics, 10 = strongly
progressive on identity, DEI, criminal justice reform, and culture-war
issues. Each candidate also has a `confidence` flag (high/medium/low)
based on how much public record exists. It's editorial — feel free to
disagree and edit.

## Scandal one-liners

Editorial calls based on contemporaneous reporting. Where there's no
confident one-liner, the entry shows "Needs research" with a Google
search link.

## Deploy to GitHub Pages

```sh
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then on GitHub: Settings → Pages → Source: `main` / `/ (root)`.
No build step — plain HTML/CSS/JS.

## Files

- `index.html` — markup + templates
- `styles.css` — layout, candidate cards, ballot panel, print styles
- `app.js` — state, filters, sort, selection, localStorage, header
- `data/elections.json` — index of elections + jurisdictions
- `data/<election>/statewide.json` — races shared across all jurisdictions
- `data/<election>/<jurisdiction>.json` — local races for one jurisdiction
- `scripts/refresh-prices.mjs` — Polymarket price refresher
- `.github/workflows/refresh-prices.yml` — 6-hour cron + manual dispatch

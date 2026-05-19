# dota-scout

Counter-draft intel dashboard for **amateur** Dota teams. Pin one enemy by `team_id`,
run a build, and get a static web dashboard summarizing their roster, per-position
hero pools, recent pubs, and top ban candidates.

Built with Next.js (App Router) + Tailwind. All data is fetched from
[STRATZ](https://stratz.com/api) **at build time** by `scripts/prefetch.ts` and
baked into `data/team.json`. The frontend is a plain static page — no server,
no API routes, no client-side network calls.

## Quick start

```powershell
npm install

# 1. Save your STRATZ JWT + the team you want to scout.
Copy-Item .env.local.example .env.local
# edit .env.local: STRATZ_TOKEN=<jwt>, TEAM_ID=<numeric team id>

# 2. Fetch + render.
npm run dev        # runs prefetch then `next dev` on http://localhost:3000
```

To build a static bundle (e.g. for hosting on GitHub Pages, S3, etc.):

```powershell
npm run build
npm start          # serves .next/ locally
```

`prefetch` runs automatically via `predev` / `prebuild`. To refresh data without
restarting, run `npm run prefetch` and hard-reload the page.

Get a STRATZ JWT at <https://stratz.com/api>. The token is **server-side only** —
it only ever lives in `.env.local` and is read by `scripts/prefetch.ts`. It is
never bundled into the client.

## What you get

- **Team header** — name, lifetime W-L (9-month window), last match, sample size.
- **5 player cards** — each with primary position, flex tag, and a collapsible
  block per position they actually play. Each position block shows team-scrim
  hero pool side-by-side with last-90-days pub picks.
- **Ban targets by position** — top 10 ranked threats per slot, aggregated
  across the roster, with flex boosts and team/pub provenance.

### Tag legend

- `COMFORT` — ≥ 5 games at the position, WR ≥ 60%.
- `HIDDEN-GEM` — ≥ 5 games at the position, WR ≥ 70% (and not already COMFORT).
- `Flex` (player-level) — ≥ 20% of their team games in two or more positions
  (min 10 total). Flex players' picks get a ×1.1 score boost on ban targets.

### Scoring

`score = winrate × log10(games + 1)` — rewards winrate **and** sample size. Pub
picks are down-weighted (×0.6) relative to team scrims when aggregating bans.

## Why team-id, not match-id?

STRATZ exposes real positions (1–5) per player and per-position hero
performance scoped to "matches played WITH this team". That's a much cleaner
signal than OpenDota's `lane_role` (1/2/3) — no conflating pos 1 with pos 5,
or pos 3 with pos 4. And STRATZ returns this data for amateur teams that
OpenDota's team endpoints would refuse.

`POSITION_1` = carry, `POSITION_2` = mid, `POSITION_3` = offlane,
`POSITION_4` = soft support, `POSITION_5` = hard support.

## Project layout

```
app/
  layout.tsx              root layout
  page.tsx                imports data/team.json + renders the dashboard
  globals.css             tailwind directives
components/
  TeamHeader.tsx
  PlayerCard.tsx          collapsible per-position blocks
  PositionBlock.tsx       team scrims vs recent pubs, parallel
  PickList.tsx
  BanTargets.tsx
lib/
  positions.ts            Position 1..5 + STRATZ enum mapping
  errors.ts               UserError / ApiError
  stratz.ts               GraphQL client (fetch + retries + timeout)
  types.ts                TeamReport data contract (JSON-serializable)
  fetch-team-data.ts      buildTeamReport — analysis + ban aggregation
scripts/
  prefetch.ts             reads .env.local, writes data/team.json
data/
  team.json               build artifact (gitignored)
```

## Configuration knobs

All tuning constants live at the top of `lib/fetch-team-data.ts`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `TEAM_WINDOW_DAYS` | 270 | How far back to look at team scrims. |
| `PUB_WINDOW_DAYS` | 90 | Pub-matchmaking window. |
| `TEAM_MATCH_TAKE` | 100 | Matches pulled to derive the roster. |
| `HERO_TAKE_TEAM` | 30 | Hero pool size per player×position (team). |
| `HERO_TAKE_PUB` | 15 | Hero pool size per player×position (pub). |
| `COMFORT_MIN_GAMES` / `COMFORT_MIN_WR` | 5 / 0.6 | COMFORT tag threshold. |
| `GEM_MIN_GAMES` / `GEM_MIN_WR` | 5 / 0.7 | HIDDEN-GEM tag threshold. |
| `FLEX_SHARE` / `FLEX_MIN_TOTAL_GAMES` | 0.2 / 10 | Flex-player threshold. |
| `FLEX_BOOST` | 1.1 | Score multiplier for flex picks on ban list. |
| `PUB_WEIGHT` | 0.6 | Down-weight for pub picks vs team scrims. |
| `PER_PLAYER` / top-10 cutoff | 6 / 10 | Ban candidates per player and per position. |

## Rate limits

STRATZ free tier: 10 req/s, 500/day, 20k/month. A full build issues ~3 round
trips: hero constants, team meta + recent matches, and one bulk aliased Roster
query (5 players × 5 positions × team + pub ≈ 50 subqueries in a single HTTP
call). Comfortably within free tier.

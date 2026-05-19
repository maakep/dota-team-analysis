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

# 2. Fetch data from STRATZ (writes data/team.json).
npm run prefetch

# 3. Run the dashboard.
npm run dev        # http://localhost:3000
```

To build a static bundle:

```powershell
npm run build       # exports out/  (does NOT prefetch — run prefetch first)
```

The build emits an `out/` directory of pure static HTML/CSS/JS — that's
what gets uploaded to Pages. Set `BASE_PATH=/your-repo-name` if you're
hosting on a project page (so asset URLs get prefixed correctly).

## Deploy to GitHub Pages

This repo ships with **two** Pages workflows that share the same
deployment target. Pick the one that matches your situation.

### Primary: fallback workflow (`pages.yml`)

`.github/workflows/pages.yml` triggers on every push to `main` (and on
manual dispatch). It builds the site from whatever `data/team.json` is
currently committed to the repo — no STRATZ call in CI. This is the
default flow because STRATZ pins personal API tokens to a single IP,
which GitHub-hosted runners can't satisfy.

To refresh data:

```powershell
npm run refresh    # prefetch + git add data/team.json + commit + push
```

The push to `main` re-triggers `pages.yml`, which redeploys the site
with the new data.

### Optional: in-CI prefetch (`deploy.yml`)

`.github/workflows/deploy.yml` is the original design: a manual
`workflow_dispatch` that runs the prefetch inside the runner. It's kept
for the day STRATZ allows your token from multiple IPs (a custom
allowlist, a stable-IP proxy, etc.). Inputs: `team_id`,
`team_window_days`, `pub_window_days`, `ban_min_games_team`,
`ban_min_games_pub`, `top_ban_min_games`.

If STRATZ rejects the runner's IP the prefetch step fails fast and the
deploy is skipped, leaving the existing Pages site (and committed
`data/team.json`) intact.

### One-time setup

1. Push the repo to GitHub (`dota-team-analysis`).
2. Settings → Secrets and variables → Actions → add `STRATZ_TOKEN`
   (only needed by `deploy.yml`; `pages.yml` doesn't read it).
3. Settings → Pages → Source: **GitHub Actions**.
4. Push to `main` → `pages.yml` builds and deploys to
   `https://maakep.github.io/dota-team-analysis/`.

Get a STRATZ JWT at <https://stratz.com/api>. The token is **server-side only** —
it only ever lives in `.env.local` (or as a GitHub Actions secret) and
is read by `scripts/prefetch.ts`. It is never bundled into the client.

## What you get

- **Team header** — name, lifetime W-L (9-month window), last match, sample size.
- **5 player cards** — each with primary position, flex tag, and a collapsible
  block per position they actually play. Each position block shows team-scrim
  hero pool side-by-side with their pub picks over the same window.
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

Defaults live at the top of `lib/fetch-team-data.ts`. The starred ones
can be overridden via env var (and the GitHub Actions workflow exposes
them as `workflow_dispatch` inputs).

| Constant | Default | Env override | Meaning |
| --- | --- | --- | --- |
| `TEAM_WINDOW_DAYS` | 270 | `TEAM_WINDOW_DAYS` | How far back to look at team scrims. |
| `PUB_WINDOW_DAYS` | 270 | `PUB_WINDOW_DAYS` | Pub-matchmaking window (default synced to the team window). |
| `BAN_MIN_GAMES_TEAM` | 3 | `BAN_MIN_GAMES_TEAM` | Min team games to surface a ban card. |
| `BAN_MIN_GAMES_PUB` | 5 | `BAN_MIN_GAMES_PUB` | Min pub games to surface a ban card. |
| `TOP_BAN_MIN_GAMES` | 3 | `TOP_BAN_MIN_GAMES` | Min team games for the priority-bans list. |
| `TEAM_MATCH_TAKE` | 100 | — | Matches pulled to derive the roster. |
| `HERO_TAKE_TEAM` | 30 | — | Hero pool size per player×position (team). |
| `HERO_TAKE_PUB` | 50 | — | Hero pool size per player×position (pub). |
| `COMFORT_MIN_GAMES` / `COMFORT_MIN_WR` | 5 / 0.6 | — | COMFORT tag threshold. |
| `GEM_MIN_GAMES` / `GEM_MIN_WR` | 5 / 0.7 | — | HIDDEN-GEM tag threshold. |
| `FLEX_SHARE` / `FLEX_MIN_TOTAL_GAMES` | 0.2 / 10 | — | Flex-player threshold. |
| `FLEX_BOOST` | 1.1 | — | Score multiplier for flex picks on ban list. |
| `PUB_WEIGHT` | 0.6 | — | Down-weight for pub picks vs team scrims. |

## Rate limits

STRATZ free tier: 10 req/s, 500/day, 20k/month. A full build issues ~3 round
trips: hero constants, team meta + recent matches, and one bulk aliased Roster
query (5 players × 5 positions × team + pub ≈ 50 subqueries in a single HTTP
call). Comfortably within free tier.

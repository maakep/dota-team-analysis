// Pure ban-aggregation logic. Extracted from fetch-team-data.ts so it can run
// both at build time (prefetch) and client-side (player selection recompute).
//
// All functions here are synchronous, deterministic, and JSON-safe — no API
// access, no env vars, no side effects. They take PlayerReport[] (already
// fully hydrated with league/pub hero pools) and produce ban candidates.

import { ALL_POSITIONS, type Position } from "./positions";
import type { BanCandidate, PlayerReport, TeamBanCandidate } from "./types";

// ──────────────────────────────────────────────────────────────────────────
// Tuning knobs — same defaults as fetch-team-data.ts. Hard-coded here because
// this module must be tree-shakeable for the client bundle (no process.env).
// ──────────────────────────────────────────────────────────────────────────
const BAN_MIN_GAMES = 3;
const TOP_BAN_MIN_GAMES = 3;
const TOP_BAN_COUNT = 7;
const PER_POSITION = 8;
const FLEX_BOOST = 1.1;

const PUB_BAN_MIN_GAMES = 8;
const PUB_BAN_MIN_WR = 0.55;
const PUB_BAN_PER_PLAYER = 3;
const PUB_BAN_PER_POSITION = 6;

// ──────────────────────────────────────────────────────────────────────────
// Scoring helper (same formula used at build time).
// ──────────────────────────────────────────────────────────────────────────
function score(games: number, wins: number): number {
  if (games <= 0) return 0;
  return (wins / games) * Math.log10(games + 1);
}

// ──────────────────────────────────────────────────────────────────────────
// Position(s) a player's league heroes are attributed to for bans.
// Primary position only — no cross-position fanning.
// ──────────────────────────────────────────────────────────────────────────
function positionsForBans(p: PlayerReport): Position[] {
  if (p.primaryPosition === null) return [];
  return [p.primaryPosition];
}

// ──────────────────────────────────────────────────────────────────────────
// Per-position ban aggregation.
// ──────────────────────────────────────────────────────────────────────────
export function aggregateBans(report: PlayerReport[]): Record<Position, BanCandidate[]> {
  const out: Record<Position, BanCandidate[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
  };

  // HERO-FLEX detection: hero played by ≥ 2 distinct roster members.
  const heroToPlayers = new Map<number, Set<number>>();
  for (const p of report) {
    if (p.primaryPosition === null) continue;
    for (const h of p.leagueHeroes) {
      const s = heroToPlayers.get(h.heroId) ?? new Set<number>();
      s.add(p.accountId);
      heroToPlayers.set(h.heroId, s);
    }
  }
  const flexHeroes = new Set<number>();
  for (const [hid, players] of heroToPlayers) {
    if (players.size >= 2) flexHeroes.add(hid);
  }

  // Build per-(position, hero) aggregate.
  interface Agg {
    heroId: number;
    heroName: string;
    shortName: string;
    position: Position;
    teamMatches: number;
    teamWins: number;
    scoreSum: number;
    tags: Set<string>;
    players: Map<number, BanCandidate["players"][number]>;
  }
  const buckets = new Map<string, Agg>();
  const key = (pos: Position, heroId: number) => `${pos}:${heroId}`;

  for (const p of report) {
    const cols = positionsForBans(p);
    for (const pos of cols) {
      for (const h of p.leagueHeroes) {
        const k = key(pos, h.heroId);
        const cur =
          buckets.get(k) ??
          ({
            heroId: h.heroId,
            heroName: h.heroName,
            shortName: h.shortName,
            position: pos,
            teamMatches: 0,
            teamWins: 0,
            scoreSum: 0,
            tags: new Set<string>(),
            players: new Map(),
          } as Agg);
        cur.teamMatches += h.matches;
        cur.teamWins += h.wins;
        cur.scoreSum += h.score;
        for (const t of h.tags) cur.tags.add(t);
        const prev = cur.players.get(p.accountId);
        if (prev) {
          prev.teamMatches += h.matches;
          prev.teamWins += h.wins;
          prev.teamWinRate = prev.teamMatches > 0 ? prev.teamWins / prev.teamMatches : 0;
        } else {
          cur.players.set(p.accountId, {
            accountId: p.accountId,
            playerName: p.name,
            teamMatches: h.matches,
            teamWins: h.wins,
            teamWinRate: h.matches > 0 ? h.wins / h.matches : 0,
            viaFlex: false,
          });
        }
        buckets.set(k, cur);
      }
    }
  }

  for (const a of buckets.values()) {
    if (a.teamMatches < BAN_MIN_GAMES) continue;
    const isFlex = flexHeroes.has(a.heroId);
    if (isFlex) a.tags.add("FLEX");
    const finalScore = a.scoreSum * (isFlex ? FLEX_BOOST : 1);
    const players = Array.from(a.players.values()).sort((x, y) => y.teamMatches - x.teamMatches);
    out[a.position].push({
      heroId: a.heroId,
      heroName: a.heroName,
      shortName: a.shortName,
      position: a.position,
      source: "league",
      teamMatches: a.teamMatches,
      teamWins: a.teamWins,
      teamWinRate: a.teamMatches > 0 ? a.teamWins / a.teamMatches : 0,
      totalMatches: a.teamMatches,
      score: finalScore,
      tags: Array.from(a.tags),
      flexBoosted: isFlex,
      players,
    });
  }

  // Pub-sourced supplemental bans.
  for (const p of report) {
    if (p.primaryPosition === null) continue;
    const pos = p.primaryPosition;
    const leagueHeroIdsInColumn = new Set<number>();
    for (const lh of p.leagueHeroes) {
      if (lh.matches >= BAN_MIN_GAMES) leagueHeroIdsInColumn.add(lh.heroId);
    }

    let added = 0;
    for (const h of p.pubHeroes) {
      if (added >= PUB_BAN_PER_PLAYER) break;
      if (leagueHeroIdsInColumn.has(h.heroId)) continue;
      if (h.matches < PUB_BAN_MIN_GAMES) continue;
      if (h.winRate < PUB_BAN_MIN_WR) continue;
      const tags = [...h.tags, "PUB"];
      out[pos].push({
        heroId: h.heroId,
        heroName: h.heroName,
        shortName: h.shortName,
        position: pos,
        source: "pub",
        teamMatches: h.matches,
        teamWins: h.wins,
        teamWinRate: h.winRate,
        totalMatches: h.matches,
        score: h.score,
        tags,
        flexBoosted: false,
        players: [
          {
            accountId: p.accountId,
            playerName: p.name,
            teamMatches: h.matches,
            teamWins: h.wins,
            teamWinRate: h.winRate,
            viaFlex: false,
          },
        ],
      });
      added++;
    }
  }

  // Sort and cap per position.
  for (const pos of ALL_POSITIONS) {
    const all = out[pos];
    const league = all
      .filter((b) => b.source === "league")
      .sort((a, b) => {
        if (b.teamMatches !== a.teamMatches) return b.teamMatches - a.teamMatches;
        return b.score - a.score;
      })
      .slice(0, PER_POSITION);
    const pub = all
      .filter((b) => b.source === "pub")
      .sort((a, b) => {
        if (b.teamMatches !== a.teamMatches) return b.teamMatches - a.teamMatches;
        return b.score - a.score;
      })
      .slice(0, PUB_BAN_PER_POSITION);
    out[pos] = [...league, ...pub];
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Top-N priority bans — team-wide aggregate.
// ──────────────────────────────────────────────────────────────────────────
export function aggregateTopBans(report: PlayerReport[]): TeamBanCandidate[] {
  interface Agg {
    heroId: number;
    heroName: string;
    shortName: string;
    teamMatches: number;
    teamWins: number;
    tags: Set<string>;
    picks: Map<
      number,
      {
        accountId: number;
        playerName: string | null;
        positions: Position[];
        teamMatches: number;
        teamWins: number;
      }
    >;
  }
  const m = new Map<number, Agg>();
  for (const p of report) {
    const positions = positionsForBans(p);
    if (positions.length === 0) continue;
    for (const h of p.leagueHeroes) {
      const cur =
        m.get(h.heroId) ??
        ({
          heroId: h.heroId,
          heroName: h.heroName,
          shortName: h.shortName,
          teamMatches: 0,
          teamWins: 0,
          tags: new Set<string>(),
          picks: new Map(),
        } as Agg);
      cur.teamMatches += h.matches;
      cur.teamWins += h.wins;
      for (const t of h.tags) cur.tags.add(t);
      cur.picks.set(p.accountId, {
        accountId: p.accountId,
        playerName: p.name,
        positions,
        teamMatches: h.matches,
        teamWins: h.wins,
      });
      m.set(h.heroId, cur);
    }
  }
  const result: TeamBanCandidate[] = [];
  for (const a of m.values()) {
    if (a.teamMatches < TOP_BAN_MIN_GAMES) continue;
    const wr = a.teamMatches > 0 ? a.teamWins / a.teamMatches : 0;
    if (a.picks.size >= 2) a.tags.add("FLEX");
    const picks = Array.from(a.picks.values()).sort((x, y) => y.teamMatches - x.teamMatches);
    result.push({
      heroId: a.heroId,
      heroName: a.heroName,
      shortName: a.shortName,
      teamMatches: a.teamMatches,
      teamWins: a.teamWins,
      teamWinRate: wr,
      score: score(a.teamMatches, a.teamWins),
      picks,
      tags: Array.from(a.tags),
    });
  }
  result.sort((a, b) => b.score - a.score);
  return result.slice(0, TOP_BAN_COUNT);
}

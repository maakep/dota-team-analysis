// Shared data model. Produced by scripts/prefetch.ts at build time and consumed
// by the React frontend at render time. Keep this JSON-serializable.

import type { Position } from "./positions";

export interface TeamAccount {
  accountId: number;
  name: string | null;
  /** Matches played WITH this team in the lookback window. */
  matchCount: number;
  winCount: number;
  /** Unix seconds. */
  lastMatchAt: number | null;
}

export interface PlayerRank {
  /** Raw STRATZ seasonRank code: tier*10 + star (e.g., 73 = Ancient 3). */
  seasonRank: number;
  /** 1-8 (Herald..Immortal). */
  tier: number;
  /** 1-5 stars (null for Immortal). */
  stars: number | null;
  /** Human-readable, e.g. "Ancient 3", "Immortal". */
  label: string;
  /** Immortal leaderboard rank if applicable. */
  leaderboardRank: number | null;
}

export interface HeroPerf {
  heroId: number;
  heroName: string;
  /** STRATZ shortName, e.g. "antimage". Used to build dota2.com asset URLs. */
  shortName: string;
  matches: number;
  wins: number;
  winRate: number;
  /** Unix seconds. */
  lastPlayed: number | null;
  score: number;
  /** Share of the player's games at this position (0..1). */
  share: number;
  tags: string[]; // COMFORT, HIDDEN-GEM, SPAMMER
}

export interface PositionStats {
  position: Position;
  /** Team scrim stats at this position. */
  teamGames: number;
  teamWins: number;
  /** Share of the player's total team games at this position (0..1). */
  share: number;
  teamHeroes: HeroPerf[];
  /** Pub matchmaking stats at this position (last ~90 days). */
  pubGames: number;
  pubWins: number;
  pubHeroes: HeroPerf[];
}

export interface PlayerReport {
  accountId: number;
  /** Best display handle — STRATZ pro/esports name when available, otherwise
   *  the raw Steam display name. Used by every listing surface. */
  name: string | null;
  /** Curated esports handle from `proSteamAccount.name`. Null for non-pros. */
  proName: string | null;
  /** Raw `steamAccount.name` — shown as muted subtitle on the roster card
   *  when it differs from `name`. */
  steamName: string | null;
  /** Pro team tag (e.g. "FLCN") sourced from `proSteamAccount.team.tag`.
   *  Roster card composes `${teamTag}.${proName}` when both exist. */
  teamTag: string | null;
  rank: PlayerRank | null;
  /** Team scrim totals (sum of all positions). */
  totalMatches: number;
  totalWins: number;
  primaryPosition: Position | null;
  flex: boolean;
  flexPositions: Position[];
  positions: PositionStats[]; // sorted by team games desc
}

/** Person who played at least one match WITH the team but isn't in the top-5.
 *  Same hero/position breakdown as a roster player; the `lastTeamMatchAt`
 *  field records when they last appeared in the team's matches. */
export interface StandinReport extends PlayerReport {
  /** Unix seconds — last match this account played WITH the team. */
  lastTeamMatchAt: number | null;
}

/** Team-level top-N ban summary: pick rate + WR across the whole roster. */
export interface TeamBanCandidate {
  heroId: number;
  heroName: string;
  shortName: string;
  /** Sum of team scrim matches for this hero across all players/positions. */
  teamMatches: number;
  teamWins: number;
  teamWinRate: number;
  /** teamMatches / total team matches analyzed (0..1). */
  pickRate: number;
  /** Internal ranking score (wr × log10(games+1)). */
  score: number;
  /** Who picks this hero — one entry per player, with the positions they've
   *  used the hero at (rolled up across positions). Sorted by teamMatches desc. */
  picks: Array<{
    accountId: number;
    playerName: string | null;
    /** Distinct positions this player has played the hero at, sorted asc. */
    positions: Position[];
    /** Sum of team matches on this hero across all of this player's positions. */
    teamMatches: number;
    teamWins: number;
  }>;
  tags: string[];
}

export interface BanCandidate {
  heroId: number;
  heroName: string;
  shortName: string;
  position: Position;
  /** Aggregated team-scrim stats across all roster players who play this hero
   *  at this position. */
  teamMatches: number;
  teamWins: number;
  teamWinRate: number;
  /** Aggregated pub stats across the same player set. */
  pubMatches: number;
  pubWins: number;
  pubWinRate: number;
  /** teamMatches + pubMatches, for at-a-glance volume. */
  totalMatches: number;
  /** Internal ranking score; primary sort is teamMatches*2+pubMatches. */
  score: number;
  /** COMF, GEM, SPAM, FLEX — union of per-player tags + team-level FLEX. */
  tags: string[];
  /** True if hero is fielded at ≥ 2 distinct positions across the team. */
  flexBoosted: boolean;
  /** Per-player breakdown: every roster player who plays this hero at this
   *  position. Sorted by teamMatches desc, then pubMatches desc. */
  players: Array<{
    accountId: number;
    playerName: string | null;
    teamMatches: number;
    teamWins: number;
    teamWinRate: number;
    pubMatches: number;
    pubWins: number;
    pubWinRate: number;
  }>;
}

export interface TeamReport {
  generatedAt: string; // ISO-8601
  teamId: number;
  teamName: string | null;
  teamTag: string | null;
  totalWins: number;
  totalLosses: number;
  /** Unix seconds. */
  windowStart: number;
  /** Unix seconds. */
  pubWindowStart: number;
  /** Number of team matches analyzed for roster derivation. */
  matchesAnalyzed: number;
  /** Last match date across the team (unix seconds). */
  lastMatchAt: number | null;
  players: PlayerReport[];
  /** Stand-ins (everyone else who played with the team in the window). */
  standins: StandinReport[];
  /** Cross-roster top-N priority bans (pick rate × win rate, role-agnostic). */
  topBans: TeamBanCandidate[];
  /** Pre-computed top ban candidates per position (top 8 each). */
  bansByPosition: Record<Position, BanCandidate[]>;
}

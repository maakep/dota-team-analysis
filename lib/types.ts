// Shared data model. Produced by scripts/prefetch.ts at build time and consumed
// by the React frontend at render time. Keep this JSON-serializable.
//
// Data sources per field — see lib/fetch-team-data.ts for the full pipeline:
//
//   STRATZ (local prefetch only, IP-pinned token):
//     - Team meta, roster discovery, stand-in detection
//     - Per-player rank + pro identity
//     - Per-position team-scrim COUNTS (used only to derive primary/flex;
//       hero details no longer requested — saves request volume)
//
//   OpenDota (build-time, no auth, no IP pin):
//     - Per-player complete match history in the window
//     - Aggregated client-side into league (CM private lobby + tournament)
//       and pub (ranked + unranked matchmaking) hero pools
//
// Position attribution: STRATZ-derived primaryPosition + flexPositions only.
// League hero pools are displayed under the player's primary position with a
// FLEX tag when flex applies. Pub hero pools are intentionally position-
// agnostic — the dataset can't reliably attribute pub games to pos 4 vs 5
// for amateur players (parse rates ~15-45%), so coaches read the list as
// "this player's pub comfort heroes" and decide threat-by-role themselves.

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
  /** Share of the player's games in THIS bucket (league or pub). 0..1. */
  share: number;
  tags: string[]; // COMF, GEM, SPAM
}

/** Per-position team-scrim count. No hero detail — only used to derive
 *  primary/flex positions for the player. We keep the per-position
 *  breakdown so the UI can show "Gunkan plays pos 2 (30g) + pos 3 (5g)"
 *  if useful, but the typical card just reads `primaryPosition`. */
export interface PositionCount {
  position: Position;
  teamGames: number;
  teamWins: number;
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

  // STRATZ-derived position attribution.
  primaryPosition: Position | null;
  flex: boolean;
  flexPositions: Position[];
  /** Per-position team-scrim game counts (no hero detail). Sorted by
   *  teamGames desc. Only positions with ≥1 team game are present. */
  positionCounts: PositionCount[];

  // STRATZ-attributed team scrim totals (sum across all positions). Used
  // for the W/L stat block in the player card header.
  totalTeamMatches: number;
  totalTeamWins: number;

  // OpenDota-sourced league/scrim pool. Captain's Mode private lobbies +
  // tournaments. Position-agnostic but displayed under primaryPosition
  // with FLEX tag where applicable. Includes scrims played for ANY team,
  // not just the current one (drafting intel still applies).
  leagueGames: number;
  leagueWins: number;
  leagueHeroes: HeroPerf[];

  // OpenDota-sourced pub pool. Ranked + unranked matchmaking. Position-
  // agnostic. The coach reads this and assesses threat-by-role.
  pubGames: number;
  pubWins: number;
  pubHeroes: HeroPerf[];
}

/** Person who played at least one match WITH the team but isn't in the top-5.
 *  Same shape as a roster player; the `lastTeamMatchAt` field records when
 *  they last appeared in the team's matches. */
export interface StandinReport extends PlayerReport {
  /** Unix seconds — last match this account played WITH the team. */
  lastTeamMatchAt: number | null;
}

/** Team-level top-N priority ban summary. Aggregated from each roster
 *  player's `leagueHeroes` (position-agnostic); same hero played by
 *  multiple players is merged into one card with combined stats. */
export interface TeamBanCandidate {
  heroId: number;
  heroName: string;
  shortName: string;
  /** Sum of league matches for this hero across the whole roster. */
  teamMatches: number;
  teamWins: number;
  teamWinRate: number;
  /** Internal ranking score (wr × log10(games+1)). */
  score: number;
  /** Who picks this hero — one entry per player who has it in their
   *  league pool. `positions` lists the player's primary + any flex
   *  positions where they'd be expected to field this hero. */
  picks: Array<{
    accountId: number;
    playerName: string | null;
    /** The player's primary position + flex positions (sorted asc).
     *  Indicates which draft slot(s) the hero might appear at. */
    positions: Position[];
    teamMatches: number;
    teamWins: number;
  }>;
  tags: string[];
}

/** Per-position ban target. Sourced from the league-hero pools of every
 *  player whose primary OR flex includes this position. Same hero owned
 *  by multiple contributors at the same position is summed.
 *
 *  Some rows are PUB-sourced — high-volume / high-WR pub heroes that
 *  don't appear in the player's league pool but the coach should still
 *  consider banning. These are flagged via `source: 'pub'` (default
 *  'league'). UI ranks all league rows above all pub rows within a
 *  column, and pub rows carry a `PUB` tag for visual distinction. */
export interface BanCandidate {
  heroId: number;
  heroName: string;
  shortName: string;
  position: Position;
  /** Which dataset this row was derived from. League rows aggregate
   *  CM/tournament games (OpenDota). Pub rows aggregate ranked +
   *  unranked matchmaking (OpenDota), surfaced only when the hero is
   *  not in the contributor's league pool and clears the pub-ban
   *  thresholds (see PUB_BAN_* knobs in fetch-team-data.ts). */
  source: "league" | "pub";
  /** Aggregated stats across all contributing players, in the same
   *  dataset as `source`. (League rows hold league games/wins; pub
   *  rows hold pub games/wins.) */
  teamMatches: number;
  teamWins: number;
  teamWinRate: number;
  totalMatches: number;
  score: number;
  /** COMF, GEM, SPAM (carried from contributors), plus FLEX when the
   *  hero appears at ≥ 2 distinct positions across the roster. PUB
   *  rows additionally carry a "PUB" tag for filtering / styling. */
  tags: string[];
  flexBoosted: boolean;
  /** Per-player breakdown — every contributor at this position. Sorted
   *  by teamMatches desc. */
  players: Array<{
    accountId: number;
    playerName: string | null;
    teamMatches: number;
    teamWins: number;
    teamWinRate: number;
    /** True when this player is contributing via flex (not their
     *  primary position). UI can mark these rows with a FLEX hint. */
    viaFlex: boolean;
  }>;
}

/** One hero pick in a match (for a single side). */
export interface MatchHero {
  heroId: number;
  shortName: string;
  /** Account ID of the team player who played this hero. Null for opponents
   *  (we don't track their identity, only their heroes). */
  accountId: number | null;
}

/** A single team match row for the match history panel. */
export interface MatchRecord {
  matchId: number;
  /** Unix seconds. */
  startDateTime: number;
  /** Which side the team played on. */
  side: "radiant" | "dire";
  /** True = our team won. */
  won: boolean;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Total kills by our team side. */
  teamKills: number;
  /** Total kills by the opponent side. */
  opponentKills: number;
  /** Heroes our team played, ordered by hero ID (stable). */
  teamHeroes: MatchHero[];
  /** Heroes the opponent played, ordered by hero ID. */
  opponentHeroes: MatchHero[];
  /** Opponent team name (from STRATZ team registration). Null for unregistered
   *  teams / private lobbies where STRATZ has no team metadata. */
  opponentName: string | null;
  /** Opponent team tag (e.g. "FLCN"). Null when opponentName is null. */
  opponentTag: string | null;
  /** True when our team fielded a player who is NOT in the top-5 roster
   *  derived from this analysis window — i.e. a stand-in. */
  hasStandin: boolean;
}

export interface TeamReport {
  generatedAt: string; // ISO-8601
  teamId: number;
  teamName: string | null;
  teamTag: string | null;
  totalWins: number;
  totalLosses: number;
  /** Unix seconds — start of the analysis window (team + pub unified now). */
  windowStart: number;
  /** Length of the analysis window in days. Mirrored on the report for
   *  the UI to render captions without re-deriving from windowStart. */
  windowDays: number;
  /** Number of team matches analyzed for roster derivation. */
  matchesAnalyzed: number;
  /** Last match date across the team (unix seconds). */
  lastMatchAt: number | null;
  players: PlayerReport[];
  /** Stand-ins (everyone else who played with the team in the window). */
  standins: StandinReport[];
  /** Recent team matches, newest first, capped at MATCH_HISTORY_TAKE. */
  matchHistory: MatchRecord[];
  /** Cross-roster top-N priority bans from league pools. */
  topBans: TeamBanCandidate[];
  /** Pre-computed top ban candidates per position (top 8 each). */
  bansByPosition: Record<Position, BanCandidate[]>;
}

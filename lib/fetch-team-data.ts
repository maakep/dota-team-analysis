// Build-time analysis: produce a TeamReport from STRATZ (roster + positions)
// and OpenDota (complete per-player match history).
//
// Steps:
//   1. STRATZ: heroes constants + team meta + recent team matches → derive
//      top-5 roster by appearances, plus stand-ins.
//   2. STRATZ: for each roster member (+ stand-in), pull per-position
//      team-scrim game COUNTS (no hero details). Derive primaryPosition
//      and flexPositions from the distribution. Also pull rank + pro
//      identity in the same query.
//   3. OpenDota: for each player, fetch the complete match history in the
//      window. Bucket each row into league (CM private lobby + tournament)
//      or pub (ranked + unranked MM). Aggregate per-hero stats into two
//      ranked lists per player.
//   4. Derive ban targets per position from the league pools of contributing
//      players (primary + flex). Derive top priority bans as the same data
//      rolled up across the whole roster.
//
// Why this split:
//   STRATZ's `heroesPerformance(positionIds: [...])` requires a parsed
//   replay, so for amateur teams it silently dropped 80%+ of pub games.
//   OpenDota returns complete game counts regardless of parse status
//   (parse only matters for lane attribution, which we don't use for
//   pub data anymore).
//
// All time windows are in unix seconds. STRATZ requires `skip: 0` on
// `heroesPerformance` requests.

import { createStratzClient, type StratzClient } from "./stratz";
import { createOpenDotaClient, classifyMatch, playerWon, type OpenDotaMatchRow } from "./opendota";
import { UserError } from "./errors";
import { decodeRank } from "./ranks";
import { ALL_POSITIONS, type Position, stratzPositionEnum } from "./positions";
import type {
  BanCandidate,
  HeroPerf,
  PlayerReport,
  PositionCount,
  StandinReport,
  TeamAccount,
  TeamBanCandidate,
  TeamReport,
} from "./types";

// ──────────────────────────────────────────────────────────────────────────
// Tuning knobs. Each has a sensible default; override via env var at
// prefetch time (the GitHub Actions workflow exposes them as inputs).
// ──────────────────────────────────────────────────────────────────────────
function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new UserError(`${key} must be a non-negative integer (got: ${v}).`);
  }
  return n;
}

const WINDOW_DAYS = envInt("TEAM_WINDOW_DAYS", 180); // ~6 months, used for both team-scrim history (STRATZ) and pub/league history (OpenDota) — unified
const TEAM_MATCH_TAKE = 100; // matches pulled to derive roster

// Comfort/gem tag thresholds (applied to league heroes — pub heroes use
// the same thresholds for consistency, even though the data shape is the
// same per-hero counts).
const COMFORT_MIN_GAMES = 5;
const COMFORT_MIN_WR = 0.6;
const GEM_MIN_GAMES = 5;
const GEM_MIN_WR = 0.7;
const SPAMMER_MIN_GAMES = 5;
const SPAMMER_MIN_SHARE = 0.25; // ≥25% of player's games in this bucket
const SPAMMER_MIN_WR = 0.5;

// Primary/flex derivation. Same thresholds we used before — flex means
// ≥20% of team-scrim games at a non-primary position, with a minimum
// total game count to keep noisy 1-game-per-position rosters from
// triggering FLEX on everyone.
const FLEX_SHARE = 0.2;
const FLEX_MIN_TOTAL_GAMES = 10;

// Ban-candidate floors. Set higher than before — we now have complete
// game counts so noisy 1-2g heroes won't surface above the threshold.
const BAN_MIN_GAMES = envInt("BAN_MIN_GAMES", 3);
const TOP_BAN_MIN_GAMES = envInt("TOP_BAN_MIN_GAMES", 3);
const TOP_BAN_COUNT = 7;
const PER_POSITION = 8;
const FLEX_BOOST = 1.1; // multiplies score when hero appears at ≥2 positions

// Low-sample fallback for per-bucket hero lists. If the >=2-game filter
// leaves us with fewer heroes than this, top up with the best 1-game rows.
const MIN_HEROES_SHOWN = 3;
// Hard cap for the pub hero list shown per player. Pub histories can run
// hundreds of distinct heroes deep; once we're past the top ~10 by games
// played, the list is noise and just makes the card scroll forever. The
// league list is intentionally NOT capped — league pools are naturally
// small (~10-30 heroes) and the long tail is still useful intel.
const PUB_HEROES_MAX = 7;

// Pub-sourced ban candidates per primary position. A player's standout
// pub heroes (high games + good WR) get surfaced in their primary-role
// ban column when they're NOT already in that player's league pool. This
// catches comfort picks that haven't shown up in scrims yet but the
// player can clearly execute. League rows always rank above pub rows in
// the same column (UI sort), and pub rows carry a "PUB" tag for visual
// distinction.
//
// Thresholds reflect that pub volume is naturally 10x league volume:
//   - PUB_BAN_MIN_GAMES: high enough to filter casual one-offs but well
//     under typical pub-comfort volume (most players have several heroes
//     with 15-30 pub games in 180d).
//   - PUB_BAN_MIN_WR: 55% is genuine signal against matchmaking's 50%
//     target. Below this, the hero is just "in the pool", not "good".
//   - PUB_BAN_PER_PLAYER: cap per player so one prolific puber doesn't
//     monopolize the column.
const PUB_BAN_MIN_GAMES = 8;
const PUB_BAN_MIN_WR = 0.55;
const PUB_BAN_PER_PLAYER = 3;
// Hard cap on pub-sourced rows per column. Without this a 5-player team
// could add up to 5 × PUB_BAN_PER_PLAYER = 15 pub rows to a single
// column (everyone's a flex player on paper but in practice this caps
// the worst case). Practically each column only has 1 player contributing
// from their primary position so this rarely matters, but defensive.
const PUB_BAN_PER_POSITION = 6;

// ──────────────────────────────────────────────────────────────────────────
// Hero constants (heroId -> displayName + shortName).
// ──────────────────────────────────────────────────────────────────────────
const HEROES_QUERY = `query Heroes { constants { heroes { id displayName shortName } } }`;

interface HeroMeta {
  displayName: string;
  shortName: string;
}

async function fetchHeroMap(stratz: StratzClient): Promise<Map<number, HeroMeta>> {
  const data = await stratz.query<{
    constants: {
      heroes: Array<{
        id: number;
        displayName: string | null;
        shortName: string | null;
      }>;
    };
  }>(HEROES_QUERY, undefined, { operationName: "Heroes" });
  const m = new Map<number, HeroMeta>();
  for (const h of data.constants.heroes) {
    m.set(h.id, {
      displayName: h.displayName ?? `hero#${h.id}`,
      shortName: h.shortName ?? "",
    });
  }
  return m;
}

const heroMeta = (m: Map<number, HeroMeta>, id: number): HeroMeta =>
  m.get(id) ?? { displayName: `hero#${id}`, shortName: "" };

// ──────────────────────────────────────────────────────────────────────────
// Team meta + recent matches → derive top-5 active roster.
// ──────────────────────────────────────────────────────────────────────────
const TEAM_QUERY = `query Team($teamId: Int!, $since: Long!) {
  team(teamId: $teamId) {
    id name tag winCount lossCount lastMatchDateTime
    matches(request: { startDateTime: $since, take: ${TEAM_MATCH_TAKE}, skip: 0 }) {
      id startDateTime didRadiantWin radiantTeamId direTeamId
      players {
        steamAccountId isRadiant
        steamAccount {
          name
          proSteamAccount { name team { tag } }
        }
      }
    }
  }
}`;

interface RawProSteamAccount {
  name?: string | null;
  team?: { tag?: string | null } | null;
}

interface TeamMatchPlayer {
  steamAccountId: number | null;
  isRadiant: boolean;
  steamAccount: {
    name: string | null;
    proSteamAccount?: RawProSteamAccount | null;
  } | null;
}
interface TeamMatch {
  id: number;
  startDateTime: number;
  didRadiantWin: boolean;
  radiantTeamId: number | null;
  direTeamId: number | null;
  players: TeamMatchPlayer[];
}
interface RawTeam {
  id: number;
  name: string | null;
  tag: string | null;
  winCount: number;
  lossCount: number;
  lastMatchDateTime: number | null;
  matches: TeamMatch[] | null;
}

async function fetchTeamAndRoster(
  stratz: StratzClient,
  teamId: number,
  windowStart: number,
): Promise<{
  team: RawTeam;
  accounts: TeamAccount[];
  standins: TeamAccount[];
  matchesAnalyzed: number;
}> {
  const data = await stratz.query<{ team: RawTeam | null }>(
    TEAM_QUERY,
    { teamId, since: windowStart },
    { operationName: "Team" },
  );
  if (!data.team) throw new UserError(`No team found for team_id=${teamId}.`);
  const matches = data.team.matches ?? [];
  if (matches.length === 0) {
    throw new UserError(
      `team ${teamId} has no matches in the last ${WINDOW_DAYS} days; cannot derive a roster.`,
    );
  }

  const agg = new Map<number, TeamAccount>();
  for (const m of matches) {
    const teamIsRadiant =
      m.radiantTeamId === teamId ? true : m.direTeamId === teamId ? false : null;
    if (teamIsRadiant === null) continue;
    const teamWon = teamIsRadiant ? m.didRadiantWin : !m.didRadiantWin;
    for (const p of m.players) {
      if (p.isRadiant !== teamIsRadiant) continue;
      if (typeof p.steamAccountId !== "number") continue;
      const proName = p.steamAccount?.proSteamAccount?.name ?? null;
      const steamName = p.steamAccount?.name ?? null;
      const resolvedName = proName ?? steamName;
      const cur = agg.get(p.steamAccountId) ?? {
        accountId: p.steamAccountId,
        name: resolvedName,
        matchCount: 0,
        winCount: 0,
        lastMatchAt: null as number | null,
      };
      cur.matchCount += 1;
      if (teamWon) cur.winCount += 1;
      if (cur.lastMatchAt === null || m.startDateTime > cur.lastMatchAt) {
        cur.lastMatchAt = m.startDateTime;
      }
      if (!cur.name && resolvedName) cur.name = resolvedName;
      agg.set(p.steamAccountId, cur);
    }
  }
  const ranked = [...agg.values()].sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return (b.lastMatchAt ?? 0) - (a.lastMatchAt ?? 0);
  });
  return {
    team: data.team,
    accounts: ranked.slice(0, 5),
    standins: ranked.slice(5),
    matchesAnalyzed: matches.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Roster identity + per-position COUNT query.
//
// Each (player × position) returns at most 1 row (we ask for take=200, but
// only sum matchCount — hero rows are essentially a free side-effect of
// STRATZ's API, we just don't keep them). We don't request heroId because
// we don't need hero-level data from STRATZ anymore.
//
// Why take=200: STRATZ caps responses at the take value. If a player has
// 150 distinct heroes at a position over 180d (extreme), we'd undercount.
// 200 is generous enough for any realistic pro/amateur pool.
// ──────────────────────────────────────────────────────────────────────────
interface RawHeroCountRow {
  matchCount: number;
  winCount: number;
}
interface RawSteamAccount {
  seasonRank?: number | null;
  seasonLeaderboardRank?: number | null;
  name?: string | null;
  proSteamAccount?: RawProSteamAccount | null;
}
type PlayerBlock = Record<string, RawHeroCountRow[] | RawSteamAccount | null>;

const POSITION_HERO_TAKE = 200;

function buildRosterQuery(accounts: TeamAccount[]): {
  query: string;
  variables: Record<string, unknown>;
} {
  const varDecls: string[] = ["$teamId: Int!", "$since: Long!"];
  const variables: Record<string, unknown> = {};
  const playerBlocks: string[] = [];

  for (const acc of accounts) {
    const aidVar = `aid_${acc.accountId}`;
    varDecls.push(`$${aidVar}: Long!`);
    variables[aidVar] = acc.accountId;

    // One alias per (player, position) — sum matchCount client-side to get
    // total team games at that position. No hero details needed.
    const posBlocks = ALL_POSITIONS.map((pos) => {
      const enumName = stratzPositionEnum(pos);
      return `    t${acc.accountId}_${pos}: heroesPerformance(request: {
      teamId: $teamId
      startDateTime: $since
      positionIds: [${enumName}]
      take: ${POSITION_HERO_TAKE}
      skip: 0
    }) { matchCount winCount }`;
    }).join("\n");

    playerBlocks.push(`  player_${acc.accountId}: player(steamAccountId: $${aidVar}) {
    steamAccount {
      name
      seasonRank
      seasonLeaderboardRank
      proSteamAccount { name team { tag } }
    }
${posBlocks}
  }`);
  }

  const query = `query Roster(${varDecls.join(", ")}) {
${playerBlocks.join("\n")}
}`;
  return { query, variables };
}

// ──────────────────────────────────────────────────────────────────────────
// Scoring + tag rules. Applied to each hero row in the league/pub buckets.
// ──────────────────────────────────────────────────────────────────────────
function score(games: number, wins: number): number {
  if (games <= 0) return 0;
  return (wins / games) * Math.log10(games + 1);
}

function classify(games: number, wins: number): string[] {
  const wr = games > 0 ? wins / games : 0;
  const tags: string[] = [];
  if (games >= COMFORT_MIN_GAMES && wr >= COMFORT_MIN_WR) tags.push("COMF");
  if (games >= GEM_MIN_GAMES && wr >= GEM_MIN_WR && !tags.includes("COMF")) tags.push("GEM");
  return tags;
}

// ──────────────────────────────────────────────────────────────────────────
// Build a HeroPerf[] list from a raw {heroId -> {games, wins, lastPlayed}}
// aggregate. Applies the ≥2-game filter, MIN_HEROES_SHOWN low-sample fallback,
// tag classification, and sorts by games desc with WR tiebreak.
// ──────────────────────────────────────────────────────────────────────────
interface RawHeroAgg {
  games: number;
  wins: number;
  lastPlayed: number;
}

function aggToHeroPerfs(
  agg: Map<number, RawHeroAgg>,
  heroes: Map<number, HeroMeta>,
  maxList?: number,
): { heroes: HeroPerf[]; totalGames: number; totalWins: number } {
  const rows = Array.from(agg.entries()).map(([heroId, a]) => ({
    heroId,
    matchCount: a.games,
    winCount: a.wins,
    lastPlayed: a.lastPlayed,
  }));
  const totalGames = rows.reduce((s, r) => s + r.matchCount, 0);
  const totalWins = rows.reduce((s, r) => s + r.winCount, 0);

  // Primary cohort: heroes with >= 2 games (the "real signal" set).
  const primary = rows.filter((r) => r.matchCount >= 2);

  let display = primary;
  if (primary.length < MIN_HEROES_SHOWN) {
    const seen = new Set(primary.map((r) => r.heroId));
    const padding = rows
      .filter((r) => !seen.has(r.heroId))
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return b.lastPlayed - a.lastPlayed;
      })
      .slice(0, MIN_HEROES_SHOWN - primary.length);
    display = [...primary, ...padding];
  }

  const out: HeroPerf[] = display.map((r) => {
    const wr = r.matchCount > 0 ? r.winCount / r.matchCount : 0;
    const meta = heroMeta(heroes, r.heroId);
    const share = totalGames > 0 ? r.matchCount / totalGames : 0;
    const tags: string[] = classify(r.matchCount, r.winCount);
    if (r.matchCount >= SPAMMER_MIN_GAMES && wr >= SPAMMER_MIN_WR && share >= SPAMMER_MIN_SHARE) {
      tags.push("SPAM");
    }
    return {
      heroId: r.heroId,
      heroName: meta.displayName,
      shortName: meta.shortName,
      matches: r.matchCount,
      wins: r.winCount,
      winRate: wr,
      lastPlayed: r.lastPlayed > 0 ? r.lastPlayed : null,
      score: score(r.matchCount, r.winCount),
      share,
      tags,
    };
  });
  out.sort((a, b) => {
    if (b.matches !== a.matches) return b.matches - a.matches;
    return b.winRate - a.winRate;
  });
  // Optional hard cap, applied AFTER sorting so we keep the top-N by
  // games (with WR tiebreak). Used for pub lists; league lists pass
  // undefined and keep the full pool.
  const capped = typeof maxList === "number" && out.length > maxList ? out.slice(0, maxList) : out;
  return { heroes: capped, totalGames, totalWins };
}

// ──────────────────────────────────────────────────────────────────────────
// Bucket an OpenDota match list into per-hero aggregates for league + pub.
// ──────────────────────────────────────────────────────────────────────────
function bucketMatches(rows: OpenDotaMatchRow[]): {
  league: Map<number, RawHeroAgg>;
  pub: Map<number, RawHeroAgg>;
} {
  const league = new Map<number, RawHeroAgg>();
  const pub = new Map<number, RawHeroAgg>();
  for (const row of rows) {
    const bucket = classifyMatch(row);
    if (bucket === null) continue;
    const target = bucket === "league" ? league : pub;
    const cur = target.get(row.hero_id) ?? { games: 0, wins: 0, lastPlayed: 0 };
    cur.games += 1;
    if (playerWon(row)) cur.wins += 1;
    if (row.start_time > cur.lastPlayed) cur.lastPlayed = row.start_time;
    target.set(row.hero_id, cur);
  }
  return { league, pub };
}

// ──────────────────────────────────────────────────────────────────────────
// Build per-player report from STRATZ position counts + OpenDota match list.
// ──────────────────────────────────────────────────────────────────────────
function buildPlayerReport(
  acc: TeamAccount,
  stratzBlock: PlayerBlock,
  openDotaMatches: OpenDotaMatchRow[],
  heroes: Map<number, HeroMeta>,
): PlayerReport {
  const rawAccount = stratzBlock["steamAccount"] as RawSteamAccount | null | undefined;
  const rank = decodeRank(rawAccount?.seasonRank, rawAccount?.seasonLeaderboardRank);
  const proName = rawAccount?.proSteamAccount?.name ?? null;
  const steamName = rawAccount?.name ?? null;
  const teamTag = rawAccount?.proSteamAccount?.team?.tag ?? null;
  const resolvedName = proName ?? steamName ?? acc.name;

  // Per-position team-scrim counts from STRATZ. Sum matchCount across all
  // hero rows in each (player, position) alias.
  const positionCounts: PositionCount[] = [];
  let totalTeamMatches = 0;
  let totalTeamWins = 0;
  for (const pos of ALL_POSITIONS) {
    const rows = (stratzBlock[`t${acc.accountId}_${pos}`] ?? []) as
      | RawHeroCountRow[]
      | null
      | undefined;
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const teamGames = rows.reduce((s, r) => s + (r?.matchCount ?? 0), 0);
    const teamWins = rows.reduce((s, r) => s + (r?.winCount ?? 0), 0);
    if (teamGames === 0) continue;
    positionCounts.push({ position: pos, teamGames, teamWins });
    totalTeamMatches += teamGames;
    totalTeamWins += teamWins;
  }
  positionCounts.sort((a, b) => b.teamGames - a.teamGames);

  // Primary + flex from the per-position distribution.
  let primaryPosition: Position | null = null;
  let max = 0;
  for (const pc of positionCounts) {
    if (pc.teamGames > max) {
      max = pc.teamGames;
      primaryPosition = pc.position;
    }
  }
  const flexPositions = positionCounts
    .filter((pc) => totalTeamMatches > 0 && pc.teamGames / totalTeamMatches >= FLEX_SHARE)
    .map((pc) => pc.position)
    .sort((a, b) => a - b);
  const flex = totalTeamMatches >= FLEX_MIN_TOTAL_GAMES && flexPositions.length >= 2;

  // OpenDota → bucketed hero pools. League list is uncapped (small + all
  // signal); pub list is capped to PUB_HEROES_MAX to keep the card tight.
  // Note: leagueRes.totalGames / pubRes.totalGames still reflect the FULL
  // bucketed match count, not the capped display list.
  const { league, pub } = bucketMatches(openDotaMatches);
  const leagueRes = aggToHeroPerfs(league, heroes);
  const pubRes = aggToHeroPerfs(pub, heroes, PUB_HEROES_MAX);

  return {
    accountId: acc.accountId,
    name: resolvedName,
    proName,
    steamName,
    teamTag,
    rank,
    primaryPosition,
    flex,
    flexPositions,
    positionCounts,
    totalTeamMatches,
    totalTeamWins,
    leagueGames: leagueRes.totalGames,
    leagueWins: leagueRes.totalWins,
    leagueHeroes: leagueRes.heroes,
    pubGames: pubRes.totalGames,
    pubWins: pubRes.totalWins,
    pubHeroes: pubRes.heroes,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Roster + stand-in fetch orchestration. STRATZ for identity/positions,
// OpenDota for match history. The two clients run in parallel per player
// to keep total wall time near max(STRATZ, OpenDota) rather than the sum.
// ──────────────────────────────────────────────────────────────────────────
async function fetchPlayerReports(
  stratz: StratzClient,
  openDota: ReturnType<typeof createOpenDotaClient>,
  accounts: TeamAccount[],
  teamId: number,
  windowStart: number,
  heroes: Map<number, HeroMeta>,
  operationName: string,
): Promise<PlayerReport[]> {
  if (accounts.length === 0) return [];

  const { query, variables } = buildRosterQuery(accounts);
  variables["teamId"] = teamId;
  variables["since"] = windowStart;

  // Fan out: STRATZ block + OpenDota matches in parallel. OpenDota is
  // per-account so it's a Promise.all of N requests; STRATZ is one bulk
  // query covering all N accounts.
  const [stratzData, ...matchLists] = await Promise.all([
    stratz.query<Record<string, PlayerBlock>>(query, variables, {
      operationName,
    }),
    ...accounts.map((acc) => openDota.fetchPlayerMatches(acc.accountId, WINDOW_DAYS)),
  ]);

  return accounts.map((acc, i) =>
    buildPlayerReport(
      acc,
      stratzData[`player_${acc.accountId}`] ?? {},
      matchLists[i] ?? [],
      heroes,
    ),
  );
}

async function fetchStandins(
  stratz: StratzClient,
  openDota: ReturnType<typeof createOpenDotaClient>,
  standins: TeamAccount[],
  teamId: number,
  windowStart: number,
  heroes: Map<number, HeroMeta>,
): Promise<StandinReport[]> {
  if (standins.length === 0) return [];
  const reports = await fetchPlayerReports(
    stratz,
    openDota,
    standins,
    teamId,
    windowStart,
    heroes,
    "Standins",
  );
  return reports.map((rep, i) => ({
    ...rep,
    lastTeamMatchAt: standins[i].lastMatchAt,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Ban candidate aggregation.
//
// Two distinct "flex" concepts in play — easy to conflate, so spelled out:
//
//   PLAYER-FLEX (PlayerReport.flex):
//     The PLAYER plays multiple roles across team-scrim history (STRATZ).
//     This drives the FLEX tag on the player card header. It does NOT
//     fan a player's hero pool out across multiple ban columns.
//
//   HERO-FLEX (BanCandidate / TeamBanCandidate "FLEX" tag):
//     The HERO is played by ≥2 different roster members in league
//     matches. This is the drafting-intel signal: an opponent can't
//     counter the lane assignment until pick order commits, because
//     the hero could come out for multiple players.
//
// Per-position ban attribution is ONLY based on each player's primary
// position. A pos-1/3 flex player's heroes show up only in pos 1 (their
// primary), never duplicated into pos 3. Coaches will assess on a
// per-hero basis whether the player might flex it elsewhere — we don't
// want to pre-populate that as if it were established play.
//
// The top-of-page priority bans are position-agnostic; they use the same
// HERO-FLEX rule (≥2 players) for the FLEX tag.
// ──────────────────────────────────────────────────────────────────────────

/** Position(s) we assume a player's league heroes were played at. We treat
 *  league hero pools as belonging to the player's STRATZ-derived primary
 *  role only. Even when the player is FLEX (covers multiple roles in
 *  scrims), we don't fan their heroes out across columns — that would be
 *  conjecture, not data. Returns `[]` for players whose primary position
 *  STRATZ couldn't resolve (rare: account had heroes-performance rows
 *  filtered out for all positions). */
function positionsForBans(p: PlayerReport): Position[] {
  if (p.primaryPosition === null) return [];
  return [p.primaryPosition];
}

function aggregateBans(report: PlayerReport[]): Record<Position, BanCandidate[]> {
  const out: Record<Position, BanCandidate[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
  };

  // HERO-FLEX detection: hero is played by ≥ 2 distinct roster members in
  // league matches. Computed in a first pass so we can apply the FLEX tag
  // + score boost during the second pass. Note we count contributors at
  // the hero level (not at the column level), since each player only
  // contributes to their primary column.
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

  // Second pass: build the per-(position, hero) aggregate. Each player
  // contributes their league pool ONLY to their primary position. No
  // cross-position attribution — even for player-flex players (see the
  // doc comment above `positionsForBans`).
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
        // Merge guard — same player shouldn't appear twice in a bucket
        // (each player contributes exactly once to their primary column)
        // but be defensive in case future logic loosens that.
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
            // viaFlex is always false now — each player only ever
            // contributes to their primary column. The field is kept on
            // the type for backwards compat / future use (e.g., if we
            // re-enable cross-column attribution with a "speculative"
            // mode), but the UI will see false everywhere.
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

  // Pub-sourced supplemental bans. For each player, look at their top
  // pub heroes (by games), skip ones already in their league pool for
  // the same primary column, and emit up to PUB_BAN_PER_PLAYER rows
  // that clear the volume + WR thresholds. These get a "PUB" tag and
  // `source: 'pub'` so the UI can rank/style them apart from league
  // rows.
  for (const p of report) {
    if (p.primaryPosition === null) continue;
    const pos = p.primaryPosition;
    // Heroes the player has played at this column in league with enough
    // volume to actually appear in the league section above. We only
    // dedupe against the displayed-league set — heroes the player has
    // played 1-2 league games on (sub-threshold, hidden in the UI) are
    // still eligible as pub picks, because the coach won't see the
    // league signal anyway. Without this carve-out we silently hide
    // genuine pub-comfort heroes whose league sample is just too
    // small to surface, like Queen of Pain on a pos-2 player with
    // 2 league games but 26 pub games at 73% WR.
    const leagueHeroIdsInColumn = new Set<number>();
    for (const lh of p.leagueHeroes) {
      if (lh.matches >= BAN_MIN_GAMES) leagueHeroIdsInColumn.add(lh.heroId);
    }

    // p.pubHeroes is already sorted by games desc with WR tiebreak (see
    // aggToHeroPerfs). Walk it in order, take up to PUB_BAN_PER_PLAYER
    // that meet thresholds and aren't in the league pool. Note: the
    // pubHeroes list is capped at PUB_HEROES_MAX (=7); if a player's
    // 8th-best pub hero would qualify we'd miss it, but that's a
    // deliberate trade-off — we don't want to load the JSON with the
    // full pub list just to scan for ban-candidate dropouts.
    let added = 0;
    for (const h of p.pubHeroes) {
      if (added >= PUB_BAN_PER_PLAYER) break;
      if (leagueHeroIdsInColumn.has(h.heroId)) continue;
      if (h.matches < PUB_BAN_MIN_GAMES) continue;
      if (h.winRate < PUB_BAN_MIN_WR) continue;
      // Carry over any COMF/GEM/SPAM tags from the per-hero classifier
      // (they were computed from pub stats, but they're still accurate
      // descriptors). Add PUB so the UI can identify the source.
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
        // Pub rows reuse the same scoring formula. They'll never beat
        // league rows because the sort puts source ahead of score, but
        // we use score to order pub rows among themselves consistently.
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

  // Sort: league rows always rank above pub rows in the same column
  // (signal quality). Within each source bucket, sort by teamMatches
  // desc with score tiebreak (winrate × log10(games+1), flex-boosted
  // for league rows). Then cap: keep ALL league rows up to PER_POSITION,
  // then top up with pub rows (also capped by PUB_BAN_PER_POSITION as
  // a defensive ceiling). Total column length never exceeds
  // PER_POSITION + PUB_BAN_PER_POSITION.
  for (const pos of ALL_POSITIONS) {
    const all = out[pos];
    const league = all
      .filter((b) => b.source === "league")
      .sort((a, b) => {
        if (b.teamMatches !== a.teamMatches)
          return b.teamMatches - a.teamMatches;
        return b.score - a.score;
      })
      .slice(0, PER_POSITION);
    const pub = all
      .filter((b) => b.source === "pub")
      .sort((a, b) => {
        if (b.teamMatches !== a.teamMatches)
          return b.teamMatches - a.teamMatches;
        return b.score - a.score;
      })
      .slice(0, PUB_BAN_PER_POSITION);
    out[pos] = [...league, ...pub];
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Top-N priority bans — same league pool data, but rolled up team-wide.
// Each hero card lists every contributing player + the position(s) they'd
// be expected to field the hero at.
// ──────────────────────────────────────────────────────────────────────────
function aggregateTopBans(report: PlayerReport[]): TeamBanCandidate[] {
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
    // HERO-FLEX: ≥2 distinct roster players contributed this hero from
    // league matches. Same rule as `aggregateBans` — multiple players,
    // not multiple positions per player.
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

// ──────────────────────────────────────────────────────────────────────────
// Main entry point: STRATZ + OpenDota orchestration.
// ──────────────────────────────────────────────────────────────────────────
export async function buildTeamReport(teamId: number, token: string): Promise<TeamReport> {
  const stratz = createStratzClient(token);
  const openDota = createOpenDotaClient();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_DAYS * 86400;

  // Step 1: heroes + team meta in parallel (both STRATZ).
  const [heroes, teamPart] = await Promise.all([
    fetchHeroMap(stratz),
    fetchTeamAndRoster(stratz, teamId, windowStart),
  ]);
  const { team, accounts, standins, matchesAnalyzed } = teamPart;

  if (accounts.length === 0) {
    throw new UserError(`team ${teamId} had matches but no identifiable accounts.`);
  }

  // Step 2: roster + stand-ins. Each fans out STRATZ (identity + position
  // counts) + OpenDota (match history) per player. We run roster and
  // stand-ins serially to keep the OpenDota request burst small (avoid
  // tripping their unauthenticated rate limit of ~60/min).
  const players = await fetchPlayerReports(
    stratz,
    openDota,
    accounts,
    teamId,
    windowStart,
    heroes,
    "Roster",
  );
  const standinReports = await fetchStandins(
    stratz,
    openDota,
    standins,
    teamId,
    windowStart,
    heroes,
  );

  // Step 3: ban aggregation from league pools.
  const bansByPosition = aggregateBans(players);
  const topBans = aggregateTopBans(players);

  return {
    generatedAt: new Date().toISOString(),
    teamId: team.id,
    teamName: team.name,
    teamTag: team.tag,
    totalWins: team.winCount,
    totalLosses: team.lossCount,
    windowStart,
    windowDays: WINDOW_DAYS,
    matchesAnalyzed,
    lastMatchAt: team.lastMatchDateTime,
    players,
    standins: standinReports,
    topBans,
    bansByPosition,
  };
}

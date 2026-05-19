// Build-time analysis: turn STRATZ raw responses into a TeamReport.
//
// Steps:
//   1. Resolve team meta + recent matches; derive active roster (top 5 by appearances).
//   2. For each player × position, fetch BOTH team-scoped and pub-scoped hero performance
//      in one bulk aliased query.
//   3. Score heroes, attach tags, compute primary/flex positions, aggregate ban candidates.
//
// All time windows are in unix seconds. STRATZ requires `skip: 0` on these requests.

import { createStratzClient, type StratzClient } from "./stratz";
import { UserError } from "./errors";
import { decodeRank } from "./ranks";
import {
  ALL_POSITIONS,
  type Position,
  stratzPositionEnum,
} from "./positions";
import type {
  BanCandidate,
  HeroPerf,
  PlayerReport,
  PositionStats,
  StandinReport,
  TeamAccount,
  TeamBanCandidate,
  TeamReport,
} from "./types";

// ──────────────────────────────────────────────────────────────────────────
// Tuning knobs.
// ──────────────────────────────────────────────────────────────────────────
const TEAM_WINDOW_DAYS = 270; // ~9 months for team scrim history
const PUB_WINDOW_DAYS = 90;   // tighter — "what are they spamming right now"
const TEAM_MATCH_TAKE = 100;  // matches pulled to derive roster
const HERO_TAKE_TEAM = 30;
const HERO_TAKE_PUB = 50;     // top N hero rows; aggregates ~hundreds of games

const COMFORT_MIN_GAMES = 5;
const COMFORT_MIN_WR = 0.6;
const GEM_MIN_GAMES = 5;
const GEM_MIN_WR = 0.7;

const SPAMMER_MIN_GAMES = 5;
const SPAMMER_MIN_SHARE = 0.25; // ≥25% of player's games at the position
const SPAMMER_MIN_WR = 0.5;

const FLEX_SHARE = 0.2;
const FLEX_MIN_TOTAL_GAMES = 10;

// ──────────────────────────────────────────────────────────────────────────
// Hero constants (heroId -> displayName).
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

/** Pro identity payload — populated by STRATZ for registered esports
 *  accounts; null for everyone else. We pull the handle ("Malr1ne") and
 *  the team tag ("FLCN") so the UI can reconstruct the canonical
 *  "FLCN.Malr1ne" form for prominent placements. */
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
      `team ${teamId} has no matches in the last ${TEAM_WINDOW_DAYS} days; cannot derive a roster.`,
    );
  }

  const agg = new Map<number, TeamAccount>();
  for (const m of matches) {
    const teamIsRadiant =
      m.radiantTeamId === teamId
        ? true
        : m.direTeamId === teamId
          ? false
          : null;
    if (teamIsRadiant === null) continue;
    const teamWon = teamIsRadiant ? m.didRadiantWin : !m.didRadiantWin;
    for (const p of m.players) {
      if (p.isRadiant !== teamIsRadiant) continue;
      if (typeof p.steamAccountId !== "number") continue;
      // Prefer the esports handle over the raw Steam display name. The
      // roster query later refetches the same identity fields, so this is
      // really just a sensible default for the standin fallback path.
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
// Bulk hero performance — team + pub, all 5 players × 5 positions in one shot.
// ──────────────────────────────────────────────────────────────────────────
interface RawHeroPerf {
  heroId: number;
  matchCount: number;
  winCount: number;
  lastPlayedDateTime: number | null;
}
interface RawSteamAccount {
  seasonRank?: number | null;
  seasonLeaderboardRank?: number | null;
  name?: string | null;
  proSteamAccount?: RawProSteamAccount | null;
}
// Hero alias keys (t<aid>_<pos>, u<aid>_<pos>) hold RawHeroPerf[]; `steamAccount`
// holds rank/profile info. Mixed shape — typed as union below.
type PlayerBlock = Record<string, RawHeroPerf[] | RawSteamAccount | null>;

function buildRosterQuery(accounts: TeamAccount[]): {
  query: string;
  variables: Record<string, unknown>;
} {
  const varDecls: string[] = [
    "$teamId: Int!",
    "$since: Long!",
    "$pubSince: Long!",
  ];
  const variables: Record<string, unknown> = {};
  const playerBlocks: string[] = [];

  for (const acc of accounts) {
    const aidVar = `aid_${acc.accountId}`;
    varDecls.push(`$${aidVar}: Long!`);
    variables[aidVar] = acc.accountId;

    const posBlocks = ALL_POSITIONS.map((pos) => {
      const enumName = stratzPositionEnum(pos);
      return `    t${acc.accountId}_${pos}: heroesPerformance(request: {
      teamId: $teamId
      startDateTime: $since
      positionIds: [${enumName}]
      take: ${HERO_TAKE_TEAM}
      skip: 0
    }) { heroId matchCount winCount lastPlayedDateTime }
    u${acc.accountId}_${pos}: heroesPerformance(request: {
      startDateTime: $pubSince
      positionIds: [${enumName}]
      lobbyTypeIds: [0, 7]
      take: ${HERO_TAKE_PUB}
      skip: 0
    }) { heroId matchCount winCount lastPlayedDateTime }`;
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
// Scoring + tag rules.
// ──────────────────────────────────────────────────────────────────────────
function score(games: number, wins: number): number {
  if (games <= 0) return 0;
  return (wins / games) * Math.log10(games + 1);
}

function classify(games: number, wins: number): string[] {
  const wr = games > 0 ? wins / games : 0;
  const tags: string[] = [];
  if (games >= COMFORT_MIN_GAMES && wr >= COMFORT_MIN_WR) tags.push("COMF");
  if (
    games >= GEM_MIN_GAMES &&
    wr >= GEM_MIN_WR &&
    !tags.includes("COMF")
  )
    tags.push("GEM");
  return tags;
}

// Low-sample fallback: if the >=2-game filter leaves us with fewer than this
// many heroes, we top up from the raw 1-game rows so coaches can still see
// *something* for thin profiles (new stand-ins, secondary positions, etc.).
// Padded rows go through the same tag/share/score pipeline — `classify`
// won't add COMF/GEM at 1 game (thresholds are higher) so they appear as
// clean untagged rows.
const MIN_HEROES_SHOWN = 3;

function rowsToHeroPerfs(
  rows: RawHeroPerf[],
  heroes: Map<number, HeroMeta>,
): { heroes: HeroPerf[]; totalGames: number; totalWins: number } {
  // Totals are computed BEFORE filtering so share/sample-size reflect reality,
  // not the filtered display set.
  const totalGames = rows.reduce((s, r) => s + r.matchCount, 0);
  const totalWins = rows.reduce((s, r) => s + r.winCount, 0);

  // Primary cohort: heroes with >= 2 games (the "real signal" set).
  const primary = rows.filter((r) => r.matchCount >= 2);

  // Low-sample fallback: if the primary set is too thin, pad with the best
  // 1-game rows (sorted by matchCount desc, then most recently played) until
  // we hit MIN_HEROES_SHOWN. This keeps Maakep-style 2-scrim stand-ins from
  // showing an empty card.
  let display = primary;
  if (primary.length < MIN_HEROES_SHOWN) {
    const seen = new Set(primary.map((r) => r.heroId));
    const padding = rows
      .filter((r) => !seen.has(r.heroId))
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return (b.lastPlayedDateTime ?? 0) - (a.lastPlayedDateTime ?? 0);
      })
      .slice(0, MIN_HEROES_SHOWN - primary.length);
    display = [...primary, ...padding];
  }

  const out: HeroPerf[] = display.map((r) => {
    const wr = r.matchCount > 0 ? r.winCount / r.matchCount : 0;
    const meta = heroMeta(heroes, r.heroId);
    const share = totalGames > 0 ? r.matchCount / totalGames : 0;
    const tags: string[] = classify(r.matchCount, r.winCount);
    if (
      r.matchCount >= SPAMMER_MIN_GAMES &&
      wr >= SPAMMER_MIN_WR &&
      share >= SPAMMER_MIN_SHARE
    ) {
      tags.push("SPAM");
    }
    return {
      heroId: r.heroId,
      heroName: meta.displayName,
      shortName: meta.shortName,
      matches: r.matchCount,
      wins: r.winCount,
      winRate: wr,
      lastPlayed: r.lastPlayedDateTime,
      score: score(r.matchCount, r.winCount),
      share,
      tags,
    };
  });
  out.sort((a, b) => {
    if (b.matches !== a.matches) return b.matches - a.matches;
    return b.winRate - a.winRate;
  });
  return { heroes: out, totalGames, totalWins };
}

// ──────────────────────────────────────────────────────────────────────────
// Build the per-player report from one PlayerBlock.
// ──────────────────────────────────────────────────────────────────────────
function buildPlayerReport(
  acc: TeamAccount,
  block: PlayerBlock,
  heroes: Map<number, HeroMeta>,
  options: { includePubOnlyPositions?: boolean } = {},
): PlayerReport {
  const includePubOnlyPositions = options.includePubOnlyPositions ?? false;
  const positionStats: PositionStats[] = [];
  let totalMatches = 0;
  let totalWins = 0;

  const rawAccount = block["steamAccount"] as RawSteamAccount | null | undefined;
  const rank = decodeRank(
    rawAccount?.seasonRank,
    rawAccount?.seasonLeaderboardRank,
  );

  // Identity resolution. STRATZ exposes two layers: the raw Steam display
  // name (anything the user has set on their profile) and the curated
  // `proSteamAccount` payload which is only populated for registered
  // esports accounts. We surface both: the esports handle drives almost
  // every UI surface, while the Steam name lingers as a muted subtitle so
  // viewers can match a known handle back to their pub account.
  const proName = rawAccount?.proSteamAccount?.name ?? null;
  const steamName = rawAccount?.name ?? null;
  const teamTag = rawAccount?.proSteamAccount?.team?.tag ?? null;
  // Fall back to whatever the team-match aggregation captured if the
  // roster query somehow returned an empty identity block.
  const resolvedName = proName ?? steamName ?? acc.name;

  // First pass: collect raw position stats.
  const raw: Array<{
    pos: Position;
    teamHeroes: HeroPerf[];
    pubHeroes: HeroPerf[];
    teamGames: number;
    teamWins: number;
    pubGames: number;
    pubWins: number;
  }> = [];
  for (const pos of ALL_POSITIONS) {
    const teamRows = (block[`t${acc.accountId}_${pos}`] ?? []) as RawHeroPerf[];
    const pubRows = (block[`u${acc.accountId}_${pos}`] ?? []) as RawHeroPerf[];
    const teamRes = rowsToHeroPerfs(teamRows, heroes);
    const pubRes = rowsToHeroPerfs(pubRows, heroes);
    totalMatches += teamRes.totalGames;
    totalWins += teamRes.totalWins;
    raw.push({
      pos,
      teamHeroes: teamRes.heroes,
      pubHeroes: pubRes.heroes,
      teamGames: teamRes.totalGames,
      teamWins: teamRes.totalWins,
      pubGames: pubRes.totalGames,
      pubWins: pubRes.totalWins,
    });
  }

  // Second pass: compute share and assemble PositionStats. For roster players
  // we gate inclusion on team games — a pos-2-only player shouldn't get pos-4
  // pubs dumped into their card just because they queued sup once on the
  // ladder. For stand-ins we relax this: include any position with at least
  // some pub data, because a stand-in might be called up to any role and we
  // want a holistic profile.
  for (const r of raw) {
    const include =
      r.teamGames > 0 || (includePubOnlyPositions && r.pubGames > 0);
    if (!include) continue;
    positionStats.push({
      position: r.pos,
      teamGames: r.teamGames,
      teamWins: r.teamWins,
      share: totalMatches > 0 ? r.teamGames / totalMatches : 0,
      teamHeroes: r.teamHeroes,
      pubGames: r.pubGames,
      pubWins: r.pubWins,
      pubHeroes: r.pubHeroes,
    });
  }
  // Sort positions by team games desc, falling back to pub games.
  positionStats.sort((a, b) => {
    if (b.teamGames !== a.teamGames) return b.teamGames - a.teamGames;
    return b.pubGames - a.pubGames;
  });

  // Primary + flex detection (team-scope only — that's what we draft against).
  let primaryPosition: Position | null = null;
  let max = 0;
  for (const r of raw) {
    if (r.teamGames > max) {
      max = r.teamGames;
      primaryPosition = r.pos;
    }
  }
  const flexPositions = raw
    .filter((r) => totalMatches > 0 && r.teamGames / totalMatches >= FLEX_SHARE)
    .map((r) => r.pos);
  const flex = totalMatches >= FLEX_MIN_TOTAL_GAMES && flexPositions.length >= 2;

  return {
    accountId: acc.accountId,
    name: resolvedName,
    proName,
    steamName,
    teamTag,
    rank,
    totalMatches,
    totalWins,
    primaryPosition,
    flex,
    flexPositions,
    positions: positionStats,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Ban candidate aggregation across the roster. One card per (hero × position)
// — every roster player who plays the hero at that position is rolled into
// the same card with team + pub stats summed across the contributors.
// ──────────────────────────────────────────────────────────────────────────
const BAN_MIN_GAMES_TEAM = 3;
const BAN_MIN_GAMES_PUB = 5;
const FLEX_BOOST = 1.1;
const PUB_WEIGHT = 0.6;
const PER_POSITION = 8; // top-N per position column

// Team-level hero-flex: hero fielded at ≥ 2 distinct positions across the
// roster (any player, any position). Same definition used by aggregateTopBans
// so the FLEX flag is consistent between the priority bans and the
// per-position ban board.
function computeTeamHeroFlex(report: PlayerReport[]): Set<number> {
  const positions = new Map<number, Set<Position>>();
  for (const p of report) {
    for (const ps of p.positions) {
      for (const h of ps.teamHeroes) {
        const s = positions.get(h.heroId) ?? new Set<Position>();
        s.add(ps.position);
        positions.set(h.heroId, s);
      }
    }
  }
  const flex = new Set<number>();
  for (const [id, s] of positions) {
    if (s.size >= 2) flex.add(id);
  }
  return flex;
}

function aggregateBans(report: PlayerReport[]): Record<Position, BanCandidate[]> {
  const out: Record<Position, BanCandidate[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
  };
  const teamHeroFlex = computeTeamHeroFlex(report);

  // Intermediate accumulator keyed by (position, heroId). Each entry collects
  // every player who fields the hero at this position (team and/or pub) and
  // the per-player totals we need for the player-breakdown sub-list.
  interface Agg {
    heroId: number;
    heroName: string;
    shortName: string;
    position: Position;
    teamMatches: number;
    teamWins: number;
    pubMatches: number;
    pubWins: number;
    teamScoreSum: number;
    pubScoreSum: number;
    tags: Set<string>;
    players: Map<number, BanCandidate["players"][number]>;
  }
  const buckets = new Map<string, Agg>();
  const key = (pos: Position, heroId: number) => `${pos}:${heroId}`;

  for (const p of report) {
    for (const ps of p.positions) {
      const pos = ps.position;
      const merged = new Map<number, { team?: HeroPerf; pub?: HeroPerf }>();
      for (const h of ps.teamHeroes) merged.set(h.heroId, { team: h });
      for (const h of ps.pubHeroes) {
        const cur = merged.get(h.heroId) ?? {};
        cur.pub = h;
        merged.set(h.heroId, cur);
      }

      for (const [heroId, { team, pub }] of merged) {
        const teamMatches = team?.matches ?? 0;
        const teamWins = team?.wins ?? 0;
        const pubMatches = pub?.matches ?? 0;
        const pubWins = pub?.wins ?? 0;
        const meta = team ?? pub!;
        const k = key(pos, heroId);
        const cur =
          buckets.get(k) ??
          ({
            heroId,
            heroName: meta.heroName,
            shortName: meta.shortName,
            position: pos,
            teamMatches: 0,
            teamWins: 0,
            pubMatches: 0,
            pubWins: 0,
            teamScoreSum: 0,
            pubScoreSum: 0,
            tags: new Set<string>(),
            players: new Map(),
          } as Agg);
        cur.teamMatches += teamMatches;
        cur.teamWins += teamWins;
        cur.pubMatches += pubMatches;
        cur.pubWins += pubWins;
        cur.teamScoreSum += team?.score ?? 0;
        cur.pubScoreSum += pub?.score ?? 0;
        for (const t of team?.tags ?? []) cur.tags.add(t);
        for (const t of pub?.tags ?? []) cur.tags.add(t);
        cur.players.set(p.accountId, {
          accountId: p.accountId,
          playerName: p.name,
          teamMatches,
          teamWins,
          teamWinRate: teamMatches > 0 ? teamWins / teamMatches : 0,
          pubMatches,
          pubWins,
          pubWinRate: pubMatches > 0 ? pubWins / pubMatches : 0,
        });
        buckets.set(k, cur);
      }
    }
  }

  for (const a of buckets.values()) {
    // Relevance gate is applied to the AGGREGATED totals so a hero fielded
    // by two players (1g each scrim) still surfaces if combined volume meets
    // the floor.
    if (a.teamMatches < BAN_MIN_GAMES_TEAM && a.pubMatches < BAN_MIN_GAMES_PUB) {
      continue;
    }
    const isFlex = teamHeroFlex.has(a.heroId);
    if (isFlex) a.tags.add("FLEX");
    const boost = isFlex ? FLEX_BOOST : 1;
    const score = (a.teamScoreSum + PUB_WEIGHT * a.pubScoreSum) * boost;

    const players = Array.from(a.players.values()).sort((x, y) => {
      if (y.teamMatches !== x.teamMatches) return y.teamMatches - x.teamMatches;
      return y.pubMatches - x.pubMatches;
    });

    out[a.position].push({
      heroId: a.heroId,
      heroName: a.heroName,
      shortName: a.shortName,
      position: a.position,
      teamMatches: a.teamMatches,
      teamWins: a.teamWins,
      teamWinRate: a.teamMatches > 0 ? a.teamWins / a.teamMatches : 0,
      pubMatches: a.pubMatches,
      pubWins: a.pubWins,
      pubWinRate: a.pubMatches > 0 ? a.pubWins / a.pubMatches : 0,
      totalMatches: a.teamMatches + a.pubMatches,
      score,
      tags: Array.from(a.tags),
      flexBoosted: isFlex,
      players,
    });
  }

  // Primary sort: weighted team games (team experience worth 2x pub volume).
  // Tiebreak: score (winrate × log10 sample size, flex-boosted).
  for (const pos of ALL_POSITIONS) {
    out[pos].sort((a, b) => {
      const aw = a.teamMatches * 2 + a.pubMatches;
      const bw = b.teamMatches * 2 + b.pubMatches;
      if (bw !== aw) return bw - aw;
      return b.score - a.score;
    });
    out[pos] = out[pos].slice(0, PER_POSITION);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Team-level priority bans — pick rate × win rate across the whole roster,
// role-agnostic. Same hero played by multiple (player, position) pairs is
// summed into a single team-level entry. Pub data is intentionally excluded
// here; this is the "what they actually pick in scrims" board.
// ──────────────────────────────────────────────────────────────────────────
const TOP_BAN_MIN_GAMES = 3;
const TOP_BAN_COUNT = 7;

function aggregateTopBans(
  report: PlayerReport[],
  matchesAnalyzed: number,
): TeamBanCandidate[] {
  // Intermediate raw shape: keep one entry per (player, position) so we can
  // collect distinct team-level positions before merging. The final
  // TeamBanCandidate.picks is rolled up per-player below.
  interface RawPick {
    accountId: number;
    playerName: string | null;
    position: Position;
    teamMatches: number;
    teamWins: number;
  }
  interface Agg {
    heroId: number;
    heroName: string;
    shortName: string;
    teamMatches: number;
    teamWins: number;
    tags: Set<string>;
    rawPicks: RawPick[];
  }
  const m = new Map<number, Agg>();
  for (const p of report) {
    for (const ps of p.positions) {
      for (const h of ps.teamHeroes) {
        const cur =
          m.get(h.heroId) ??
          ({
            heroId: h.heroId,
            heroName: h.heroName,
            shortName: h.shortName,
            teamMatches: 0,
            teamWins: 0,
            tags: new Set<string>(),
            rawPicks: [],
          } as Agg);
        cur.teamMatches += h.matches;
        cur.teamWins += h.wins;
        for (const t of h.tags) cur.tags.add(t);
        cur.rawPicks.push({
          accountId: p.accountId,
          playerName: p.name,
          position: ps.position,
          teamMatches: h.matches,
          teamWins: h.wins,
        });
        m.set(h.heroId, cur);
      }
    }
  }
  const result: TeamBanCandidate[] = [];
  for (const a of m.values()) {
    if (a.teamMatches < TOP_BAN_MIN_GAMES) continue;
    const wr = a.teamWins / a.teamMatches;

    // Team-level FLEX: hero played at ≥ 2 distinct positions across the
    // whole roster (any player, any position). Draft-prep view: you can't
    // counter-pick the lane until commitment.
    const distinctPositions = new Set(a.rawPicks.map((pk) => pk.position));
    if (distinctPositions.size >= 2) a.tags.add("FLEX");

    // Merge picks per player: one row per accountId, accumulating positions
    // (deduped, sorted) and summing team matches/wins. UI shows e.g.
    // "Jorel  p4·p5  6g" instead of two separate rows.
    const byPlayer = new Map<number, TeamBanCandidate["picks"][number]>();
    for (const pk of a.rawPicks) {
      const prev = byPlayer.get(pk.accountId);
      if (prev) {
        if (!prev.positions.includes(pk.position)) {
          prev.positions.push(pk.position);
        }
        prev.teamMatches += pk.teamMatches;
        prev.teamWins += pk.teamWins;
      } else {
        byPlayer.set(pk.accountId, {
          accountId: pk.accountId,
          playerName: pk.playerName,
          positions: [pk.position],
          teamMatches: pk.teamMatches,
          teamWins: pk.teamWins,
        });
      }
    }
    const mergedPicks = Array.from(byPlayer.values());
    for (const p of mergedPicks) p.positions.sort((x, y) => x - y);
    mergedPicks.sort((x, y) => y.teamMatches - x.teamMatches);

    result.push({
      heroId: a.heroId,
      heroName: a.heroName,
      shortName: a.shortName,
      teamMatches: a.teamMatches,
      teamWins: a.teamWins,
      teamWinRate: wr,
      pickRate: matchesAnalyzed > 0 ? a.teamMatches / matchesAnalyzed : 0,
      score: score(a.teamMatches, a.teamWins),
      picks: mergedPicks,
      tags: Array.from(a.tags),
    });
  }
  result.sort((a, b) => b.score - a.score);
  return result.slice(0, TOP_BAN_COUNT);
}

// ──────────────────────────────────────────────────────────────────────────
// Stand-in fetch: same per-position hero analysis as roster players (team
// + pub), so stand-ins can be rendered with the regular PlayerCard. We
// piggy-back on `buildRosterQuery` since the shape is identical — STRATZ
// returns the same player object regardless of whether the account is
// listed on the team or just shows up in matches.
//
// Cost: O(stand-ins × 5 positions × 2 scopes) aliased subqueries per build.
// Rate-limit caution: a team with many stand-ins (>~5) may want a cap.
// ──────────────────────────────────────────────────────────────────────────
async function fetchPlayerReports(
  stratz: StratzClient,
  accounts: TeamAccount[],
  teamId: number,
  windowStart: number,
  pubWindowStart: number,
  heroes: Map<number, HeroMeta>,
  operationName: string,
  options: { includePubOnlyPositions?: boolean } = {},
): Promise<PlayerReport[]> {
  if (accounts.length === 0) return [];
  const { query, variables } = buildRosterQuery(accounts);
  variables["teamId"] = teamId;
  variables["since"] = windowStart;
  variables["pubSince"] = pubWindowStart;
  const data = await stratz.query<Record<string, PlayerBlock>>(
    query,
    variables,
    { operationName },
  );
  return accounts.map((acc) =>
    buildPlayerReport(
      acc,
      data[`player_${acc.accountId}`] ?? {},
      heroes,
      options,
    ),
  );
}

async function fetchStandins(
  stratz: StratzClient,
  standins: TeamAccount[],
  teamId: number,
  windowStart: number,
  pubWindowStart: number,
  heroes: Map<number, HeroMeta>,
): Promise<StandinReport[]> {
  if (standins.length === 0) return [];
  const reports = await fetchPlayerReports(
    stratz,
    standins,
    teamId,
    windowStart,
    pubWindowStart,
    heroes,
    "Standins",
    { includePubOnlyPositions: true },
  );
  return reports.map((rep, i) => ({
    ...rep,
    lastTeamMatchAt: standins[i].lastMatchAt,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry: orchestrate the full fetch and build the TeamReport.
// ──────────────────────────────────────────────────────────────────────────
export async function buildTeamReport(
  teamId: number,
  token: string,
): Promise<TeamReport> {
  const stratz = createStratzClient(token);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - TEAM_WINDOW_DAYS * 86400;
  const pubWindowStart = now - PUB_WINDOW_DAYS * 86400;

  // Step 1: heroes + team meta in parallel.
  const [heroes, teamPart] = await Promise.all([
    fetchHeroMap(stratz),
    fetchTeamAndRoster(stratz, teamId, windowStart),
  ]);
  const { team, accounts, standins, matchesAnalyzed } = teamPart;

  if (accounts.length === 0) {
    throw new UserError(`team ${teamId} had matches but no identifiable accounts.`);
  }

  // Step 2: roster (full per-position hero perfs) + stand-ins (same shape) in parallel.
  const [players, standinReports] = await Promise.all([
    fetchPlayerReports(
      stratz,
      accounts,
      teamId,
      windowStart,
      pubWindowStart,
      heroes,
      "Roster",
    ),
    fetchStandins(
      stratz,
      standins,
      teamId,
      windowStart,
      pubWindowStart,
      heroes,
    ),
  ]);

  // Step 3: ban aggregation from roster reports.
  const bansByPosition = aggregateBans(players);
  const topBans = aggregateTopBans(players, matchesAnalyzed);

  return {
    generatedAt: new Date().toISOString(),
    teamId: team.id,
    teamName: team.name,
    teamTag: team.tag,
    totalWins: team.winCount,
    totalLosses: team.lossCount,
    windowStart,
    pubWindowStart,
    matchesAnalyzed,
    lastMatchAt: team.lastMatchDateTime,
    players,
    standins: standinReports,
    topBans,
    bansByPosition,
  };
}

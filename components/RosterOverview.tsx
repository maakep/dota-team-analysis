import type { PlayerReport, TeamReport } from "@/lib/types";
import { POSITION_NAMES, type Position } from "@/lib/positions";
import { RankBadge } from "./RankBadge";

// Same reading order the rest of the dashboard uses: outer supports →
// cores → hard support. Keeps the eye flowing left-to-right through the
// natural draft slots a coach would scan.
const COLUMN_ORDER: Position[] = [4, 3, 2, 1, 5];

/** Roster at-a-glance strip that sits between the team header and the
 *  priority-ban grid. One card per primary position — name + medal +
 *  primary role + flex tag (when the player covers 2+ positions) + a
 *  single combined volume/WR line covering both team scrims and pub
 *  ladder in the analysis window.
 *
 *  Visually mirrors `BanTargets` so the page reads as a stack of 5-wide
 *  grids, but each card here represents a person, not a hero. */
export function RosterOverview({ report }: { report: TeamReport }) {
  // The window length is now baked on the report (team + pub unified).
  const windowDays = report.windowDays;

  // Bucket roster by primary position so we can render the 5 columns
  // even when two players share a position (rare but possible — e.g.,
  // dual-pos-4 rosters). Players without a primary position get
  // appended to the offlane column as a fallback so nothing disappears.
  const buckets = new Map<Position, PlayerReport[]>();
  for (const pos of COLUMN_ORDER) buckets.set(pos, []);
  for (const p of report.players) {
    const key = (p.primaryPosition ?? 3) as Position;
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {COLUMN_ORDER.map((pos) => {
        const players = buckets.get(pos) ?? [];
        return (
          <RosterColumn
            key={pos}
            pos={pos}
            players={players}
            windowDays={windowDays}
          />
        );
      })}
    </div>
  );
}

function RosterColumn({
  pos,
  players,
  windowDays,
}: {
  pos: Position;
  players: PlayerReport[];
  windowDays: number;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-ink-700 bg-ink-800">
      <header className="flex items-baseline justify-between border-b border-ink-700 px-3 py-2">
        <h3 className="text-sm font-semibold text-ink-100">
          Pos {pos}
          <span className="ml-1.5 text-xs font-normal text-ink-300">
            {POSITION_NAMES[pos]}
          </span>
        </h3>
      </header>
      {players.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs italic text-ink-400">
          —
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-ink-700/60">
          {players.map((p) => (
            <RosterCard
              key={p.accountId}
              player={p}
              windowDays={windowDays}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RosterCard({
  player,
  windowDays,
}: {
  player: PlayerReport;
  windowDays: number;
}) {
  // We deliberately use the bare `name` here, not the `${tag}.${pro}`
  // form — the column is narrow and the team tag is already implied by
  // being on the team page.
  const handle = player.name ?? `Account ${player.accountId}`;
  // Combined volume across all three data sources for a single
  // at-a-glance number. League + pub come from OpenDota (complete);
  // team-scrim comes from STRATZ (the canonical "matches with this
  // team" count). Sum them for the headline; expose the breakdown via
  // tooltip so a coach can drill in without losing the overview.
  const totalGames =
    player.totalTeamMatches + player.leagueGames + player.pubGames;
  const totalWins =
    player.totalTeamWins + player.leagueWins + player.pubWins;
  const wr = totalGames > 0 ? (totalWins / totalGames) * 100 : 0;
  // Player is treated as "flexes" if they covered at least 2 distinct
  // positions in the team window — same threshold the rest of the
  // dashboard uses via `PlayerReport.flex`.
  const isFlex = player.flex && player.flexPositions.length >= 2;
  const extras = player.flexPositions.filter(
    (p) => p !== player.primaryPosition,
  );
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <RankBadge rank={player.rank} size="xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <a
            href={`https://stratz.com/players/${player.accountId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-sm font-semibold text-ink-100 hover:text-accent-flex hover:underline"
            title={`${handle} — open STRATZ profile`}
          >
            {handle}
          </a>
          {isFlex && (
            <span
              className="rounded bg-accent-flex/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-accent-flex ring-1 ring-accent-flex/30"
              title={
                extras.length > 0
                  ? `Also plays ${extras.map((p) => `pos ${p}`).join(", ")}`
                  : "Multi-position player"
              }
            >
              FLEX
            </span>
          )}
        </div>
        <div
          className="mt-0.5 font-mono text-[11px] text-ink-300"
          title={`${player.totalTeamMatches}g team · ${player.leagueGames}g league · ${player.pubGames}g pub`}
        >
          {totalGames}g · {totalGames > 0 ? `${wr.toFixed(0)}% WR` : "—"}
          <span className="ml-1 text-ink-500">/ {windowDays}d</span>
        </div>
      </div>
    </li>
  );
}



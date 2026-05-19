import type { BanCandidate } from "@/lib/types";
import { POSITION_NAMES, type Position } from "@/lib/positions";
import { HeroIcon } from "./HeroIcon";

// Drafting-ish column order: outer supports → cores → hard support.
const COLUMN_ORDER: Position[] = [4, 3, 2, 1, 5];

export function BanTargets({
  bans,
}: {
  bans: Record<Position, BanCandidate[]>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {COLUMN_ORDER.map((pos) => (
        <BanColumn key={pos} pos={pos} candidates={bans[pos]} />
      ))}
    </div>
  );
}

function BanColumn({
  pos,
  candidates,
}: {
  pos: Position;
  candidates: BanCandidate[];
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
        <span className="font-mono text-[11px] text-ink-400">
          top {candidates.length}
        </span>
      </header>
      {candidates.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs italic text-ink-400">
          No clear targets.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-ink-700/60">
          {candidates.map((b, i) => (
            <BanCard key={b.heroId} rank={i + 1} b={b} />
          ))}
        </ol>
      )}
    </section>
  );
}

function BanCard({ rank, b }: { rank: number; b: BanCandidate }) {
  // FLEX cards get a faint tint stripe.
  const rowCls = b.flexBoosted
    ? "bg-accent-flex/5 hover:bg-accent-flex/10"
    : "hover:bg-ink-700/30";
  return (
    <li className={`flex gap-2.5 px-3 py-2.5 ${rowCls}`}>
      <div className="flex w-5 shrink-0 flex-col items-center pt-0.5 font-mono text-[10px] text-ink-400">
        {rank}
      </div>
      <HeroIcon shortName={b.shortName} name={b.heroName} size="md" />
      <div className="min-w-0 flex-1">
        {/* Hero name + tags on the same line; tags wrap below if cramped. */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">
            {b.heroName}
          </h4>
          {b.tags.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {b.tags.map((t) => (
                <MiniTag key={t} tag={t} />
              ))}
            </div>
          )}
        </div>

        {/* Player names only — no per-player stats. Comma-separated, each
            linked to STRATZ. Wraps to multiple lines if needed. */}
        <p className="mt-0.5 text-[11px] text-ink-300">
          {b.players.map((pl, i) => (
            <span key={pl.accountId}>
              {i > 0 && <span className="text-ink-500">, </span>}
              <a
                href={`https://stratz.com/players/${pl.accountId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink-100 hover:underline"
                title={`STRATZ: ${pl.playerName ?? pl.accountId}`}
              >
                {pl.playerName ?? `#${pl.accountId}`}
              </a>
            </span>
          ))}
        </p>

        {/* Aggregated stats — team and pub on separate lines so neither
            overflows the narrow column. Lines are hidden when irrelevant. */}
        <div className="mt-1 space-y-0.5 font-mono text-[11px]">
          {b.teamMatches > 0 && (
            <StatLine
              label="team"
              games={b.teamMatches}
              wins={b.teamWins}
              wr={b.teamWinRate}
            />
          )}
          {b.pubMatches > 0 && (
            <StatLine
              label="pub"
              games={b.pubMatches}
              wins={b.pubWins}
              wr={b.pubWinRate}
              muted
            />
          )}
        </div>
      </div>
    </li>
  );
}

function StatLine({
  label,
  games,
  wins,
  wr,
  muted = false,
}: {
  label: string;
  games: number;
  wins: number;
  wr: number;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-2 ${muted ? "opacity-70" : ""}`}
    >
      <span className="text-[10px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <span className="text-ink-300">
        {games}g{" "}
        <span className="text-ink-500">
          ({wins}-{games - wins})
        </span>
      </span>
      <span className={wrColor(wr, games)}>{(wr * 100).toFixed(0)}%</span>
    </div>
  );
}

function MiniTag({ tag }: { tag: string }) {
  const cls =
    tag === "COMF"
      ? "bg-accent-good/15 text-accent-good"
      : tag === "GEM"
        ? "bg-accent-gem/15 text-accent-gem"
        : tag === "SPAM"
          ? "bg-accent-mid/15 text-accent-mid"
          : tag === "FLEX"
            ? "bg-accent-flex/20 text-accent-flex"
            : "bg-ink-600 text-ink-200";
  return (
    <span
      className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {tag}
    </span>
  );
}

function wrColor(wr: number, games: number): string {
  if (games < 3) return "text-ink-300";
  if (wr >= 0.6) return "text-accent-good";
  if (wr >= 0.5) return "text-accent-mid";
  return "text-accent-bad";
}

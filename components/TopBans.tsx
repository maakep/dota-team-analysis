import type { TeamBanCandidate } from "@/lib/types";
import { HeroIcon } from "./HeroIcon";

/** Top-of-page priority bans: team-level aggregate, role-agnostic.
 *  Picks are merged per-player (positions rolled into an array). When the
 *  hero is played at ≥ 2 distinct positions across the roster, the card is
 *  highlighted as FLEX — a draft-prep priority since you can't counter the
 *  lane until pick order commits. */
export function TopBans({ bans }: { bans: TeamBanCandidate[] }) {
  if (bans.length === 0) {
    return (
      <p className="rounded-lg border border-ink-700 bg-ink-800 p-4 text-sm italic text-ink-400">
        Not enough team data to compute priority bans yet.
      </p>
    );
  }
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {bans.map((b, i) => (
        <TopBanCard key={b.heroId} rank={i + 1} b={b} />
      ))}
    </ol>
  );
}

function TopBanCard({ rank, b }: { rank: number; b: TeamBanCandidate }) {
  // Win rate and game count come from the league-only pool now; pickRate
  // was dropped during the OpenDota refactor since we can't define
  // "what fraction of the team's matches featured this hero" cheaply
  // across the two data sources (STRATZ team-scrim totals vs OpenDota
  // per-player league pulls don't share a denominator).
  const wrPct = (b.teamWinRate * 100).toFixed(0);
  const isFlex = b.tags.includes("FLEX");
  // FLEX cards get a colored border + faint accent tint so they pop in the row.
  const containerCls = isFlex
    ? "border-accent-flex/60 bg-accent-flex/5 ring-1 ring-accent-flex/30"
    : "border-ink-700 bg-ink-800";
  return (
    <li className={`flex flex-col rounded-lg border p-2.5 ${containerCls}`}>
      <div className="flex items-start gap-2">
        <span className="font-mono text-[10px] text-ink-400">#{rank}</span>
        <HeroIcon shortName={b.shortName} name={b.heroName} size="md" />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-ink-100">
            {b.heroName}
          </h4>
          <div className="font-mono text-[11px] text-ink-300">
            <span className={wrColor(b.teamWinRate, b.teamMatches)}>
              {wrPct}%
            </span>
            <span className="text-ink-500"> · </span>
            <span>{b.teamMatches}g</span>
          </div>
        </div>
      </div>

      {b.picks.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-ink-700/60 pt-1.5 text-[11px]">
          {b.picks.map((pk) => (
            <li
              key={pk.accountId}
              className="flex items-center justify-between gap-2"
            >
              <a
                href={`https://stratz.com/players/${pk.accountId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-ink-200 hover:text-accent-flex hover:underline"
              >
                {pk.playerName ?? `#${pk.accountId}`}
              </a>
              <span className="shrink-0 font-mono text-ink-400">
                <span
                  className={
                    pk.positions.length >= 2 ? "text-accent-flex" : undefined
                  }
                >
                  {pk.positions.map((p) => `p${p}`).join("·")}
                </span>
                <span className="text-ink-500"> · </span>
                {pk.teamMatches}g
              </span>
            </li>
          ))}
        </ul>
      )}

      {b.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {b.tags.map((t) => (
            <MiniTag key={t} tag={t} />
          ))}
        </div>
      )}
    </li>
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

import report from "@/data/team.json";
import type { PlayerReport, TeamReport } from "@/lib/types";
import { TeamHeader } from "@/components/TeamHeader";
import { PlayerCard } from "@/components/PlayerCard";
import { BanTargets } from "@/components/BanTargets";
import { TopBans } from "@/components/TopBans";
import { Standins } from "@/components/Standins";
import { RosterOverview } from "@/components/RosterOverview";

const data = report as unknown as TeamReport;

// Coach-friendly roster grid: two-column layout reading as
//   row 1: pos 1 (carry)   · pos 3 (offlane)
//   row 2: pos 5 (hard sup) · pos 4 (soft sup)
//   row 3: pos 2 (mid)
// Players without a known primary position fall to the end in their natural
// (matches-desc) order. Players whose primary position appears more than once
// among the roster keep their original ordering inside that bucket.
const ROSTER_POSITION_ORDER: ReadonlyArray<number> = [1, 3, 5, 4, 2];

function orderRoster(players: PlayerReport[]): PlayerReport[] {
  const rank = (p: PlayerReport): number => {
    if (p.primaryPosition === null) return ROSTER_POSITION_ORDER.length;
    const idx = ROSTER_POSITION_ORDER.indexOf(p.primaryPosition);
    return idx === -1 ? ROSTER_POSITION_ORDER.length : idx;
  };
  // Stable sort: tiebreak preserves the input order so duplicate primaries
  // (e.g., two pos-4 players) keep their natural matches-desc ranking.
  return [...players]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

export default function Page() {
  // Derive the pub-window length once from the report so per-player /
  // per-position captions ("Recent pubs (270d)") track the actual
  // PUB_WINDOW_DAYS env knob baked at prefetch time. Matches the same
  // formula RosterOverview uses for its window caption.
  const pubWindowDays = Math.max(
    1,
    Math.round((Date.now() / 1000 - data.pubWindowStart) / 86400),
  );
  return (
    <main className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:px-8">
      <TeamHeader report={data} />

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Roster overview
          <span className="ml-2 text-[10px] font-normal normal-case text-ink-400">
            primary roles · rank · combined team + pub volume in window
          </span>
        </h2>
        <RosterOverview report={data} />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Priority bans
          <span className="ml-2 text-[10px] font-normal normal-case text-ink-400">
            top {data.topBans.length} team picks by sample × win rate
          </span>
        </h2>
        <TopBans bans={data.topBans} />
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Ban targets by position
        </h2>
        <BanTargets bans={data.bansByPosition} />
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Roster
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {orderRoster(data.players).map((p) => (
            <PlayerCard
              key={p.accountId}
              player={p}
              pubWindowDays={pubWindowDays}
            />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Stand-ins
          <span className="ml-2 text-[10px] font-normal normal-case text-ink-400">
            off-roster players who appeared with the team
          </span>
        </h2>
        <Standins standins={data.standins} pubWindowDays={pubWindowDays} />
      </section>

      <footer className="mt-12 border-t border-ink-700 pt-4 text-xs text-ink-400">
        Generated {new Date(data.generatedAt).toLocaleString()} ·{" "}
        {data.matchesAnalyzed} team matches analyzed · STRATZ data
      </footer>
    </main>
  );
}

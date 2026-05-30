import type { PlayerReport, TeamReport } from "@/lib/types";
import { TeamHeader } from "./TeamHeader";
import { PlayerCard } from "./PlayerCard";
import { Standins } from "./Standins";
import { RosterOverview } from "./RosterOverview";
import { MatchHistory } from "./MatchHistory";
import { DashboardClient } from "./DashboardClient";
import { TeamSwitcher } from "./TeamSwitcher";

interface TeamManifestEntry {
  teamId: number;
  teamName: string | null;
  teamTag: string | null;
}

const ROSTER_POSITION_ORDER: ReadonlyArray<number> = [1, 3, 5, 4, 2];

function orderRoster(players: PlayerReport[]): PlayerReport[] {
  const rank = (p: PlayerReport): number => {
    if (p.primaryPosition === null) return ROSTER_POSITION_ORDER.length;
    const idx = ROSTER_POSITION_ORDER.indexOf(p.primaryPosition);
    return idx === -1 ? ROSTER_POSITION_ORDER.length : idx;
  };
  return [...players]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

/** Full team dashboard page body. Shared between the root page and the
 *  dynamic /[teamId] route to avoid duplicating the layout. */
export function TeamDashboard({
  data,
  teams,
  currentTeamId,
}: {
  data: TeamReport;
  teams: TeamManifestEntry[];
  currentTeamId: number;
}) {
  return (
    <main className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:px-8">
      {teams.length > 1 && (
        <TeamSwitcher teams={teams} currentTeamId={currentTeamId} />
      )}

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

      <DashboardClient report={data} />

      <section className="mt-6">
        <MatchHistory matches={data.matchHistory} />
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Roster
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {orderRoster(data.players).map((p) => (
            <PlayerCard key={p.accountId} player={p} />
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
        <Standins standins={data.standins} />
      </section>

      <footer className="mt-12 border-t border-ink-700 pt-4 text-xs text-ink-400">
        Generated {data.generatedAt.slice(0, 10)} ·{" "}
        {data.matchesAnalyzed} team matches analyzed · {data.windowDays}d window
        · STRATZ + OpenDota
      </footer>
    </main>
  );
}

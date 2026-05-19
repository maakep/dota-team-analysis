import type { TeamReport } from "@/lib/types";

function fmtDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString();
}

export function TeamHeader({ report }: { report: TeamReport }) {
  const total = report.totalWins + report.totalLosses;
  const wr = total > 0 ? (report.totalWins / total) * 100 : 0;
  return (
    <header className="rounded-lg border border-ink-700 bg-ink-800 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-ink-400">
            Team #{report.teamId}
            {report.teamTag ? ` · ${report.teamTag}` : ""}
          </div>
          <h1 className="mt-1 text-3xl font-semibold text-ink-100">
            {report.teamName ?? `Team ${report.teamId}`}
          </h1>
        </div>
        <dl className="flex gap-6 text-sm">
          <Stat label="Record" value={`${report.totalWins}W – ${report.totalLosses}L`} />
          <Stat label="Win rate" value={`${wr.toFixed(1)}%`} />
          <Stat label="Last match" value={fmtDate(report.lastMatchAt)} />
          <Stat label="Matches in window" value={String(report.matchesAnalyzed)} />
        </dl>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-1 font-mono text-ink-100">{value}</dd>
    </div>
  );
}

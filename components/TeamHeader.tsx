import type { TeamReport } from "@/lib/types";

function fmtDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

export function TeamHeader({ report }: { report: TeamReport }) {
  const total = report.totalWins + report.totalLosses;
  const wr = total > 0 ? (report.totalWins / total) * 100 : 0;
  const generated = report.generatedAt.slice(0, 10); // YYYY-MM-DD

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
        <dl className="flex flex-wrap gap-6 text-sm">
          <Stat label="Record" value={`${report.totalWins}W – ${report.totalLosses}L`} />
          <Stat label="Win rate" value={`${wr.toFixed(1)}%`} />
          <Stat label="Last match" value={fmtDate(report.lastMatchAt)} />
          <Stat label="Matches in window" value={String(report.matchesAnalyzed)} />
        </dl>
      </div>

      {/* Analysis window + generation timestamp */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-700/60 pt-3 font-mono text-[11px] text-ink-400">
        <span>
          Window{" "}
          <span className="text-ink-200">{report.windowFrom}</span>
          {" → "}
          <span className="text-ink-200">{report.windowTo}</span>
          <span className="ml-1 text-ink-500">({report.windowDays}d)</span>
        </span>
        <span className="text-ink-600">·</span>
        <span>
          Report generated{" "}
          <span className="text-ink-200">{generated}</span>
        </span>

        {/* Recent patches */}
        {report.recentPatches.length > 0 && (
          <>
            <span className="text-ink-600">·</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="text-ink-500">patches:</span>
              {report.recentPatches.map((p) => (
                <span key={p.patchName} className="whitespace-nowrap">
                  <span className="text-ink-200">{p.patchName}</span>
                  <span className="ml-1 text-ink-500">({p.daysAgo}d ago)</span>
                </span>
              ))}
            </span>
          </>
        )}
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

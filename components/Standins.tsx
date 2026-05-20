import type { StandinReport } from "@/lib/types";
import { PlayerCard } from "./PlayerCard";

function fmtDate(unix: number | null): string {
  if (!unix) return "unknown";
  return new Date(unix * 1000).toLocaleDateString();
}

/** Stand-ins are rendered with the same per-position breakdown as roster
 *  players. The "last appeared" timestamp is shown as a small subtitle so
 *  it's obvious how recent the data is. */
export function Standins({ standins }: { standins: StandinReport[] }) {
  if (standins.length === 0) {
    return (
      <p className="rounded-lg border border-ink-700 bg-ink-800 p-4 text-sm italic text-ink-400">
        No stand-ins recorded in the lookback window.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {standins.map((s) => (
        <div key={s.accountId} className="flex flex-col">
          <PlayerCard player={s} />
          <p className="mt-1 px-1 text-[11px] text-ink-400">
            last appeared with team {fmtDate(s.lastTeamMatchAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

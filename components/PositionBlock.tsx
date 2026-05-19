import type { PositionStats } from "@/lib/types";
import { PickList } from "./PickList";

// Just the two parallel columns. The enclosing PlayerCard <details> already
// labels the position, so we don't repeat it here.
export function PositionBlock({ stats }: { stats: PositionStats }) {
  const teamWr =
    stats.teamGames > 0 ? (stats.teamWins / stats.teamGames) * 100 : 0;
  const pubWr =
    stats.pubGames > 0 ? (stats.pubWins / stats.pubGames) * 100 : 0;
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">
            Team scrims
          </h5>
          <span className="font-mono text-[11px] text-ink-400">
            {stats.teamGames}g · {teamWr.toFixed(0)}%
          </span>
        </div>
        <PickList heroes={stats.teamHeroes} empty="No team games here." />
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h5 className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">
            Recent pubs (90d)
          </h5>
          <span className="font-mono text-[11px] text-ink-400">
            {stats.pubGames}g · {pubWr.toFixed(0)}%
          </span>
        </div>
        <PickList heroes={stats.pubHeroes} empty="No pubs in last 90d." />
      </div>
    </div>
  );
}

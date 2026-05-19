import type { PlayerReport } from "@/lib/types";
import { POSITION_NAMES } from "@/lib/positions";
import { PositionBlock } from "./PositionBlock";
import { RankBadge } from "./RankBadge";

export function PlayerCard({ player }: { player: PlayerReport }) {
  const wr =
    player.totalMatches > 0
      ? (player.totalWins / player.totalMatches) * 100
      : 0;
  // The roster card has room to breathe, so we splurge with the
  // "FLCN.Malr1ne" canonical form when STRATZ has both pieces; everywhere
  // else falls back to the bare `name`. The Steam handle slips in as a
  // muted subtitle below so a viewer who knows the player by their pub
  // name can still anchor on it.
  const cardTitle =
    player.proName && player.teamTag
      ? `${player.teamTag}.${player.proName}`
      : (player.name ?? `Account ${player.accountId}`);
  const subtitle =
    player.steamName && player.steamName !== cardTitle
      ? player.steamName
      : null;
  return (
    <article className="rounded-lg border border-ink-700 bg-ink-800 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-lg font-semibold text-ink-100">
              <a
                href={`https://stratz.com/players/${player.accountId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent-flex hover:underline"
                title="Open STRATZ profile"
              >
                {cardTitle}
              </a>
            </h3>
            <RankBadge rank={player.rank} size="sm" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-300">
            {player.primaryPosition !== null && (
              <span>
                Pos {player.primaryPosition}{" "}
                <span className="text-ink-400">
                  ({POSITION_NAMES[player.primaryPosition]})
                </span>
              </span>
            )}
            {subtitle && (
              <span className="text-ink-400" title="Steam display name">
                · {subtitle}
              </span>
            )}
            {(() => {
              const extras = player.flexPositions.filter(
                (p) => p !== player.primaryPosition,
              );
              if (extras.length === 0) return null;
              return (
                <span className="text-ink-400">
                  + {extras.map((p) => `pos ${p}`).join(", ")}
                </span>
              );
            })()}
          </div>
        </div>
        <div className="font-mono text-xs text-ink-300">
          {player.totalWins}W / {player.totalMatches - player.totalWins}L ·{" "}
          {wr.toFixed(0)}%
        </div>
      </header>

      <div className="space-y-2">
        {player.positions.length === 0 ? (
          <p className="text-sm italic text-ink-400">No position data.</p>
        ) : (
          player.positions.map((ps) => (
            <details
              key={ps.position}
              open={ps.position === player.primaryPosition}
              className="group border-t border-ink-700 pt-2 first:border-t-0 first:pt-0"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-ink-400 transition group-open:rotate-90">
                    ›
                  </span>
                  <span className="font-semibold text-ink-100">
                    Pos {ps.position}
                  </span>
                  <span className="text-xs text-ink-400">
                    {POSITION_NAMES[ps.position]}
                  </span>
                </span>
                <span className="font-mono text-xs text-ink-300">
                  team {ps.teamGames}g · pub {ps.pubGames}g · share{" "}
                  {(ps.share * 100).toFixed(0)}%
                </span>
              </summary>
              <div className="pt-3">
                <PositionBlock stats={ps} />
              </div>
            </details>
          ))
        )}
      </div>
    </article>
  );
}

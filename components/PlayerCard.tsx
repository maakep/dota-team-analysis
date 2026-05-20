import type { PlayerReport } from "@/lib/types";
import { POSITION_NAMES, type Position } from "@/lib/positions";
import { PickList } from "./PickList";
import { RankBadge } from "./RankBadge";

/** Player card — one per roster member or stand-in. The card shows two
 *  hero lists side-by-side:
 *
 *    LEFT  "League heroes" — sourced from OpenDota (Captain's Mode private
 *          lobbies + tournaments). Displayed under the player's STRATZ-
 *          derived primary position. If the player flexes, a FLEX tag
 *          appears next to the section header and the flex positions are
 *          listed in the subtitle. This is the lossy assumption we made
 *          when dropping STRATZ's per-position hero attribution: we treat
 *          ALL of a player's CM games as if they happened at their
 *          primary role.
 *
 *    RIGHT "Pub heroes" — sourced from OpenDota (ranked + unranked MM).
 *          Intentionally position-agnostic. The coach reads the list and
 *          decides on a per-hero basis where each pick might be a threat.
 *
 *  The header continues to use STRATZ-attributed team-scrim totals for
 *  the W/L stat block (totalTeamMatches), since that's the canonical
 *  "this team's matches" count rather than "all CM games the account
 *  played anywhere".
 */
export function PlayerCard({ player }: { player: PlayerReport }) {
  const teamWr =
    player.totalTeamMatches > 0
      ? (player.totalTeamWins / player.totalTeamMatches) * 100
      : 0;

  // "FLCN.Malr1ne" canonical form when STRATZ has both pieces; otherwise
  // fall back to whatever name we resolved. Steam name slips in as a muted
  // subtitle so viewers who know the pub handle can still anchor on it.
  const cardTitle =
    player.proName && player.teamTag
      ? `${player.teamTag}.${player.proName}`
      : (player.name ?? `Account ${player.accountId}`);
  const subtitle =
    player.steamName && player.steamName !== cardTitle ? player.steamName : null;

  // Flex info for the league-section header. We mark the section as FLEX
  // when the player actually qualifies (≥2 positions, ≥ FLEX_MIN_TOTAL_GAMES);
  // bare primary players just see the position label.
  const isFlex = player.flex && player.flexPositions.length >= 2;
  const flexExtras = player.flexPositions.filter(
    (p) => p !== player.primaryPosition,
  );

  return (
    <article className="rounded-lg border border-ink-700 bg-ink-800 p-4">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <RankBadge rank={player.rank} size="lg" />
          <div>
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
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-300">
              {player.primaryPosition !== null && (
                <span>
                  Pos {player.primaryPosition}{" "}
                  <span className="text-ink-400">
                    ({POSITION_NAMES[player.primaryPosition as Position]})
                  </span>
                </span>
              )}
              {subtitle && (
                <span className="text-ink-400" title="Steam display name">
                  · {subtitle}
                </span>
              )}
              {flexExtras.length > 0 && (
                <span className="text-ink-400">
                  + {flexExtras.map((p) => `pos ${p}`).join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Team-scrim record only. League/pub volumes appear under each
            hero list. Keeps the header honest about which dataset this
            number is from (STRATZ team-attributed). */}
        <div
          className="text-right font-mono text-xs text-ink-300"
          title="Team-attributed scrim record (STRATZ)"
        >
          <div>
            {player.totalTeamWins}W /{" "}
            {player.totalTeamMatches - player.totalTeamWins}L ·{" "}
            {teamWr.toFixed(0)}%
          </div>
          <div className="text-[10px] text-ink-500">team scrims</div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-300">
              League heroes
              {isFlex && <FlexTag positions={player.flexPositions} />}
            </h4>
            <span
              className="font-mono text-[11px] text-ink-400"
              title="Captain's Mode private lobby + tournament games (OpenDota)"
            >
              {player.leagueGames}g
              {player.leagueGames > 0 && (
                <> · {Math.round((player.leagueWins / player.leagueGames) * 100)}%</>
              )}
            </span>
          </div>
          {/* Subtitle clarifies the assumption that all CM games are
              treated as primary-role play. We can't actually attribute
              individual league games to roles cheaply, so the coach is
              told upfront. */}
          {player.primaryPosition !== null && (
            <p className="mb-2 text-[10px] italic text-ink-500">
              assumed at pos {player.primaryPosition}
              {flexExtras.length > 0 && (
                <> · flexes {flexExtras.map((p) => `pos ${p}`).join(", ")}</>
              )}
            </p>
          )}
          <PickList
            heroes={player.leagueHeroes}
            empty="No league/scrim matches in window."
          />
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">
              Pub heroes
            </h4>
            <span
              className="font-mono text-[11px] text-ink-400"
              title="Ranked + unranked matchmaking (OpenDota)"
            >
              {player.pubGames}g
              {player.pubGames > 0 && (
                <> · {Math.round((player.pubWins / player.pubGames) * 100)}%</>
              )}
            </span>
          </div>
          <p className="mb-2 text-[10px] italic text-ink-500">
            position-agnostic — assess per-hero
          </p>
          <PickList
            heroes={player.pubHeroes}
            empty="No pub matches in window."
          />
        </section>
      </div>
    </article>
  );
}

function FlexTag({ positions }: { positions: number[] }) {
  return (
    <span
      className="rounded bg-accent-flex/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-accent-flex ring-1 ring-accent-flex/30"
      title={`Plays positions ${positions.join(", ")}`}
    >
      FLEX
    </span>
  );
}

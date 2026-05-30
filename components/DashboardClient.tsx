"use client";

import { useMemo, useState, useCallback } from "react";
import type { PlayerReport, TeamReport } from "@/lib/types";
import type { Position } from "@/lib/positions";
import { aggregateBans, aggregateTopBans } from "@/lib/aggregate-bans";
import { RosterBuilder, type Lineup } from "./PlayerSelector";
import { HeroSearch } from "./HeroSearch";
import { BanTargets } from "./BanTargets";
import { TopBans } from "./TopBans";

interface DashboardClientProps {
  report: TeamReport;
}

// ──────────────────────────────────────────────────────────────────────────
// State shape
// ──────────────────────────────────────────────────────────────────────────

interface RosterState {
  lineup: Lineup;
  bench: PlayerReport[];
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function buildDefaultState(
  players: PlayerReport[],
  standins: PlayerReport[],
): RosterState {
  const lineup: Lineup = { 1: null, 2: null, 3: null, 4: null, 5: null };
  const bench: PlayerReport[] = [];

  const sorted = [...players].sort((a, b) => b.totalTeamMatches - a.totalTeamMatches);
  for (const p of sorted) {
    const pos = p.primaryPosition as Position | null;
    if (pos !== null && lineup[pos] === null) {
      lineup[pos] = p;
    } else {
      bench.push(p);
    }
  }
  bench.push(...standins);
  return { lineup, bench };
}

function findPlayer(pool: PlayerReport[], accountId: number): PlayerReport | undefined {
  return pool.find((p) => p.accountId === accountId);
}

function withPosition(player: PlayerReport, pos: Position): PlayerReport {
  if (player.primaryPosition === pos) return player;
  return { ...player, primaryPosition: pos };
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export function DashboardClient({ report }: DashboardClientProps) {
  const pool: PlayerReport[] = useMemo(
    () => [...report.players, ...report.standins],
    [report.players, report.standins],
  );

  const defaults = useMemo(
    () => buildDefaultState(report.players, report.standins),
    [report.players, report.standins],
  );

  const [state, setState] = useState<RosterState>(defaults);
  const [rosterExpanded, setRosterExpanded] = useState(false);

  const handleMove = useCallback(
    (accountId: number, to: Position | "bench") => {
      setState((prev) => {
        const player = findPlayer(pool, accountId);
        if (!player) return prev;

        const newLineup = { ...prev.lineup };
        let newBench = [...prev.bench];

        let found = false;
        for (const pos of [1, 2, 3, 4, 5] as Position[]) {
          if (newLineup[pos]?.accountId === accountId) {
            newLineup[pos] = null;
            found = true;
            break;
          }
        }
        if (!found) {
          newBench = newBench.filter((p) => p.accountId !== accountId);
        }

        if (to === "bench") {
          newBench.push(player);
        } else {
          if (newLineup[to] !== null) {
            newBench.push(newLineup[to]!);
          }
          newLineup[to] = player;
        }

        return { lineup: newLineup, bench: newBench };
      });
    },
    [pool],
  );

  const handleSwap = useCallback((posA: Position, posB: Position) => {
    setState((prev) => {
      const newLineup = { ...prev.lineup };
      const tmp = newLineup[posA];
      newLineup[posA] = newLineup[posB];
      newLineup[posB] = tmp;
      return { ...prev, lineup: newLineup };
    });
  }, []);

  const handleReset = useCallback(() => {
    setState(defaults);
  }, [defaults]);

  const isCustom = useMemo(() => {
    for (const pos of [1, 2, 3, 4, 5] as Position[]) {
      if (state.lineup[pos]?.accountId !== defaults.lineup[pos]?.accountId) return true;
    }
    return state.bench.length !== defaults.bench.length;
  }, [state, defaults]);

  const activePlayers: PlayerReport[] = useMemo(() => {
    const result: PlayerReport[] = [];
    for (const pos of [1, 2, 3, 4, 5] as Position[]) {
      const player = state.lineup[pos];
      if (player) {
        result.push(withPosition(player, pos));
      }
    }
    return result;
  }, [state.lineup]);

  const bansByPosition = useMemo(() => aggregateBans(activePlayers), [activePlayers]);
  const topBans = useMemo(() => aggregateTopBans(activePlayers), [activePlayers]);

  return (
    <>
      {/* Roster builder — collapsible */}
      <section className="mt-8">
        <RosterBuilder
          lineup={state.lineup}
          bench={state.bench}
          onMove={handleMove}
          onSwap={handleSwap}
          onReset={handleReset}
          isCustom={isCustom}
          expanded={rosterExpanded}
          onToggleExpanded={() => setRosterExpanded((v) => !v)}
        />
      </section>

      {/* Hero search — collapsible, Alt+S shortcut */}
      <section className="mt-6">
        <HeroSearch players={activePlayers} allPlayers={pool} />
      </section>

      {/* Priority bans */}
      <section className="mt-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Priority bans
          <span className="ml-2 text-[10px] font-normal normal-case text-ink-400">
            top {topBans.length} team picks by sample x win rate
            {isCustom && (
              <span className="ml-1.5 rounded bg-accent-flex/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-accent-flex">
                custom lineup
              </span>
            )}
          </span>
        </h2>
        <TopBans bans={topBans} />
      </section>

      {/* Ban targets by position */}
      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Ban targets by position
          {isCustom && (
            <span className="ml-2 rounded bg-accent-flex/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-accent-flex">
              custom lineup
            </span>
          )}
        </h2>
        <BanTargets bans={bansByPosition} />
      </section>
    </>
  );
}

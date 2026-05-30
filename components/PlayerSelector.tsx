"use client";

import { useCallback, useRef, useState } from "react";
import type { PlayerReport } from "@/lib/types";
import { POSITION_NAMES, type Position } from "@/lib/positions";
import { RankBadge } from "./RankBadge";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/** One of the 5 position slots in the active lineup, or null (empty). */
export type Lineup = Record<Position, PlayerReport | null>;

export interface RosterBuilderProps {
  lineup: Lineup;
  bench: PlayerReport[];
  onMove: (accountId: number, to: Position | "bench") => void;
  onSwap: (posA: Position, posB: Position) => void;
  onReset: () => void;
  isCustom: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}

// Slot display order: 4-3-2-1-5 (standard draft reading order).
const SLOT_ORDER: Position[] = [4, 3, 2, 1, 5];

// ──────────────────────────────────────────────────────────────────────────
// Deterministic date format (avoids hydration mismatch).
// ──────────────────────────────────────────────────────────────────────────
function fmtDate(unix: number | null): string {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────

export function RosterBuilder({
  lineup,
  bench,
  onMove,
  onSwap,
  onReset,
  isCustom,
  expanded,
  onToggleExpanded,
}: RosterBuilderProps) {
  // Drag state tracked locally for visual feedback.
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<Position | "bench" | null>(null);
  const [dropTarget, setDropTarget] = useState<Position | "bench" | null>(null);

  const handleDragStart = useCallback(
    (accountId: number, from: Position | "bench") => {
      setDragId(accountId);
      setDragFrom(from);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragFrom(null);
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (to: Position | "bench") => {
      if (dragId === null || dragFrom === null) return;
      // If dragging from one slot to another occupied slot → swap.
      if (
        dragFrom !== "bench" &&
        to !== "bench" &&
        dragFrom !== to &&
        lineup[to] !== null
      ) {
        onSwap(dragFrom, to);
      } else {
        onMove(dragId, to);
      }
      setDragId(null);
      setDragFrom(null);
      setDropTarget(null);
    },
    [dragId, dragFrom, lineup, onMove, onSwap],
  );

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800">
      {/* Header — always visible, acts as toggle */}
      <button
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-ink-700/30"
      >
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Active lineup
          <span className="ml-2 text-[10px] font-normal normal-case text-ink-400">
            drag players between slots — bans update live
          </span>
          {isCustom && (
            <span className="ml-2 rounded bg-accent-flex/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-accent-flex">
              custom
            </span>
          )}
        </h3>
        <span className="text-ink-400">
          <ChevronIcon expanded={expanded} />
        </span>
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div className="border-t border-ink-700 px-4 pb-4 pt-3">
          {isCustom && (
            <div className="mb-3 flex justify-end">
              <button
                onClick={onReset}
                className="rounded bg-ink-700 px-2 py-1 text-[10px] font-medium text-ink-300 hover:bg-ink-600 hover:text-ink-100"
              >
                Reset
              </button>
            </div>
          )}

          {/* Position slots */}
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
            {SLOT_ORDER.map((pos) => (
              <PositionSlot
                key={pos}
                pos={pos}
                player={lineup[pos]}
                isDragOver={dropTarget === pos}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragEnter={() => setDropTarget(pos)}
                onDragLeave={() => setDropTarget((prev) => (prev === pos ? null : prev))}
                onDrop={() => handleDrop(pos)}
              />
            ))}
          </div>

          {/* Bench */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-2">
              <div className="h-px flex-1 bg-ink-700" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Bench
              </span>
              <div className="h-px flex-1 bg-ink-700" />
            </div>
            <BenchArea
              players={bench}
              isDragOver={dropTarget === "bench"}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragEnter={() => setDropTarget("bench")}
              onDragLeave={() => setDropTarget((prev) => (prev === "bench" ? null : prev))}
              onDrop={() => handleDrop("bench")}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Position slot
// ──────────────────────────────────────────────────────────────────────────

function PositionSlot({
  pos,
  player,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  pos: Position;
  player: PlayerReport | null;
  isDragOver: boolean;
  onDragStart: (id: number, from: Position) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={`flex flex-col rounded-md border transition-colors ${
        isDragOver
          ? "border-accent-flex/60 bg-accent-flex/10"
          : "border-ink-700 bg-ink-900/50"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragEnter();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {/* Slot header */}
      <div className="flex items-baseline justify-between border-b border-ink-700/60 px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          Pos {pos}
        </span>
        <span className="text-[9px] text-ink-500">{POSITION_NAMES[pos]}</span>
      </div>

      {/* Player card or empty */}
      {player ? (
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(player.accountId));
            onDragStart(player.accountId, pos);
          }}
          onDragEnd={onDragEnd}
          className="cursor-grab p-2 active:cursor-grabbing"
        >
          <SlotPlayerCard player={player} assignedPos={pos} />
        </div>
      ) : (
        <div className="flex min-h-[52px] items-center justify-center p-2">
          <span className="text-[11px] italic text-ink-500">empty</span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Bench drop area
// ──────────────────────────────────────────────────────────────────────────

function BenchArea({
  players,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  players: PlayerReport[];
  isDragOver: boolean;
  onDragStart: (id: number, from: "bench") => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={`min-h-[48px] rounded-md border border-dashed p-2 transition-colors ${
        isDragOver
          ? "border-accent-flex/60 bg-accent-flex/5"
          : "border-ink-700 bg-ink-900/30"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragEnter();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {players.length === 0 ? (
        <p className="py-1 text-center text-[11px] italic text-ink-500">
          Drag a player here to bench them
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {players.map((p) => (
            <div
              key={p.accountId}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(p.accountId));
                onDragStart(p.accountId, "bench");
              }}
              onDragEnd={onDragEnd}
              className="cursor-grab active:cursor-grabbing"
            >
              <BenchPlayerChip player={p} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Player cards (slot vs bench styles)
// ──────────────────────────────────────────────────────────────────────────

function SlotPlayerCard({
  player,
  assignedPos,
}: {
  player: PlayerReport;
  assignedPos: Position;
}) {
  const handle = player.name ?? `Account ${player.accountId}`;
  const isSwapped = player.primaryPosition !== null && player.primaryPosition !== assignedPos;

  return (
    <div className="flex items-center gap-2">
      <RankBadge rank={player.rank} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-ink-100">
            {handle}
          </span>
          {isSwapped && (
            <span
              className="rounded bg-accent-mid/15 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-accent-mid"
              title={`Normally pos ${player.primaryPosition}`}
            >
              swapped
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-ink-400">
          {player.leagueGames}g league · {player.pubGames}g pub
        </div>
      </div>
    </div>
  );
}

function BenchPlayerChip({ player }: { player: PlayerReport }) {
  const handle = player.name ?? `#${player.accountId}`;
  const posLabel = player.primaryPosition
    ? `p${player.primaryPosition}`
    : "?";
  // Detect stand-in by checking if they have lastTeamMatchAt
  // (StandinReport extends PlayerReport with this field)
  const lastSeen = (player as { lastTeamMatchAt?: number | null }).lastTeamMatchAt;

  return (
    <div className="flex items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 hover:border-ink-500">
      <RankBadge rank={player.rank} size="sm" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-ink-200">
            {handle}
          </span>
          <span className="rounded bg-ink-600 px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-ink-400">
            {posLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-ink-400">
          <span>{player.leagueGames}g league · {player.pubGames}g pub</span>
          {lastSeen && (
            <span className="text-ink-500">· {fmtDate(lastSeen)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Shared icon
// ──────────────────────────────────────────────────────────────────────────

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

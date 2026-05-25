"use client";

import { useState } from "react";
import type { MatchRecord, MatchHero } from "@/lib/types";

const HERO_CDN =
  "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";

// Grid column template — must match between header and row.
// W/L · Side · Date · Team heroes (5×32px + gaps) · Score · Opp heroes · Duration · Opponent · SUB · Link
const GRID =
  "grid grid-cols-[1.25rem_4rem_6rem_172px_3.5rem_172px_3rem_minmax(6rem,1fr)_2rem_4rem] items-center gap-x-2";

function fmt(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function HeroStrip({ heroes }: { heroes: MatchHero[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {heroes.map((h, i) => (
        <img
          key={`${h.heroId}-${i}`}
          src={`${HERO_CDN}/${h.shortName}.png`}
          alt={h.shortName}
          title={h.shortName}
          width={32}
          height={18}
          className="h-[18px] w-[32px] shrink-0 rounded-sm object-cover object-top"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ))}
    </div>
  );
}

function MatchRow({ m, index }: { m: MatchRecord; index: number }) {
  const borderCls = m.won ? "border-l-2 border-accent-good/70" : "border-l-2 border-accent-bad/70";
  const bgCls = index % 2 === 0 ? "bg-ink-800" : "bg-ink-850";

  const opponent = m.opponentTag ?? m.opponentName ?? "Unknown";
  const sideLabel = m.side === "radiant" ? "Radiant" : "Dire";
  const sideCls = "text-ink-400";

  return (
    <li className={`${GRID} px-3 py-1.5 ${borderCls} ${bgCls} hover:bg-ink-700/40`}>
      {/* W / L */}
      <span
        className={`text-center font-mono text-xs font-bold ${m.won ? "text-accent-good" : "text-accent-bad"}`}
      >
        {m.won ? "W" : "L"}
      </span>

      {/* Side */}
      <span className={`font-mono text-[11px] ${sideCls}`}>{sideLabel}</span>

      {/* Date */}
      <span className="font-mono text-[11px] text-ink-400">{fmt(m.startDateTime)}</span>

      {/* Team heroes */}
      <HeroStrip heroes={m.teamHeroes} />

      {/* Score */}
      <span className="text-center font-mono text-[12px]">
        <span className={m.won ? "text-accent-good" : "text-ink-200"}>{m.teamKills}</span>
        <span className="text-ink-500">–</span>
        <span className={!m.won ? "text-accent-bad" : "text-ink-200"}>{m.opponentKills}</span>
      </span>

      {/* Opponent heroes */}
      <HeroStrip heroes={m.opponentHeroes} />

      {/* Duration */}
      <span className="font-mono text-[11px] text-ink-400">{fmtDuration(m.durationSeconds)}</span>

      {/* Opponent name */}
      <span className="truncate text-[12px] text-ink-300" title={m.opponentName ?? undefined}>
        vs {opponent}
      </span>

      {/* SUB badge — always occupies the column, empty when no standin */}
      <span className="flex justify-center">
        {m.hasStandin && (
          <span
            className="rounded bg-accent-mid/20 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-accent-mid ring-1 ring-accent-mid/30"
            title="Team used a stand-in in this match"
          >
            SUB
          </span>
        )}
      </span>

      {/* STRATZ link */}
      <a
        href={`https://stratz.com/matches/${m.matchId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate text-right text-[10px] text-ink-500 hover:text-ink-300 hover:underline"
        title="View on STRATZ"
      >
        #{m.matchId}
      </a>
    </li>
  );
}

export function MatchHistory({ matches }: { matches: MatchRecord[] }) {
  const [open, setOpen] = useState(false);

  if (matches.length === 0) {
    return (
      <p className="rounded-lg border border-ink-700 bg-ink-800 p-4 text-sm italic text-ink-400">
        No match history available.
      </p>
    );
  }

  const wins = matches.filter((m) => m.won).length;

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-ink-700/30"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
            Match history
          </span>
          <span className="font-mono text-[11px] text-ink-400">
            {matches.length} matches ·{" "}
            <span className="text-accent-good">{wins}W</span>
            <span className="text-ink-500"> / </span>
            <span className="text-accent-bad">{matches.length - wins}L</span>
          </span>
        </div>
        <span className="text-[11px] text-ink-400" aria-hidden>
          {open ? "▲ collapse" : "▼ expand"}
        </span>
      </button>

      {open && (
        <>
          {/* Column headers — same grid as rows */}
          <div
            className={`${GRID} border-t border-ink-700 bg-ink-900/60 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-500`}
          >
            <span title="Win / Loss" />
            <span>Side</span>
            <span>Date</span>
            <span>Team heroes</span>
            <span className="text-center">Score</span>
            <span>Opp heroes</span>
            <span>Time</span>
            <span>Opponent</span>
            <span className="text-center">Sub</span>
            <span className="text-right">Match</span>
          </div>
          <ol className="divide-y divide-ink-700/40">
            {matches.map((m, i) => (
              <MatchRow key={m.matchId} m={m} index={i} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

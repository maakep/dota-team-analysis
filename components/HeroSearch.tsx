"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerReport, HeroPerf } from "@/lib/types";
import { POSITION_NAMES, type Position } from "@/lib/positions";
import { RankBadge } from "./RankBadge";

const HERO_CDN =
  "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/** All data we can surface about a hero across the roster. */
interface HeroResult {
  heroId: number;
  heroName: string;
  shortName: string;
  /** Per-player breakdown: who plays this hero, in what context. */
  players: HeroPlayerEntry[];
  /** Aggregate stats across all players. */
  totalLeagueGames: number;
  totalLeagueWins: number;
  totalPubGames: number;
  totalPubWins: number;
  /** Most recent game (unix seconds). */
  lastPlayed: number | null;
}

interface HeroPlayerEntry {
  accountId: number;
  playerName: string | null;
  position: Position | null;
  rank: PlayerReport["rank"];
  league: HeroPerf | null;
  pub: HeroPerf | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** Build a searchable hero index from all players' hero pools. */
function buildHeroIndex(players: PlayerReport[]): Map<number, { heroName: string; shortName: string }> {
  const m = new Map<number, { heroName: string; shortName: string }>();
  for (const p of players) {
    for (const h of p.leagueHeroes) m.set(h.heroId, { heroName: h.heroName, shortName: h.shortName });
    for (const h of p.pubHeroes) m.set(h.heroId, { heroName: h.heroName, shortName: h.shortName });
  }
  return m;
}

/** Search heroes by name (case-insensitive prefix + substring). */
function searchHeroes(
  query: string,
  index: Map<number, { heroName: string; shortName: string }>,
): Array<{ heroId: number; heroName: string; shortName: string }> {
  if (!query.trim()) return [];
  const q = query.toLowerCase().trim();
  const results: Array<{ heroId: number; heroName: string; shortName: string; priority: number }> = [];
  for (const [heroId, meta] of index) {
    const name = meta.heroName.toLowerCase();
    const short = meta.shortName.toLowerCase();
    if (name.startsWith(q) || short.startsWith(q)) {
      results.push({ heroId, ...meta, priority: 0 });
    } else if (name.includes(q) || short.includes(q)) {
      results.push({ heroId, ...meta, priority: 1 });
    }
  }
  results.sort((a, b) => a.priority - b.priority || a.heroName.localeCompare(b.heroName));
  return results.slice(0, 12);
}

/** Collect all data about a hero across the player pool. */
function buildHeroResult(heroId: number, players: PlayerReport[]): HeroResult | null {
  let heroName = "";
  let shortName = "";
  const entries: HeroPlayerEntry[] = [];
  let totalLeagueGames = 0;
  let totalLeagueWins = 0;
  let totalPubGames = 0;
  let totalPubWins = 0;
  let lastPlayed: number | null = null;

  for (const p of players) {
    const league = p.leagueHeroes.find((h) => h.heroId === heroId) ?? null;
    const pub = p.pubHeroes.find((h) => h.heroId === heroId) ?? null;
    if (!league && !pub) continue;

    if (league) {
      heroName = league.heroName;
      shortName = league.shortName;
      totalLeagueGames += league.matches;
      totalLeagueWins += league.wins;
      if (league.lastPlayed && (lastPlayed === null || league.lastPlayed > lastPlayed)) {
        lastPlayed = league.lastPlayed;
      }
    }
    if (pub) {
      heroName = pub.heroName;
      shortName = pub.shortName;
      totalPubGames += pub.matches;
      totalPubWins += pub.wins;
      if (pub.lastPlayed && (lastPlayed === null || pub.lastPlayed > lastPlayed)) {
        lastPlayed = pub.lastPlayed;
      }
    }
    entries.push({
      accountId: p.accountId,
      playerName: p.name,
      position: p.primaryPosition,
      rank: p.rank,
      league,
      pub,
    });
  }

  if (entries.length === 0) return null;

  // Sort: players with league data first (by league games desc), then pub-only.
  entries.sort((a, b) => {
    const aLeague = a.league?.matches ?? 0;
    const bLeague = b.league?.matches ?? 0;
    if (bLeague !== aLeague) return bLeague - aLeague;
    const aPub = a.pub?.matches ?? 0;
    const bPub = b.pub?.matches ?? 0;
    return bPub - aPub;
  });

  return {
    heroId,
    heroName,
    shortName,
    players: entries,
    totalLeagueGames,
    totalLeagueWins,
    totalPubGames,
    totalPubWins,
    lastPlayed,
  };
}

function fmtDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function daysAgo(unix: number | null): string {
  if (!unix) return "";
  const days = Math.floor((Date.now() / 1000 - unix) / 86400);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

// ──────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────

export function HeroSearch({
  players,
  allPlayers,
}: {
  /** Active lineup (with position overrides). */
  players: PlayerReport[];
  /** Full pool (for search index — heroes might only exist in bench players' pools). */
  allPlayers: PlayerReport[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedHeroId, setSelectedHeroId] = useState<number | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Hero index from ALL players (so we can search everything).
  const heroIndex = useMemo(() => buildHeroIndex(allPlayers), [allPlayers]);

  // Search suggestions.
  const suggestions = useMemo(() => searchHeroes(query, heroIndex), [query, heroIndex]);

  // Selected hero detail — compute from active players only (position-aware).
  const heroResult = useMemo(() => {
    if (selectedHeroId === null) return null;
    // Search across all players, not just active — user may want to see
    // info about a hero a benched player has.
    return buildHeroResult(selectedHeroId, allPlayers);
  }, [selectedHeroId, allPlayers]);

  // Alt+S global shortcut.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setExpanded(true);
        // Focus the input after the panel expands.
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close suggestions on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectHero = useCallback((heroId: number, heroName: string) => {
    setSelectedHeroId(heroId);
    setQuery(heroName);
    setShowSuggestions(false);
    setHighlightIdx(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSuggestions || suggestions.length === 0) {
        if (e.key === "Escape") {
          setExpanded(false);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = suggestions[highlightIdx];
        if (item) selectHero(item.heroId, item.heroName);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    },
    [showSuggestions, suggestions, highlightIdx, selectHero],
  );

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800">
      {/* Header — toggle */}
      <button
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-ink-700/30"
      >
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-300">
          Hero lookup
          <span className="ml-2 text-[10px] font-normal normal-case text-ink-400">
            search any hero for full intel
          </span>
          <kbd className="ml-2 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 font-mono text-[9px] text-ink-400">
            Alt+S
          </kbd>
        </h3>
        <ChevronIcon expanded={expanded} />
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div className="border-t border-ink-700 px-4 pb-4 pt-3">
          <div className="flex flex-col gap-4 lg:flex-row">
            {/* Left: search */}
            <div className="relative w-full lg:w-72 lg:shrink-0">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(true);
                  setHighlightIdx(0);
                  if (!e.target.value.trim()) setSelectedHeroId(null);
                }}
                onFocus={() => {
                  if (query.trim() && suggestions.length > 0) setShowSuggestions(true);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Type hero name..."
                className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder-ink-500 focus:border-accent-flex/60 focus:outline-none focus:ring-1 focus:ring-accent-flex/40"
              />

              {/* Autocomplete dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-ink-600 bg-ink-900 py-1 shadow-lg"
                >
                  {suggestions.map((s, i) => (
                    <button
                      key={s.heroId}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                        i === highlightIdx
                          ? "bg-accent-flex/15 text-ink-100"
                          : "text-ink-200 hover:bg-ink-700/50"
                      }`}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onMouseDown={(e) => {
                        e.preventDefault(); // Prevent blur before click fires.
                        selectHero(s.heroId, s.heroName);
                      }}
                    >
                      <img
                        src={`${HERO_CDN}/${s.shortName}.png`}
                        alt=""
                        className="h-5 w-9 rounded-sm object-cover"
                      />
                      <span>{s.heroName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: result */}
            <div className="min-w-0 flex-1">
              {heroResult ? (
                <HeroResultPanel result={heroResult} />
              ) : selectedHeroId !== null ? (
                <p className="py-4 text-center text-sm italic text-ink-400">
                  No data found for this hero in the current pool.
                </p>
              ) : (
                <p className="py-4 text-center text-sm italic text-ink-500">
                  Search for a hero to see who plays it and how.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero result panel
// ──────────────────────────────────────────────────────────────────────────

function HeroResultPanel({ result }: { result: HeroResult }) {
  const leagueWr =
    result.totalLeagueGames > 0
      ? (result.totalLeagueWins / result.totalLeagueGames) * 100
      : 0;
  const pubWr =
    result.totalPubGames > 0
      ? (result.totalPubWins / result.totalPubGames) * 100
      : 0;

  return (
    <div>
      {/* Hero header */}
      <div className="mb-4 flex items-center gap-3">
        <img
          src={`${HERO_CDN}/${result.shortName}.png`}
          alt={result.heroName}
          className="h-10 w-[72px] rounded object-cover"
        />
        <div>
          <h4 className="text-base font-semibold text-ink-100">{result.heroName}</h4>
          <div className="flex flex-wrap gap-3 font-mono text-[11px] text-ink-300">
            {result.totalLeagueGames > 0 && (
              <span>
                league: {result.totalLeagueGames}g{" "}
                <span className={wrColor(leagueWr)}>{leagueWr.toFixed(0)}%</span>
              </span>
            )}
            {result.totalPubGames > 0 && (
              <span>
                pub: {result.totalPubGames}g{" "}
                <span className={wrColor(pubWr)}>{pubWr.toFixed(0)}%</span>
              </span>
            )}
            <span className="text-ink-500">
              last played {fmtDate(result.lastPlayed)}{" "}
              <span className="text-ink-600">({daysAgo(result.lastPlayed)})</span>
            </span>
          </div>
        </div>
      </div>

      {/* Per-player breakdown */}
      <div className="space-y-2">
        {result.players.map((entry) => (
          <HeroPlayerRow key={entry.accountId} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function HeroPlayerRow({ entry }: { entry: HeroPlayerEntry }) {
  const handle = entry.playerName ?? `#${entry.accountId}`;
  const posLabel = entry.position
    ? `Pos ${entry.position} (${POSITION_NAMES[entry.position as Position]})`
    : "Unknown pos";

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900/50 p-3">
      {/* Player identity */}
      <div className="mb-2 flex items-center gap-2">
        <RankBadge rank={entry.rank} size="sm" />
        <a
          href={`https://stratz.com/players/${entry.accountId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-ink-100 hover:text-accent-flex hover:underline"
        >
          {handle}
        </a>
        <span className="text-[11px] text-ink-400">{posLabel}</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {entry.league && (
          <HeroStatBlock
            label="League"
            perf={entry.league}
          />
        )}
        {entry.pub && (
          <HeroStatBlock
            label="Pub"
            perf={entry.pub}
          />
        )}
      </div>
    </div>
  );
}

function HeroStatBlock({
  label,
  perf,
}: {
  label: string;
  perf: HeroPerf;
}) {
  const wr = perf.winRate * 100;
  return (
    <div className="rounded border border-ink-700/60 bg-ink-800/50 px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
        <StatRow label="Games" value={String(perf.matches)} />
        <StatRow label="Wins" value={`${perf.wins} (${perf.matches - perf.wins}L)`} />
        <StatRow
          label="Win rate"
          value={`${wr.toFixed(0)}%`}
          valueClass={wrColor(wr)}
        />
        <StatRow
          label="Share"
          value={`${(perf.share * 100).toFixed(0)}%`}
          valueClass="text-ink-300"
        />
        <StatRow label="Last played" value={fmtDate(perf.lastPlayed)} />
        <StatRow
          label="Recency"
          value={daysAgo(perf.lastPlayed)}
          valueClass="text-ink-400"
        />
      </div>
      {perf.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {perf.tags.map((t) => (
            <MiniTag key={t} tag={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] text-ink-500">{label}</span>
      <span className={valueClass ?? "text-ink-200"}>{value}</span>
    </div>
  );
}

function MiniTag({ tag }: { tag: string }) {
  const cls =
    tag === "COMF"
      ? "bg-accent-good/15 text-accent-good"
      : tag === "GEM"
        ? "bg-accent-gem/15 text-accent-gem"
        : tag === "SPAM"
          ? "bg-accent-mid/15 text-accent-mid"
          : tag === "FLEX"
            ? "bg-accent-flex/20 text-accent-flex"
            : tag === "PUB"
              ? "bg-ink-600/60 text-ink-300 ring-1 ring-ink-500"
              : "bg-ink-600 text-ink-200";
  return (
    <span
      className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {tag}
    </span>
  );
}

function wrColor(wr: number): string {
  if (wr >= 60) return "text-accent-good";
  if (wr >= 50) return "text-accent-mid";
  return "text-accent-bad";
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className="text-ink-400">
      <svg
        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </span>
  );
}

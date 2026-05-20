// OpenDota REST client. No auth, no IP pin, free tier — used at build time
// alongside STRATZ to pull per-player match history.
//
// Why we need OpenDota:
//   STRATZ's `heroesPerformance(positionIds: [...])` query requires position
//   classification, which requires a parsed replay. For amateur teams the
//   parse rate can be ~15–45%, so STRATZ was silently dropping the majority
//   of pub games (the 78 vs 452 discrepancy we observed for Haj).
//
//   OpenDota's `/players/{id}/matches` returns every match it has metadata
//   for, parsed or not. Game counts are complete; only lane attribution is
//   gated on parse status, and we don't use lane attribution for pub data
//   anymore (it's position-agnostic per the new design).
//
// Bucketing rules (mirrored in fetch-team-data.ts):
//   league/scrim: lobby_type ∈ {1 (private lobby), 2 (tournament)}
//                 AND game_mode ∈ {2 (Captain's Mode), 16 (Captains Draft)}
//   pub:          lobby_type ∈ {0 (unranked), 7 (ranked)}
//
// Lobby/mode IDs verified empirically against an amateur team's match list —
// see the design discussion in the conversation log. Other lobby types
// (bot games, event modes, party finder) are intentionally ignored.

import { ApiError } from "./errors";

export const OPENDOTA_BASE = "https://api.opendota.com/api";
// 45s — OpenDota's /players/{id}/matches can be slow when the player has a
// large lifetime history (the date filter is applied after row scan on
// their end, so cold-cache pulls for veterans easily exceed 20s).
const DEFAULT_TIMEOUT_MS = 45000;
// 3 retries with exponential backoff (400 → 800 → 1600 → 3200ms). Combined
// with the 45s timeout, worst case for a single request is ~3 minutes,
// which we tolerate during a one-off prefetch.
const DEFAULT_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Lobby types we treat as competitive "league/scrim" volume. Captain's-mode
 *  private lobbies (lt=1) are how amateur teams scrim; lt=2 is reserved for
 *  Valve-tracked tournaments (DPC, Majors). Both belong in the same bucket
 *  for drafting-intel purposes. */
export const LEAGUE_LOBBY_TYPES: ReadonlySet<number> = new Set([1, 2]);

/** Game modes we accept as competitive drafting modes within league lobbies.
 *  Pubs in lt=1 happen too (custom games, AP scrims) — we keep this filter
 *  tight so casual practice doesn't pollute the league bucket. */
export const LEAGUE_GAME_MODES: ReadonlySet<number> = new Set([
  2, // Captain's Mode
  16, // Captains Draft
]);

/** Lobby types we treat as matchmade public games. */
export const PUB_LOBBY_TYPES: ReadonlySet<number> = new Set([0, 7]);

/** One row from /players/{id}/matches. OpenDota returns many more fields
 *  (kills/deaths/items/etc.) — we keep the type narrow to what we actually
 *  consume so the contract surface stays small. */
export interface OpenDotaMatchRow {
  match_id: number;
  player_slot: number; // 0-4 = radiant, 128-132 = dire
  radiant_win: boolean;
  hero_id: number;
  start_time: number; // unix seconds
  duration: number;
  game_mode: number;
  lobby_type: number;
  /** Replay-parse version. null = unparsed (still counts toward totals,
   *  but lane/items/etc. are unavailable). We don't gate on this. */
  version: number | null;
}

export interface OpenDotaClient {
  /** Fetch a player's match list within the date window (in days). Cap
   *  applies server-side; default 2000 is plenty for any realistic 180d
   *  window — even a 4-games-per-day grinder lands at ~1100. */
  fetchPlayerMatches(
    accountId: number,
    dateDays: number,
    limit?: number,
  ): Promise<OpenDotaMatchRow[]>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createOpenDotaClient(): OpenDotaClient {
  async function fetchPlayerMatches(
    accountId: number,
    dateDays: number,
    limit = 2000,
  ): Promise<OpenDotaMatchRow[]> {
    const url = `${OPENDOTA_BASE}/players/${accountId}/matches?date=${dateDays}&limit=${limit}`;
    return request<OpenDotaMatchRow[]>(url, `matches:${accountId}`);
  }

  return { fetchPlayerMatches };
}

async function request<T>(url: string, opLabel: string): Promise<T> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= DEFAULT_RETRIES) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          // OpenDota has no auth requirement for /players endpoints; the
          // UA string is just polite identification for their access logs.
          "User-Agent": "dota-cli (build-time prefetch)",
        },
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        if (RETRYABLE_STATUSES.has(res.status) && attempt < DEFAULT_RETRIES) {
          attempt++;
          await sleep(2 ** attempt * 400);
          continue;
        }
        throw new ApiError(
          `OpenDota HTTP ${res.status} ${res.statusText} on ${opLabel}: ${text.slice(0, 240)}`,
          res.status,
          "http_error",
          text,
          url,
        );
      }
      return (await res.json()) as T;
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      lastErr = err;
      const e = err as { name?: string; message?: string };
      const isAbort = e?.name === "AbortError";
      if (attempt < DEFAULT_RETRIES) {
        attempt++;
        await sleep(2 ** attempt * 400);
        continue;
      }
      throw new ApiError(
        isAbort
          ? `OpenDota request timed out after ${DEFAULT_TIMEOUT_MS}ms (${opLabel})`
          : `OpenDota network error on ${opLabel}: ${e?.message ?? String(err)}`,
        0,
        isAbort ? "timeout" : "network_error",
        undefined,
        url,
      );
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/** Classify a raw match row into a competitive bucket. Returns null when
 *  the match doesn't belong to any drafting-intel bucket (bots, events,
 *  party-finder, etc.). Single source of truth for the bucketing rules so
 *  the prefetch pipeline and any future debug tooling stay in sync. */
export function classifyMatch(row: OpenDotaMatchRow): "league" | "pub" | null {
  if (LEAGUE_LOBBY_TYPES.has(row.lobby_type) && LEAGUE_GAME_MODES.has(row.game_mode)) {
    return "league";
  }
  if (PUB_LOBBY_TYPES.has(row.lobby_type)) return "pub";
  return null;
}

/** True if the radiant side won AND the player was on radiant, OR dire won
 *  AND player was on dire. OpenDota encodes side in player_slot's high bit
 *  (0–127 = radiant, 128+ = dire). */
export function playerWon(row: OpenDotaMatchRow): boolean {
  const isRadiant = row.player_slot < 128;
  return isRadiant ? row.radiant_win : !row.radiant_win;
}

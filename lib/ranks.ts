// Dota 2 rank tier decoding + display assets.
//
// STRATZ exposes `Player.steamAccount.seasonRank` as a 2-digit code where the
// tens digit is the tier (1-8 from Herald → Immortal) and the ones digit is
// the star (1-5; 0 or unused for Immortal). `seasonLeaderboardRank` is the
// Immortal ladder position.
//
// Tier medal art is on the dota2.com CDN at
// /apps/dota2/images/dota_react/icons/seasonal_rank/medal_<tier>.png.
// Star is shown as a small text overlay (the combined tier+star asset URL
// pattern isn't a stable public path).

import type { PlayerRank } from "./types";

const TIER_NAMES: Record<number, string> = {
  1: "Herald",
  2: "Guardian",
  3: "Crusader",
  4: "Archon",
  5: "Legend",
  6: "Ancient",
  7: "Divine",
  8: "Immortal",
};

const TIER_COLORS: Record<number, string> = {
  1: "text-stone-400",
  2: "text-lime-400",
  3: "text-amber-500",
  4: "text-sky-400",
  5: "text-fuchsia-400",
  6: "text-rose-400",
  7: "text-cyan-300",
  8: "text-yellow-300",
};

const MEDAL_BASE =
  "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/icons/seasonal_rank";

export function decodeRank(
  seasonRank: number | null | undefined,
  leaderboardRank: number | null | undefined = null,
): PlayerRank | null {
  if (typeof seasonRank !== "number" || seasonRank < 11) return null;
  const tier = Math.floor(seasonRank / 10);
  const star = seasonRank % 10;
  if (tier < 1 || tier > 8) return null;
  const tierName = TIER_NAMES[tier] ?? "Unknown";
  const isImmortal = tier === 8;
  const lb =
    typeof leaderboardRank === "number" && leaderboardRank > 0
      ? leaderboardRank
      : null;
  const label = isImmortal
    ? lb
      ? `Immortal #${lb}`
      : "Immortal"
    : `${tierName} ${star || ""}`.trim();
  return {
    seasonRank,
    tier,
    stars: isImmortal ? null : star >= 1 && star <= 5 ? star : null,
    label,
    leaderboardRank: lb,
  };
}

export function rankMedalUrl(tier: number): string {
  return `${MEDAL_BASE}/medal_${tier}.png`;
}

export function rankTierColor(tier: number): string {
  return TIER_COLORS[tier] ?? "text-ink-300";
}

export function rankTierName(tier: number): string {
  return TIER_NAMES[tier] ?? "Unknown";
}

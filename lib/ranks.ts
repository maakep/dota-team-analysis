// Dota 2 rank tier decoding + display assets.
//
// STRATZ exposes `Player.steamAccount.seasonRank` as a 2-digit code where the
// tens digit is the tier (1-8 from Herald → Immortal) and the ones digit is
// the star (1-5; 0 or unused for Immortal). `seasonLeaderboardRank` is the
// Immortal ladder position.
//
// Medal art used to live on Valve's Steam CDN at
// `cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/icons/seasonal_rank/medal_<tier>.png`
// but Valve removed that path some time in late 2026 (hero portraits at the
// same CDN still work — only the rank medals are gone). We mirror from
// OpenDota, which hosts both the tier base medals and per-star transparent
// overlays so we can compose the canonical look instead of stamping a text
// star on top.

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

const MEDAL_BASE = "https://www.opendota.com/assets/images/dota2/rank_icons";

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
  return `${MEDAL_BASE}/rank_icon_${tier}.png`;
}

/** Transparent star-pip overlay (1-5). Composited on top of the tier
 *  medal to produce the full "Ancient 3" look. Immortal has no stars. */
export function rankStarUrl(star: number): string {
  return `${MEDAL_BASE}/rank_star_${star}.png`;
}

export function rankTierColor(tier: number): string {
  return TIER_COLORS[tier] ?? "text-ink-300";
}

export function rankTierName(tier: number): string {
  return TIER_NAMES[tier] ?? "Unknown";
}

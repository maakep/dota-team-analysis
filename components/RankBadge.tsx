import type { PlayerRank } from "@/lib/types";
import { rankMedalUrl, rankStarUrl, rankTierColor } from "@/lib/ranks";

const SIZES = {
  sm: "h-5 w-5",
  md: "h-7 w-7",
  lg: "h-10 w-10",
  xl: "h-14 w-14",
} as const;

/** Renders a rank medal (tier image + star overlay) optionally followed by
 *  the textual label. The star transparency overlays from OpenDota line
 *  up exactly with the medal base, so we stack them as absolutely-
 *  positioned siblings.
 *
 *  Default usage shows just the medal — the canonical Dota presentation
 *  in-client never repeats the tier name next to it. Pass `showLabel` to
 *  add the "Ancient 3" / "Immortal #42" caption. */
export function RankBadge({
  rank,
  size = "lg",
  showLabel = false,
}: {
  rank: PlayerRank | null;
  size?: keyof typeof SIZES;
  showLabel?: boolean;
}) {
  if (!rank) {
    return (
      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        Unranked
      </span>
    );
  }
  const dim = SIZES[size];
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`relative inline-block ${dim}`}>
        <img
          src={rankMedalUrl(rank.tier)}
          alt={rank.label}
          title={rank.label}
          loading="lazy"
          className={`${dim} block object-contain`}
        />
        {rank.stars !== null && (
          <img
            src={rankStarUrl(rank.stars)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className={`${dim} pointer-events-none absolute inset-0 object-contain`}
          />
        )}
      </span>
      {showLabel && (
        <span className={`text-xs font-medium ${rankTierColor(rank.tier)}`}>
          {rank.label}
        </span>
      )}
    </span>
  );
}

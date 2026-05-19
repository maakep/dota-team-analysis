import type { PlayerRank } from "@/lib/types";
import { rankMedalUrl, rankTierColor } from "@/lib/ranks";

/** Renders a rank medal (tier image + star number + label) or a muted
 *  "Unranked" pill if the profile didn't expose a rank. */
export function RankBadge({
  rank,
  size = "md",
}: {
  rank: PlayerRank | null;
  size?: "sm" | "md";
}) {
  if (!rank) {
    return (
      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        Unranked
      </span>
    );
  }
  const dim = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const textCls = size === "sm" ? "text-[11px]" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 ${textCls}`}>
      <span className="relative inline-block">
        <img
          src={rankMedalUrl(rank.tier)}
          alt=""
          title={rank.label}
          loading="lazy"
          className={`${dim} block object-contain`}
        />
        {rank.stars !== null && (
          <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 rounded bg-ink-900/90 px-1 text-[8px] font-bold leading-none text-ink-100 ring-1 ring-ink-700">
            {rank.stars}
          </span>
        )}
      </span>
      <span className={`font-medium ${rankTierColor(rank.tier)}`}>
        {rank.label}
      </span>
    </span>
  );
}

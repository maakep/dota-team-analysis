// Hero portrait sourced from the dota2.com CDN. `shortName` is STRATZ's
// HeroType.shortName (e.g. "antimage", "queenofpain") — matches the dota2_react
// asset naming exactly. We use a plain <img> to keep the static export simple.

const BASE =
  "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";

const SIZES = {
  sm: "h-7 w-12", // 234×130 source, scaled compact
  md: "h-10 w-[68px]",
  lg: "h-14 w-24",
  banner: "w-full aspect-[234/130]", // full-width landscape banner for cards
} as const;

export function HeroIcon({
  shortName,
  name,
  size = "sm",
  className = "",
}: {
  shortName: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const dims = SIZES[size];
  if (!shortName) {
    return (
      <div
        className={`${dims} ${className} shrink-0 rounded bg-ink-700`}
        title={name}
      />
    );
  }
  return (
    <img
      src={`${BASE}/${shortName}.png`}
      alt={name}
      title={name}
      loading="lazy"
      className={`${dims} ${className} block shrink-0 rounded object-cover ring-1 ring-ink-700`}
    />
  );
}

import type { HeroPerf } from "@/lib/types";
import { HeroIcon } from "./HeroIcon";

export function PickList({
  heroes,
  empty = "No data",
}: {
  heroes: HeroPerf[];
  empty?: string;
}) {
  if (heroes.length === 0) {
    return <p className="text-xs italic text-ink-400">{empty}</p>;
  }
  return (
    <ul className="space-y-1">
      {heroes.map((h) => (
        <li
          key={h.heroId}
          className="flex items-center gap-2.5 rounded px-1 py-1 hover:bg-ink-700/40"
        >
          <HeroIcon shortName={h.shortName} name={h.heroName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm text-ink-100">
                {h.heroName}
              </span>
              {h.tags.map((t) => (
                <Tag key={t} tag={t} />
              ))}
            </div>
            <div className="font-mono text-[11px] text-ink-400">
              {h.matches}g · {(h.share * 100).toFixed(0)}% share
            </div>
          </div>
          <div
            className={`shrink-0 text-right font-mono text-xs ${wrColor(h.winRate, h.matches)}`}
          >
            {(h.winRate * 100).toFixed(0)}%
            <div className="text-[10px] text-ink-400">
              {h.wins}-{h.matches - h.wins}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Tag({ tag }: { tag: string }) {
  const cls =
    tag === "COMF"
      ? "bg-accent-good/15 text-accent-good"
      : tag === "GEM"
        ? "bg-accent-gem/15 text-accent-gem"
        : tag === "SPAM"
          ? "bg-accent-mid/15 text-accent-mid"
          : "bg-ink-600 text-ink-200";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {tag}
    </span>
  );
}

function wrColor(wr: number, games: number): string {
  if (games < 3) return "text-ink-300";
  if (wr >= 0.6) return "text-accent-good";
  if (wr >= 0.5) return "text-accent-mid";
  return "text-accent-bad";
}
